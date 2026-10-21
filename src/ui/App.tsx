import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AiProviderConfig,
  CertaintyLevel,
  ChangeReviewReport,
  CodingAssistantTarget,
  ContextPack,
  DevelopmentTaskType,
  KnowledgeCategory,
  KnowledgeEntry,
  OutboundConsentPreview,
  PrivacyAndIndexStatus,
  RepositoryRecord,
  RepositorySnapshot,
  SearchHit,
  SourceReference,
} from '../domain/index.js';
import { apiClient, type HealthPayload } from './api-client.js';

export type WorkspaceViewId =
  | 'dashboard'
  | 'onboarding'
  | 'explorer'
  | 'architecture'
  | 'search'
  | 'context_builder'
  | 'knowledge'
  | 'change_review'
  | 'settings';

const NAV_ITEMS: readonly {
  readonly id: WorkspaceViewId;
  readonly label: string;
  readonly shortcut: string;
}[] = [
  { id: 'dashboard', label: '1. Project Dashboard', shortcut: 'Alt+1' },
  { id: 'onboarding', label: '2. Repository Onboarding', shortcut: 'Alt+2' },
  { id: 'explorer', label: '3. Repository Explorer', shortcut: 'Alt+3' },
  { id: 'architecture', label: '4. Architecture & Deps', shortcut: 'Alt+4' },
  { id: 'search', label: '5. Global & Project Search', shortcut: 'Alt+5' },
  { id: 'context_builder', label: '6. Context Pack Builder', shortcut: 'Alt+6' },
  { id: 'knowledge', label: '7. Knowledge & Decisions', shortcut: 'Alt+7' },
  { id: 'change_review', label: '8. Git Change Review', shortcut: 'Alt+8' },
  { id: 'settings', label: '9. Analyzer & AI Settings', shortcut: 'Alt+9' },
];

const SAMPLE_RISKY_DIFF = [
  'diff --git a/apps/web-portal/src/BillingView.tsx b/apps/web-portal/src/BillingView.tsx',
  'index 1111111..2222222 100644',
  '--- a/apps/web-portal/src/BillingView.tsx',
  '+++ b/apps/web-portal/src/BillingView.tsx',
  '@@ -5,3 +5,4 @@ export interface InvoiceSummary {',
  '-export function formatCurrency(amountCents: number): string {',
  '+export function formatCurrency(amountCents: number, currencySymbol = "$"): string {',
  '+  // Modified currency signature without updating dependent main.tsx or unit tests',
  '   return `${currencySymbol}${(amountCents / 100).toFixed(2)}`;',
  'diff --git a/db/migrations/001_initial_schema.sql b/db/migrations/001_initial_schema.sql',
  'index 3333333..4444444 100644',
  '--- a/db/migrations/001_initial_schema.sql',
  '+++ b/db/migrations/001_initial_schema.sql',
  '@@ -18,2 +18,5 @@ SELECT id, account_id, subtotal_cents',
  ' FROM invoices',
  " WHERE status = 'open';",
  '+ALTER TABLE accounts ADD COLUMN tax_id VARCHAR(64) NOT NULL;',
  '+DROP TABLE invoices;',
  '+DELETE FROM accounts;',
].join('\n');

function CertaintyBadge({ level }: { readonly level: CertaintyLevel }) {
  return <span className={`badge badge-${level}`}>{level.replace('_', ' ')}</span>;
}

