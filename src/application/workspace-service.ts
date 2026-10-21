import crypto from 'node:crypto';
import path from 'node:path';
import { createDefaultAdapters } from '../adapters/index.js';
import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderConfig,
  ChangeReviewReport,
  CodingAssistantTarget,
  ContextBudgetConfig,
  ContextExportFormat,
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
  SourceReference,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';
import {
  ConsentGatedExternalAiProvider,
  createOutboundConsentPreview,
  NoOpDeterministicProvider,
} from '../infrastructure/ai/ai-providers.js';
import { assembleContextPack } from '../infrastructure/context-engine/context-assembler.js';
import { exportContextPack } from '../infrastructure/context-engine/context-exporters.js';
import { ContextForgeSqliteStore } from '../infrastructure/persistence/sqlite-store.js';
import {
  DEFAULT_SCAN_RESOURCE_LIMITS,
  readSafeRepoFile,
  validateAndResolveRepoRoot,
} from '../infrastructure/repo-access/safe-fs.js';
import { generateRepositoryMarkdownReport } from '../infrastructure/reporting/markdown-report-generator.js';
import { analyzeRepository } from '../infrastructure/scanning/repository-analyzer.js';
import { reviewRepositoryChanges } from './change-review-service.js';

export class ContextForgeWorkspaceService {
  private readonly store: ContextForgeSqliteStore;
  private readonly adapters: readonly RepositoryAnalyzerAdapter[];

  public constructor(
    store: ContextForgeSqliteStore,
    adapters: readonly RepositoryAnalyzerAdapter[] = createDefaultAdapters()
  ) {
    this.store = store;
    this.adapters = adapters;
  }

  public getRegisteredAdapters(): readonly {
    readonly adapterId: string;
    readonly displayName: string;
    readonly description: string;
    readonly version: string;
    readonly capabilities: RepositoryAnalyzerAdapter['capabilities'];
  }[] {
    return this.adapters.map((a) => ({
      adapterId: a.adapterId,
      displayName: a.displayName,
      description: a.description,
      version: a.version,
      capabilities: a.capabilities,
    }));
  }

  public async onboardRepository(params: {
    readonly rootPath: string;
    readonly name?: string;
    readonly resourceLimits?: Partial<ScanResourceLimits>;
  }): Promise<{ readonly repository: RepositoryRecord; readonly snapshot: RepositorySnapshot }> {
    const canonicalRoot = await validateAndResolveRepoRoot(params.rootPath);
    const existing = this.store.getRepositoryByRootPath(canonicalRoot);

    const limits: ScanResourceLimits = {
      ...DEFAULT_SCAN_RESOURCE_LIMITS,
      ...(existing?.resourceLimits ?? {}),
      ...(params.resourceLimits ?? {}),
    };

    const repoId = existing?.id ?? `repo_${crypto.randomUUID().slice(0, 12)}`;
    const repoName = params.name?.trim() || existing?.name || path.basename(canonicalRoot);
    const nowIso = new Date().toISOString();

    const record: RepositoryRecord = {
      id: repoId,
      name: repoName,
      rootPath: canonicalRoot,
      createdAtIso: existing?.createdAtIso ?? nowIso,
      lastAnalyzedAtIso: nowIso,
      latestSnapshotId: existing?.latestSnapshotId ?? null,
      resourceLimits: limits,
    };

    this.store.upsertRepository(record);

    const { snapshot, indexedFileContents } = await analyzeRepository({
      repoId,
      repoName,
      rootPath: canonicalRoot,
      adapters: this.adapters,
      resourceLimits: limits,
    });

    this.store.saveSnapshotAndIndex(snapshot, indexedFileContents);
    const updatedRepo = this.store.getRepositoryById(repoId)!;

    return {
      repository: updatedRepo,
      snapshot,
    };
  }

