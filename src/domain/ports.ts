/**
 * ContextForge Domain Port & Adapter Interfaces
 * Pure TypeScript — ZERO external or Node.js runtime imports allowed.
 */

import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderCapabilities,
  ApiSurfaceDescriptor,
  ChangedFileDiff,
  DatabaseObjectDescriptor,
  DependencyEdge,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExternalDependency,
  ExtractedSymbol,
  IndexedFileRecord,
  OutboundConsentToken,
  ReviewFinding,
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
 * Pluggable, independently testable Language / Stack / SQL Adapter contract.
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
 * Vendor-neutral AI Provider interface.
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