export function App(): React.ReactElement {
  const [activeView, setActiveView] = useState<WorkspaceViewId>('dashboard');
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [repositories, setRepositories] = useState<readonly RepositoryRecord[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [knowledgeEntries, setKnowledgeEntries] = useState<readonly KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Explorer state
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFileHighlightLine, setSelectedFileHighlightLine] = useState<number | null>(null);
  const [fileContentData, setFileContentData] = useState<{
    relativePath: string;
    content: string;
    sha256: string;
    lineCount: number;
  } | null>(null);
  const [explorerRoleFilter, setExplorerRoleFilter] = useState<string>('ALL');
  const [explorerSubProjectFilter, setExplorerSubProjectFilter] = useState<string>('ALL');

  // Onboarding state
  const [onboardPath, setOnboardPath] = useState<string>('');
  const [onboardName, setOnboardName] = useState<string>('');
  const [onboardExcludeGlobs, setOnboardExcludeGlobs] = useState<string>('');

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchScope, setSearchScope] = useState<'REPO' | 'GLOBAL'>('REPO');
  const [searchKind, setSearchKind] = useState<string>('');
  const [searchHits, setSearchHits] = useState<readonly SearchHit[]>([]);

  // Context Pack Builder state
  const [taskType, setTaskType] = useState<DevelopmentTaskType>('implement_feature');
  const [taskTitle, setTaskTitle] = useState<string>(
    'Add multi-currency support to invoice billing & pricing service'
  );
  const [taskDescription, setTaskDescription] = useState<string>(
    'Ensure integer cents arithmetic is preserved across BillingView, calculator, and database schema.'
  );
  const [targetSubProjectId, setTargetSubProjectId] = useState<string>('');
  const [seedFiles, setSeedFiles] = useState<readonly string[]>([]);
  const [assistantTarget, setAssistantTarget] = useState<CodingAssistantTarget>('universal');
  const [maxTotalChars, setMaxTotalChars] = useState<number>(28000);
  const [maxFilesCount, setMaxFilesCount] = useState<number>(10);
  const [includeTests, setIncludeTests] = useState<boolean>(true);
  const [generatedPack, setGeneratedPack] = useState<{
    pack: ContextPack;
    markdownExport: string;
    plainTextExport: string;
  } | null>(null);
  const [exportFormatTab, setExportFormatTab] = useState<'markdown' | 'plaintext'>('markdown');

  // Knowledge state
  const [newKnowCategory, setNewKnowCategory] = useState<KnowledgeCategory>('architecture_decision');
  const [newKnowTitle, setNewKnowTitle] = useState<string>('');
  const [newKnowContent, setNewKnowContent] = useState<string>('');
  const [newKnowRefPath, setNewKnowRefPath] = useState<string>('');

  // Change Review state
  const [diffTargetSpec, setDiffTargetSpec] = useState<string>('WORKING_TREE');
  const [rawDiffInput, setRawDiffInput] = useState<string>('');
  const [activeReviewReport, setActiveReviewReport] = useState<ChangeReviewReport | null>(null);

  // Settings & AI Consent state
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyAndIndexStatus | null>(null);
  const [consentPreview, setConsentPreview] = useState<OutboundConsentPreview | null>(null);
  const [aiResponseText, setAiResponseText] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (preferredRepoId?: string) => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const [healthData, reposData, aiCfgData, privData] = await Promise.all([
        apiClient.getHealth(),
        apiClient.listRepositories(),
        apiClient.getAiConfig(),
        apiClient.getPrivacyStatus(),
      ]);

      setHealth(healthData);
      setRepositories(reposData.repositories);
      setAiConfig(aiCfgData.config);
      setPrivacyStatus(privData.status);

      const targetId =
        preferredRepoId ||
        activeRepoId ||
        (reposData.repositories[0]?.id ?? '');

      if (targetId && reposData.repositories.some((r) => r.id === targetId)) {
        setActiveRepoId(targetId);
        const [snapData, knowData] = await Promise.all([
          apiClient.getSnapshot(targetId),
          apiClient.listKnowledge(targetId),
        ]);
        setSnapshot(snapData.snapshot);
        setKnowledgeEntries(knowData.entries);
      } else {
        setActiveRepoId('');
        setSnapshot(null);
        setKnowledgeEntries([]);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [activeRepoId]);

  useEffect(() => {
    void loadWorkspaceData();
  }, []);

  // Keyboard navigation Alt+1..Alt+9
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        const idx = Number.parseInt(e.key, 10) - 1;
        const item = NAV_ITEMS[idx];
        if (item) {
          e.preventDefault();
          setActiveView(item.id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSelectRepo = async (repoId: string) => {
    setActiveRepoId(repoId);
    setSelectedFilePath('');
    setFileContentData(null);
    setGeneratedPack(null);
    setActiveReviewReport(null);
    await loadWorkspaceData(repoId);
  };

  const openSourceReference = async (ref: SourceReference) => {
    if (!activeRepoId) return;
    setSelectedFilePath(ref.relativePath);
    setSelectedFileHighlightLine(ref.startLine ?? 1);
    setActiveView('explorer');
    try {
      const data = await apiClient.readFile(activeRepoId, ref.relativePath);
      setFileContentData(data);
    } catch (err) {
      setFileContentData(null);
      setErrorBanner(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const handleOnboardRepo = async (pathOverride?: string, nameOverride?: string) => {
    const targetPath = (pathOverride ?? onboardPath).trim();
    if (!targetPath) {
      setErrorBanner('Please enter or select a local repository directory path.');
      return;
    }
    setLoading(true);
    setErrorBanner(null);
    try {
      const customExcludeGlobs = onboardExcludeGlobs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { repository, snapshot: newSnap } = await apiClient.onboardRepository({
        rootPath: targetPath,
        ...(nameOverride || onboardName.trim() ? { name: nameOverride ?? onboardName.trim() } : {}),
        ...(customExcludeGlobs.length > 0
          ? { resourceLimits: { customExcludeGlobs } as never }
          : {}),
      });
      setStatusNotice(
        `Analyzed "${repository.name}": ${newSnap.stats.totalFilesIndexed} files indexed across ${newSnap.subProjects.length} sub-project(s) in ${newSnap.stats.analysisDurationMs} ms.`
      );
      await loadWorkspaceData(repository.id);
      setActiveView('dashboard');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRunSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      const res = await apiClient.search({
        query: searchQuery,
        ...(searchScope === 'REPO' && activeRepoId ? { repoId: activeRepoId } : {}),
        ...(searchKind ? { kind: searchKind } : {}),
      });
      setSearchHits(res.hits);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Search failed');
    }
  };

  useEffect(() => {
    if (activeView === 'search') {
      void handleRunSearch();
    }
  }, [activeView, activeRepoId, searchScope, searchKind]);

  const handleGenerateContextPack = async () => {
    if (!activeRepoId) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiClient.generateContextPack(activeRepoId, {
        taskType,
        taskTitle,
        taskDescription,
        targetSubProjectId: targetSubProjectId || null,
        seedFilePaths: [...seedFiles],
        assistantTarget,
        budget: {
          maxTotalChars,
          maxFilesCount,
          maxCharsPerFile: Math.min(8000, Math.floor(maxTotalChars / 2)),
          includeTests,
          includeKnowledgeAndAdrs: true,
          includeDependencyGraphSummary: true,
        },
      });
      setGeneratedPack(res);
      setStatusNotice(
        `Generated deterministic context pack (${res.pack.includedItems.length} files, ${res.pack.usedChars.toLocaleString()} chars).`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Context pack assembly failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleSeedFile = (relPath: string) => {
    setSeedFiles((prev) =>
      prev.includes(relPath) ? prev.filter((p) => p !== relPath) : [...prev, relPath]
    );
  };

  const handleSaveKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRepoId || !newKnowTitle.trim()) return;
    try {
      await apiClient.saveKnowledge(activeRepoId, {
        category: newKnowCategory,
        title: newKnowTitle.trim(),
        contentMarkdown: newKnowContent.trim(),
        linkedFilePaths: newKnowRefPath.trim()
          ? [{ relativePath: newKnowRefPath.trim(), startLine: 1, endLine: 20 }]
          : [],
      });
      setNewKnowTitle('');
      setNewKnowContent('');
      setNewKnowRefPath('');
      const knowData = await apiClient.listKnowledge(activeRepoId);
      setKnowledgeEntries(knowData.entries);
      setStatusNotice('Saved project knowledge entry with source fingerprint tracking.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save knowledge');
    }
  };

  const handleRunChangeReview = async (overrideDiff?: string) => {
    if (!activeRepoId) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const diffToUse = overrideDiff !== undefined ? overrideDiff : rawDiffInput;
      const res = await apiClient.reviewChanges(activeRepoId, {
        targetSpec: diffTargetSpec,
        ...(diffToUse.trim() ? { rawDiffOverride: diffToUse } : {}),
      });
      setActiveReviewReport(res.report);
      setStatusNotice(
        `Completed change review: ${res.report.findings.length} evidence-backed finding(s) across ${res.report.stats.totalChangedFiles} changed file(s).`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Change review failed');
    } finally {
      setLoading(false);
    }
  };

  const filteredExplorerFiles = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.files.filter((f) => {
      if (explorerRoleFilter !== 'ALL' && f.role !== explorerRoleFilter) return false;
      if (explorerSubProjectFilter !== 'ALL' && f.subProjectId !== explorerSubProjectFilter) {
        return false;
      }
      return true;
    });
  }, [snapshot, explorerRoleFilter, explorerSubProjectFilter]);

  const staleKnowledgeCount = useMemo(
    () => knowledgeEntries.filter((k) => k.stalenessStatus !== 'verified_fresh' && k.stalenessStatus !== 'unlinked').length,
    [knowledgeEntries]
  );

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

        <nav>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <strong style={{ fontSize: '15px' }}>
              {NAV_ITEMS.find((n) => n.id === activeView)?.label}
            </strong>
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
              AI Mode: {aiConfig?.activeProviderId === 'noop_deterministic' ? 'Deterministic No-AI' : aiConfig?.activeProviderId}
            </span>
          </div>
        </header>

        <div className="content-area">
          {errorBanner && (
            <div className="alert-banner alert-danger" role="alert">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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

          {loading && (
            <div className="panel">
              <div className="mono">Analyzing repository structure and verifying source fingerprints...</div>
            </div>
          )}

          {/* VIEW 1: PROJECT DASHBOARD */}
          {activeView === 'dashboard' && (
            <>
              {!snapshot ? (
                <div className="panel">
                  <h2 className="panel-title">No Repository Onboarded Yet</h2>
                  <p className="panel-subtitle">
                    Onboard a local repository or select one of the built-in polyglot/unrecognized-stack fixtures to begin analysis.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '12px' }}
                    onClick={() => setActiveView('onboarding')}
                  >
                    Go to Repository Onboarding →
                  </button>
                </div>
              ) : (
                <>
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
                      <div className="stat-label">Knowledge & ADRs</div>
                      <div className="stat-value">{knowledgeEntries.length}</div>
                      <div className="stat-meta">
                        {staleKnowledgeCount > 0
                          ? `${staleKnowledgeCount} potentially stale!`
                          : 'All linked refs verified fresh'}
                      </div>
                    </div>
                  </div>

                  {staleKnowledgeCount > 0 && (
                    <div className="alert-banner alert-warning">
                      <strong>Stale Project Knowledge Detected:</strong> {staleKnowledgeCount} knowledge/ADR entry has linked source files whose SHA-256 fingerprint changed since the note was written.
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
                          ContextForge never assumes the repository root is a single application. Every claim carries an explicit certainty badge and source reference.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setActiveView('architecture')}
                      >
                        Full Architecture View →
                      </button>
                    </div>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Sub-Project</th>
                          <th>Kind</th>
                          <th>Root Path</th>
                          <th>Languages</th>
                          <th>Frameworks & Build</th>
                          <th>Entry Points / APIs / DB</th>
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
                                <span className="badge badge-unknown">None / Docs</span>
                              ) : (
                                sp.languages.map((l) => (
                                  <span key={l.id} style={{ marginRight: '6px' }}>
                                    <CertaintyBadge level={l.certainty} /> {l.value}
                                  </span>
                                ))
                              )}
                            </td>
                            <td>
                              {[...sp.frameworks, ...sp.buildSystems].map((fw) => (
                                <span
                                  key={fw.id}
                                  className="source-ref-pill"
                                  style={{ marginRight: '5px', marginBottom: '4px' }}
                                  onClick={() =>
                                    fw.evidence[0] && void openSourceReference(fw.evidence[0])
                                  }
                                >
                                  {fw.value}
                                </span>
                              ))}
                            </td>
                            <td className="mono" style={{ fontSize: '12px' }}>
                              {sp.entryPoints.length} entry · {sp.apiSurfaces.length} API ·{' '}
                              {sp.databaseObjects.length} DB
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {snapshot.unknownsAndLimitations.length > 0 && (
                    <div className="panel">
                      <div className="panel-header">
                        <div>
                          <h3 className="panel-title">
                            Explicit Unknowns & Analysis Limitations
                          </h3>
                          <p className="panel-subtitle">
                            ContextForge reports when stack-specific information is unknown or inferred rather than fabricating facts.
                          </p>
                        </div>
                        <CertaintyBadge level="unknown" />
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)' }}>
                        {snapshot.unknownsAndLimitations.map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* VIEW 2: REPOSITORY ONBOARDING */}
          {activeView === 'onboarding' && (
            <div className="split-layout">
              <div className="panel">
                <h2 className="panel-title">Onboard Local Repository</h2>
                <p className="panel-subtitle">
                  Import any local directory. ContextForge performs read-only structural and adapter analysis without executing project code.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  <div>
                    <label className="field-label" htmlFor="onboard-path-input">
                      Local Repository Directory Path
                    </label>
                    <input
                      id="onboard-path-input"
                      className="input mono"
                      placeholder="e.g. E:\projects\my-service or /home/dev/repo"
                      value={onboardPath}
                      onChange={(e) => setOnboardPath(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="onboard-name-input">
                      Display Name (Optional)
                    </label>
                    <input
                      id="onboard-name-input"
                      className="input"
                      placeholder="Defaults to folder name"
                      value={onboardName}
                      onChange={(e) => setOnboardName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="onboard-exclude-input">
                      Additional Exclusion Globs (Comma-separated)
                    </label>
                    <input
                      id="onboard-exclude-input"
                      className="input mono"
                      placeholder="e.g. legacy/**, *.bak, tmp/**"
                      value={onboardExcludeGlobs}
                      onChange={(e) => setOnboardExcludeGlobs(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleOnboardRepo()}
                  >
                    Analyze & Index Repository
                  </button>
                </div>

                <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                  <div className="field-label">Security & Onboarding Invariants</div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <li>Zero script, binary, package manager, or migration execution.</li>
                    <li>Git hooks disabled via <code>-c core.hooksPath=_contextforge_disabled_hooks_</code>.</li>
                    <li><code>.env</code> secrets, private keys, and tokens excluded prior to indexing.</li>
                    <li>Symlinks and Windows junctions resolving outside repository root are blocked.</li>
                  </ul>
                </div>
              </div>

              <div className="panel">
                <h2 className="panel-title">Quick-Onboard Verified Local Repositories & Fixtures</h2>
                <p className="panel-subtitle">
                  Test ContextForge across polyglot monorepos, .NET + SQL services, unrecognized custom languages (<code>.qlang</code>), or ContextForge itself.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
                  {health?.presets.map((preset) => (
                    <div
                      key={preset.path}
                      style={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '6px',
                        padding: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{preset.label}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {preset.description}
                        </div>
                        <div className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                          {preset.path}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleOnboardRepo(preset.path, preset.label.split(' (')[0])}
                      >
                        Onboard
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: REPOSITORY EXPLORER */}
          {activeView === 'explorer' && snapshot && (
            <div className="split-layout">
              <div className="panel">
                <h2 className="panel-title">Source-Linked Project Inventory</h2>
                <div className="form-grid" style={{ marginTop: '10px', marginBottom: '12px' }}>
                  <div>
                    <label className="field-label">Sub-Project</label>
                    <select
                      className="select"
                      value={explorerSubProjectFilter}
                      onChange={(e) => setExplorerSubProjectFilter(e.target.value)}
                    >
                      <option value="ALL">All Sub-Projects ({snapshot.subProjects.length})</option>
                      {snapshot.subProjects.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name} ({sp.rootPath || '/'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">File Role</label>
                    <select
                      className="select"
                      value={explorerRoleFilter}
                      onChange={(e) => setExplorerRoleFilter(e.target.value)}
                    >
                      <option value="ALL">All Roles ({snapshot.files.length})</option>
                      <option value="source">source</option>
                      <option value="test">test</option>
                      <option value="manifest">manifest</option>
                      <option value="database_script">database_script</option>
                      <option value="config_template">config_template</option>
                      <option value="documentation">documentation</option>
                      <option value="build_config">build_config</option>
                    </select>
                  </div>
                </div>

                <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Role</th>
                        <th>Seed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExplorerFiles.map((file) => (
                        <tr key={file.relativePath}>
                          <td>
                            {file.isIndexed ? (
                              <button
                                type="button"
                                className="source-ref-pill"
                                onClick={() =>
                                  void openSourceReference({
                                    repoId: snapshot.repoId,
                                    relativePath: file.relativePath,
                                    fileSha256: file.sha256,
                                    startLine: 1,
                                    endLine: file.lineCount ?? 1,
                                    capturedAtIso: snapshot.analyzedAtIso,
                                  })
                                }
                              >
                                {file.relativePath}
                              </button>
                            ) : (
                              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                                {file.relativePath}{' '}
                                <span className="badge badge-danger">{file.exclusionReason}</span>
                              </span>
                            )}
                          </td>
                          <td className="mono" style={{ fontSize: '11px' }}>
                            {file.role}
                          </td>
                          <td>
                            {file.isIndexed && (
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.relativePath} as context seed`}
                                checked={seedFiles.includes(file.relativePath)}
                                onChange={() => toggleSeedFile(file.relativePath)}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                {fileContentData ? (
                  <>
                    <div className="panel-header">
                      <div>
                        <h3 className="panel-title mono">{fileContentData.relativePath}</h3>
                        <p className="panel-subtitle mono">
                          SHA-256: {fileContentData.sha256.slice(0, 16)}... · {fileContentData.lineCount} lines
                          {selectedFileHighlightLine ? ` · Highlighted Line ${selectedFileHighlightLine}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => toggleSeedFile(fileContentData.relativePath)}
                        >
                          {seedFiles.includes(fileContentData.relativePath)
                            ? '✓ In Context Seeds'
                            : '+ Add to Context Seeds'}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setNewKnowRefPath(fileContentData.relativePath);
                            setActiveView('knowledge');
                          }}
                        >
                          Anchor ADR/Note
                        </button>
                      </div>
                    </div>
                    <div className="code-viewer">
                      {fileContentData.content.split('\n').map((line, i) => {
                        const lineNo = i + 1;
                        const isHighlighted = selectedFileHighlightLine === lineNo;
                        return (
                          <div
                            key={lineNo}
                            style={{
                              background: isHighlighted ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                              padding: '0 4px',
                            }}
                          >
                            <span style={{ color: 'var(--text-muted)', userSelect: 'none', display: 'inline-block', width: '42px' }}>
                              {lineNo}
                            </span>
                            <span>{line}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div>
                    <h3 className="panel-title">File & Provenance Inspector</h3>
                    <p className="panel-subtitle">
                      Select any indexed file on the left to view its LF-normalized source code, line numbers, and SHA-256 fingerprint.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 4: ARCHITECTURE & DEPENDENCY VIEWS */}
          {activeView === 'architecture' && snapshot && (
            <>
              <div className="panel">
                <h2 className="panel-title">Architecture & Sub-Project Evidence Map</h2>
                <p className="panel-subtitle">
                  Click any source reference pill to inspect the exact manifest, route definition, entry point, or SQL DDL statement.
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
                                <span
                                  className="source-ref-pill"
                                  onClick={() =>
                                    ep.evidence[0] && void openSourceReference(ep.evidence[0])
                                  }
                                >
                                  {ep.value.identifier}
                                </span>
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
                                <span
                                  className="source-ref-pill"
                                  onClick={() =>
                                    api.evidence[0] && void openSourceReference(api.evidence[0])
                                  }
                                >
                                  {api.value.methodOrOperation} {api.value.routeOrSignature}
                                </span>
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
                                <span
                                  className="source-ref-pill"
                                  onClick={() =>
                                    dbObj.evidence[0] && void openSourceReference(dbObj.evidence[0])
                                  }
                                >
                                  {dbObj.value.objectType.toUpperCase()}: {dbObj.value.name}
                                </span>
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
                    Internal Module & SQL Foreign Key Edges ({snapshot.dependencyEdges.length})
                  </h3>
                  <table className="data-table" style={{ marginTop: '10px' }}>
                    <thead>
                      <tr>
                        <th>From</th>
                        <th>To</th>
                        <th>Kind</th>
                        <th>Certainty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.dependencyEdges.map((edge) => (
                        <tr key={edge.id}>
                          <td className="mono">{edge.value.fromPathOrModule}</td>
                          <td className="mono">{edge.value.toPathOrModule}</td>
                          <td className="mono" style={{ fontSize: '11px' }}>
                            {edge.value.kind}
                          </td>
                          <td>
                            <CertaintyBadge level={edge.certainty} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="panel">
                  <h3 className="panel-title">
                    Declared External Dependencies ({snapshot.externalDependencies.length})
                  </h3>
                  <table className="data-table" style={{ marginTop: '10px' }}>
                    <thead>
                      <tr>
                        <th>Package</th>
                        <th>Constraint</th>
                        <th>Ecosystem</th>
                        <th>Source Manifest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.externalDependencies.map((dep) => (
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
                              <span
                                className="source-ref-pill"
                                onClick={() => void openSourceReference(dep.evidence[0]!)}
                              >
                                {dep.evidence[0].relativePath}:{dep.evidence[0].startLine ?? 1}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* VIEW 5: GLOBAL & PROJECT-SPECIFIC SEARCH */}
          {activeView === 'search' && (
            <div className="panel">
              <h2 className="panel-title">Global & Project-Specific Search</h2>
              <form
                onSubmit={(e) => void handleRunSearch(e)}
                style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '16px', flexWrap: 'wrap' }}
              >
                <input
                  className="input"
                  style={{ flex: '1 1 320px' }}
                  placeholder="Search files, symbols, SQL tables, dependencies, or ADRs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <select
                  className="select"
                  style={{ width: '190px' }}
                  value={searchScope}
                  onChange={(e) => setSearchScope(e.target.value as 'REPO' | 'GLOBAL')}
                >
                  <option value="REPO">Active Repository</option>
                  <option value="GLOBAL">Global (All Repositories)</option>
                </select>
                <select
                  className="select"
                  style={{ width: '170px' }}
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
                  {searchHits.map((hit) => (
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
          )}

          {/* VIEW 6: CONTEXT PACK BUILDER */}
          {activeView === 'context_builder' && snapshot && (
            <div className="split-layout">
              <div className="panel">
                <h2 className="panel-title">Deterministic Context Pack Builder</h2>
                <p className="panel-subtitle">
                  Assemble a budget-constrained, prompt-injection-fenced context pack for any AI coding assistant.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  <div>
                    <label className="field-label">Development Task Type</label>
                    <select
                      className="select"
                      value={taskType}
                      onChange={(e) => setTaskType(e.target.value as DevelopmentTaskType)}
                    >
                      <option value="implement_feature">Implement Feature</option>
                      <option value="fix_bug">Fix Bug</option>
                      <option value="understand_module">Understand Unfamiliar Module</option>
                      <option value="refactor">Refactor Module</option>
                      <option value="write_tests">Write Automated Tests</option>
                      <option value="database_change">Database Schema / Migration Change</option>
                      <option value="review_changes">Review Code Changes</option>
                      <option value="security_audit">Security Audit</option>
                    </select>
                  </div>

                  <div>
                    <label className="field-label">Task Title</label>
                    <input
                      className="input"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Task Description & Specific Constraints</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Scope to Sub-Project (Optional)</label>
                    <select
                      className="select"
                      value={targetSubProjectId}
                      onChange={(e) => setTargetSubProjectId(e.target.value)}
                    >
                      <option value="">All Sub-Projects (Auto-rank)</option>
                      {snapshot.subProjects.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name} ({sp.rootPath || '/'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="field-label">Target Coding Assistant Profile</label>
                    <select
                      className="select"
                      value={assistantTarget}
                      onChange={(e) => setAssistantTarget(e.target.value as CodingAssistantTarget)}
                    >
                      <option value="universal">Universal Multi-Assistant Standard</option>
                      <option value="claude_code">Claude Code</option>
                      <option value="cursor">Cursor Composer / Agent</option>
                      <option value="github_copilot">GitHub Copilot</option>
                      <option value="codex_aider">Codex / Aider CLI</option>
                    </select>
                  </div>

                  <div className="form-grid">
                    <div>
                      <label className="field-label">Max Context Budget (Chars)</label>
                      <input
                        type="number"
                        className="input mono"
                        min={2000}
                        max={200000}
                        step={2000}
                        value={maxTotalChars}
                        onChange={(e) => setMaxTotalChars(Number.parseInt(e.target.value || '28000', 10))}
                      />
                    </div>
                    <div>
                      <label className="field-label">Max Included Files</label>
                      <input
                        type="number"
                        className="input mono"
                        min={1}
                        max={50}
                        value={maxFilesCount}
                        onChange={(e) => setMaxFilesCount(Number.parseInt(e.target.value || '10', 10))}
                      />
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={includeTests}
                      onChange={(e) => setIncludeTests(e.target.checked)}
                    />
                    Include relevant test files in context pack
                  </label>

                  <div>
                    <div className="field-label">Selected Seed Files ({seedFiles.length})</div>
                    {seedFiles.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        No explicit seed files selected (will rank by task keywords & role). You can check seed files in Repository Explorer.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {seedFiles.map((sf) => (
                          <span
                            key={sf}
                            className="source-ref-pill"
                            onClick={() => toggleSeedFile(sf)}
                          >
                            {sf} ✕
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleGenerateContextPack()}
                  >
                    Assemble Deterministic Context Pack
                  </button>
                </div>
              </div>

              <div className="panel">
                {generatedPack ? (
                  <>
                    <div className="panel-header">
                      <div>
                        <h3 className="panel-title">
                          Assembled Pack: {generatedPack.pack.usedChars.toLocaleString()} /{' '}
                          {generatedPack.pack.budget.maxTotalChars.toLocaleString()} chars (~
                          {generatedPack.pack.estimatedTokens.toLocaleString()} tokens)
                        </h3>
                        <p className="panel-subtitle">
                          {generatedPack.pack.includedItems.length} files included ·{' '}
                          {generatedPack.pack.omittedItems.length} files omitted
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className={`btn ${exportFormatTab === 'markdown' ? 'btn-primary' : ''}`}
                          onClick={() => setExportFormatTab('markdown')}
                        >
                          Markdown
                        </button>
                        <button
                          type="button"
                          className={`btn ${exportFormatTab === 'plaintext' ? 'btn-primary' : ''}`}
                          onClick={() => setExportFormatTab('plaintext')}
                        >
                          Plain Text
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            const text =
                              exportFormatTab === 'markdown'
                                ? generatedPack.markdownExport
                                : generatedPack.plainTextExport;
                            void navigator.clipboard?.writeText(text);
                            setStatusNotice(`Copied ${exportFormatTab} context pack to clipboard.`);
                          }}
                        >
                          Copy Export
                        </button>
                      </div>
                    </div>

                    {generatedPack.pack.injectionAlerts.length > 0 && (
                      <div className="alert-banner alert-danger">
                        <strong>
                          Prompt Injection Warnings ({generatedPack.pack.injectionAlerts.length}):
                        </strong>
                        {generatedPack.pack.injectionAlerts.map((a, i) => (
                          <div key={i} className="mono" style={{ fontSize: '12px' }}>
                            [{a.severity.toUpperCase()}] {a.patternId} in {a.sourceRef.relativePath}:
                            {a.sourceRef.startLine} — {a.description}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginBottom: '12px' }}>
                      <div className="field-label">Deterministic File Ranking Breakdown</div>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Rank & File</th>
                            <th>Role</th>
                            <th>Score</th>
                            <th>Rule Contributions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedPack.pack.includedItems.map((item, idx) => (
                            <tr key={item.relativePath}>
                              <td className="mono">
                                #{idx + 1} {item.relativePath}
                              </td>
                              <td className="mono" style={{ fontSize: '11px' }}>
                                {item.role}
                              </td>
                              <td className="mono">
                                <strong>{item.relevanceScore}</strong>
                              </td>
                              <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {item.scoreBreakdown
                                  .map((b) => `${b.ruleId} (+${b.points})`)
                                  .join(' · ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="field-label">
                      Exported Context Pack ({exportFormatTab.toUpperCase()})
                    </div>
                    <pre className="code-viewer">
                      {exportFormatTab === 'markdown'
                        ? generatedPack.markdownExport
                        : generatedPack.plainTextExport}
                    </pre>
                  </>
                ) : (
                  <div>
                    <h3 className="panel-title">Context Pack Preview & Score Breakdown</h3>
                    <p className="panel-subtitle">
                      Configure your task and click "Assemble Deterministic Context Pack" to inspect the deterministic file scoring rules and export Markdown or Plain Text.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 7: PROJECT KNOWLEDGE & DECISIONS */}
          {activeView === 'knowledge' && snapshot && (
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
                    <label className="field-label">Category</label>
                    <select
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
                    <label className="field-label">Title</label>
                    <input
                      className="input"
                      placeholder="e.g. ADR-002: Database Migration Locking Policy"
                      value={newKnowTitle}
                      onChange={(e) => setNewKnowTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Anchor to Source File Path (Optional)</label>
                    <input
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
                    <label className="field-label">Content (Markdown)</label>
                    <textarea
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
                            <span
                              key={i}
                              className="source-ref-pill"
                              onClick={() => void openSourceReference(r)}
                            >
                              {r.relativePath}:{r.startLine ?? 1}-{r.endLine ?? 1} (SHA:{' '}
                              {r.fileSha256.slice(0, 8)})
                            </span>
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
          )}

          {/* VIEW 8: GIT CHANGE REVIEW */}
          {activeView === 'change_review' && snapshot && (
            <div className="split-layout">
              <div className="panel">
                <h2 className="panel-title">Safe Git Change Review</h2>
                <p className="panel-subtitle">
                  Inspect working tree diffs, commit ranges, or unified patches without executing project code or database migrations.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  <div>
                    <label className="field-label">Git Revision / Target Spec</label>
                    <input
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
                    <div className="panel-header">
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
                                <span
                                  key={idx}
                                  className="source-ref-pill"
                                  onClick={() => void openSourceReference(ev)}
                                >
                                  Evidence: {ev.relativePath}:{ev.startLine ?? 1}
                                </span>
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
          )}

          {/* VIEW 9: ANALYZER & AI PROVIDER SETTINGS */}
          {activeView === 'settings' && (
            <>
              <div className="split-layout">
                <div className="panel">
                  <h2 className="panel-title">AI Provider Independence & Outbound Consent</h2>
                  <p className="panel-subtitle">
                    ContextForge defaults to 100% local deterministic analysis. External AI calls require explicit per-payload user consent.
                  </p>

                  {aiConfig && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                      <div>
                        <label className="field-label">Active Provider Adapter</label>
                        <select
                          className="select"
                          value={aiConfig.activeProviderId}
                          onChange={(e) =>
                            setAiConfig({
                              ...aiConfig,
                              activeProviderId: e.target.value as AiProviderConfig['activeProviderId'],
                            })
                          }
                        >
                          <option value="noop_deterministic">
                            NoOpDeterministicProvider (Local-Only, Zero Network)
                          </option>
                          <option value="openai_compatible">OpenAI-Compatible API Adapter</option>
                          <option value="anthropic_compatible">Anthropic Messages API Adapter</option>
                          <option value="local_ollama">Local Ollama Adapter</option>
                        </select>
                      </div>

                      <div>
                        <label className="field-label">Provider Endpoint URL</label>
                        <input
                          className="input mono"
                          value={aiConfig.endpointUrl}
                          onChange={(e) =>
                            setAiConfig({ ...aiConfig, endpointUrl: e.target.value })
                          }
                        />
                      </div>

                      <div>
                        <label className="field-label">Model Identifier</label>
                        <input
                          className="input mono"
                          value={aiConfig.modelName}
                          onChange={(e) => setAiConfig({ ...aiConfig, modelName: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={async () => {
                            const res = await apiClient.saveAiConfig(aiConfig);
                            setAiConfig(res.config);
                            setStatusNotice('Saved AI provider configuration.');
                          }}
                        >
                          Save Provider Config
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={async () => {
                            const res = await apiClient.previewOutboundConsent({
                              systemInstruction: 'Summarize architecture.',
                              taskPrompt: taskTitle,
                              untrustedContextPackText:
                                generatedPack?.markdownExport ??
                                '<untrusted_repository_content>Sample preview payload</untrusted_repository_content>',
                              disclosedFilePaths:
                                generatedPack?.pack.includedItems.map((i) => i.relativePath) ?? [],
                            });
                            setConsentPreview(res.preview);
                          }}
                        >
                          Inspect Outbound Consent Gate Preview
                        </button>
                      </div>

                      {consentPreview && (
                        <div
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '6px',
                            padding: '12px',
                          }}
                        >
                          <strong>Explicit Outbound Data Consent Gate</strong>
                          <div className="mono" style={{ fontSize: '11px', marginTop: '4px' }}>
                            Target Provider: {consentPreview.providerId} ({consentPreview.endpointUrl})
                          </div>
                          <div className="mono" style={{ fontSize: '11px' }}>
                            Payload SHA-256: {consentPreview.payloadSha256}
                          </div>
                          <div className="mono" style={{ fontSize: '11px' }}>
                            Disclosed Files ({consentPreview.disclosedFilePaths.length}):{' '}
                            {consentPreview.disclosedFilePaths.join(', ') || 'none'}
                          </div>
                          <div className="mono" style={{ fontSize: '11px' }}>
                            Size: {consentPreview.totalCharacters} chars (~{consentPreview.estimatedTokens} tokens)
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ marginTop: '8px' }}
                            onClick={async () => {
                              try {
                                const res = await apiClient.executeAiWithConsent({
                                  request: {
                                    systemInstruction: 'Summarize architecture.',
                                    taskPrompt: taskTitle,
                                    untrustedContextPackText:
                                      generatedPack?.markdownExport ??
                                      '<untrusted_repository_content>Sample preview payload</untrusted_repository_content>',
                                    disclosedFilePaths: consentPreview.disclosedFilePaths,
                                  },
                                  consentToken: {
                                    consentId: consentPreview.consentId,
                                    approvedAtIso: new Date().toISOString(),
                                    providerId: consentPreview.providerId,
                                    payloadSha256: consentPreview.payloadSha256,
                                    disclosedFilePaths: consentPreview.disclosedFilePaths,
                                    estimatedBytes: consentPreview.totalCharacters,
                                  },
                                });
                                setAiResponseText(res.response.generatedText);
                              } catch (err) {
                                setErrorBanner(
                                  err instanceof Error ? err.message : 'AI invocation failed'
                                );
                              }
                            }}
                          >
                            Approve Consent Token & Run Provider
                          </button>
                          {aiResponseText && (
                            <pre className="code-viewer" style={{ marginTop: '8px' }}>
                              {aiResponseText}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="panel">
                  <h2 className="panel-title">Privacy & Indexed Data Controls</h2>
                  <p className="panel-subtitle">
                    Inspect everything stored in the local SQLite database and delete indexed data at any time.
                  </p>
                  {privacyStatus && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
                      <div className="stat-grid">
                        <div className="stat-card">
                          <div className="stat-label">Repositories Indexed</div>
                          <div className="stat-value">{privacyStatus.totalRepositoriesIndexed}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Indexed Files</div>
                          <div className="stat-value">{privacyStatus.totalFilesIndexed}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Secrets Blocked</div>
                          <div className="stat-value">{privacyStatus.totalSecretsExcludedAllTime}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Outbound AI Calls</div>
                          <div className="stat-value">{privacyStatus.outboundAiRequestsCount}</div>
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        SQLite Store: {privacyStatus.databaseFilePath} ({privacyStatus.databaseSizeBytes.toLocaleString()} bytes)
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                        {activeRepoId && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={async () => {
                              await apiClient.deleteRepository(activeRepoId);
                              setStatusNotice('Deleted active repository index data.');
                              await loadWorkspaceData('');
                            }}
                          >
                            Delete Active Repository Index
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={async () => {
                            await apiClient.purgeAllData();
                            setStatusNotice('Purged all indexed repositories, snapshots, and knowledge from SQLite.');
                            await loadWorkspaceData('');
                          }}
                        >
                          Purge All Indexed Data
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <h3 className="panel-title">Registered Tier-1 Pluggable Language & Stack Adapters</h3>
                <p className="panel-subtitle">
                  Tier-0 Universal Structural Analysis runs on all repositories; Tier-1 adapters provide deeper optional stack intelligence.
                </p>
                <table className="data-table" style={{ marginTop: '10px' }}>
                  <thead>
                    <tr>
                      <th>Adapter ID</th>
                      <th>Name</th>
                      <th>Capabilities</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health?.adapters.map((a) => (
                      <tr key={a.adapterId}>
                        <td className="mono">{a.adapterId}</td>
                        <td>
                          <strong>{a.displayName}</strong>
                        </td>
                        <td>
                          {Object.entries(a.capabilities)
                            .filter(([, v]) => v)
                            .map(([k]) => (
                              <span
                                key={k}
                                className="badge badge-verified"
                                style={{ marginRight: '4px', marginBottom: '3px' }}
                              >
                                {k}
                              </span>
                            ))}
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{a.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
