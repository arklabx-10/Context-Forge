import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AnalyzerExecutionEntry,
  ApiSurfaceDescriptor,
  DatabaseObjectDescriptor,
  DependencyEdge,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExternalDependency,
  ExtractedSymbol,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
  RepositorySnapshot,
  ScanResourceLimits,
  SourceReference,
  SubProject,
} from '../../domain/index.js';
import { createSourceRef } from '../../domain/index.js';
import { DEFAULT_SCAN_RESOURCE_LIMITS, walkRepositorySafely } from '../repo-access/safe-fs.js';
import { extractGitMetadata } from '../repo-access/safe-git.js';
import {
  classifyFileRole,
  detectFileLanguageWithSignals,
  discoverSubProjectsTier0,
  extractTier0FileSignals,
} from './tier0-scanner.js';

export interface AnalyzeRepositoryResult {
  readonly snapshot: RepositorySnapshot;
  readonly indexedFileContents: ReadonlyMap<string, string>;
}

/**
 * Runs the two-tier repository analysis pipeline:
 * Tier 0 (Universal Structural Analyzer) + Tier 1 (Optional Pluggable Adapters).
 * Supports partial analysis when manifests are malformed or files are unsupported/inaccessible,
 * and records which analyzers ran and which were skipped.
 */
