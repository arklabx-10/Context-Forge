/**
 * ContextForge Core Domain Models & Value Objects
 * Pure TypeScript — ZERO external or Node.js runtime imports allowed.
 */

export type CertaintyLevel = 'verified' | 'inferred' | 'ai_generated' | 'unknown';

export interface SourceReference {
  readonly repoId: string;
  /** Repository-relative path normalized to POSIX forward slashes (e.g., "services/api/src/index.ts") */
  readonly relativePath: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly symbolName?: string;
  /** SHA-256 hash of LF-normalized file contents at capture time */
  readonly fileSha256: string;
  readonly commitSha?: string;
  readonly capturedAtIso: string;
}

export interface EvidenceBackedClaim<T> {
  readonly id: string;
  readonly value: T;
  readonly certainty: CertaintyLevel;
  readonly evidence: readonly SourceReference[];
  readonly rationale: string;
  readonly producerId: string;
  readonly isStale?: boolean;
}

export type FileRole =
  | 'source'
  | 'test'
  | 'manifest'
  | 'lockfile'
  | 'build_config'
  | 'api_spec'
  | 'config_template'
  | 'documentation'
  | 'database_script'
  | 'ci_workflow'
  | 'generated'
  | 'binary'
  | 'unknown';

export type ExclusionReason =
  | 'git_ignored'
  | 'user_excluded'
  | 'sensitive_filename'
  | 'secret_content_detected'
  | 'binary_or_oversized'
  | 'symlink_escape_blocked'
  | 'inaccessible_or_permission_denied'
  | 'resource_limit_reached';

export type LanguageDetectionSignal =
  | 'extension'
  | 'filename'
  | 'shebang'
  | 'content_signature';

export interface IndexedFileRecord {
  readonly relativePath: string;
  readonly subProjectId: string | null;
  readonly sizeBytes: number;
  readonly lineCount: number | null;
  readonly sha256: string;
  readonly detectedLanguage: string | null;
  readonly languageDetectionSignals?: readonly LanguageDetectionSignal[];
  readonly role: FileRole;
  readonly isIndexed: boolean;
  readonly exclusionReason?: ExclusionReason;
  readonly lastModifiedIso: string;
}

export interface ExtractedSymbol {
  readonly name: string;
  readonly kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'struct'
    | 'enum'
    | 'constant'
    | 'endpoint'
    | 'sql_table'
    | 'sql_view'
    | 'sql_index'
    | 'module';
  readonly exported: boolean;
  readonly signature?: string;
  readonly sourceRef: SourceReference;
  readonly certainty: CertaintyLevel;
  readonly producerId: string;
}

export interface EntryPointDescriptor {
  readonly kind:
    | 'cli'
    | 'http_server'
    | 'worker'
    | 'ui_root'
    | 'library_export'
    | 'script'
    | 'main_function'
    | 'container_entry';
  readonly identifier: string;
  readonly runtimeCommandHint?: string;
}

export interface ApiSurfaceDescriptor {
  readonly protocol: 'http_rest' | 'graphql' | 'grpc' | 'rpc' | 'cli_command' | 'exported_module';
  readonly methodOrOperation: string;
  readonly routeOrSignature: string;
}

export interface DatabaseObjectDescriptor {
  readonly objectType: 'table' | 'view' | 'index' | 'migration' | 'procedure' | 'schema_model';
  readonly name: string;
  readonly dialectHint?: string;
  readonly columnsOrFields?: readonly string[];
}

export type SubProjectKind =
  | 'application'
  | 'service'
  | 'library'
  | 'database'
  | 'infrastructure'
  | 'workspace_root'
  | 'unknown';

