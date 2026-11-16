// All workspace state, data loading, effects and handlers (formerly the body of App).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AiProviderConfig,
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
import {
  computeExclusionBreakdown,
  computeLanguageBreakdown,
  deriveAnalysisStatus,
  filterExplorerFiles,
  paginateItems,
  type InspectedFindingEvidence,
} from './workspace-helpers.js';
import { DEFAULT_FILE_WINDOW_LINES, NAV_ITEMS, type WorkspaceViewId } from './workspace-shared.js';

export function useWorkspace() {
  const [activeView, setActiveView] = useState<WorkspaceViewId>('dashboard');
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [repositories, setRepositories] = useState<readonly RepositoryRecord[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [knowledgeEntries, setKnowledgeEntries] = useState<readonly KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Evidence Inspector Drawer state
  const [inspectedEvidence, setInspectedEvidence] = useState<InspectedFindingEvidence | null>(null);

  // Markdown Report Preview state
  const [markdownReportPreview, setMarkdownReportPreview] = useState<string | null>(null);

  // Explorer state (with pagination & windowed file loading)
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFileHighlightLine, setSelectedFileHighlightLine] = useState<number | null>(null);
  const [fileContentData, setFileContentData] = useState<{
    relativePath: string;
    content: string;
    sha256: string;
    lineCount: number;
    sliceStartLine: number;
    sliceEndLine: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  } | null>(null);
  const [explorerPathQuery, setExplorerPathQuery] = useState<string>('');
  const [explorerRoleFilter, setExplorerRoleFilter] = useState<string>('ALL');
  const [explorerSubProjectFilter, setExplorerSubProjectFilter] = useState<string>('ALL');
  const [explorerLanguageFilter, setExplorerLanguageFilter] = useState<string>('ALL');
  const [explorerStatusFilter, setExplorerStatusFilter] = useState<'ALL' | 'INDEXED' | 'EXCLUDED'>('ALL');
  const [explorerPage, setExplorerPage] = useState<number>(1);
  const [explorerPageSize, setExplorerPageSize] = useState<number>(25);
  const [symbolPage, setSymbolPage] = useState<number>(1);

  // Architecture & Dependency pagination/filter state
  const [depEdgeQuery, setDepEdgeQuery] = useState<string>('');
  const [depEdgePage, setDepEdgePage] = useState<number>(1);
  const [extDepQuery, setExtDepQuery] = useState<string>('');
  const [extDepPage, setExtDepPage] = useState<number>(1);

  // Onboarding state
  const [onboardPath, setOnboardPath] = useState<string>('');
  const [onboardName, setOnboardName] = useState<string>('');
  const [onboardExcludeGlobs, setOnboardExcludeGlobs] = useState<string>('');
  const [onboardMaxFileSizeKb, setOnboardMaxFileSizeKb] = useState<number>(1024);
  const [onboardMaxTotalFiles, setOnboardMaxTotalFiles] = useState<number>(5000);

  // Per-project Settings & Exclusions editor state
  const [settingsRepoName, setSettingsRepoName] = useState<string>('');
  const [settingsExcludeGlobs, setSettingsExcludeGlobs] = useState<string>('');
  const [settingsMaxFileSizeKb, setSettingsMaxFileSizeKb] = useState<number>(1024);
  const [settingsMaxTotalFiles, setSettingsMaxTotalFiles] = useState<number>(5000);
  const [settingsMaxDepth, setSettingsMaxDepth] = useState<number>(25);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchScope, setSearchScope] = useState<'REPO' | 'GLOBAL'>('REPO');
  const [searchKind, setSearchKind] = useState<string>('');
  const [searchHits, setSearchHits] = useState<readonly SearchHit[]>([]);
  const [searchPage, setSearchPage] = useState<number>(1);

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
  const [excludedPackFiles, setExcludedPackFiles] = useState<readonly string[]>([]);
  const [assistantTarget, setAssistantTarget] = useState<CodingAssistantTarget>('universal');
  const [customTemplateInstruction, setCustomTemplateInstruction] = useState<string>('');
  const [maxTotalChars, setMaxTotalChars] = useState<number>(28000);
  const [maxFilesCount, setMaxFilesCount] = useState<number>(10);
  const [maxCharsPerFile, setMaxCharsPerFile] = useState<number>(6000);
  const [maxPackFileSizeKb, setMaxPackFileSizeKb] = useState<number>(512);
  const [staleFilePolicy, setStaleFilePolicy] = useState<'flag' | 'reject'>('flag');
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
  const [activeReviewMarkdown, setActiveReviewMarkdown] = useState<string>('');

  // Settings & AI Consent state
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyAndIndexStatus | null>(null);
  const [consentPreview, setConsentPreview] = useState<OutboundConsentPreview | null>(null);
  const [aiResponseText, setAiResponseText] = useState<string | null>(null);

  const syncProjectSettingsForm = useCallback((repo: RepositoryRecord | undefined) => {
    if (!repo) return;
    setSettingsRepoName(repo.name);
    setSettingsExcludeGlobs(repo.resourceLimits.customExcludeGlobs.join(', '));
    setSettingsMaxFileSizeKb(Math.max(1, Math.round(repo.resourceLimits.maxFileSizeBytes / 1024)));
    setSettingsMaxTotalFiles(repo.resourceLimits.maxTotalFiles);
    setSettingsMaxDepth(repo.resourceLimits.maxDirectoryDepth);
  }, []);

  const loadWorkspaceData = useCallback(
    async (preferredRepoId?: string) => {
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
          preferredRepoId !== undefined
            ? preferredRepoId
            : activeRepoId || (reposData.repositories[0]?.id ?? '');

        const activeRepoRecord = reposData.repositories.find((r) => r.id === targetId);
        if (targetId && activeRepoRecord) {
          setActiveRepoId(targetId);
          syncProjectSettingsForm(activeRepoRecord);
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
    },
    [activeRepoId, syncProjectSettingsForm]
  );

  useEffect(() => {
    void loadWorkspaceData();
  }, []);

  // Keyboard navigation Alt+1..Alt+9, Alt+0, Alt+-
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number.parseInt(e.key, 10) - 1;
        const item = NAV_ITEMS[idx];
        if (item) {
          e.preventDefault();
          setActiveView(item.id);
        }
      } else if (e.key === '0') {
        e.preventDefault();
        setActiveView('change_review');
      } else if (e.key === '-') {
        e.preventDefault();
        setActiveView('settings');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSelectRepo = async (repoId: string, navigateToView?: WorkspaceViewId) => {
    setActiveRepoId(repoId);
    setSelectedFilePath('');
    setFileContentData(null);
    setGeneratedPack(null);
    setActiveReviewReport(null);
    setMarkdownReportPreview(null);
    setExplorerPage(1);
    await loadWorkspaceData(repoId);
    if (navigateToView) {
      setActiveView(navigateToView);
    }
  };

  const loadFileWindow = async (
    repoId: string,
    relativePath: string,
    startLine: number,
    endLine: number,
    highlightLine: number | null
  ) => {
    setSelectedFilePath(relativePath);
    setSelectedFileHighlightLine(highlightLine);
    try {
      const data = await apiClient.readFile(repoId, relativePath, { startLine, endLine });
      setFileContentData({
        ...data,
        sliceStartLine: data.sliceStartLine ?? startLine,
        sliceEndLine: data.sliceEndLine ?? endLine,
        hasMoreBefore: data.hasMoreBefore ?? startLine > 1,
        hasMoreAfter: data.hasMoreAfter ?? endLine < data.lineCount,
      });
    } catch (err) {
      setFileContentData(null);
      setErrorBanner(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const openSourceReference = async (ref: SourceReference) => {
    const targetRepo = ref.repoId || activeRepoId;
    if (!targetRepo) return;
    const centerLine = ref.startLine ?? 1;
    const windowStart = Math.max(1, centerLine - 40);
    const windowEnd = windowStart + DEFAULT_FILE_WINDOW_LINES - 1;
    setActiveView('explorer');
    await loadFileWindow(targetRepo, ref.relativePath, windowStart, windowEnd, centerLine);
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
        resourceLimits: {
          maxFileSizeBytes: Math.max(1024, onboardMaxFileSizeKb * 1024),
          maxTotalFiles: Math.max(10, onboardMaxTotalFiles),
          ...(customExcludeGlobs.length > 0 ? { customExcludeGlobs } : {}),
        },
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

  const handleSaveProjectSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRepoId) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const customExcludeGlobs = settingsExcludeGlobs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { repository, snapshot: updatedSnap } = await apiClient.updateRepositorySettings(
        activeRepoId,
        {
          name: settingsRepoName.trim(),
          resourceLimits: {
            customExcludeGlobs,
            maxFileSizeBytes: Math.max(1024, settingsMaxFileSizeKb * 1024),
            maxTotalFiles: Math.max(10, settingsMaxTotalFiles),
            maxDirectoryDepth: Math.max(1, settingsMaxDepth),
          },
          rescan: true,
        }
      );
      setStatusNotice(
        `Updated settings & re-scanned "${repository.name}": ${updatedSnap?.stats.totalFilesIndexed ?? 0} files indexed (${updatedSnap?.stats.totalFilesExcluded ?? 0} excluded).`
      );
      await loadWorkspaceData(repository.id);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update project settings');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMarkdownReport = async () => {
    if (!activeRepoId) return;
    try {
      const { reportMarkdown } = await apiClient.getReport(activeRepoId);
      setMarkdownReportPreview(reportMarkdown);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to generate Markdown report');
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
      setSearchPage(1);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Search failed');
    }
  };

  useEffect(() => {
    if (activeView === 'search') {
      void handleRunSearch();
    }
  }, [activeView, activeRepoId, searchScope, searchKind]);

  const handleGenerateContextPack = async (overrides?: {
    readonly seedFilePaths?: readonly string[];
    readonly excludedFilePaths?: readonly string[];
  }) => {
    if (!activeRepoId) return;
    setLoading(true);
    setErrorBanner(null);
    const nextSeeds = overrides?.seedFilePaths ?? seedFiles;
    const nextExcluded = overrides?.excludedFilePaths ?? excludedPackFiles;
    try {
      const res = await apiClient.generateContextPack(activeRepoId, {
        taskType,
        taskTitle,
        taskDescription,
        targetSubProjectId: targetSubProjectId || null,
        seedFilePaths: [...nextSeeds],
        excludedFilePaths: [...nextExcluded],
        assistantTarget,
        ...(customTemplateInstruction.trim()
          ? { customTemplateInstruction: customTemplateInstruction.trim() }
          : {}),
        budget: {
          maxTotalChars,
          maxFilesCount,
          maxCharsPerFile,
          maxFileSizeBytes: Math.max(1024, maxPackFileSizeKb * 1024),
          staleFilePolicy,
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

  const toggleExcludedPackFile = (relPath: string) => {
    setExcludedPackFiles((prev) =>
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
      setActiveReviewMarkdown(res.markdownReport ?? '');
      setStatusNotice(
        `Completed change review: ${res.report.findings.length} evidence-backed finding(s) across ${res.report.stats.totalChangedFiles} changed file(s).`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Change review failed');
    } finally {
      setLoading(false);
    }
  };

  const analysisStatus = useMemo(
    () => deriveAnalysisStatus({ loading, errorBanner, snapshot }),
    [loading, errorBanner, snapshot]
  );

  const languageBreakdown = useMemo(
    () => (snapshot ? computeLanguageBreakdown(snapshot) : []),
    [snapshot]
  );

  const exclusionBreakdown = useMemo(
    () => (snapshot ? computeExclusionBreakdown(snapshot.files) : []),
    [snapshot]
  );

  const filteredExplorerFiles = useMemo(() => {
    if (!snapshot) return [];
    return filterExplorerFiles(snapshot.files, {
      pathQuery: explorerPathQuery,
      roleFilter: explorerRoleFilter,
      subProjectFilter: explorerSubProjectFilter,
      languageFilter: explorerLanguageFilter,
      statusFilter: explorerStatusFilter,
    });
  }, [
    snapshot,
    explorerPathQuery,
    explorerRoleFilter,
    explorerSubProjectFilter,
    explorerLanguageFilter,
    explorerStatusFilter,
  ]);

  const paginatedExplorerFiles = useMemo(
    () => paginateItems(filteredExplorerFiles, explorerPage, explorerPageSize),
    [filteredExplorerFiles, explorerPage, explorerPageSize]
  );

  const selectedFileSymbols = useMemo(() => {
    if (!snapshot) return [];
    if (selectedFilePath) {
      return snapshot.symbols.filter((s) => s.sourceRef.relativePath === selectedFilePath);
    }
    return snapshot.symbols;
  }, [snapshot, selectedFilePath]);

  const paginatedSymbols = useMemo(
    () => paginateItems(selectedFileSymbols, symbolPage, 15),
    [selectedFileSymbols, symbolPage]
  );

  const filteredDepEdges = useMemo(() => {
    if (!snapshot) return [];
    const q = depEdgeQuery.trim().toLowerCase();
    if (!q) return snapshot.dependencyEdges;
    return snapshot.dependencyEdges.filter(
      (e) =>
        e.value.fromPathOrModule.toLowerCase().includes(q) ||
        e.value.toPathOrModule.toLowerCase().includes(q) ||
        e.value.kind.toLowerCase().includes(q)
    );
  }, [snapshot, depEdgeQuery]);

  const paginatedDepEdges = useMemo(
    () => paginateItems(filteredDepEdges, depEdgePage, 25),
    [filteredDepEdges, depEdgePage]
  );

  const filteredExtDeps = useMemo(() => {
    if (!snapshot) return [];
    const q = extDepQuery.trim().toLowerCase();
    if (!q) return snapshot.externalDependencies;
    return snapshot.externalDependencies.filter(
      (d) =>
        d.value.name.toLowerCase().includes(q) ||
        d.value.ecosystem.toLowerCase().includes(q)
    );
  }, [snapshot, extDepQuery]);

  const paginatedExtDeps = useMemo(
    () => paginateItems(filteredExtDeps, extDepPage, 25),
    [filteredExtDeps, extDepPage]
  );

  const paginatedSearchHits = useMemo(
    () => paginateItems(searchHits, searchPage, 25),
    [searchHits, searchPage]
  );

  const staleKnowledgeCount = useMemo(
    () =>
      knowledgeEntries.filter(
        (k) => k.stalenessStatus !== 'verified_fresh' && k.stalenessStatus !== 'unlinked'
      ).length,
    [knowledgeEntries]
  );

  return {
    activeView,
    setActiveView,
    health,
    setHealth,
    repositories,
    setRepositories,
    activeRepoId,
    setActiveRepoId,
    snapshot,
    setSnapshot,
    knowledgeEntries,
    setKnowledgeEntries,
    loading,
    setLoading,
    errorBanner,
    setErrorBanner,
    statusNotice,
    setStatusNotice,
    inspectedEvidence,
    setInspectedEvidence,
    markdownReportPreview,
    setMarkdownReportPreview,
    selectedFilePath,
    setSelectedFilePath,
    selectedFileHighlightLine,
    setSelectedFileHighlightLine,
    fileContentData,
    setFileContentData,
    explorerPathQuery,
    setExplorerPathQuery,
    explorerRoleFilter,
    setExplorerRoleFilter,
    explorerSubProjectFilter,
    setExplorerSubProjectFilter,
    explorerLanguageFilter,
    setExplorerLanguageFilter,
    explorerStatusFilter,
    setExplorerStatusFilter,
    explorerPage,
    setExplorerPage,
    explorerPageSize,
    setExplorerPageSize,
    symbolPage,
    setSymbolPage,
    depEdgeQuery,
    setDepEdgeQuery,
    depEdgePage,
    setDepEdgePage,
    extDepQuery,
    setExtDepQuery,
    extDepPage,
    setExtDepPage,
    onboardPath,
    setOnboardPath,
    onboardName,
    setOnboardName,
    onboardExcludeGlobs,
    setOnboardExcludeGlobs,
    onboardMaxFileSizeKb,
    setOnboardMaxFileSizeKb,
    onboardMaxTotalFiles,
    setOnboardMaxTotalFiles,
    settingsRepoName,
    setSettingsRepoName,
    settingsExcludeGlobs,
    setSettingsExcludeGlobs,
    settingsMaxFileSizeKb,
    setSettingsMaxFileSizeKb,
    settingsMaxTotalFiles,
    setSettingsMaxTotalFiles,
    settingsMaxDepth,
    setSettingsMaxDepth,
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchKind,
    setSearchKind,
    searchHits,
    setSearchHits,
    searchPage,
    setSearchPage,
    taskType,
    setTaskType,
    taskTitle,
    setTaskTitle,
    taskDescription,
    setTaskDescription,
    targetSubProjectId,
    setTargetSubProjectId,
    seedFiles,
    setSeedFiles,
    excludedPackFiles,
    setExcludedPackFiles,
    assistantTarget,
    setAssistantTarget,
    customTemplateInstruction,
    setCustomTemplateInstruction,
    maxTotalChars,
    setMaxTotalChars,
    maxFilesCount,
    setMaxFilesCount,
    maxCharsPerFile,
    setMaxCharsPerFile,
    maxPackFileSizeKb,
    setMaxPackFileSizeKb,
    staleFilePolicy,
    setStaleFilePolicy,
    includeTests,
    setIncludeTests,
    generatedPack,
    setGeneratedPack,
    exportFormatTab,
    setExportFormatTab,
    newKnowCategory,
    setNewKnowCategory,
    newKnowTitle,
    setNewKnowTitle,
    newKnowContent,
    setNewKnowContent,
    newKnowRefPath,
    setNewKnowRefPath,
    diffTargetSpec,
    setDiffTargetSpec,
    rawDiffInput,
    setRawDiffInput,
    activeReviewReport,
    setActiveReviewReport,
    activeReviewMarkdown,
    setActiveReviewMarkdown,
    aiConfig,
    setAiConfig,
    privacyStatus,
    setPrivacyStatus,
    consentPreview,
    setConsentPreview,
    aiResponseText,
    setAiResponseText,
    syncProjectSettingsForm,
    loadWorkspaceData,
    handleSelectRepo,
    loadFileWindow,
    openSourceReference,
    handleOnboardRepo,
    handleSaveProjectSettings,
    handleLoadMarkdownReport,
    handleRunSearch,
    handleGenerateContextPack,
    toggleSeedFile,
    toggleExcludedPackFile,
    handleSaveKnowledge,
    handleRunChangeReview,
    analysisStatus,
    languageBreakdown,
    exclusionBreakdown,
    filteredExplorerFiles,
    paginatedExplorerFiles,
    selectedFileSymbols,
    paginatedSymbols,
    filteredDepEdges,
    paginatedDepEdges,
    filteredExtDeps,
    paginatedExtDeps,
    paginatedSearchHits,
    staleKnowledgeCount,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
