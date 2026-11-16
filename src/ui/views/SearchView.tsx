// Workspace view: search. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge } from '../workspace-shared.js';

export function SearchView({ ws }: { readonly ws: Workspace }): React.ReactElement {
  const {
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchKind,
    setSearchKind,
    searchHits,
    openSourceReference,
    handleRunSearch,
    paginatedSearchHits,
  } = ws;

  return (
    <div className="panel">
      <h2 className="panel-title">Global & Project-Specific Search ({searchHits.length} hits)</h2>
      <form
        onSubmit={(e) => void handleRunSearch(e)}
        style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '16px', flexWrap: 'wrap' }}
      >
        <input
          className="input"
          style={{ flex: '1 1 320px' }}
          aria-label="Search query"
          placeholder="Search files, symbols, SQL tables, dependencies, or ADRs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="select"
          style={{ width: '190px' }}
          aria-label="Search scope"
          value={searchScope}
          onChange={(e) => setSearchScope(e.target.value as 'REPO' | 'GLOBAL')}
        >
          <option value="REPO">Active Repository</option>
          <option value="GLOBAL">Global (All Repositories)</option>
        </select>
        <select
          className="select"
          style={{ width: '170px' }}
          aria-label="Result kind"
          value={searchKind}
          onChange={(e) => setSearchKind(e.target.value)}
        >
          <option value="">All Kinds</option>
          <option value="file">Files</option>
          <option value="symbol">Symbols & SQL Objects</option>
          <option value="dependency">Dependencies</option>
          <option value="knowledge">Knowledge & ADRs</option>
          <option value="subproject">Sub-Projects</option>
        </select>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Title / Symbol</th>
            <th>Location & Context</th>
            <th>Certainty</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {paginatedSearchHits.pageItems.map((hit) => (
            <tr key={hit.id}>
              <td>
                <span className="badge badge-verified">{hit.kind}</span>
              </td>
              <td className="mono">
                <strong>{hit.title}</strong>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {hit.subtitle}
                </div>
              </td>
              <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {hit.snippet}
              </td>
              <td>
                {hit.certainty && <CertaintyBadge level={hit.certainty} />}
              </td>
              <td>
                {hit.sourceRef && (
                  <button
                    type="button"
                    className="source-ref-pill"
                    onClick={() => void openSourceReference(hit.sourceRef!)}
                  >
                    {hit.sourceRef.relativePath}:{hit.sourceRef.startLine ?? 1}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