  public async rescanRepository(repoId: string): Promise<RepositorySnapshot> {
    const repo = this.store.getRepositoryById(repoId);
    if (!repo) {
      throw new Error(`Repository not found: ${repoId}`);
    }
    const { snapshot } = await this.onboardRepository({
      rootPath: repo.rootPath,
      name: repo.name,
      resourceLimits: repo.resourceLimits,
    });
    return snapshot;
  }

  public listRepositories(): readonly RepositoryRecord[] {
    return this.store.listRepositories();
  }

  public getRepositorySnapshot(repoId: string): RepositorySnapshot | null {
    return this.store.getLatestSnapshot(repoId);
  }

  public generateRepositoryReport(
    repoId: string,
    options?: { readonly includeTimestamps?: boolean }
  ): string {
    const snapshot = this.store.getLatestSnapshot(repoId);
    if (!snapshot) {
      throw new Error(`No snapshot found for repository ${repoId}`);
    }
    return generateRepositoryMarkdownReport(snapshot, options);
  }

  public async readRepositoryFile(
    repoId: string,
    relativePath: string
  ): Promise<{
    readonly relativePath: string;
    readonly content: string;
    readonly sha256: string;
    readonly lineCount: number;
  } | null> {
    const repo = this.store.getRepositoryById(repoId);
    if (!repo) {
      throw new Error(`Repository not found: ${repoId}`);
    }
    const result = await readSafeRepoFile(
      repo.rootPath,
      relativePath,
      repo.resourceLimits.maxFileSizeBytes
    );
    if (!result) {
      return null;
    }
    return {
      relativePath: relativePath.replace(/\\/g, '/'),
      ...result,
    };
  }

  public search(params: {
    readonly query: string;
    readonly repoId?: string;
    readonly kind?: SearchHit['kind'];
    readonly limit?: number;
  }): readonly SearchHit[] {
    return this.store.search(params);
  }

  public async generateContextPack(params: {
    readonly repoId: string;
    readonly taskType: DevelopmentTaskType;
    readonly taskTitle: string;
    readonly taskDescription: string;
    readonly targetSubProjectId?: string | null;
    readonly seedFilePaths?: readonly string[];
    readonly assistantTarget?: CodingAssistantTarget;
    readonly budget?: Partial<ContextBudgetConfig>;
  }): Promise<{
    readonly pack: ContextPack;
    readonly markdownExport: string;
    readonly plainTextExport: string;
  }> {
    const snapshot = this.store.getLatestSnapshot(params.repoId);
    if (!snapshot) {
      throw new Error(`No snapshot found for repository ${params.repoId}`);
    }
    const knowledgeEntries = this.store.listKnowledgeEntries(params.repoId);

    const pack = await assembleContextPack({
      snapshot,
      knowledgeEntries,
      taskType: params.taskType,
      taskTitle: params.taskTitle,
      taskDescription: params.taskDescription,
      ...(params.targetSubProjectId !== undefined
        ? { targetSubProjectId: params.targetSubProjectId }
        : {}),
      ...(params.seedFilePaths !== undefined ? { seedFilePaths: params.seedFilePaths } : {}),
      ...(params.assistantTarget !== undefined
        ? { assistantTarget: params.assistantTarget }
        : {}),
      ...(params.budget !== undefined ? { budget: params.budget } : {}),
    });

    this.store.saveContextPack(pack);

    return {
      pack,
      markdownExport: exportContextPack(pack, 'markdown'),
      plainTextExport: exportContextPack(pack, 'plaintext'),
    };
  }

  public listContextPacks(repoId: string): readonly ContextPack[] {
    return this.store.listContextPacks(repoId);
  }

  public exportPack(pack: ContextPack, format: ContextExportFormat): string {
    return exportContextPack(pack, format);
  }

