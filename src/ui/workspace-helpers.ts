import type {
  CertaintyLevel,
  ExclusionReason,
  IndexedFileRecord,
  LanguageDetectionSignal,
  RepositorySnapshot,
  SourceReference,
} from '../domain/index.js';

export type WorkspaceAnalysisState = 'empty' | 'loading' | 'failed' | 'partial' | 'completed';

export interface DerivedAnalysisStatus {
  readonly state: WorkspaceAnalysisState;
  readonly label: string;
  readonly badgeClass: string;
  readonly summary: string;
}

export function deriveAnalysisStatus(params: {
  readonly loading: boolean;
  readonly errorBanner: string | null;
  readonly snapshot: RepositorySnapshot | null;
}): DerivedAnalysisStatus {
  if (params.loading) {
    return {
      state: 'loading',
      label: 'LOADING / ANALYZING',
      badgeClass: 'badge-inferred',
      summary: 'Scanning repository boundaries, extracting symbols, and verifying SHA-256 fingerprints...',
    };
  }

  if (params.errorBanner && !params.snapshot) {
    return {
      state: 'failed',
      label: 'ANALYSIS FAILED',
      badgeClass: 'badge-danger',
      summary: params.errorBanner,
    };
  }

  if (!params.snapshot) {
    return {
      state: 'empty',
      label: 'EMPTY WORKSPACE',
      badgeClass: 'badge-unknown',
      summary: 'No repository onboarded yet. Import a local directory or select a quick-start fixture.',
    };
  }

  const hasPartialAdapterErrors = (params.snapshot.analyzerExecutionLog ?? []).some(
    (entry) => entry.status === 'partial_error'
  );
  const hasInaccessibleFiles = (params.snapshot.stats.inaccessibleFilesCount ?? 0) > 0;
  const hasUnknowns = params.snapshot.unknownsAndLimitations.length > 0;

  if (hasPartialAdapterErrors || hasInaccessibleFiles || hasUnknowns) {
    const reasons: string[] = [];
    if (hasPartialAdapterErrors) {
      const count = (params.snapshot.analyzerExecutionLog ?? []).filter(
        (e) => e.status === 'partial_error'
      ).length;
      reasons.push(`${count} adapter(s) reported partial parse errors`);
    }
    if (hasInaccessibleFiles) {
      reasons.push(`${params.snapshot.stats.inaccessibleFilesCount} inaccessible file(s)`);
    }
    if (hasUnknowns) {
      reasons.push(`${params.snapshot.unknownsAndLimitations.length} limitation/unknown note(s)`);
    }
    return {
      state: 'partial',
      label: 'PARTIAL ANALYSIS (WITH WARNINGS)',
      badgeClass: 'badge-inferred',
      summary: `Indexed ${params.snapshot.stats.totalFilesIndexed} files across ${params.snapshot.subProjects.length} sub-project(s); ${reasons.join(', ')}.`,
    };
  }

  return {
    state: 'completed',
    label: 'COMPLETED (VERIFIED)',
    badgeClass: 'badge-verified',
    summary: `Successfully analyzed ${params.snapshot.stats.totalFilesIndexed} indexed files and ${params.snapshot.stats.totalSymbolsExtracted} symbols across ${params.snapshot.subProjects.length} sub-project(s).`,
  };
}

export interface PaginationSlice<T> {
  readonly pageItems: readonly T[];
  readonly currentPage: number;
  readonly totalPages: number;
  readonly totalItems: number;
  readonly startIndex: number;
  readonly endIndex: number;
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number
): PaginationSlice<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.max(1, Math.min(totalPages, Math.floor(requestedPage)));
  const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize;
  const endIndex = Math.min(totalItems, startIndex + safePageSize);

  return {
    pageItems: items.slice(startIndex, endIndex),
    currentPage,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
  };
}