export interface SubProject {
  readonly id: string;
  readonly name: string;
  /** Repository-relative directory path ("" for root, or e.g., "packages/core", "apps/web") */
  readonly rootPath: string;
  readonly kind: SubProjectKind;
  readonly manifests: readonly SourceReference[];
  readonly languages: readonly EvidenceBackedClaim<string>[];
  readonly frameworks: readonly EvidenceBackedClaim<string>[];
  readonly packageManagers: readonly EvidenceBackedClaim<string>[];
  readonly buildSystems: readonly EvidenceBackedClaim<string>[];
  readonly testHarnesses: readonly EvidenceBackedClaim<string>[];
  readonly entryPoints: readonly EvidenceBackedClaim<EntryPointDescriptor>[];
  readonly apiSurfaces: readonly EvidenceBackedClaim<ApiSurfaceDescriptor>[];
  readonly databaseObjects: readonly EvidenceBackedClaim<DatabaseObjectDescriptor>[];
  readonly configTemplates: readonly SourceReference[];
  readonly documentationFiles: readonly SourceReference[];
  readonly lockfiles?: readonly SourceReference[];
  readonly apiSpecifications?: readonly SourceReference[];
}

export interface DependencyEdge {
  readonly fromPathOrModule: string;
  readonly toPathOrModule: string;
  readonly kind: 'file_import' | 'subproject_reference' | 'sql_foreign_key' | 'config_reference';
  readonly rawSpecifier?: string;
}

export interface ExternalDependency {
  readonly subProjectId: string;
  readonly name: string;
  readonly versionConstraint: string;
  readonly scope: 'runtime' | 'development' | 'build' | 'peer' | 'unknown';
  readonly ecosystem: string;
}

export interface GitMetadata {
  readonly isGitRepo: boolean;
  readonly currentBranch: string | null;
  readonly headCommitSha: string | null;
  readonly isDirty: boolean;
  readonly remotes: readonly { readonly name: string; readonly urlRedacted: string }[];
  readonly recentCommits: readonly {
    readonly sha: string;
    readonly author: string;
    readonly dateIso: string;
    readonly subject: string;
  }[];
}

export interface ScanResourceLimits {
  readonly maxFileSizeBytes: number;
  readonly maxTotalFiles: number;
  readonly maxDirectoryDepth: number;
  readonly customExcludeGlobs: readonly string[];
}

export interface RepositoryRecord {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly createdAtIso: string;
  readonly lastAnalyzedAtIso: string | null;
  readonly latestSnapshotId: string | null;
  readonly resourceLimits: ScanResourceLimits;
}

export interface AnalyzerExecutionEntry {
  readonly adapterId: string;
  readonly displayName: string;
  readonly status: 'ran' | 'skipped' | 'partial_error';
  readonly filesMatchedCount: number;
  readonly reasonOrNotes: readonly string[];
}

export interface RepositorySnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly repoName: string;
  readonly rootPath: string;
  readonly analyzedAtIso: string;
  readonly gitMetadata: GitMetadata;
  readonly subProjects: readonly SubProject[];
  readonly files: readonly IndexedFileRecord[];
  readonly symbols: readonly ExtractedSymbol[];
  readonly dependencyEdges: readonly EvidenceBackedClaim<DependencyEdge>[];
  readonly externalDependencies: readonly EvidenceBackedClaim<ExternalDependency>[];
  readonly unknownsAndLimitations: readonly string[];
  readonly activeAdapters: readonly string[];
  readonly skippedAdapters?: readonly {
    readonly adapterId: string;
    readonly displayName: string;
    readonly reason: string;
  }[];
  readonly analyzerExecutionLog?: readonly AnalyzerExecutionEntry[];
  readonly stats: {
    readonly totalFilesDiscovered: number;
    readonly totalFilesIndexed: number;
    readonly totalFilesExcluded: number;
    readonly secretExclusionsCount: number;
    readonly symlinkEscapesBlocked: number;
    readonly inaccessibleFilesCount?: number;
    readonly totalSymbolsExtracted: number;
    readonly analysisDurationMs: number;
  };
}

// ============================================================================
// Search & Context Pack Assembly Models
// ============================================================================

export type SearchResultKind = 'file' | 'symbol' | 'dependency' | 'knowledge' | 'subproject';

export interface SearchHit {
  readonly id: string;
  readonly repoId: string;
  readonly repoName: string;
  readonly kind: SearchResultKind;
  readonly title: string;
  readonly subtitle: string;
  readonly snippet: string;
  readonly score: number;
  readonly sourceRef?: SourceReference;
  readonly certainty?: CertaintyLevel;
}

