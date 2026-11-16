// Workspace view: analysis_status. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { RepositorySnapshot } from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge } from '../workspace-shared.js';

export function AnalysisStatusView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    analysisStatus,
    exclusionBreakdown,
  } = ws;

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Analysis Status & Adapter Execution Log</h2>
            <p className="panel-subtitle">{analysisStatus.summary}</p>
          </div>
          <span className={`badge ${analysisStatus.badgeClass}`}>
            {analysisStatus.label}
          </span>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Adapter ID</th>
              <th>Adapter Name</th>
              <th>Execution Status</th>
              <th>Matched Files</th>
              <th>Notes / Skipped Reason</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot.analyzerExecutionLog ?? []).map((entry) => (
              <tr key={entry.adapterId}>
                <td className="mono">{entry.adapterId}</td>
                <td>
                  <strong>{entry.displayName}</strong>
                </td>
                <td>
                  <span
                    className={`badge ${
                      entry.status === 'ran'
                        ? 'badge-verified'
                        : entry.status === 'partial_error'
                          ? 'badge-danger'
                          : 'badge-unknown'
                    }`}
                  >
                    {entry.status}
                  </span>
                </td>
                <td className="mono">{entry.filesMatchedCount}</td>
                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {entry.reasonOrNotes.join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="split-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">
                Warnings, Unknowns & Unsupported Areas ({snapshot.unknownsAndLimitations.length})
              </h3>
              <p className="panel-subtitle">
                ContextForge explicitly reports malformed manifests, unrecognized stacks, and static analysis boundaries.
              </p>
            </div>
            <CertaintyBadge level="unknown" />
          </div>
          {snapshot.unknownsAndLimitations.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)' }}>
              No warnings, malformed manifests, or unsupported file types detected.
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)' }}>
              {snapshot.unknownsAndLimitations.map((u, idx) => (
                <li key={idx} style={{ marginBottom: '6px' }}>
                  {u}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">
            Excluded & Inaccessible Files Breakdown ({snapshot.stats.totalFilesExcluded})
          </h3>
          <p className="panel-subtitle">
            Secrets, credentials, oversized binaries, and inaccessible files are excluded before indexing.
          </p>
          {exclusionBreakdown.length === 0 ? (
            <div style={{ marginTop: '10px', color: 'var(--text-secondary)' }}>
              No files were excluded in this repository.
            </div>
          ) : (
            <table className="data-table" style={{ marginTop: '10px' }}>
              <thead>
                <tr>
                  <th>Exclusion Reason</th>
                  <th>Count</th>
                  <th>Sample Paths</th>
                </tr>
              </thead>
              <tbody>
                {exclusionBreakdown.map((row) => (
                  <tr key={row.reason}>
                    <td>
                      <span className="badge badge-danger">{row.reason}</span>
                    </td>
                    <td className="mono">{row.count}</td>
                    <td className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {row.files
                        .slice(0, 4)
                        .map((f) => f.relativePath)
                        .join(', ')}
                      {row.files.length > 4 ? ` (+${row.files.length - 4} more)` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
