import type {
  ReportGeneratorPort,
  RepositorySnapshot,
  SourceReference,
} from '../../domain/index.js';

function formatSourceRefs(refs: readonly SourceReference[]): string {
  if (refs.length === 0) return '_(no direct file reference)_';
  return refs
    .map(
      (r) =>
        `\`${r.relativePath}:${r.startLine ?? 1}-${r.endLine ?? 1}\` (sha256:\`${r.fileSha256.slice(0, 10)}\`)`
    )
    .join(', ');
}

/**
 * Generates a deterministic, stack-agnostic Markdown repository analysis report
 * directly from a RepositorySnapshot without requiring any AI provider.
 */
export function generateRepositoryMarkdownReport(
  snapshot: RepositorySnapshot,
  options?: { readonly includeTimestamps?: boolean }
): string {
  const includeTimestamps = options?.includeTimestamps ?? true;
  const sections: string[] = [];

  // 1. Report Header & Git / Snapshot Provenance
  sections.push(
    [
      `# ContextForge Repository Analysis Report: ${snapshot.repoName}`,
      `- **Repository ID**: \`${snapshot.repoId}\``,
      ...(includeTimestamps
        ? [
            `- **Snapshot ID**: \`${snapshot.snapshotId}\``,
            `- **Analyzed Timestamp**: \`${snapshot.analyzedAtIso}\``,
          ]
        : []),
      `- **Analysis Mode**: Deterministic Local Engine (No AI Provider Required)`,
      `- **Git Repository**: \`${snapshot.gitMetadata.isGitRepo ? 'yes' : 'no'}\``,
      ...(snapshot.gitMetadata.isGitRepo
        ? [
            `- **Git Branch**: \`${snapshot.gitMetadata.currentBranch ?? 'detached'}\``,
            `- **Git HEAD Revision**: \`${snapshot.gitMetadata.headCommitSha ?? 'uncommitted'}\``,
            `- **Working Tree Dirty**: \`${snapshot.gitMetadata.isDirty ? 'yes' : 'no'}\``,
          ]
        : []),
    ].join('\n')
  );

  // 2. Inventory & Security Boundary Summary
  sections.push(
    [
      `## 1. Inventory & Security Summary`,
      `- **Total Files Discovered**: ${snapshot.stats.totalFilesDiscovered}`,
      `- **Files Indexed**: ${snapshot.stats.totalFilesIndexed}`,
      `- **Files Excluded**: ${snapshot.stats.totalFilesExcluded}`,
      `- **Secrets & Sensitive Files Excluded**: ${snapshot.stats.secretExclusionsCount}`,
      `- **Symlink / Path Escapes Blocked**: ${snapshot.stats.symlinkEscapesBlocked}`,
      `- **Inaccessible / Permission-Denied Files**: ${snapshot.stats.inaccessibleFilesCount ?? 0}`,
      `- **Total Symbols Extracted**: ${snapshot.stats.totalSymbolsExtracted}`,
      `- **Sub-Projects Discovered**: ${snapshot.subProjects.length}`,
    ].join('\n')
  );

  // 3. Analyzer Execution Log (Ran vs. Skipped vs. Partial Error)
  const execLog = snapshot.analyzerExecutionLog ?? [];
  sections.push(
    [
      `## 2. Analyzer Execution Log`,
      execLog.length === 0
        ? `- Active Adapters: ${snapshot.activeAdapters.map((a) => `\`${a}\``).join(', ')}`
        : execLog
            .map(
              (entry) =>
                `- **[${entry.status.toUpperCase()}]** \`${entry.adapterId}\` (${entry.displayName}) — Matched Files: ${entry.filesMatchedCount} — ${entry.reasonOrNotes.join('; ')}`
            )
            .join('\n'),
    ].join('\n')
  );

  // 4. Monorepo & Sub-Project Topology
  const sortedSubProjects = [...snapshot.subProjects].sort((a, b) =>
    a.rootPath.localeCompare(b.rootPath)
  );

  const subProjectBlocks = sortedSubProjects.map((sp) => {
    const langs = [...sp.languages].sort((a, b) => a.value.localeCompare(b.value));
    const fws = [...sp.frameworks].sort((a, b) => a.value.localeCompare(b.value));
    const pms = [...sp.packageManagers].sort((a, b) => a.value.localeCompare(b.value));
    const builds = [...sp.buildSystems].sort((a, b) => a.value.localeCompare(b.value));
    const tests = [...sp.testHarnesses].sort((a, b) => a.value.localeCompare(b.value));
    const eps = [...sp.entryPoints].sort((a, b) =>
      a.value.identifier.localeCompare(b.value.identifier)
    );
    const apis = [...sp.apiSurfaces].sort((a, b) =>
      a.value.routeOrSignature.localeCompare(b.value.routeOrSignature)
    );
    const dbs = [...sp.databaseObjects].sort((a, b) => a.value.name.localeCompare(b.value.name));

    return [
      `### Sub-Project: \`${sp.name}\` (\`${sp.kind}\` at \`${sp.rootPath || '/'}\`)`,
      `- **Manifests (${sp.manifests.length})**: ${sp.manifests.length > 0 ? formatSourceRefs(sp.manifests) : '_(none)_'}`,
      `- **Lockfiles (${sp.lockfiles?.length ?? 0})**: ${(sp.lockfiles?.length ?? 0) > 0 ? formatSourceRefs(sp.lockfiles!) : '_(none)_'}`,
      `- **Languages (${langs.length})**: ${
        langs.length > 0
          ? langs
              .map(
                (l) =>
                  `**[${l.certainty.toUpperCase()}]** ${l.value} — _${l.rationale}_ (${formatSourceRefs(l.evidence)})`
              )
              .join('; ')
          : '**[UNKNOWN]** No recognized programming language files'
      }`,
      `- **Frameworks (${fws.length})**: ${
        fws.length > 0
          ? fws
              .map(
                (f) =>
                  `**[${f.certainty.toUpperCase()}]** ${f.value} (${formatSourceRefs(f.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Package Managers (${pms.length})**: ${
        pms.length > 0
          ? pms
              .map(
                (p) =>
                  `**[${p.certainty.toUpperCase()}]** ${p.value} (${formatSourceRefs(p.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Build Systems (${builds.length})**: ${
        builds.length > 0
          ? builds
              .map(
                (b) =>
                  `**[${b.certainty.toUpperCase()}]** ${b.value} (${formatSourceRefs(b.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Test Harnesses (${tests.length})**: ${
        tests.length > 0
          ? tests
              .map(
                (t) =>
                  `**[${t.certainty.toUpperCase()}]** ${t.value} (${formatSourceRefs(t.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Entry Points (${eps.length})**: ${
        eps.length > 0
          ? eps
              .map(
                (e) =>
                  `**[${e.certainty.toUpperCase()}]** \`${e.value.identifier}\` (${e.value.kind}) (${formatSourceRefs(e.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **API Specifications & Routes (${apis.length})**: ${
        apis.length > 0
          ? apis
              .map(
                (a) =>
                  `**[${a.certainty.toUpperCase()}]** \`${a.value.methodOrOperation} ${a.value.routeOrSignature}\` (${a.value.protocol}) (${formatSourceRefs(a.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Database Objects (${dbs.length})**: ${
        dbs.length > 0
          ? dbs
              .map(
                (d) =>
                  `**[${d.certainty.toUpperCase()}]** \`${d.value.objectType.toUpperCase()} ${d.value.name}\` (${formatSourceRefs(d.evidence)})`
              )
              .join('; ')
          : '_(none detected)_'
      }`,
      `- **Configuration Templates (${sp.configTemplates.length})**: ${
        sp.configTemplates.length > 0 ? formatSourceRefs(sp.configTemplates) : '_(none)_'
      }`,
      `- **Documentation Files (${sp.documentationFiles.length})**: ${
        sp.documentationFiles.length > 0 ? formatSourceRefs(sp.documentationFiles) : '_(none)_'
      }`,
    ].join('\n');
  });

  sections.push([`## 3. Monorepo & Sub-Project Topology`, ...subProjectBlocks].join('\n\n'));

  // 5. Normalized Project File Inventory
  const sortedFiles = [...snapshot.files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
  sections.push(
    [
      `## 4. Normalized File Inventory`,
      ...sortedFiles.map((f) => {
        const status = f.isIndexed
          ? `INDEXED (lines:${f.lineCount ?? 0}, sha256:\`${f.sha256.slice(0, 10)}\`)`
          : `EXCLUDED (${f.exclusionReason ?? 'excluded'})`;
        const signals =
          f.languageDetectionSignals && f.languageDetectionSignals.length > 0
            ? ` [signals: ${f.languageDetectionSignals.join(', ')}]`
            : '';
        return `- \`${f.relativePath}\` — Role: \`${f.role}\` | Language: \`${f.detectedLanguage ?? 'none'}\`${signals} | Status: ${status}`;
      }),
    ].join('\n')
  );

  // 6. Baseline Dependency Graph
  const sortedInternalEdges = [...snapshot.dependencyEdges].sort((a, b) =>
    `${a.value.fromPathOrModule}->${a.value.toPathOrModule}`.localeCompare(
      `${b.value.fromPathOrModule}->${b.value.toPathOrModule}`
    )
  );
  const sortedExternalDeps = [...snapshot.externalDependencies].sort((a, b) =>
    `${a.value.subProjectId}:${a.value.name}`.localeCompare(
      `${b.value.subProjectId}:${b.value.name}`
    )
  );

  sections.push(
    [
      `## 5. Baseline Verifiable Dependency Graph`,
      `### Internal Module, Workspace & SQL Relationships (${sortedInternalEdges.length})`,
      sortedInternalEdges.length === 0
        ? `- _(No internal module or foreign-key edges verified)_`
        : sortedInternalEdges
            .map(
              (e) =>
                `- **[${e.certainty.toUpperCase()}]** \`${e.value.fromPathOrModule}\` -> \`${e.value.toPathOrModule}\` (\`${e.value.kind}\`) — Evidence: ${formatSourceRefs(e.evidence)}`
            )
            .join('\n'),
      '',
      `### External Package Dependencies (${sortedExternalDeps.length})`,
      sortedExternalDeps.length === 0
        ? `- _(No external dependencies declared in recognized manifests)_`
        : sortedExternalDeps
            .map(
              (d) =>
                `- **[${d.certainty.toUpperCase()}]** \`${d.value.name}@${d.value.versionConstraint}\` (${d.value.ecosystem}, ${d.value.scope}) — Evidence: ${formatSourceRefs(d.evidence)}`
            )
            .join('\n'),
    ].join('\n')
  );

  // 7. Honest Unknowns, Unsupported Areas & Partial-Analysis Notes
  const sortedUnknowns = [...snapshot.unknownsAndLimitations].sort();
  sections.push(
    [
      `## 6. Unsupported Areas, Malformed Inputs & Honest Unknowns`,
      sortedUnknowns.length === 0
        ? `- _(No unsupported file types, malformed manifests, or inaccessible files encountered.)_`
        : sortedUnknowns.map((u) => `- **[UNKNOWN / LIMITATION]** ${u}`).join('\n'),
    ].join('\n')
  );

  return `${sections.join('\n\n')}\n`;
}

export class DeterministicMarkdownReportGenerator implements ReportGeneratorPort {
  public generateMarkdownReport(
    snapshot: RepositorySnapshot,
    options?: { readonly includeTimestamps?: boolean }
  ): string {
    return generateRepositoryMarkdownReport(snapshot, options);
  }
}
