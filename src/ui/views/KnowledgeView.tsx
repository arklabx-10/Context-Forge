// Workspace view: knowledge. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { KnowledgeCategory, RepositorySnapshot } from '../../domain/index.js';
import { apiClient } from '../api-client.js';
import type { Workspace } from '../useWorkspace.js';

export function KnowledgeView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    activeRepoId,
    knowledgeEntries,
    setKnowledgeEntries,
    setStatusNotice,
    newKnowCategory,
    setNewKnowCategory,
    newKnowTitle,
    setNewKnowTitle,
    newKnowContent,
    setNewKnowContent,
    newKnowRefPath,
    setNewKnowRefPath,
    openSourceReference,
    handleSaveKnowledge,
  } = ws;

  return (
    <div className="split-layout">
      <div className="panel">
        <h2 className="panel-title">Record Project Knowledge / ADR</h2>
        <p className="panel-subtitle">
          Anchor notes and decisions to source files. ContextForge automatically detects when referenced files change their SHA-256 fingerprint.
        </p>
        <form
          onSubmit={(e) => void handleSaveKnowledge(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}
        >
          <div>
            <label className="field-label" htmlFor="cf-category">Category</label>
            <select
              id="cf-category"
              className="select"
              value={newKnowCategory}
              onChange={(e) => setNewKnowCategory(e.target.value as KnowledgeCategory)}
            >
              <option value="architecture_decision">Architecture Decision (ADR)</option>
              <option value="coding_convention">Development Convention</option>
              <option value="known_limitation">Known Limitation</option>
              <option value="workflow_template">Workflow Template</option>
              <option value="project_note">Project Note</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="cf-title">Title</label>
            <input
              id="cf-title"
              className="input"
              placeholder="e.g. ADR-002: Database Migration Locking Policy"
              value={newKnowTitle}
              onChange={(e) => setNewKnowTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cf-anchor-to-source-file-path-optional">Anchor to Source File Path (Optional)</label>
            <input
              id="cf-anchor-to-source-file-path-optional"
              className="input mono"
              list="repo-file-paths"
              placeholder="e.g. apps/web-portal/src/BillingView.tsx"
              value={newKnowRefPath}
              onChange={(e) => setNewKnowRefPath(e.target.value)}
            />
            <datalist id="repo-file-paths">
              {snapshot.files
                .filter((f) => f.isIndexed)
                .map((f) => (
                  <option key={f.relativePath} value={f.relativePath} />
                ))}
            </datalist>
          </div>
          <div>
            <label className="field-label" htmlFor="cf-content-markdown">Content (Markdown)</label>
            <textarea
              id="cf-content-markdown"
              className="textarea"
              rows={5}
              placeholder="Document the architectural decision, convention, or workflow..."
              value={newKnowContent}
              onChange={(e) => setNewKnowContent(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Save Knowledge Entry
          </button>
        </form>
      </div>

      <div className="panel">
        <h2 className="panel-title">
          Verified Knowledge Base ({knowledgeEntries.length})
        </h2>
        <p className="panel-subtitle">
          Current source code is always treated as more authoritative than notes or generated summaries.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
          {knowledgeEntries.map((entry) => (
            <div
              key={entry.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: '6px',
                padding: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{entry.title}</strong>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className="badge badge-unknown">{entry.category}</span>
                  {entry.stalenessStatus === 'verified_fresh' && (
                    <span className="badge badge-verified">VERIFIED FRESH</span>
                  )}
                  {entry.stalenessStatus === 'potentially_stale' && (
                    <span className="badge badge-danger">POTENTIALLY STALE</span>
                  )}
                  {entry.stalenessStatus === 'reference_missing' && (
                    <span className="badge badge-danger">FILE MISSING</span>
                  )}
                  {entry.stalenessStatus !== 'verified_fresh' && entry.stalenessStatus !== 'unlinked' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={async () => {
                        await apiClient.reconcileKnowledge(activeRepoId, entry.id);
                        const updated = await apiClient.listKnowledge(activeRepoId);
                        setKnowledgeEntries(updated.entries);
                        setStatusNotice(`Reconciled and re-anchored "${entry.title}" to current file fingerprint.`);
                      }}
                    >
                      Re-anchor
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={async () => {
                      await apiClient.deleteKnowledge(entry.id);
                      const updated = await apiClient.listKnowledge(activeRepoId);
                      setKnowledgeEntries(updated.entries);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ margin: '8px 0', color: 'var(--text-primary)' }}>
                {entry.contentMarkdown}
              </p>
              {entry.linkedReferences.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {entry.linkedReferences.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      className="source-ref-pill"
                      onClick={() => void openSourceReference(r)}
                    >
                      {r.relativePath}:{r.startLine ?? 1}-{r.endLine ?? 1} (SHA:{' '}
                      {r.fileSha256.slice(0, 8)})
                    </button>
                  ))}
                </div>
              )}
              {entry.driftDetails.length > 0 && (
                <div className="alert-banner alert-warning" style={{ marginTop: '8px', marginBottom: 0 }}>
                  {entry.driftDetails.map((d, idx) => (
                    <div key={idx} className="mono" style={{ fontSize: '12px' }}>
                      Drift on {d.reference.relativePath}: {d.reason} (Captured SHA:{' '}
                      {d.reference.fileSha256.slice(0, 8)} vs Current SHA:{' '}
                      {d.currentFileSha256?.slice(0, 8) ?? 'deleted'})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