export type DevelopmentTaskType =
  | 'understand_module'
  | 'implement_feature'
  | 'fix_bug'
  | 'refactor'
  | 'write_tests'
  | 'review_changes'
  | 'database_change'
  | 'security_audit';

export type CodingAssistantTarget =
  | 'universal'
  | 'claude_code'
  | 'cursor'
  | 'github_copilot'
  | 'codex_aider';

export type ContextExportFormat = 'markdown' | 'plaintext';

export interface ContextBudgetConfig {
  readonly maxTotalChars: number;
  readonly maxFilesCount: number;
  readonly maxCharsPerFile: number;
  readonly includeTests: boolean;
  readonly includeKnowledgeAndAdrs: boolean;
  readonly includeDependencyGraphSummary: boolean;
}

export interface ScoreContribution {
  readonly ruleId: string;
  readonly points: number;
  readonly reason: string;
}

export interface PromptInjectionAlert {
  readonly severity: 'low' | 'medium' | 'high';
  readonly patternId: string;
  readonly description: string;
  readonly matchedExcerptRedacted: string;
  readonly sourceRef: SourceReference;
}

export interface ContextSelectionItem {
  readonly relativePath: string;
  readonly subProjectId: string | null;
  readonly role: FileRole;
  readonly startLine: number;
  readonly endLine: number;
  readonly charCount: number;
  readonly truncated: boolean;
  readonly relevanceScore: number;
  readonly scoreBreakdown: readonly ScoreContribution[];
  readonly sourceRef: SourceReference;
  readonly contentExcerpt: string;
  readonly symbolsInFile: readonly string[];
  readonly promptInjectionAlerts: readonly PromptInjectionAlert[];
}

export interface OmittedContextItem {
  readonly relativePath: string;
  readonly relevanceScore: number;
  readonly reason: 'budget_exceeded' | 'max_files_reached' | 'low_relevance' | 'excluded_sensitive';
  readonly scoreBreakdown: readonly ScoreContribution[];
}

export interface ContextPack {
  readonly packId: string;
  readonly repoId: string;
  readonly repoName: string;
  readonly snapshotId: string;
  readonly createdAtIso: string;
  readonly taskType: DevelopmentTaskType;
  readonly taskTitle: string;
  readonly taskDescription: string;
  readonly targetSubProjectId: string | null;
  readonly seedFilePaths: readonly string[];
  readonly assistantTarget: CodingAssistantTarget;
  readonly budget: ContextBudgetConfig;
  readonly usedChars: number;
  readonly estimatedTokens: number;
  readonly architectureSummaryClaims: readonly EvidenceBackedClaim<string>[];
  readonly includedItems: readonly ContextSelectionItem[];
  readonly omittedItems: readonly OmittedContextItem[];
  readonly applicableKnowledge: readonly KnowledgeEntry[];
  readonly constraintsAndSafetyNotes: readonly string[];
  readonly injectionAlerts: readonly PromptInjectionAlert[];
}

// ============================================================================
// Project Knowledge & Staleness Tracking
// ============================================================================

export type KnowledgeCategory =
  | 'architecture_decision'
  | 'coding_convention'
  | 'project_note'
  | 'known_limitation'
  | 'workflow_template';

export type StalenessStatus = 'verified_fresh' | 'potentially_stale' | 'reference_missing' | 'unlinked';

export interface KnowledgeReferenceDrift {
  readonly reference: SourceReference;
  readonly currentFileSha256: string | null;
  readonly reason: 'file_modified' | 'file_deleted' | 'line_range_out_of_bounds';
}

export interface KnowledgeEntry {
  readonly id: string;
  readonly repoId: string;
  readonly category: KnowledgeCategory;
  readonly title: string;
  readonly contentMarkdown: string;
  readonly isAiGeneratedSummary: boolean;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly linkedReferences: readonly SourceReference[];
  readonly stalenessStatus: StalenessStatus;
  readonly driftDetails: readonly KnowledgeReferenceDrift[];
}

// ============================================================================
// Git Change Review Models
// ============================================================================

export type ReviewFindingCategory =
  | 'potential_regression'
  | 'missing_test_coverage'
  | 'sensitive_file_change'
  | 'risky_sql_operation'
  | 'public_contract_change'
  | 'stale_knowledge_impact'
  | 'prompt_injection_risk';

