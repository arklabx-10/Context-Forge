/**
 * ContextForge Domain Port & Adapter Interfaces
 * Pure TypeScript — ZERO external or Node.js runtime imports allowed.
 */

import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderCapabilities,
  AiProviderConfig,
  ApiSurfaceDescriptor,
  ChangedFileDiff,
  ChangeReviewReport,
  ContextExportFormat,
  ContextPack,
  DatabaseObjectDescriptor,
  DependencyEdge,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExternalDependency,
  ExtractedSymbol,
  GitMetadata,
  IndexedFileRecord,
  KnowledgeEntry,
  OutboundConsentToken,
  PrivacyAndIndexStatus,
  RepositoryRecord,
  RepositorySnapshot,
  ReviewFinding,
  ScanResourceLimits,
  SearchHit,
  SourceReference,
  SubProjectKind,
} from './models.js';

export interface AdapterCapabilities {
  readonly detectsManifests: boolean;
  readonly extractsSymbols: boolean;
  readonly extractsModuleImports: boolean;
  readonly detectsEntryPoints: boolean;
  readonly detectsApiSurfaces: boolean;
  readonly analyzesSqlObjects: boolean;
  readonly inspectsDiffRisks: boolean;
}

export interface AdapterFileContext {
  readonly repoId: string;
  readonly commitSha?: string;
  readonly subProjectId: string;
  readonly subProjectRootPath: string;
  readonly file: IndexedFileRecord;
  readonly content: string;
  readonly lines: readonly string[];
  readonly siblingFilePaths: readonly string[];
}

export interface AdapterAnalysisFragment {
  readonly subProjectKindHint?: SubProjectKind;
  readonly subProjectNameHint?: string;
  readonly languages?: readonly EvidenceBackedClaim<string>[];
  readonly frameworks?: readonly EvidenceBackedClaim<string>[];
  readonly packageManagers?: readonly EvidenceBackedClaim<string>[];
  readonly buildSystems?: readonly EvidenceBackedClaim<string>[];
  readonly testHarnesses?: readonly EvidenceBackedClaim<string>[];
  readonly entryPoints?: readonly EvidenceBackedClaim<EntryPointDescriptor>[];
  readonly apiSurfaces?: readonly EvidenceBackedClaim<ApiSurfaceDescriptor>[];
  readonly databaseObjects?: readonly EvidenceBackedClaim<DatabaseObjectDescriptor>[];
  readonly symbols?: readonly ExtractedSymbol[];
  readonly dependencyEdges?: readonly EvidenceBackedClaim<DependencyEdge>[];
  readonly externalDependencies?: readonly EvidenceBackedClaim<ExternalDependency>[];
  readonly workspaceMemberGlobs?: readonly string[];
  readonly notesOrLimitations?: readonly string[];
}

export interface AdapterDiffContext {
  readonly repoId: string;
  readonly commitSha?: string;
  readonly diff: ChangedFileDiff;
  readonly currentFileSha256: string;
  readonly fullCurrentContent?: string;
}

/**
 * 1. Analyzer Port: Pluggable, independently testable Language / Stack / SQL Adapter contract.
 */
export interface RepositoryAnalyzerAdapter {
  readonly adapterId: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly capabilities: AdapterCapabilities;

  supportsFile(file: IndexedFileRecord): boolean;

  analyzeFile(context: AdapterFileContext): Promise<AdapterAnalysisFragment>;

  inspectFileDiff?(context: AdapterDiffContext): Promise<readonly ReviewFinding[]>;
}

/**
 * 2. Repository Access Port: Safe local filesystem and read-only Git access contract.
 */
export interface RepositoryAccessPort {
  validateAndResolveRoot(inputPath: string): Promise<string>;
  readSafeFile(
    canonicalRootPath: string,
    relativePath: string,
    maxBytes?: number
  ): Promise<{ readonly content: string; readonly sha256: string; readonly lineCount: number } | null>;
  extractGitMetadata(canonicalRootPath: string): Promise<GitMetadata>;
  getGitDiffs(
    canonicalRootPath: string,
    targetSpec?: string
  ): Promise<{ readonly label: string; readonly files: readonly ChangedFileDiff[] }>;
}

/**
 * 3. AI Provider Port: Vendor-neutral AI Provider interface.
 */
export interface AiProviderPort {
  readonly providerId: string;
  readonly displayName: string;

  getCapabilities(): AiProviderCapabilities;

  generateText(
    request: AiGenerationRequest,
    consentToken: OutboundConsentToken
  ): Promise<AiGenerationResponse>;
}

/**
 * 4. Persistence Port: Storage & Search Index contract.
 */
export interface PersistencePort {
  upsertRepository(record: RepositoryRecord): void;
  getRepositoryById(repoId: string): RepositoryRecord | null;
  getRepositoryByRootPath(rootPath: string): RepositoryRecord | null;
  listRepositories(): readonly RepositoryRecord[];
  deleteRepository(repoId: string): void;
  saveSnapshotAndIndex(
    snapshot: RepositorySnapshot,
    fileContentsMap?: ReadonlyMap<string, string>
  ): void;
  getLatestSnapshot(repoId: string): RepositorySnapshot | null;
  search(params: {
    readonly query: string;
    readonly repoId?: string;
    readonly kind?: SearchHit['kind'];
    readonly limit?: number;
  }): readonly SearchHit[];
  upsertKnowledgeEntry(
    entry: Omit<KnowledgeEntry, 'stalenessStatus' | 'driftDetails'>
  ): KnowledgeEntry;
  listKnowledgeEntries(repoId: string): readonly KnowledgeEntry[];
  deleteKnowledgeEntry(id: string): void;
  saveContextPack(pack: ContextPack): void;
  listContextPacks(repoId: string): readonly ContextPack[];
  saveChangeReview(report: ChangeReviewReport): void;
  listChangeReviews(repoId: string): readonly ChangeReviewReport[];
  getAiProviderConfig(): AiProviderConfig;
  saveAiProviderConfig(config: AiProviderConfig): void;
  recordOutboundConsentApproval(token: OutboundConsentToken): void;
  verifyOutboundConsent(consentId: string, payloadSha256: string, providerId: string): boolean;
  getPrivacyAndIndexStatus(): PrivacyAndIndexStatus;
  purgeAllIndexedData(): void;
}

/**
 * 5. Context Exporter Port: Deterministic ContextPack formatting contract.
 */
export interface ContextExporterPort {
  exportPack(pack: ContextPack, format: ContextExportFormat): string;
}

/**
 * 6. Report Generator Port: Deterministic Repository Analysis Markdown Report contract (No-AI required).
 */
export interface ReportGeneratorPort {
  generateMarkdownReport(
    snapshot: RepositorySnapshot,
    options?: { readonly includeTimestamps?: boolean }
  ): string;
}

/**
 * Helper to construct a deterministic SourceReference.
 */
export function createSourceRef(params: {
  repoId: string;
  relativePath: string;
  fileSha256: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  commitSha?: string;
  capturedAtIso?: string;
}): SourceReference {
  return {
    repoId: params.repoId,
    relativePath: params.relativePath.replace(/\\/g, '/'),
    fileSha256: params.fileSha256,
    ...(params.startLine !== undefined ? { startLine: params.startLine } : {}),
    ...(params.endLine !== undefined ? { endLine: params.endLine } : {}),
    ...(params.symbolName !== undefined ? { symbolName: params.symbolName } : {}),
    ...(params.commitSha !== undefined ? { commitSha: params.commitSha } : {}),
    capturedAtIso: params.capturedAtIso ?? new Date().toISOString(),
  };
}
