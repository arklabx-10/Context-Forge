import React from 'react';
import { apiClient } from './api-client.js';
import { useWorkspace } from './useWorkspace.js';
import { CertaintyBadge, NAV_ITEMS } from './workspace-shared.js';
import { AnalysisStatusView } from './views/AnalysisStatusView.js';
import { ArchitectureView } from './views/ArchitectureView.js';
import { ChangeReviewView } from './views/ChangeReviewView.js';
import { ContextBuilderView } from './views/ContextBuilderView.js';
import { DashboardView } from './views/DashboardView.js';
import { ExplorerView } from './views/ExplorerView.js';
import { KnowledgeView } from './views/KnowledgeView.js';
import { OnboardingView } from './views/OnboardingView.js';
import { SearchView } from './views/SearchView.js';
import { SettingsView } from './views/SettingsView.js';
import { StackProfileView } from './views/StackProfileView.js';

export type { WorkspaceViewId } from './workspace-shared.js';

export function App(): React.ReactElement {
  const ws = useWorkspace();
  const {
    activeView,
    setActiveView,
    repositories,
    activeRepoId,
    snapshot,
    loading,
    setLoading,
    errorBanner,
    setErrorBanner,
    statusNotice,
    setStatusNotice,
    inspectedEvidence,
    setInspectedEvidence,
    seedFiles,
    aiConfig,
    loadWorkspaceData,
    handleSelectRepo,
    openSourceReference,
    analysisStatus,
  } = ws;

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar" aria-label="Workspace Navigation">
        <div className="brand-header">
          <div className="brand-title">
            <span className="brand-dot" />
            <span>ContextForge</span>
          </div>
          <span className="badge badge-verified">LOCAL-FIRST</span>
        </div>

        <div className="repo-selector-box">
          <label htmlFor="active-repo-select">Active Repository</label>
          <select
            id="active-repo-select"
            value={activeRepoId}
            onChange={(e) => void handleSelectRepo(e.target.value)}
          >
            {repositories.length === 0 && <option value="">No repository onboarded</option>}
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Primary Views">
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`nav-btn ${activeView === item.id ? 'active' : ''}`}
                  onClick={() => setActiveView(item.id)}
                >
                  <span>{item.label}</span>
                  <span className="kbd-hint">{item.shortcut}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {snapshot && (
          <div
            style={{
              marginTop: 'auto',
              padding: '10px',
              background: 'var(--bg-elevated)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Snapshot Provenance
            </div>
            <div className="mono" style={{ fontSize: '11px', marginTop: '4px' }}>
              ID: {snapshot.snapshotId}
            </div>
            <div className="mono" style={{ fontSize: '11px' }}>
              Branch: {snapshot.gitMetadata.currentBranch ?? 'non-git'}
            </div>
            <div className="mono" style={{ fontSize: '11px' }}>
              HEAD: {snapshot.gitMetadata.headCommitSha?.slice(0, 8) ?? 'n/a'}
            </div>
            <button
              type="button"
              className="btn"
              style={{ width: '100%', marginTop: '8px', justifyContent: 'center' }}
              onClick={async () => {
                if (!activeRepoId) return;
                setLoading(true);
                await apiClient.rescanRepository(activeRepoId);
                await loadWorkspaceData(activeRepoId);
                setStatusNotice('Repository re-scanned and fingerprints updated.');
              }}
            >
              Re-Scan Repository
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="main-workspace">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '15px' }}>
              {NAV_ITEMS.find((n) => n.id === activeView)?.label}
            </strong>
            <span
              className={`badge ${analysisStatus.badgeClass}`}
              data-testid="analysis-state-badge"
              title={analysisStatus.summary}
            >
              {analysisStatus.label}
            </span>
            {snapshot && (
              <span className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {snapshot.rootPath}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {seedFiles.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setActiveView('context_builder')}
              >
                Context Seeds ({seedFiles.length}) → Build Pack
              </button>
            )}
            <span className="badge badge-verified">
              AI Mode:{' '}
              {aiConfig?.activeProviderId === 'noop_deterministic'
                ? 'Deterministic No-AI'
                : aiConfig?.activeProviderId}
            </span>
          </div>
        </header>

        <div className="content-area">
          {errorBanner && (
            <div className="alert-banner alert-danger" role="alert">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Error: {errorBanner}</strong>
                <button type="button" className="btn" onClick={() => setErrorBanner(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {statusNotice && (
            <div
              className="alert-banner"
              role="status"
              style={{
                background: 'var(--accent-primary-bg)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{statusNotice}</span>
                <button type="button" className="btn" onClick={() => setStatusNotice(null)}>
                  OK
                </button>
              </div>
            </div>
          )}

          {/* Interactive Evidence Inspector Drawer */}
          {inspectedEvidence && (
            <div
              className="panel"
              role="region"
              aria-label="Evidence Inspector"
              style={{
                borderColor: 'var(--accent-primary)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div className="panel-header" style={{ marginBottom: '8px' }}>
                <div>
                  <span className="badge badge-verified" style={{ marginRight: '8px' }}>
                    {inspectedEvidence.category}
                  </span>
                  <strong>Evidence Inspector: {inspectedEvidence.title}</strong>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setInspectedEvidence(null)}
                >
                  Close Inspector ✕
                </button>
              </div>
              <div className="form-grid" style={{ fontSize: '13px' }}>
                <div>
                  <div className="field-label">Claim Value & Certainty</div>
                  <div>
                    <CertaintyBadge level={inspectedEvidence.certainty} />{' '}
                    <span className="mono">{inspectedEvidence.valueSummary}</span>
                  </div>
                  <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                    <strong>Rationale:</strong> {inspectedEvidence.rationale}
                  </div>
                  <div className="mono" style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    Producer Adapter: {inspectedEvidence.producerId}
                  </div>
                </div>
                <div>
                  <div className="field-label">
                    Verified Source Evidence ({inspectedEvidence.evidence.length})
                  </div>
                  {inspectedEvidence.evidence.length === 0 ? (
                    <span className="badge badge-unknown">Structural / Directory Signal</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {inspectedEvidence.evidence.map((ev, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="source-ref-pill"
                            onClick={() => void openSourceReference(ev)}
                          >
                            {ev.relativePath}:{ev.startLine ?? 1}-{ev.endLine ?? 1}
                          </button>
                          <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            SHA-256: {ev.fileSha256.slice(0, 12)}...
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="panel" role="status" aria-live="polite">
              <div className="mono">
                Analyzing repository structure and verifying source fingerprints...
              </div>
            </div>
          )}

          {/* VIEW 1: PROJECTS DASHBOARD & PROJECT OVERVIEW */}
          {activeView === 'dashboard' && <DashboardView ws={ws} />}

          {/* VIEW 2: ADD / IMPORT REPOSITORY */}
          {activeView === 'onboarding' && <OnboardingView ws={ws} />}

          {/* VIEW 3: FILE & MODULE EXPLORER */}
          {activeView === 'explorer' && snapshot && <ExplorerView ws={ws} snapshot={snapshot} />}

          {/* VIEW 4: DETECTED LANGUAGES, FRAMEWORKS, MANIFESTS & BUILD SYSTEMS */}
          {activeView === 'stack_profile' && snapshot && <StackProfileView ws={ws} snapshot={snapshot} />}

          {/* VIEW 5: ARCHITECTURE & DEPENDENCY OVERVIEW */}
          {activeView === 'architecture' && snapshot && <ArchitectureView ws={ws} snapshot={snapshot} />}

          {/* VIEW 6: SEARCH ACROSS INDEXED PROJECT INFORMATION */}
          {activeView === 'search' && <SearchView ws={ws} />}

          {/* VIEW 7: ANALYSIS STATUS, WARNINGS & UNSUPPORTED AREAS */}
          {activeView === 'analysis_status' && snapshot && <AnalysisStatusView ws={ws} snapshot={snapshot} />}

          {/* VIEW 8: CONTEXT PACK BUILDER */}
          {activeView === 'context_builder' && snapshot && <ContextBuilderView ws={ws} snapshot={snapshot} />}

          {/* VIEW 9: PROJECT KNOWLEDGE & DECISIONS */}
          {activeView === 'knowledge' && snapshot && <KnowledgeView ws={ws} snapshot={snapshot} />}

          {/* VIEW 10: GIT CHANGE REVIEW */}
          {activeView === 'change_review' && snapshot && <ChangeReviewView ws={ws} snapshot={snapshot} />}

          {/* VIEW 11: PROJECT SETTINGS, EXCLUSIONS & AI CONTROLS */}
          {activeView === 'settings' && <SettingsView ws={ws} />}
        </div>
      </main>
    </div>
  );
}