export type ReviewSeverity = 'info' | 'warning' | 'critical';

export interface ChangedFileDiff {
  readonly relativePath: string;
  readonly oldPath?: string;
  readonly changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly addedLines: readonly { readonly lineNumber: number; readonly content: string }[];
  readonly removedLines: readonly { readonly lineNumber: number; readonly content: string }[];
  readonly rawPatchExcerpt: string;
}

export interface ReviewFinding {
  readonly id: string;
  readonly severity: ReviewSeverity;
  readonly category: ReviewFindingCategory;
  readonly title: string;
  readonly description: string;
  readonly certainty: CertaintyLevel;
  readonly producerId: string;
  readonly evidence: readonly SourceReference[];
  readonly impactedPaths: readonly string[];
  readonly remediationHint: string;
}

export interface ChangeReviewReport {
  readonly reviewId: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly createdAtIso: string;
  readonly diffTargetLabel: string;
  readonly changedFiles: readonly ChangedFileDiff[];
  readonly findings: readonly ReviewFinding[];
  readonly impactedSubProjectIds: readonly string[];
  readonly downstreamDependents: readonly {
    readonly changedPath: string;
    readonly dependentPaths: readonly string[];
  }[];
  readonly stats: {
    readonly totalChangedFiles: number;
    readonly criticalCount: number;
    readonly warningCount: number;
    readonly infoCount: number;
  };
}

// ============================================================================
// AI Provider & Outbound Consent Models
// ============================================================================

export interface AiProviderCapabilities {
  readonly isConfigured: boolean;
  readonly requiresExternalNetwork: boolean;
  readonly maxContextTokens: number;
  readonly supportsStructuredOutput: boolean;
  readonly vendorName: string;
  readonly modelIdentifier: string;
}

export interface AiProviderConfig {
  readonly activeProviderId: 'noop_deterministic' | 'openai_compatible' | 'anthropic_compatible' | 'local_ollama';
  readonly endpointUrl: string;
  readonly modelName: string;
  readonly apiKeyConfigured: boolean;
  readonly maxRequestTokens: number;
  readonly timeoutMs: number;
}

export interface OutboundConsentPreview {
  readonly consentId: string;
  readonly providerId: string;
  readonly endpointUrl: string;
  readonly modelName: string;
  readonly payloadSha256: string;
  readonly disclosedFilePaths: readonly string[];
  readonly totalCharacters: number;
  readonly estimatedTokens: number;
  readonly redactedSecretsCount: number;
  readonly payloadPreviewText: string;
  readonly createdAtIso: string;
}

export interface OutboundConsentToken {
  readonly consentId: string;
  readonly approvedAtIso: string;
  readonly providerId: string;
  readonly payloadSha256: string;
  readonly disclosedFilePaths: readonly string[];
  readonly estimatedBytes: number;
}

export interface AiGenerationRequest {
  readonly systemInstruction: string;
  readonly taskPrompt: string;
  readonly untrustedContextPackText: string;
  readonly disclosedFilePaths: readonly string[];
  readonly maxOutputTokens?: number;
}

export interface AiGenerationResponse {
  readonly providerId: string;
  readonly modelName: string;
  readonly generatedText: string;
  readonly certainty: CertaintyLevel;
  readonly completedAtIso: string;
  readonly durationMs: number;
}

export interface PrivacyAndIndexStatus {
  readonly databaseFilePath: string;
  readonly databaseSizeBytes: number;
  readonly totalRepositoriesIndexed: number;
  readonly totalSnapshotsStored: number;
  readonly totalFilesIndexed: number;
  readonly totalSymbolsIndexed: number;
  readonly totalKnowledgeEntries: number;
  readonly totalSecretsExcludedAllTime: number;
  readonly outboundAiRequestsCount: number;
  readonly outboundAuditLog: readonly {
    readonly id: string;
    readonly timestampIso: string;
    readonly providerId: string;
    readonly endpointUrl: string;
    readonly payloadSha256: string;
    readonly fileCount: number;
    readonly byteCount: number;
  }[];
}
