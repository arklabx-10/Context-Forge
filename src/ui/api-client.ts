import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderConfig,
  ChangeReviewReport,
  CodingAssistantTarget,
  ContextBudgetConfig,
  ContextPack,
  DevelopmentTaskType,
  KnowledgeCategory,
  KnowledgeEntry,
  OutboundConsentPreview,
  OutboundConsentToken,
  PrivacyAndIndexStatus,
  RepositoryAnalyzerAdapter,
  RepositoryRecord,
  RepositorySnapshot,
  ScanResourceLimits,
  SearchHit,
} from '../domain/index.js';

export interface KnowledgeAuditSummary {
  readonly repoId: string;
  readonly totalEntries: number;
  readonly freshCount: number;
  readonly potentiallyStaleCount: number;
  readonly missingReferenceCount: number;
  readonly unlinkedCount: number;
  readonly entries: readonly KnowledgeEntry[];
}

export interface HealthPayload {
  readonly status: string;
  readonly adapters: readonly {
    readonly adapterId: string;
    readonly displayName: string;
    readonly description: string;
    readonly version: string;
    readonly capabilities: RepositoryAnalyzerAdapter['capabilities'];
  }[];
  readonly privacy: PrivacyAndIndexStatus;
  readonly presets: readonly {
    readonly label: string;
    readonly description: string;
    readonly path: string;
  }[];
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export const apiClient = {
  getHealth: () => requestJson<HealthPayload>('/api/health'),

  listRepositories: () =>
    requestJson<{ repositories: readonly RepositoryRecord[] }>('/api/repositories'),

  onboardRepository: (payload: {
    rootPath: string;
    name?: string;
    resourceLimits?: Partial<ScanResourceLimits>;
  }) =>
    requestJson<{ repository: RepositoryRecord; snapshot: RepositorySnapshot }>(
      '/api/repositories/onboard',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  rescanRepository: (repoId: string) =>
    requestJson<{ snapshot: RepositorySnapshot }>(
      `/api/repositories/${encodeURIComponent(repoId)}/rescan`,
      { method: 'POST' }
    ),

  updateRepositorySettings: (
    repoId: string,
    payload: {
      name?: string;
      resourceLimits?: Partial<ScanResourceLimits>;
      rescan?: boolean;
    }
  ) =>
    requestJson<{ repository: RepositoryRecord; snapshot: RepositorySnapshot | null }>(
      `/api/repositories/${encodeURIComponent(repoId)}/settings`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteRepository: (repoId: string) =>
    requestJson<{ deleted: boolean }>(`/api/repositories/${encodeURIComponent(repoId)}`, {
      method: 'DELETE',
    }),

  getSnapshot: (repoId: string) =>
    requestJson<{ snapshot: RepositorySnapshot }>(
      `/api/repositories/${encodeURIComponent(repoId)}/snapshot`
    ),

  getReport: (repoId: string) =>
    requestJson<{ reportMarkdown: string }>(
      `/api/repositories/${encodeURIComponent(repoId)}/report`
    ),

  readFile: (
    repoId: string,
    relativePath: string,
    options?: { startLine?: number; endLine?: number }
  ) => {
    const qs = new URLSearchParams({ path: relativePath });
    if (options?.startLine !== undefined) qs.set('startLine', String(options.startLine));
    if (options?.endLine !== undefined) qs.set('endLine', String(options.endLine));
    return requestJson<{
      relativePath: string;
      content: string;
      sha256: string;
      lineCount: number;
      sliceStartLine: number;
      sliceEndLine: number;
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    }>(`/api/repositories/${encodeURIComponent(repoId)}/file?${qs.toString()}`);
  },

  search: (params: { query: string; repoId?: string; kind?: string }) => {
    const qs = new URLSearchParams({ q: params.query });
    if (params.repoId) qs.set('repoId', params.repoId);
    if (params.kind) qs.set('kind', params.kind);
    return requestJson<{ hits: readonly SearchHit[] }>(`/api/search?${qs.toString()}`);
  },

  generateContextPack: (
    repoId: string,
    payload: {
      taskType: DevelopmentTaskType;
      taskTitle: string;
      taskDescription: string;
      targetSubProjectId?: string | null;
      seedFilePaths?: string[];
      excludedFilePaths?: string[];
      assistantTarget?: CodingAssistantTarget;
      customTemplateInstruction?: string;
      budget?: Partial<ContextBudgetConfig>;
    }
  ) =>
    requestJson<{
      pack: ContextPack;
      markdownExport: string;
      plainTextExport: string;
    }>(`/api/repositories/${encodeURIComponent(repoId)}/context-packs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listKnowledge: (repoId: string) =>
    requestJson<{ entries: readonly KnowledgeEntry[] }>(
      `/api/repositories/${encodeURIComponent(repoId)}/knowledge`
    ),

  auditKnowledge: (repoId: string) =>
    requestJson<{ audit: KnowledgeAuditSummary }>(
      `/api/repositories/${encodeURIComponent(repoId)}/knowledge/audit`
    ),

  reconcileKnowledge: (repoId: string, entryId: string, removeMissingReferences?: boolean) =>
    requestJson<{ entry: KnowledgeEntry }>(
      `/api/repositories/${encodeURIComponent(repoId)}/knowledge/${encodeURIComponent(entryId)}/reconcile`,
      {
        method: 'POST',
        body: JSON.stringify({ removeMissingReferences }),
      }
    ),

  saveKnowledge: (
    repoId: string,
    payload: {
      id?: string;
      category: KnowledgeCategory;
      title: string;
      contentMarkdown: string;
      isAiGeneratedSummary?: boolean;
      linkedFilePaths?: { relativePath: string; startLine?: number; endLine?: number }[];
    }
  ) =>
    requestJson<{ entry: KnowledgeEntry }>(
      `/api/repositories/${encodeURIComponent(repoId)}/knowledge`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteKnowledge: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  reviewChanges: (
    repoId: string,
    payload: { targetSpec?: string; rawDiffOverride?: string }
  ) =>
    requestJson<{ report: ChangeReviewReport; markdownReport?: string }>(
      `/api/repositories/${encodeURIComponent(repoId)}/reviews`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listReviews: (repoId: string) =>
    requestJson<{ reviews: readonly ChangeReviewReport[] }>(
      `/api/repositories/${encodeURIComponent(repoId)}/reviews`
    ),

  getAiConfig: () => requestJson<{ config: AiProviderConfig }>('/api/settings/ai'),

  saveAiConfig: (config: AiProviderConfig) =>
    requestJson<{ config: AiProviderConfig }>('/api/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  previewOutboundConsent: (request: AiGenerationRequest) =>
    requestJson<{ preview: OutboundConsentPreview }>('/api/ai/consent-preview', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  executeAiWithConsent: (payload: {
    request: AiGenerationRequest;
    consentToken: OutboundConsentToken;
    apiKey?: string;
  }) =>
    requestJson<{ response: AiGenerationResponse }>('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPrivacyStatus: () => requestJson<{ status: PrivacyAndIndexStatus }>('/api/settings/privacy'),

  purgeAllData: () =>
    requestJson<{ purged: boolean; status: PrivacyAndIndexStatus }>(
      '/api/settings/privacy/purge',
      { method: 'POST' }
    ),
};
