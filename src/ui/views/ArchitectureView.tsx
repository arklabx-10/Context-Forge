// Workspace view: architecture. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { RepositorySnapshot } from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge } from '../workspace-shared.js';

export function ArchitectureView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    setInspectedEvidence,
    depEdgeQuery,
    setDepEdgeQuery,
    setDepEdgePage,
    extDepQuery,
    setExtDepQuery,
    setExtDepPage,
    openSourceReference,
    filteredDepEdges,
    paginatedDepEdges,
    filteredExtDeps,
    paginatedExtDeps,
  } = ws;

  return (
    <>
      <div className="panel">
        <h2 className="panel-title">Architecture & Sub-Project Evidence Map</h2>
        <p className="panel-subtitle">
          Click any entry point, API route, or SQL object to jump to its source file or inspect its evidence claim.
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
                  <div className="field-label">Entry Points ({sp.entryPoints.length})</div>
                  {sp.entryPoints.length === 0 ? (
                    <span className="badge badge-unknown">None detected</span>
                  ) : (
                    sp.entryPoints.map((ep) => (
                      <div key={ep.id} style={{ marginBottom: '6px' }}>
                        <CertaintyBadge level={ep.certainty} />{' '}
                        <button
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            ep.evidence[0] && void openSourceReference(ep.evidence[0])
                          }
                        >
                          {ep.value.identifier}
                        </button>{' '}
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '1px 6px', fontSize: '10px' }}
                          onClick={() =>
                            setInspectedEvidence({
                              title: `Entry Point: ${ep.value.identifier}`,
                              category: 'Entry Point',
                              valueSummary: `${ep.value.identifier} (${ep.value.kind})`,
                              certainty: ep.certainty,
                              rationale: ep.rationale,
                              producerId: ep.producerId,
                              evidence: ep.evidence,
                            })
                          }
                        >
                          Evidence
                        </button>
                        {ep.value.runtimeCommandHint && (
                          <div className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            Hint: {ep.value.runtimeCommandHint}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <div className="field-label">API Surfaces ({sp.apiSurfaces.length})</div>
                  {sp.apiSurfaces.length === 0 ? (
                    <span className="badge badge-unknown">No HTTP/RPC routes</span>
                  ) : (
                    sp.apiSurfaces.map((api) => (
                      <div key={api.id} style={{ marginBottom: '6px' }}>
                        <CertaintyBadge level={api.certainty} />{' '}
                        <button
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            api.evidence[0] && void openSourceReference(api.evidence[0])
                          }
                        >
                          {api.value.methodOrOperation} {api.value.routeOrSignature}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <div className="field-label">Database Objects ({sp.databaseObjects.length})</div>
                  {sp.databaseObjects.length === 0 ? (
                    <span className="badge badge-unknown">No SQL/Schema objects</span>
                  ) : (
                    sp.databaseObjects.map((dbObj) => (
                      <div key={dbObj.id} style={{ marginBottom: '6px' }}>
                        <CertaintyBadge level={dbObj.certainty} />{' '}
                        <button
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            dbObj.evidence[0] && void openSourceReference(dbObj.evidence[0])
                          }
                        >
                          {dbObj.value.objectType.toUpperCase()}: {dbObj.value.name}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="split-layout">
        <div className="panel">
          <h3 className="panel-title">
            Internal Module & SQL Foreign Key Edges ({filteredDepEdges.length})
          </h3>
          <input
            className="input mono"
            style={{ marginTop: '8px', marginBottom: '8px' }}
            aria-label="Filter internal dependency edges"
            placeholder="Filter internal dependency edges..."
            value={depEdgeQuery}
            onChange={(e) => {
              setDepEdgeQuery(e.target.value);
              setDepEdgePage(1);
            }}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Kind</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDepEdges.pageItems.map((edge) => (
                <tr key={edge.id}>
                  <td className="mono">{edge.value.fromPathOrModule}</td>
                  <td className="mono">{edge.value.toPathOrModule}</td>
                  <td className="mono" style={{ fontSize: '11px' }}>
                    {edge.value.kind}
                  </td>
                  <td>
                    {edge.evidence[0] ? (
                      <button
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(edge.evidence[0]!)}
                      >
                        {edge.evidence[0].relativePath}:{edge.evidence[0].startLine ?? 1}
                      </button>
                    ) : (
                      <CertaintyBadge level={edge.certainty} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginatedDepEdges.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px' }}>
              <span className="mono">
                Page {paginatedDepEdges.currentPage} / {paginatedDepEdges.totalPages}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={paginatedDepEdges.currentPage <= 1}
                  onClick={() => setDepEdgePage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={paginatedDepEdges.currentPage >= paginatedDepEdges.totalPages}
                  onClick={() =>
                    setDepEdgePage((p) => Math.min(paginatedDepEdges.totalPages, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">
            Declared External Dependencies ({filteredExtDeps.length})
          </h3>
          <input
            className="input mono"
            style={{ marginTop: '8px', marginBottom: '8px' }}
            aria-label="Filter external packages"
            placeholder="Filter external packages..."
            value={extDepQuery}
            onChange={(e) => {
              setExtDepQuery(e.target.value);
              setExtDepPage(1);
            }}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Constraint</th>
                <th>Ecosystem</th>
                <th>Source Manifest</th>
              </tr>
            </thead>
            <tbody>
              {paginatedExtDeps.pageItems.map((dep) => (
                <tr key={dep.id}>
                  <td className="mono">
                    <strong>{dep.value.name}</strong>
                  </td>
                  <td className="mono">{dep.value.versionConstraint}</td>
                  <td>
                    <span className="badge badge-verified">{dep.value.ecosystem}</span>
                  </td>
                  <td>
                    {dep.evidence[0] && (
                      <button
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(dep.evidence[0]!)}
                      >
                        {dep.evidence[0].relativePath}:{dep.evidence[0].startLine ?? 1}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginatedExtDeps.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px' }}>
              <span className="mono">
                Page {paginatedExtDeps.currentPage} / {paginatedExtDeps.totalPages}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={paginatedExtDeps.currentPage <= 1}
                  onClick={() => setExtDepPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={paginatedExtDeps.currentPage >= paginatedExtDeps.totalPages}
                  onClick={() =>
                    setExtDepPage((p) => Math.min(paginatedExtDeps.totalPages, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