export interface ExplorerFilterOptions {
  readonly pathQuery: string;
  readonly roleFilter: string;
  readonly subProjectFilter: string;
  readonly languageFilter: string;
  readonly statusFilter: 'ALL' | 'INDEXED' | 'EXCLUDED';
}

export function filterExplorerFiles(
  files: readonly IndexedFileRecord[],
  filters: ExplorerFilterOptions
): readonly IndexedFileRecord[] {
  const needle = filters.pathQuery.trim().toLowerCase();
  return files.filter((f) => {
    if (filters.statusFilter === 'INDEXED' && !f.isIndexed) return false;
    if (filters.statusFilter === 'EXCLUDED' && f.isIndexed) return false;
    if (filters.roleFilter !== 'ALL' && f.role !== filters.roleFilter) return false;
    if (filters.subProjectFilter !== 'ALL' && f.subProjectId !== filters.subProjectFilter) {
      return false;
    }
    if (filters.languageFilter !== 'ALL') {
      const lang = f.detectedLanguage ?? 'Unrecognized';
      if (lang !== filters.languageFilter) return false;
    }
    if (needle && !f.relativePath.toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
}

export interface LanguageBreakdownRow {
  readonly language: string;
  readonly fileCount: number;
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly signalsUsed: readonly LanguageDetectionSignal[];
  readonly sampleFileRef: SourceReference;
}

export function computeLanguageBreakdown(snapshot: RepositorySnapshot): readonly LanguageBreakdownRow[] {
  const map = new Map<
    string,
    {
      fileCount: number;
      totalLines: number;
      totalBytes: number;
      signals: Set<LanguageDetectionSignal>;
      sampleFile: IndexedFileRecord;
    }
  >();

  for (const file of snapshot.files) {
    if (!file.isIndexed || !file.detectedLanguage) continue;
    const existing = map.get(file.detectedLanguage);
    if (!existing) {
      map.set(file.detectedLanguage, {
        fileCount: 1,
        totalLines: file.lineCount ?? 0,
        totalBytes: file.sizeBytes,
        signals: new Set(file.languageDetectionSignals ?? []),
        sampleFile: file,
      });
    } else {
      existing.fileCount += 1;
      existing.totalLines += file.lineCount ?? 0;
      existing.totalBytes += file.sizeBytes;
      for (const sig of file.languageDetectionSignals ?? []) {
        existing.signals.add(sig);
      }
    }
  }

  return [...map.entries()]
    .map(([language, data]) => ({
      language,
      fileCount: data.fileCount,
      totalLines: data.totalLines,
      totalBytes: data.totalBytes,
      signalsUsed: [...data.signals].sort(),
      sampleFileRef: {
        repoId: snapshot.repoId,
        relativePath: data.sampleFile.relativePath,
        fileSha256: data.sampleFile.sha256,
        startLine: 1,
        endLine: Math.min(data.sampleFile.lineCount ?? 1, 50),
        capturedAtIso: snapshot.analyzedAtIso,
      },
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.language.localeCompare(b.language));
}

export interface ExclusionSummaryRow {
  readonly reason: ExclusionReason;
  readonly count: number;
  readonly files: readonly IndexedFileRecord[];
}

export function computeExclusionBreakdown(
  files: readonly IndexedFileRecord[]
): readonly ExclusionSummaryRow[] {
  const groups = new Map<ExclusionReason, IndexedFileRecord[]>();
  for (const file of files) {
    if (file.isIndexed || !file.exclusionReason) continue;
    const list = groups.get(file.exclusionReason) ?? [];
    list.push(file);
    groups.set(file.exclusionReason, list);
  }

  return [...groups.entries()]
    .map(([reason, groupFiles]) => ({
      reason,
      count: groupFiles.length,
      files: groupFiles,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export interface InspectedFindingEvidence {
  readonly title: string;
  readonly category: string;
  readonly valueSummary: string;
  readonly certainty: CertaintyLevel;
  readonly rationale: string;
  readonly producerId: string;
  readonly evidence: readonly SourceReference[];
}
