import type { ChangeReviewReport, SourceReference } from '../../domain/index.js';

function formatEvidenceRefs(evidence: readonly SourceReference[]): string {
  if (evidence.length === 0) return '_(no direct evidence reference)_';
  return evidence
    .map(
      (r) =>
        `\`${r.relativePath}:${r.startLine ?? 1}-${r.endLine ?? 1}\` (sha256:\`${r.fileSha256.slice(0, 10)}\`)`
    )
    .join(', ');
}

/**
 * Generates an evidence-backed, deterministic Markdown report of a Git change review.
 */
export function generateChangeReviewMarkdownReport(report: ChangeReviewReport): string {
  const sections: string[] = [];

  sections.push(
    [
      `# ContextForge Git Change Review Report`,
      `- **Repository ID**: \`${report.repoId}\``,
      `- **Snapshot ID**: \`${report.snapshotId}\``,
      `- **Review ID**: \`${report.reviewId}\``,
      `- **Review Date**: \`${report.createdAtIso}\``,
      `- **Diff Target**: \`${report.diffTargetLabel}\``,
      `- **Changed Files Count**: ${report.stats.totalChangedFiles}`,
      `- **Critical Findings**: ${report.stats.criticalCount}`,
      `- **Warning Findings**: ${report.stats.warningCount}`,
      `- **Info Findings**: ${report.stats.infoCount}`,
    ].join('\n')
  );

  // 1. Critical Risk Banner
  if (report.stats.criticalCount > 0) {
    const criticals = report.findings.filter((f) => f.severity === 'critical');
    sections.push(
      [
        `## [CRITICAL RISK ALERT] ${report.stats.criticalCount} Critical Issue(s) Detected`,
        `> **Action Required**: Do not merge or deploy this change until the following critical items are remediated.`,
        '',
        ...criticals.map((c) =>
          [
            `### [CRITICAL] ${c.title}`,
            `- **Category**: \`${c.category}\``,
            `- **Evidence**: ${formatEvidenceRefs(c.evidence)}`,
            `- **Impacted Paths**: ${c.impactedPaths.map((p) => `\`${p}\``).join(', ')}`,
            `- **Description**: ${c.description}`,
            c.remediationHint ? `- **Remediation**: ${c.remediationHint}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        ),
      ].join('\n\n')
    );
  }

  // 2. Warnings & Regressions
  const warnings = report.findings.filter((f) => f.severity === 'warning');
  if (warnings.length > 0) {
    sections.push(
      [
        `## Warnings & Potential Regressions (${warnings.length})`,
        ...warnings.map((w) =>
          [
            `### [WARNING] ${w.title}`,
            `- **Category**: \`${w.category}\``,
            `- **Evidence**: ${formatEvidenceRefs(w.evidence)}`,
            `- **Impacted Paths**: ${w.impactedPaths.map((p) => `\`${p}\``).join(', ')}`,
            `- **Description**: ${w.description}`,
            w.remediationHint ? `- **Remediation**: ${w.remediationHint}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        ),
      ].join('\n\n')
    );
  }

  // 3. Stale Knowledge & ADR Impact
  const staleKnowledgeFindings = report.findings.filter(
    (f) => f.category === 'stale_knowledge_impact'
  );
  if (staleKnowledgeFindings.length > 0) {
    sections.push(
      [
        `## Affected Project Knowledge & ADRs (${staleKnowledgeFindings.length})`,
        `> Changes in this diff modified files that are anchored to verified Architecture Decision Records (ADRs).`,
        '',
        ...staleKnowledgeFindings.map(
          (k) =>
            `- **${k.title}**: ${k.description} _(Evidence: ${formatEvidenceRefs(k.evidence)})_`
        ),
      ].join('\n')
    );
  }

  // 4. Downstream Blast-Radius & Dependency Topology
  if (report.downstreamDependents.length > 0) {
    sections.push(
      [
        `## Downstream Blast-Radius Analysis`,
        `The following changed modules have dependent modules elsewhere in the repository that may require verification:`,
        '',
        ...report.downstreamDependents.map(
          (d) =>
            `- \`${d.changedPath}\` is imported by **${d.dependentPaths.length}** module(s): ${d.dependentPaths.map((p) => `\`${p}\``).join(', ')}`
        ),
      ].join('\n')
    );
  }

  // 5. Changed Files Summary
  sections.push(
    [
      `## Changed Files Summary (${report.changedFiles.length})`,
      '| Change Type | Relative Path | Additions | Deletions |',
      '| :--- | :--- | :--- | :--- |',
      ...report.changedFiles.map(
        (c) => `| \`${c.changeType}\` | \`${c.relativePath}\` | +${c.additions} | -${c.deletions} |`
      ),
    ].join('\n')
  );

  return `${sections.join('\n\n')}\n`;
}