export async function analyzeRepository(params: {
  readonly repoId: string;
  readonly repoName?: string;
  readonly rootPath: string;
  readonly adapters: readonly RepositoryAnalyzerAdapter[];
  readonly resourceLimits?: ScanResourceLimits;
  readonly simulatedInaccessiblePaths?: readonly string[];
  readonly deterministicSnapshotMeta?: {
    readonly snapshotId: string;
    readonly analyzedAtIso: string;
  };
}): Promise<AnalyzeRepositoryResult> {
  const startTimeMs = Date.now();
  const analyzedAtIso =
    params.deterministicSnapshotMeta?.analyzedAtIso ?? new Date().toISOString();
  const limits = params.resourceLimits ?? DEFAULT_SCAN_RESOURCE_LIMITS;

  const walkResult = await walkRepositorySafely(
    params.rootPath,
    limits,
    params.simulatedInaccessiblePaths
      ? { simulatedInaccessiblePaths: params.simulatedInaccessiblePaths }
      : undefined
  );
  const gitMetadata = await extractGitMetadata(walkResult.canonicalRootPath);
  const repoName = params.repoName ?? path.basename(walkResult.canonicalRootPath);
  const commitSha = gitMetadata.headCommitSha ?? undefined;

  const { subProjects: initialSubProjects, fileSubProjectAssignment } = discoverSubProjectsTier0({
    repoId: params.repoId,
    repoName,
    ...(commitSha ? { commitSha } : {}),
    analyzedAtIso,
    discoveredFiles: walkResult.files,
  });

  const indexedFileContents = new Map<string, string>();
  const indexedFiles: IndexedFileRecord[] = [];

  for (const rawFile of walkResult.files) {
    if (rawFile.isIndexed && rawFile.decodedContent !== undefined) {
      indexedFileContents.set(rawFile.relativePath, rawFile.decodedContent);
    }

    const role = classifyFileRole(rawFile.relativePath, rawFile.isIndexed, rawFile.decodedContent);
    const langDetection = detectFileLanguageWithSignals(
      rawFile.relativePath,
      rawFile.decodedContent
    );
    const subProjectId = fileSubProjectAssignment.get(rawFile.relativePath) ?? 'sp:root';

    indexedFiles.push({
      relativePath: rawFile.relativePath,
      subProjectId,
      sizeBytes: rawFile.sizeBytes,
      lineCount: rawFile.lineCount,
      sha256: rawFile.sha256,
      detectedLanguage: langDetection.language,
      ...(langDetection.signals.length > 0
        ? { languageDetectionSignals: langDetection.signals }
        : {}),
      role,
      isIndexed: rawFile.isIndexed,
      ...(rawFile.exclusionReason ? { exclusionReason: rawFile.exclusionReason } : {}),
      lastModifiedIso: rawFile.lastModifiedIso,
    });
  }

  const allIndexedPaths = indexedFiles.filter((f) => f.isIndexed).map((f) => f.relativePath);

  // Per-subproject mutable accumulators
  const spAccumulators = new Map<
    string,
    {
      base: SubProject;
      languages: Map<string, EvidenceBackedClaim<string>>;
      frameworks: Map<string, EvidenceBackedClaim<string>>;
      packageManagers: Map<string, EvidenceBackedClaim<string>>;
      buildSystems: Map<string, EvidenceBackedClaim<string>>;
      testHarnesses: Map<string, EvidenceBackedClaim<string>>;
      entryPoints: Map<string, EvidenceBackedClaim<EntryPointDescriptor>>;
      apiSurfaces: Map<string, EvidenceBackedClaim<ApiSurfaceDescriptor>>;
      databaseObjects: Map<string, EvidenceBackedClaim<DatabaseObjectDescriptor>>;
      configTemplates: SourceReference[];
      documentationFiles: SourceReference[];
      lockfiles: SourceReference[];
      apiSpecifications: SourceReference[];
    }
  >();

  for (const sp of initialSubProjects) {
    spAccumulators.set(sp.id, {
      base: sp,
      languages: new Map(),
      frameworks: new Map(),
      packageManagers: new Map(),
      buildSystems: new Map(),
      testHarnesses: new Map(),
      entryPoints: new Map(),
      apiSurfaces: new Map(),
      databaseObjects: new Map(),
      configTemplates: [],
      documentationFiles: [],
      lockfiles: [],
      apiSpecifications: [],
    });
  }

  const allSymbols: ExtractedSymbol[] = [];
  const allDependencyEdges = new Map<string, EvidenceBackedClaim<DependencyEdge>>();
  const allExternalDeps = new Map<string, EvidenceBackedClaim<ExternalDependency>>();
  const unknownsAndLimitations = new Set<string>();
  const activeAdapterIds = new Set<string>(['tier0.structural']);

  // Track adapter execution stats (which ran, how many files matched, and any partial errors)
  const adapterTracker = new Map<
    string,
    {
      readonly adapter: RepositoryAnalyzerAdapter;
      filesMatchedCount: number;
      hasPartialError: boolean;
      notes: string[];
    }
  >();
  for (const adapter of params.adapters) {
    adapterTracker.set(adapter.adapterId, {
      adapter,
      filesMatchedCount: 0,
      hasPartialError: false,
      notes: [],
    });
  }

  // Record inaccessible files honestly
  for (const file of indexedFiles) {
    if (file.exclusionReason === 'inaccessible_or_permission_denied') {
      unknownsAndLimitations.add(
        `File "${file.relativePath}" could not be read due to permissions or filesystem inaccessibility; skipped safely.`
      );
    }
  }

  // Process each indexed file through Tier-0 and matching Tier-1 Adapters
  for (const file of indexedFiles) {
    const spAcc = spAccumulators.get(file.subProjectId ?? 'sp:root') ?? spAccumulators.get('sp:root')!;
    const fileRef = createSourceRef({
      repoId: params.repoId,
      relativePath: file.relativePath,
      fileSha256: file.sha256,
      startLine: 1,
      endLine: file.lineCount ?? 1,
      ...(commitSha ? { commitSha } : {}),
      capturedAtIso: analyzedAtIso,
    });

    if (file.role === 'config_template') {
      spAcc.configTemplates.push(fileRef);
    }
    if (file.role === 'documentation') {
      spAcc.documentationFiles.push(fileRef);
    }
    if (file.role === 'lockfile') {
      spAcc.lockfiles.push(fileRef);
    }
    if (file.role === 'api_spec') {
      spAcc.apiSpecifications.push(fileRef);
    }

    if (!file.isIndexed) {
      continue;
    }

    const content = indexedFileContents.get(file.relativePath) ?? '';
    const lines = content.split('\n');

    // Tier-0 API specification extraction (OpenAPI / GraphQL / Proto)
    if (file.role === 'api_spec') {
      const specProtocol = file.relativePath.endsWith('.proto')
        ? 'grpc'
        : file.relativePath.endsWith('.graphql') || file.relativePath.endsWith('.gql')
          ? 'graphql'
          : 'http_rest';
      const apiId = `api:spec:${file.relativePath}`;
      spAcc.apiSurfaces.set(apiId, {
        id: apiId,
        value: {
          protocol: specProtocol,
          methodOrOperation: 'SPEC',
          routeOrSignature: file.relativePath,
        },
        certainty: 'verified',
        evidence: [fileRef],
        rationale: `Discovered API specification file ${file.relativePath} (${specProtocol}).`,
        producerId: 'tier0.structural',
      });
    }

    // Record detected language claim on the owning SubProject
    if (
      file.detectedLanguage &&
      !['Markdown', 'JSON', 'YAML', 'TOML', 'XML', 'INI'].includes(file.detectedLanguage)
    ) {
      const isUnrecognized = file.detectedLanguage.startsWith('Unrecognized');
      const signalsList = file.languageDetectionSignals?.join(' + ') ?? 'extension';
      const langCertainty = isUnrecognized
        ? 'unknown'
        : file.languageDetectionSignals?.some((s) =>
              ['extension', 'filename', 'shebang'].includes(s)
            )
          ? 'verified'
          : 'inferred';

      if (!spAcc.languages.has(file.detectedLanguage)) {
        spAcc.languages.set(file.detectedLanguage, {
          id: `lang:${spAcc.base.id}:${file.detectedLanguage}`,
          value: file.detectedLanguage,
          certainty: langCertainty,
          evidence: [fileRef],
          rationale: isUnrecognized
            ? `Unrecognized source file extension detected in ${file.relativePath}; analyzed via Tier-0 structural scanner.`
            : `Detected ${file.detectedLanguage} in ${file.relativePath} via signal(s): [${signalsList}].`,
          producerId: 'tier0.structural',
        });
      }
      if (isUnrecognized) {
        unknownsAndLimitations.add(
          `File "${file.relativePath}" uses an unrecognized language/extension (${file.detectedLanguage}); deeper AST analysis is unavailable so Tier-0 structural heuristics were applied.`
        );
      }
    }

    // Tier-0 structural signals
    const tier0Signals = extractTier0FileSignals({
      repoId: params.repoId,
      ...(commitSha ? { commitSha } : {}),
      analyzedAtIso,
      file,
      content,
    });

    if (tier0Signals.entryPointClaim) {
      spAcc.entryPoints.set(tier0Signals.entryPointClaim.id, tier0Signals.entryPointClaim);
    }
    for (const sym of tier0Signals.genericSymbols) {
      allSymbols.push(sym);
    }

    // Tier-1 optional adapters (isolated with partial-analysis fault tolerance)
    for (const adapter of params.adapters) {
      if (!adapter.supportsFile(file)) {
        continue;
      }
      activeAdapterIds.add(adapter.adapterId);
      const trackEntry = adapterTracker.get(adapter.adapterId)!;
      trackEntry.filesMatchedCount += 1;

      try {
        const fragment = await adapter.analyzeFile({
          repoId: params.repoId,
          ...(commitSha ? { commitSha } : {}),
          subProjectId: spAcc.base.id,
          subProjectRootPath: spAcc.base.rootPath,
          file,
          content,
          lines,
          siblingFilePaths: allIndexedPaths,
        });

        if (fragment.subProjectNameHint && spAcc.base.rootPath !== '') {
          spAcc.base = { ...spAcc.base, name: fragment.subProjectNameHint };
        }
        if (fragment.subProjectKindHint) {
          spAcc.base = { ...spAcc.base, kind: fragment.subProjectKindHint };
        }

        for (const item of fragment.languages ?? []) spAcc.languages.set(item.value, item);
        for (const item of fragment.frameworks ?? []) spAcc.frameworks.set(item.value, item);
        for (const item of fragment.packageManagers ?? []) spAcc.packageManagers.set(item.value, item);
        for (const item of fragment.buildSystems ?? []) spAcc.buildSystems.set(item.value, item);
        for (const item of fragment.testHarnesses ?? []) spAcc.testHarnesses.set(item.value, item);
        for (const item of fragment.entryPoints ?? []) spAcc.entryPoints.set(item.id, item);
        for (const item of fragment.apiSurfaces ?? []) spAcc.apiSurfaces.set(item.id, item);
        for (const item of fragment.databaseObjects ?? []) spAcc.databaseObjects.set(item.id, item);
        for (const sym of fragment.symbols ?? []) allSymbols.push(sym);
        for (const edge of fragment.dependencyEdges ?? []) allDependencyEdges.set(edge.id, edge);
        for (const extDep of fragment.externalDependencies ?? []) allExternalDeps.set(extDep.id, extDep);
        for (const note of fragment.notesOrLimitations ?? []) {
          unknownsAndLimitations.add(note);
          trackEntry.hasPartialError = true;
          trackEntry.notes.push(note);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Adapter error';
        const errNote = `Adapter "${adapter.adapterId}" encountered an error on "${file.relativePath}": ${msg}`;
        unknownsAndLimitations.add(errNote);
        trackEntry.hasPartialError = true;
        trackEntry.notes.push(errNote);
      }
    }
  }

  // Build analyzerExecutionLog and skippedAdapters
  const analyzerExecutionLog: AnalyzerExecutionEntry[] = [
    {
      adapterId: 'tier0.structural',
      displayName: 'Tier-0 Universal Structural Scanner',
      status: 'ran',
      filesMatchedCount: indexedFiles.filter((f) => f.isIndexed).length,
      reasonOrNotes: ['Always runs on all repositories regardless of language or stack.'],
    },
  ];
  const skippedAdapters: {
    readonly adapterId: string;
    readonly displayName: string;
    readonly reason: string;
  }[] = [];

  for (const track of adapterTracker.values()) {
    if (track.filesMatchedCount === 0) {
      const reason = 'No matching manifest or source files discovered in repository.';
      skippedAdapters.push({
        adapterId: track.adapter.adapterId,
        displayName: track.adapter.displayName,
        reason,
      });
      analyzerExecutionLog.push({
        adapterId: track.adapter.adapterId,
        displayName: track.adapter.displayName,
        status: 'skipped',
        filesMatchedCount: 0,
        reasonOrNotes: [reason],
      });
    } else {
      analyzerExecutionLog.push({
        adapterId: track.adapter.adapterId,
        displayName: track.adapter.displayName,
        status: track.hasPartialError ? 'partial_error' : 'ran',
        filesMatchedCount: track.filesMatchedCount,
        reasonOrNotes:
          track.notes.length > 0
            ? track.notes
            : [`Analyzed ${track.filesMatchedCount} matching file(s).`],
      });
    }
  }

  // Finalize SubProjects and record explicit unknowns where manifests or build systems are absent
  const finalSubProjects: SubProject[] = [];
  for (const spAcc of spAccumulators.values()) {
    const ownedFiles = indexedFiles.filter((f) => f.subProjectId === spAcc.base.id);
    if (ownedFiles.length === 0 && spAcc.base.rootPath === '' && spAccumulators.size > 1) {
      continue;
    }

    if (spAcc.base.manifests.length === 0 && spAcc.base.kind !== 'workspace_root') {
      unknownsAndLimitations.add(
        `Sub-project "${spAcc.base.name}" (${spAcc.base.rootPath || 'root'}) has no recognized package manifest; external dependencies and build commands are marked as unknown.`
      );
    }

    finalSubProjects.push({
      ...spAcc.base,
      languages: Array.from(spAcc.languages.values()),
      frameworks: Array.from(spAcc.frameworks.values()),
      packageManagers: Array.from(spAcc.packageManagers.values()),
      buildSystems: Array.from(spAcc.buildSystems.values()),
      testHarnesses: Array.from(spAcc.testHarnesses.values()),
      entryPoints: Array.from(spAcc.entryPoints.values()),
      apiSurfaces: Array.from(spAcc.apiSurfaces.values()),
      databaseObjects: Array.from(spAcc.databaseObjects.values()),
      configTemplates: spAcc.configTemplates,
      documentationFiles: spAcc.documentationFiles,
      lockfiles: spAcc.lockfiles,
      apiSpecifications: spAcc.apiSpecifications,
    });
  }

  const totalFilesIndexed = indexedFiles.filter((f) => f.isIndexed).length;
  const totalFilesExcluded = indexedFiles.length - totalFilesIndexed;

  const snapshot: RepositorySnapshot = {
    snapshotId:
      params.deterministicSnapshotMeta?.snapshotId ??
      `snap_${crypto.randomUUID().slice(0, 12)}`,
    repoId: params.repoId,
    repoName,
    rootPath: walkResult.canonicalRootPath,
    analyzedAtIso,
    gitMetadata,
    subProjects: finalSubProjects,
    files: indexedFiles,
    symbols: allSymbols,
    dependencyEdges: Array.from(allDependencyEdges.values()),
    externalDependencies: Array.from(allExternalDeps.values()),
    unknownsAndLimitations: Array.from(unknownsAndLimitations),
    activeAdapters: Array.from(activeAdapterIds),
    skippedAdapters,
    analyzerExecutionLog,
    stats: {
      totalFilesDiscovered: indexedFiles.length,
      totalFilesIndexed,
      totalFilesExcluded,
      secretExclusionsCount: walkResult.secretExclusionsCount,
      symlinkEscapesBlocked: walkResult.symlinkEscapesBlocked,
      inaccessibleFilesCount: walkResult.inaccessibleFilesCount,
      totalSymbolsExtracted: allSymbols.length,
      analysisDurationMs: Math.max(1, Date.now() - startTimeMs),
    },
  };

  return { snapshot, indexedFileContents };
}
