// Workspace view: dashboard. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge } from '../workspace-shared.js';

export function DashboardView({ ws }: { readonly ws: Workspace }): React.ReactElement {
  const {
    setActiveView,
    repositories,
    activeRepoId,
    snapshot,
    setStatusNotice,
    setInspectedEvidence,
    markdownReportPreview,
    setMarkdownReportPreview,
    handleSelectRepo,
    handleLoadMarkdownReport,
    analysisStatus,
    staleKnowledgeCount,
  } = ws;

  return (
    <>
      {/* Onboarded Projects Registry */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              Projects Dashboard ({repositories.length} Onboarded)
            </h2>
            <p className="panel-subtitle">
              Switch between onboarded repositories, inspect analysis status, or import a new local directory.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setActiveView('onboarding')}
          >
            + Add / Import Repository
          </button>
        </div>

        {repositories.length === 0 ? (
          <div
            style={{
              padding: '16px',
              background: 'var(--bg-elevated)',
              borderRadius: '6px',
              border: '1px solid var(--border-strong)',
            }}
          >
            <strong>First-Time Onboarding — No Repositories Imported Yet</strong>
            <p style={{ margin: '6px 0 12px', color: 'var(--text-secondary)' }}>
              Import a local repository directory or one of the built-in polyglot/unrecognized-stack fixtures to generate a verified project inventory.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setActiveView('onboarding')}
            >
              Import First Repository →
            </button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Repository Name</th>
                <th>Canonical Root Path</th>
                <th>Last Analyzed</th>
                <th>Custom Exclusions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {repositories.map((repo) => {
                const isCurrent = repo.id === activeRepoId;
                return (
                  <tr key={repo.id}>
                    <td>
                      <strong>{repo.name}</strong>{' '}
                      {isCurrent && <span className="badge badge-verified">ACTIVE</span>}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {repo.rootPath}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {repo.lastAnalyzedAtIso
                        ? new Date(repo.lastAnalyzedAtIso).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {repo.resourceLimits.customExcludeGlobs.length > 0
                        ? repo.resourceLimits.customExcludeGlobs.join(', ')
                        : 'Default rules only'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {!isCurrent && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() => void handleSelectRepo(repo.id)}
                          >
                            Select
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => void handleSelectRepo(repo.id, 'explorer')}
                        >
                          Explorer
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => void handleSelectRepo(repo.id, 'settings')}
                        >
                          Exclusions
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {snapshot && (
        <>
          {/* Analysis State & Git Provenance Banner */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">
                  Project Overview: {snapshot.repoName}
                </h2>
                <p className="panel-subtitle">{analysisStatus.summary}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleLoadMarkdownReport()}
                >
                  View Deterministic Markdown Report
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setActiveView('analysis_status')}
                >
                  Status & Warnings ({snapshot.unknownsAndLimitations.length}) →
                </button>
              </div>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Sub-Projects / Roots</div>
                <div className="stat-value">{snapshot.subProjects.length}</div>
                <div className="stat-meta">Monorepo & multi-app aware</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Indexed Safe Files</div>
                <div className="stat-value">{snapshot.stats.totalFilesIndexed}</div>
                <div className="stat-meta">
                  of {snapshot.stats.totalFilesDiscovered} discovered ({snapshot.stats.totalFilesExcluded} excluded)
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Secrets & Keys Excluded</div>
                <div className="stat-value" style={{ color: 'var(--status-verified)' }}>
                  {snapshot.stats.secretExclusionsCount}
                </div>
                <div className="stat-meta">Blocked before indexing</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Extracted Symbols</div>
                <div className="stat-value">{snapshot.stats.totalSymbolsExtracted}</div>
                <div className="stat-meta">Functions, classes, SQL objects</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Dependency Edges</div>
                <div className="stat-value">{snapshot.dependencyEdges.length}</div>
                <div className="stat-meta">
                  + {snapshot.externalDependencies.length} external packages
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Git Working Tree</div>
                <div className="stat-value" style={{ fontSize: '16px' }}>
                  {snapshot.gitMetadata.isGitRepo
                    ? `${snapshot.gitMetadata.currentBranch ?? 'detached'} (${snapshot.gitMetadata.isDirty ? 'dirty' : 'clean'})`
                    : 'Non-Git Directory'}
                </div>
                <div className="stat-meta mono">
                  HEAD: {snapshot.gitMetadata.headCommitSha?.slice(0, 10) ?? 'n/a'}
                </div>
              </div>
            </div>

            {markdownReportPreview && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span className="field-label" style={{ margin: 0 }}>
                    Deterministic Markdown Analysis Report (No AI Required)
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void navigator.clipboard?.writeText(markdownReportPreview);
                        setStatusNotice('Copied Markdown analysis report to clipboard.');
                      }}
                    >
                      Copy Report
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setMarkdownReportPreview(null)}
                    >
                      Hide Report
                    </button>
                  </div>
                </div>
                <pre className="code-viewer">{markdownReportPreview}</pre>
              </div>
            )}
          </div>

          {staleKnowledgeCount > 0 && (
            <div className="alert-banner alert-warning">
              <strong>Stale Project Knowledge Detected:</strong> {staleKnowledgeCount}{' '}
              knowledge/ADR entry has linked source files whose SHA-256 fingerprint changed since the note was written.
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setActiveView('knowledge')}
                >
                  Inspect Stale Knowledge →
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Discovered Sub-Projects & Applications</h2>
                <p className="panel-subtitle">
                  ContextForge never assumes the repository root is a single application. Click any badge or pill to inspect its source evidence.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setActiveView('stack_profile')}
                >
                  Languages & Manifests →
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setActiveView('architecture')}
                >
                  Full Architecture View →
                </button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sub-Project</th>
                  <th>Kind</th>
                  <th>Root Path</th>
                  <th>Languages</th>
                  <th>Frameworks, Build & Package Managers</th>
                  <th>Inventory Summary</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.subProjects.map((sp) => (
                  <tr key={sp.id}>
                    <td>
                      <strong>{sp.name}</strong>
                    </td>
                    <td>
                      <span className="badge badge-verified">{sp.kind}</span>
                    </td>
                    <td className="mono">{sp.rootPath || '/'}</td>
                    <td>
                      {sp.languages.length === 0 ? (
                        <span className="badge badge-unknown">None / Unrecognized</span>
                      ) : (
                        sp.languages.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            className="source-ref-pill"
                            style={{ marginRight: '6px', marginBottom: '4px' }}
                            onClick={() =>
                              setInspectedEvidence({
                                title: `${sp.name} — Language: ${l.value}`,
                                category: 'Language Detection',
                                valueSummary: l.value,
                                certainty: l.certainty,
                                rationale: l.rationale,
                                producerId: l.producerId,
                                evidence: l.evidence,
                              })
                            }
                          >
                            <CertaintyBadge level={l.certainty} /> {l.value}
                          </button>
                        ))
                      )}
                    </td>
                    <td>
                      {[...sp.frameworks, ...sp.buildSystems, ...sp.packageManagers].map(
                        (claim) => (
                          <button
                            key={claim.id}
                            type="button"
                            className="source-ref-pill"
                            style={{ marginRight: '5px', marginBottom: '4px' }}
                            onClick={() =>
                              setInspectedEvidence({
                                title: `${sp.name} — ${claim.value}`,
                                category: 'Framework / Build / Package Manager',
                                valueSummary: claim.value,
                                certainty: claim.certainty,
                                rationale: claim.rationale,
                                producerId: claim.producerId,
                                evidence: claim.evidence,
                              })
                            }
                          >
                            {claim.value}
                          </button>
                        )
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {sp.manifests.length} manifest · {sp.lockfiles?.length ?? 0} lockfile ·{' '}
                      {sp.entryPoints.length} entry · {sp.apiSurfaces.length} API ·{' '}
                      {sp.databaseObjects.length} DB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
