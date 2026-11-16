// Workspace view: stack_profile. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { RepositorySnapshot } from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge } from '../workspace-shared.js';

export function StackProfileView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    setInspectedEvidence,
    openSourceReference,
    languageBreakdown,
  } = ws;

  return (
    <>
      <div className="panel">
        <h2 className="panel-title">
          Multi-Signal Language Detection Breakdown ({languageBreakdown.length} Languages)
        </h2>
        <p className="panel-subtitle">
          Languages are detected using filename rules, shebang interpreters (<code>#!</code>), file extensions, and lexical content signatures (e.g. C++ vs C headers).
        </p>
        {languageBreakdown.length === 0 ? (
          <div style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>
            <CertaintyBadge level="unknown" /> No recognized programming languages detected in this repository. Tier-0 structural inventory remains available.
          </div>
        ) : (
          <table className="data-table" style={{ marginTop: '10px' }}>
            <thead>
              <tr>
                <th>Detected Language</th>
                <th>Indexed Files</th>
                <th>Total Lines</th>
                <th>Signals Used</th>
                <th>Sample Source Evidence</th>
              </tr>
            </thead>
            <tbody>
              {languageBreakdown.map((row) => (
                <tr key={row.language}>
                  <td>
                    <strong>{row.language}</strong>
                  </td>
                  <td className="mono">{row.fileCount}</td>
                  <td className="mono">{row.totalLines.toLocaleString()}</td>
                  <td>
                    {row.signalsUsed.map((sig) => (
                      <span
                        key={sig}
                        className="badge badge-verified"
                        style={{ marginRight: '4px' }}
                      >
                        {sig}
                      </span>
                    ))}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="source-ref-pill"
                      onClick={() => void openSourceReference(row.sampleFileRef)}
                    >
                      {row.sampleFileRef.relativePath}:1
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">
          Sub-Project Manifests, Lockfiles, Frameworks, Build Systems & Tests
        </h2>
        <p className="panel-subtitle">
          Click any claim pill to open the Evidence Inspector or jump to the source manifest.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '14px' }}>
          {snapshot.subProjects.map((sp) => (
            <div
              key={sp.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: '6px',
                padding: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '15px' }}>{sp.name}</strong>{' '}
                  <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                    ({sp.rootPath || '/'})
                  </span>
                </div>
                <span className="badge badge-verified">{sp.kind}</span>
              </div>

              <div className="form-grid" style={{ marginTop: '12px' }}>
                <div>
                  <div className="field-label">
                    Manifests ({sp.manifests.length}) & Lockfiles ({sp.lockfiles?.length ?? 0})
                  </div>
                  {sp.manifests.length === 0 && (sp.lockfiles?.length ?? 0) === 0 ? (
                    <span className="badge badge-unknown">No recognizable manifest</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {sp.manifests.map((m, i) => (
                        <button
                          key={`m-${i}`}
                          type="button"
                          className="source-ref-pill"
                          onClick={() => void openSourceReference(m)}
                        >
                          Manifest: {m.relativePath}
                        </button>
                      ))}
                      {(sp.lockfiles ?? []).map((lf, i) => (
                        <button
                          key={`lf-${i}`}
                          type="button"
                          className="source-ref-pill"
                          onClick={() => void openSourceReference(lf)}
                        >
                          Lockfile: {lf.relativePath}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="field-label">
                    Frameworks ({sp.frameworks.length}) & Package Managers ({sp.packageManagers.length})
                  </div>
                  {sp.frameworks.length === 0 && sp.packageManagers.length === 0 ? (
                    <span className="badge badge-unknown">None detected</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {[...sp.frameworks, ...sp.packageManagers].map((claim) => (
                        <button
                          key={claim.id}
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            setInspectedEvidence({
                              title: `${sp.name} — ${claim.value}`,
                              category: 'Framework / Package Manager',
                              valueSummary: claim.value,
                              certainty: claim.certainty,
                              rationale: claim.rationale,
                              producerId: claim.producerId,
                              evidence: claim.evidence,
                            })
                          }
                        >
                          <CertaintyBadge level={claim.certainty} /> {claim.value}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="field-label">
                    Build Systems ({sp.buildSystems.length}) & Test Harnesses ({sp.testHarnesses.length})
                  </div>
                  {sp.buildSystems.length === 0 && sp.testHarnesses.length === 0 ? (
                    <span className="badge badge-unknown">None detected</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {[...sp.buildSystems, ...sp.testHarnesses].map((claim) => (
                        <button
                          key={claim.id}
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            setInspectedEvidence({
                              title: `${sp.name} — ${claim.value}`,
                              category: 'Build System / Test Harness',
                              valueSummary: claim.value,
                              certainty: claim.certainty,
                              rationale: claim.rationale,
                              producerId: claim.producerId,
                              evidence: claim.evidence,
                            })
                          }
                        >
                          <CertaintyBadge level={claim.certainty} /> {claim.value}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="field-label">
                    API Specs ({sp.apiSpecifications?.length ?? 0}), Config Templates ({sp.configTemplates.length}) & Docs ({sp.documentationFiles.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {(sp.apiSpecifications ?? []).map((spec, i) => (
                      <button
                        key={`spec-${i}`}
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(spec)}
                      >
                        API Spec: {spec.relativePath}
                      </button>
                    ))}
                    {sp.configTemplates.map((cfg, i) => (
                      <button
                        key={`cfg-${i}`}
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(cfg)}
                      >
                        Config: {cfg.relativePath}
                      </button>
                    ))}
                    {sp.documentationFiles.map((doc, i) => (
                      <button
                        key={`doc-${i}`}
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(doc)}
                      >
                        Doc: {doc.relativePath}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
