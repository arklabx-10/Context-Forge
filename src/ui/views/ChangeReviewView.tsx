// Workspace view: change_review. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { RepositorySnapshot } from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge, SAMPLE_RISKY_DIFF } from '../workspace-shared.js';

export function ChangeReviewView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    setStatusNotice,
    diffTargetSpec,
    setDiffTargetSpec,
    rawDiffInput,
    setRawDiffInput,
    activeReviewReport,
    activeReviewMarkdown,
    openSourceReference,
    handleRunChangeReview,
  } = ws;

  return (
    <div className="split-layout">
      <div className="panel">
        <h2 className="panel-title">Safe Git Change Review</h2>
        <p className="panel-subtitle">
          Inspect working tree diffs, commit ranges, or unified patches without executing project code or database migrations.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
          <div>
            <label className="field-label" htmlFor="cf-git-revision-target-spec">Git Revision / Target Spec</label>
            <input
              id="cf-git-revision-target-spec"
              className="input mono"
              value={diffTargetSpec}
              onChange={(e) => setDiffTargetSpec(e.target.value)}
              placeholder="WORKING_TREE, STAGED, or HEAD~1..HEAD"
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="field-label" style={{ margin: 0 }}>
                Or Inspect Unified Diff Patch Directly
              </label>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: '11px' }}
                onClick={() => {
                  setRawDiffInput(SAMPLE_RISKY_DIFF);
                  void handleRunChangeReview(SAMPLE_RISKY_DIFF);
                }}
              >
                Load & Run Sample Risky SQL + Regression Diff
              </button>
            </div>
            <textarea
              className="textarea mono"
              rows={9}
              aria-label="Unified diff patch"
              placeholder="Leave blank to run `git diff` on the repository, or paste a unified diff here..."
              value={rawDiffInput}
              onChange={(e) => setRawDiffInput(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleRunChangeReview()}
          >
            Run Evidence-Backed Change Review
          </button>
        </div>
      </div>

      <div className="panel">
        {activeReviewReport ? (
          <>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="panel-title">
                  Review Report: {activeReviewReport.diffTargetLabel}
                </h3>
                <p className="panel-subtitle">
                  {activeReviewReport.stats.totalChangedFiles} changed file(s) ·{' '}
                  <span style={{ color: 'var(--status-danger)' }}>
                    {activeReviewReport.stats.criticalCount} critical
                  </span>{' '}
                  ·{' '}
                  <span style={{ color: 'var(--status-inferred)' }}>
                    {activeReviewReport.stats.warningCount} warning
                  </span>{' '}
                  · {activeReviewReport.stats.infoCount} info
                </p>
              </div>
              {activeReviewMarkdown && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeReviewMarkdown);
                    setStatusNotice('Copied Change Review Markdown report to clipboard!');
                  }}
                >
                  Copy Markdown Report
                </button>
              )}
            </div>

            {activeReviewReport.findings.length === 0 ? (
              <div className="panel" style={{ background: 'var(--bg-elevated)' }}>
                No regressions, risky SQL operations, or missing test alerts found for this diff.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeReviewReport.findings.map((finding) => (
                  <div
                    key={finding.id}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: `1px solid ${
                        finding.severity === 'critical'
                          ? 'var(--status-danger)'
                          : 'var(--border-strong)'
                      }`,
                      borderRadius: '6px',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <strong>{finding.title}</strong>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span
                          className={`badge ${
                            finding.severity === 'critical'
                              ? 'badge-danger'
                              : finding.severity === 'warning'
                                ? 'badge-inferred'
                                : 'badge-verified'
                          }`}
                        >
                          {finding.severity}
                        </span>
                        <CertaintyBadge level={finding.certainty} />
                      </div>
                    </div>
                    <p style={{ margin: '6px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {finding.description}
                    </p>
                    <div style={{ fontSize: '12px', color: 'var(--accent-primary)', marginBottom: '6px' }}>
                      <strong>Remediation:</strong> {finding.remediationHint}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {finding.evidence.map((ev, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="source-ref-pill"
                          onClick={() => void openSourceReference(ev)}
                        >
                          Evidence: {ev.relativePath}:{ev.startLine ?? 1}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div>
            <h3 className="panel-title">Evidence-Backed Review Findings</h3>
            <p className="panel-subtitle">
              Run a change review or click "Load & Run Sample Risky SQL + Regression Diff" to inspect blast radius, missing tests, and destructive SQL checks.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