  public saveKnowledgeEntry(params: {
    readonly id?: string;
    readonly repoId: string;
    readonly category: KnowledgeCategory;
    readonly title: string;
    readonly contentMarkdown: string;
    readonly isAiGeneratedSummary?: boolean;
    readonly linkedFilePaths?: readonly {
      readonly relativePath: string;
      readonly startLine?: number;
      readonly endLine?: number;
    }[];
  }): KnowledgeEntry {
    const snapshot = this.store.getLatestSnapshot(params.repoId);
    const fileMap = new Map(snapshot?.files.map((f) => [f.relativePath, f]) ?? []);
    const nowIso = new Date().toISOString();

    const linkedReferences: SourceReference[] = (params.linkedFilePaths ?? []).map((item) => {
      const cleanRel = item.relativePath.replace(/\\/g, '/');
      const fileRecord = fileMap.get(cleanRel);
      return createSourceRef({
        repoId: params.repoId,
        relativePath: cleanRel,
        fileSha256: fileRecord?.sha256 ?? 'unverified_sha256',
        ...(item.startLine !== undefined ? { startLine: item.startLine } : {}),
        ...(item.endLine !== undefined ? { endLine: item.endLine } : {}),
        ...(snapshot?.gitMetadata.headCommitSha
          ? { commitSha: snapshot.gitMetadata.headCommitSha }
          : {}),
        capturedAtIso: nowIso,
      });
    });

    return this.store.upsertKnowledgeEntry({
      id: params.id ?? `know_${crypto.randomUUID().slice(0, 12)}`,
      repoId: params.repoId,
      category: params.category,
      title: params.title,
      contentMarkdown: params.contentMarkdown,
      isAiGeneratedSummary: Boolean(params.isAiGeneratedSummary),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      linkedReferences,
    });
  }

  public listKnowledgeEntries(repoId: string): readonly KnowledgeEntry[] {
    return this.store.listKnowledgeEntries(repoId);
  }

  public deleteKnowledgeEntry(id: string): void {
    this.store.deleteKnowledgeEntry(id);
  }

  public async reviewChanges(params: {
    readonly repoId: string;
    readonly targetSpec?: string;
    readonly rawDiffOverride?: string;
  }): Promise<ChangeReviewReport> {
    const snapshot = this.store.getLatestSnapshot(params.repoId);
    if (!snapshot) {
      throw new Error(`No snapshot found for repository ${params.repoId}`);
    }
    const knowledgeEntries = this.store.listKnowledgeEntries(params.repoId);

    const report = await reviewRepositoryChanges({
      snapshot,
      knowledgeEntries,
      adapters: this.adapters,
      ...(params.targetSpec !== undefined ? { targetSpec: params.targetSpec } : {}),
      ...(params.rawDiffOverride !== undefined
        ? { rawDiffOverride: params.rawDiffOverride }
        : {}),
    });

    this.store.saveChangeReview(report);
    return report;
  }

  public listChangeReviews(repoId: string): readonly ChangeReviewReport[] {
    return this.store.listChangeReviews(repoId);
  }

  public getAiProviderConfig(): AiProviderConfig {
    return this.store.getAiProviderConfig();
  }

  public saveAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
    this.store.saveAiProviderConfig(config);
    return this.store.getAiProviderConfig();
  }

  public createOutboundAiConsentPreview(request: AiGenerationRequest): OutboundConsentPreview {
    const config = this.store.getAiProviderConfig();
    return createOutboundConsentPreview(config, request);
  }

  public async executeAiGenerationWithConsent(
    request: AiGenerationRequest,
    consentToken: OutboundConsentToken,
    apiKey?: string
  ): Promise<AiGenerationResponse> {
    const config = this.store.getAiProviderConfig();
    if (config.activeProviderId === 'noop_deterministic') {
      const noop = new NoOpDeterministicProvider();
      return noop.generateText(request, consentToken);
    }

    this.store.recordOutboundConsentApproval(consentToken);
    const provider = new ConsentGatedExternalAiProvider(config, this.store, apiKey);
    return provider.generateText(request, consentToken);
  }

  public getPrivacyAndIndexStatus(): PrivacyAndIndexStatus {
    return this.store.getPrivacyAndIndexStatus();
  }

  public deleteRepositoryData(repoId: string): void {
    this.store.deleteRepository(repoId);
  }

  public purgeAllIndexedData(): void {
    this.store.purgeAllIndexedData();
  }
}
