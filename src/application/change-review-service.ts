import crypto from 'node:crypto';
import path from 'node:path';
import type {
  ChangedFileDiff,
  ChangeReviewReport,
  KnowledgeEntry,
  RepositoryAnalyzerAdapter,
  RepositorySnapshot,
  ReviewFinding,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';
import { buildDependencyLookup } from '../infrastructure/dependency/dependency-graph.js';
import { scanForPromptInjection } from '../infrastructure/repo-access/prompt-injection-scanner.js';
import { computeSha256 } from '../infrastructure/repo-access/safe-fs.js';
import { getRepositoryGitDiffs, parseUnifiedGitDiff } from '../infrastructure/repo-access/safe-git.js';
import { isConfigTemplateFilePath, isSensitiveFilePath } from '../infrastructure/repo-access/secret-scanner.js';
import { classifyFileRole } from '../infrastructure/scanning/tier0-scanner.js';

export async function reviewRepositoryChanges(params: {
  readonly snapshot: RepositorySnapshot;
  readonly knowledgeEntries: readonly KnowledgeEntry[];
  readonly adapters: readonly RepositoryAnalyzerAdapter[];
  readonly targetSpec?: string;
  readonly rawDiffOverride?: string;
}): Promise<ChangeReviewReport> {
  let diffLabel: string;
  let changedFiles: readonly ChangedFileDiff[];

  if (params.rawDiffOverride !== undefined && params.rawDiffOverride.trim().length > 0) {
    diffLabel = params.targetSpec ?? 'Custom Unified Diff';
    changedFiles = parseUnifiedGitDiff(params.rawDiffOverride);
  } else {
    const gitDiff = await getRepositoryGitDiffs(
      params.snapshot.rootPath,
      params.targetSpec ?? 'WORKING_TREE'
    );
    diffLabel = gitDiff.label;
    changedFiles = gitDiff.files;
  }

  const fileMap = new Map(params.snapshot.files.map((f) => [f.relativePath, f]));
  const indexedPaths = new Set(
    params.snapshot.files.filter((f) => f.isIndexed).map((f) => f.relativePath)
  );
  const depLookup = buildDependencyLookup(params.snapshot.dependencyEdges, indexedPaths);

  const changedPathsSet = new Set(changedFiles.map((c) => c.relativePath));
  const changedTestPaths = changedFiles
    .filter((c) => {
      const existing = fileMap.get(c.relativePath);
      const role = existing?.role ?? classifyFileRole(c.relativePath, true, '');
      return role === 'test';
    })
    .map((c) => c.relativePath);

  const findings: ReviewFinding[] = [];
  const impactedSubProjectIds = new Set<string>();
  const downstreamDependents: {
    readonly changedPath: string;
    readonly dependentPaths: readonly string[];
  }[] = [];

  const commitSha = params.snapshot.gitMetadata.headCommitSha ?? undefined;

  for (const diff of changedFiles) {
    const existingFile = fileMap.get(diff.relativePath);
    if (existingFile?.subProjectId) {
      impactedSubProjectIds.add(existingFile.subProjectId);
    }

    const fileSha256 =
      existingFile?.sha256 ?? computeSha256(`${diff.relativePath}:${diff.rawPatchExcerpt}`);
    const firstChangedLine = diff.addedLines[0]?.lineNumber ?? diff.removedLines[0]?.lineNumber ?? 1;
    const lastChangedLine =
      diff.addedLines[diff.addedLines.length - 1]?.lineNumber ?? firstChangedLine;

    const baseRef = createSourceRef({
      repoId: params.snapshot.repoId,
      relativePath: diff.relativePath,
      fileSha256,
      startLine: firstChangedLine,
      endLine: lastChangedLine,
      ...(commitSha ? { commitSha } : {}),
    });

    const role = existingFile?.role ?? classifyFileRole(diff.relativePath, true, '');

    // 1. Sensitive file or security-critical module change detection
    const lowerPath = diff.relativePath.toLowerCase();
    if (
      isSensitiveFilePath(diff.relativePath) ||
      isConfigTemplateFilePath(diff.relativePath) ||
      role === 'ci_workflow' ||
      role === 'manifest' ||
      /(?:^|\/)(?:auth|security|crypto|permissions?|rbac|oauth|jwt|secrets?)(?:\/|\.|_|-)/i.test(
        lowerPath
      )
    ) {
      findings.push({
        id: `finding:sensitive:${diff.relativePath}`,
        severity: isSensitiveFilePath(diff.relativePath) ? 'critical' : 'warning',
        category: 'sensitive_file_change',
        title: `Security-sensitive or configuration file modified: ${diff.relativePath}`,
        description: `Changes in "${diff.relativePath}" (${diff.changeType}, +${diff.additions}/-${diff.deletions}) affect authentication, build manifests, CI pipelines, or environment configuration templates.`,
        certainty: 'verified',
        producerId: 'tier0.change_review',
        evidence: [baseRef],
        impactedPaths: [diff.relativePath],
        remediationHint:
          'Verify no secrets or weakened access controls were introduced and confirm configuration template changes are documented.',
      });
    }

    // 2. Downstream blast-radius & potential regression analysis via module dependency graph
    const dependents = depLookup.incomingByPath.get(diff.relativePath) ?? [];
    if (dependents.length > 0) {
      downstreamDependents.push({
        changedPath: diff.relativePath,
        dependentPaths: dependents,
      });

      const untouchedDependents = dependents.filter((d) => !changedPathsSet.has(d));
      if (untouchedDependents.length > 0 && (diff.deletions > 0 || diff.changeType === 'deleted')) {
        findings.push({
          id: `finding:regression:${diff.relativePath}`,
          severity: diff.changeType === 'deleted' ? 'critical' : 'warning',
          category: 'potential_regression',
          title: `Modified module "${diff.relativePath}" has ${untouchedDependents.length} unchanged dependent file(s)`,
          description: `"${diff.relativePath}" has deletions or signature changes while ${untouchedDependents.length} dependent module(s) (${untouchedDependents.slice(0, 5).join(', ')}) were not updated in this diff.`,
          certainty: 'verified',
          producerId: 'tier0.dependency_blast_radius',
          evidence: [baseRef],
          impactedPaths: [diff.relativePath, ...untouchedDependents],
          remediationHint: `Inspect dependent modules (${untouchedDependents.slice(0, 5).join(', ')}) to ensure exported contracts remain compatible.`,
        });
      }
    }

    // 3. Missing test coverage detection for modified/added source files
    if (role === 'source' && diff.changeType !== 'deleted' && diff.additions > 0) {
      const stem = path.posix
        .basename(diff.relativePath, path.posix.extname(diff.relativePath))
        .toLowerCase();
      const hasMatchingTestChange = changedTestPaths.some((tp) =>
        tp.toLowerCase().includes(stem)
      );
      if (!hasMatchingTestChange) {
        findings.push({
          id: `finding:missing_test:${diff.relativePath}`,
          severity: 'warning',
          category: 'missing_test_coverage',
          title: `Source change in "${diff.relativePath}" without corresponding test update`,
          description: `Source file "${diff.relativePath}" added/modified ${diff.additions} line(s), but no test file matching "${stem}" was modified in this change set.`,
          certainty: 'inferred',
          producerId: 'tier0.change_review',
          evidence: [baseRef],
          impactedPaths: [diff.relativePath],
          remediationHint: `Add or update unit/integration tests covering the changes in "${diff.relativePath}".`,
        });
      }
    }

    // 4. Prompt injection check on added lines
    if (diff.addedLines.length > 0) {
      const addedText = diff.addedLines.map((l) => l.content).join('\n');
      const injectionAlerts = scanForPromptInjection({
        repoId: params.snapshot.repoId,
        relativePath: diff.relativePath,
        fileSha256,
        ...(commitSha ? { commitSha } : {}),
        content: addedText,
      });

      for (const alert of injectionAlerts) {
        findings.push({
          id: `finding:injection:${diff.relativePath}:${alert.patternId}`,
          severity: 'critical',
          category: 'prompt_injection_risk',
          title: `Prompt injection pattern (${alert.patternId}) added in ${diff.relativePath}`,
          description: `${alert.description} Matched excerpt: "${alert.matchedExcerptRedacted}".`,
          certainty: 'verified',
          producerId: 'security.prompt_injection_scanner',
          evidence: [baseRef],
          impactedPaths: [diff.relativePath],
          remediationHint:
            'Remove instruction-override phrases or bidirectional control characters from repository source/comments.',
        });
      }
    }

    // 5. Invoke Tier-1 Adapter diff risk inspectors (e.g., SqlMigrationAdapter)
    const pseudoRecord = existingFile ?? {
      relativePath: diff.relativePath,
      subProjectId: null,
      sizeBytes: diff.rawPatchExcerpt.length,
      lineCount: diff.addedLines.length,
      sha256: fileSha256,
      detectedLanguage: null,
      role,
      isIndexed: true,
      lastModifiedIso: new Date().toISOString(),
    };

    for (const adapter of params.adapters) {
      if (adapter.inspectFileDiff && adapter.supportsFile(pseudoRecord)) {
        const adapterFindings = await adapter.inspectFileDiff({
          repoId: params.snapshot.repoId,
          ...(commitSha ? { commitSha } : {}),
          diff,
          currentFileSha256: fileSha256,
        });
        findings.push(...adapterFindings);
      }
    }
  }

  // 6. Check if any Project Knowledge / ADR entries reference files modified in this diff
  for (const k of params.knowledgeEntries) {
    const touchedRefs = k.linkedReferences.filter((r) => changedPathsSet.has(r.relativePath));
    if (touchedRefs.length > 0) {
      findings.push({
        id: `finding:stale_knowledge:${k.id}`,
        severity: 'info',
        category: 'stale_knowledge_impact',
        title: `Project knowledge "${k.title}" references modified file(s)`,
        description: `Knowledge entry "${k.title}" (${k.category}) is anchored to ${touchedRefs.map((r) => r.relativePath).join(', ')}, which was modified in this diff.`,
        certainty: 'verified',
        producerId: 'tier0.knowledge_tracker',
        evidence: touchedRefs,
        impactedPaths: touchedRefs.map((r) => r.relativePath),
        remediationHint: `Review "${k.title}" in the Project Knowledge view and update its summary or re-anchor its source fingerprint.`,
      });
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  return {
    reviewId: `rev_${crypto.randomUUID().slice(0, 12)}`,
    repoId: params.snapshot.repoId,
    snapshotId: params.snapshot.snapshotId,
    createdAtIso: new Date().toISOString(),
    diffTargetLabel: diffLabel,
    changedFiles,
    findings,
    impactedSubProjectIds: Array.from(impactedSubProjectIds),
    downstreamDependents,
    stats: {
      totalChangedFiles: changedFiles.length,
      criticalCount,
      warningCount,
      infoCount,
    },
  };
}
