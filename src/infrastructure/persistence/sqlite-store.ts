import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AiProviderConfig,
  ChangeReviewReport,
  ContextPack,
  KnowledgeEntry,
  KnowledgeReferenceDrift,
  OutboundConsentToken,
  PrivacyAndIndexStatus,
  RepositoryRecord,
  RepositorySnapshot,
  SearchHit,
  StalenessStatus,
} from '../../domain/index.js';
import { createSourceRef } from '../../domain/index.js';

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  activeProviderId: 'noop_deterministic',
  endpointUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  modelName: 'deterministic-local-only',
  apiKeyConfigured: false,
  maxRequestTokens: 4096,
  timeoutMs: 15000,
};

export class ContextForgeSqliteStore {
  private db: DatabaseSync;
  private readonly dbFilePath: string;
  private isClosed = false;

  public constructor(dbFilePath: string = ':memory:') {
    this.dbFilePath = dbFilePath;
    if (dbFilePath !== ':memory:') {
      const dir = path.dirname(dbFilePath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at_iso TEXT NOT NULL,
        last_analyzed_at_iso TEXT,
        latest_snapshot_id TEXT,
        resource_limits_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        snapshot_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        analyzed_at_iso TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS search_entries (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        snippet TEXT NOT NULL,
        search_text TEXT NOT NULL,
        source_ref_json TEXT,
        certainty TEXT,
        FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_search_entries_repo ON search_entries(repo_id);
      CREATE INDEX IF NOT EXISTS idx_search_entries_kind ON search_entries(kind);

      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        is_ai_generated_summary INTEGER NOT NULL DEFAULT 0,
        created_at_iso TEXT NOT NULL,
        updated_at_iso TEXT NOT NULL,
        linked_references_json TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_repo ON knowledge_entries(repo_id);

      CREATE TABLE IF NOT EXISTS context_packs (
        pack_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        created_at_iso TEXT NOT NULL,
        pack_json TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS change_reviews (
        review_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        created_at_iso TEXT NOT NULL,
        review_json TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbound_consents (
        consent_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        disclosed_files_json TEXT NOT NULL,
        estimated_bytes INTEGER NOT NULL,
        approved_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbound_audit_log (
        id TEXT PRIMARY KEY,
        timestamp_iso TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        endpoint_url TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        byte_count INTEGER NOT NULL
      );
    `);
  }

  public close(): void {
    if (!this.isClosed) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Ignore checkpoint error on memory DB
      }
      this.db.close();
      this.isClosed = true;
    }
  }

  // ==========================================================================
  // Repository & Snapshot Management
  // ==========================================================================

  public upsertRepository(record: RepositoryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO repositories (id, name, root_path, created_at_iso, last_analyzed_at_iso, latest_snapshot_id, resource_limits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        root_path = excluded.root_path,
        last_analyzed_at_iso = excluded.last_analyzed_at_iso,
        latest_snapshot_id = excluded.latest_snapshot_id,
        resource_limits_json = excluded.resource_limits_json
    `);
    stmt.run(
      record.id,
      record.name,
      record.rootPath,
      record.createdAtIso,
      record.lastAnalyzedAtIso,
      record.latestSnapshotId,
      JSON.stringify(record.resourceLimits)
    );
  }

  public getRepositoryById(repoId: string): RepositoryRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM repositories WHERE id = ?`)
      .get(repoId) as Record<string, unknown> | undefined;
    return row ? this.mapRepoRow(row) : null;
  }

  public getRepositoryByRootPath(rootPath: string): RepositoryRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM repositories WHERE root_path = ?`)
      .get(rootPath) as Record<string, unknown> | undefined;
    return row ? this.mapRepoRow(row) : null;
  }

  public listRepositories(): readonly RepositoryRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM repositories ORDER BY COALESCE(last_analyzed_at_iso, created_at_iso) DESC`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRepoRow(r));
  }

  public deleteRepository(repoId: string): void {
    this.db.prepare(`DELETE FROM repositories WHERE id = ?`).run(repoId);
  }

  private mapRepoRow(row: Record<string, unknown>): RepositoryRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      createdAtIso: String(row.created_at_iso),
      lastAnalyzedAtIso: row.last_analyzed_at_iso ? String(row.last_analyzed_at_iso) : null,
      latestSnapshotId: row.latest_snapshot_id ? String(row.latest_snapshot_id) : null,
      resourceLimits: JSON.parse(String(row.resource_limits_json)),
    };
  }

  public saveSnapshotAndIndex(snapshot: RepositorySnapshot, fileContentsMap?: ReadonlyMap<string, string>): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO snapshots (snapshot_id, repo_id, analyzed_at_iso, snapshot_json) VALUES (?, ?, ?, ?)`
        )
        .run(snapshot.snapshotId, snapshot.repoId, snapshot.analyzedAtIso, JSON.stringify(snapshot));

      this.db
        .prepare(`UPDATE repositories SET last_analyzed_at_iso = ?, latest_snapshot_id = ? WHERE id = ?`)
        .run(snapshot.analyzedAtIso, snapshot.snapshotId, snapshot.repoId);

      // Rebuild search_entries for this repository (excluding knowledge entries which are managed with knowledge)
      this.db
        .prepare(`DELETE FROM search_entries WHERE repo_id = ? AND kind != 'knowledge'`)
        .run(snapshot.repoId);

      const insertSearch = this.db.prepare(`
        INSERT OR REPLACE INTO search_entries
        (id, repo_id, repo_name, kind, title, subtitle, snippet, search_text, source_ref_json, certainty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // 1. Index SubProjects
      for (const sp of snapshot.subProjects) {
        const spManifest = sp.manifests[0] ?? null;
        const langs = sp.languages.map((l) => l.value).join(', ') || 'unknown stack';
        const frameworks = sp.frameworks.map((f) => f.value).join(', ');
        const snippet = `Sub-project (${sp.kind}) at ${sp.rootPath || '/'} — Languages: ${langs}${frameworks ? ` | Frameworks: ${frameworks}` : ''}`;
        insertSearch.run(
          `sp:${snapshot.repoId}:${sp.id}`,
          snapshot.repoId,
          snapshot.repoName,
          'subproject',
          sp.name,
          sp.rootPath || '(root)',
          snippet,
          `${sp.name} ${sp.rootPath} ${langs} ${frameworks}`.toLowerCase(),
          spManifest ? JSON.stringify(spManifest) : null,
          'verified'
        );
      }

      // 2. Index Files (only indexed, non-excluded files)
      for (const file of snapshot.files) {
        if (!file.isIndexed) {
          continue;
        }
        const rawText = fileContentsMap?.get(file.relativePath) ?? '';
        const previewLines = rawText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .slice(0, 4)
          .join(' · ')
          .slice(0, 240);

        const ref = createSourceRef({
          repoId: snapshot.repoId,
          relativePath: file.relativePath,
          fileSha256: file.sha256,
          startLine: 1,
          endLine: file.lineCount ?? 1,
          ...(snapshot.gitMetadata.headCommitSha ? { commitSha: snapshot.gitMetadata.headCommitSha } : {}),
          capturedAtIso: snapshot.analyzedAtIso,
        });

        insertSearch.run(
          `file:${snapshot.repoId}:${file.relativePath}`,
          snapshot.repoId,
          snapshot.repoName,
          'file',
          file.relativePath,
          `${file.role} · ${file.detectedLanguage ?? 'unknown'} · ${file.lineCount ?? 0} lines`,
          previewLines || `Indexed ${file.role} file (${file.sizeBytes} bytes)`,
          `${file.relativePath} ${file.role} ${file.detectedLanguage ?? ''} ${rawText.slice(0, 4000)}`.toLowerCase(),
          JSON.stringify(ref),
          'verified'
        );
      }

      // 3. Index Symbols
      for (const sym of snapshot.symbols) {
        insertSearch.run(
          `sym:${snapshot.repoId}:${sym.sourceRef.relativePath}:${sym.name}:${sym.sourceRef.startLine ?? 1}`,
          snapshot.repoId,
          snapshot.repoName,
          'symbol',
          sym.name,
          `${sym.kind} in ${sym.sourceRef.relativePath}:${sym.sourceRef.startLine ?? 1}`,
          sym.signature ?? `${sym.kind} ${sym.name}`,
          `${sym.name} ${sym.kind} ${sym.signature ?? ''} ${sym.sourceRef.relativePath}`.toLowerCase(),
          JSON.stringify(sym.sourceRef),
          sym.certainty
        );
      }

      // 4. Index External Dependencies
      for (const depClaim of snapshot.externalDependencies) {
        const dep = depClaim.value;
        const ref = depClaim.evidence[0] ?? null;
        insertSearch.run(
          `dep:${snapshot.repoId}:${dep.subProjectId}:${dep.name}`,
          snapshot.repoId,
          snapshot.repoName,
          'dependency',
          `${dep.name} (${dep.versionConstraint})`,
          `${dep.ecosystem} · ${dep.scope} dependency`,
          depClaim.rationale,
          `${dep.name} ${dep.versionConstraint} ${dep.ecosystem} ${dep.scope}`.toLowerCase(),
          ref ? JSON.stringify(ref) : null,
          depClaim.certainty
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getLatestSnapshot(repoId: string): RepositorySnapshot | null {
    const row = this.db
      .prepare(
        `SELECT snapshot_json FROM snapshots WHERE repo_id = ? ORDER BY analyzed_at_iso DESC LIMIT 1`
      )
      .get(repoId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as RepositorySnapshot) : null;
  }

  public getSnapshotById(snapshotId: string): RepositorySnapshot | null {
    const row = this.db
      .prepare(`SELECT snapshot_json FROM snapshots WHERE snapshot_id = ?`)
      .get(snapshotId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as RepositorySnapshot) : null;
  }

  // ==========================================================================
  // Global & Project-Specific Search
  // ==========================================================================

  public search(params: {
    readonly query: string;
    readonly repoId?: string;
    readonly kind?: SearchHit['kind'];
    readonly limit?: number;
  }): readonly SearchHit[] {
    const rawQuery = params.query.trim().toLowerCase();
    const limit = Math.min(Math.max(params.limit ?? 40, 1), 200);

    const conditions: string[] = [];
    const bindArgs: (string | number)[] = [];

    if (params.repoId) {
      conditions.push('repo_id = ?');
      bindArgs.push(params.repoId);
    }
    if (params.kind) {
      conditions.push('kind = ?');
      bindArgs.push(params.kind);
    }

    const tokens = rawQuery.split(/\s+/).filter((t) => t.length > 0);
    for (const token of tokens) {
      conditions.push('search_text LIKE ?');
      bindArgs.push(`%${token}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM search_entries ${whereClause} LIMIT 300`)
      .all(...bindArgs) as Record<string, unknown>[];

    const scored: SearchHit[] = rows.map((row) => {
      const title = String(row.title);
      const subtitle = String(row.subtitle);
      const snippet = String(row.snippet);
      const titleLower = title.toLowerCase();

      let score = 10;
      if (rawQuery.length > 0) {
        if (titleLower === rawQuery) score += 200;
        else if (titleLower.startsWith(rawQuery)) score += 120;
        else if (titleLower.includes(rawQuery)) score += 80;

        for (const token of tokens) {
          if (titleLower.includes(token)) score += 35;
          if (subtitle.toLowerCase().includes(token)) score += 15;
        }
      }

      return {
        id: String(row.id),
        repoId: String(row.repo_id),
        repoName: String(row.repo_name),
        kind: String(row.kind) as SearchHit['kind'],
        title,
        subtitle,
        snippet,
        score,
        ...(row.source_ref_json ? { sourceRef: JSON.parse(String(row.source_ref_json)) } : {}),
        ...(row.certainty ? { certainty: String(row.certainty) as SearchHit['certainty'] } : {}),
      };
    });

    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title)));
    return scored.slice(0, limit);
  }

  // ==========================================================================
  // Project Knowledge & Automatic Staleness Computation
  // ==========================================================================

  public upsertKnowledgeEntry(entry: Omit<KnowledgeEntry, 'stalenessStatus' | 'driftDetails'>): KnowledgeEntry {
    this.db
      .prepare(`
        INSERT INTO knowledge_entries
        (id, repo_id, category, title, content_markdown, is_ai_generated_summary, created_at_iso, updated_at_iso, linked_references_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          title = excluded.title,
          content_markdown = excluded.content_markdown,
          is_ai_generated_summary = excluded.is_ai_generated_summary,
          updated_at_iso = excluded.updated_at_iso,
          linked_references_json = excluded.linked_references_json
      `)
      .run(
        entry.id,
        entry.repoId,
        entry.category,
        entry.title,
        entry.contentMarkdown,
        entry.isAiGeneratedSummary ? 1 : 0,
        entry.createdAtIso,
        entry.updatedAtIso,
        JSON.stringify(entry.linkedReferences)
      );

    const repo = this.getRepositoryById(entry.repoId);
    const firstRef = entry.linkedReferences[0] ?? null;
    this.db
      .prepare(`
        INSERT OR REPLACE INTO search_entries
        (id, repo_id, repo_name, kind, title, subtitle, snippet, search_text, source_ref_json, certainty)
        VALUES (?, ?, ?, 'knowledge', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        `know:${entry.repoId}:${entry.id}`,
        entry.repoId,
        repo?.name ?? entry.repoId,
        entry.title,
        `Knowledge (${entry.category})`,
        entry.contentMarkdown.slice(0, 200),
        `${entry.title} ${entry.category} ${entry.contentMarkdown}`.toLowerCase(),
        firstRef ? JSON.stringify(firstRef) : null,
        entry.isAiGeneratedSummary ? 'ai_generated' : 'verified'
      );

    return this.computeKnowledgeStaleness(entry);
  }

  public listKnowledgeEntries(repoId: string): readonly KnowledgeEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_entries WHERE repo_id = ? ORDER BY updated_at_iso DESC`)
      .all(repoId) as Record<string, unknown>[];

    const latestSnapshot = this.getLatestSnapshot(repoId);
    return rows.map((row) =>
      this.computeKnowledgeStaleness(
        {
          id: String(row.id),
          repoId: String(row.repo_id),
          category: String(row.category) as KnowledgeEntry['category'],
          title: String(row.title),
          contentMarkdown: String(row.content_markdown),
          isAiGeneratedSummary: Boolean(row.is_ai_generated_summary),
          createdAtIso: String(row.created_at_iso),
          updatedAtIso: String(row.updated_at_iso),
          linkedReferences: JSON.parse(String(row.linked_references_json)),
        },
        latestSnapshot
      )
    );
  }

  public deleteKnowledgeEntry(id: string): void {
    const row = this.db
      .prepare(`SELECT repo_id FROM knowledge_entries WHERE id = ?`)
      .get(id) as { repo_id: string } | undefined;
    this.db.prepare(`DELETE FROM knowledge_entries WHERE id = ?`).run(id);
    if (row) {
      this.db.prepare(`DELETE FROM search_entries WHERE id = ?`).run(`know:${row.repo_id}:${id}`);
    }
  }

  public computeKnowledgeStaleness(
    raw: Omit<KnowledgeEntry, 'stalenessStatus' | 'driftDetails'>,
    snapshotOverride?: RepositorySnapshot | null
  ): KnowledgeEntry {
    const snapshot = snapshotOverride !== undefined ? snapshotOverride : this.getLatestSnapshot(raw.repoId);
    if (raw.linkedReferences.length === 0) {
      return {
        ...raw,
        stalenessStatus: 'unlinked',
        driftDetails: [],
      };
    }

    if (!snapshot) {
      return {
        ...raw,
        stalenessStatus: 'verified_fresh',
        driftDetails: [],
      };
    }

    const fileMap = new Map(snapshot.files.map((f) => [f.relativePath, f]));
    const driftDetails: KnowledgeReferenceDrift[] = [];
    let hasMissing = false;

    for (const ref of raw.linkedReferences) {
      const currentFile = fileMap.get(ref.relativePath);
      if (!currentFile) {
        hasMissing = true;
        driftDetails.push({
          reference: ref,
          currentFileSha256: null,
          reason: 'file_deleted',
        });
        continue;
      }

      if (currentFile.sha256 !== ref.fileSha256) {
        driftDetails.push({
          reference: ref,
          currentFileSha256: currentFile.sha256,
          reason: 'file_modified',
        });
        continue;
      }

      if (
        ref.endLine !== undefined &&
        currentFile.lineCount !== null &&
        ref.endLine > currentFile.lineCount
      ) {
        driftDetails.push({
          reference: ref,
          currentFileSha256: currentFile.sha256,
          reason: 'line_range_out_of_bounds',
        });
      }
    }

    let stalenessStatus: StalenessStatus = 'verified_fresh';
    if (hasMissing) {
      stalenessStatus = 'reference_missing';
    } else if (driftDetails.length > 0) {
      stalenessStatus = 'potentially_stale';
    }

    return {
      ...raw,
      stalenessStatus,
      driftDetails,
    };
  }

  // ==========================================================================
  // Context Packs & Change Reviews
  // ==========================================================================

  public saveContextPack(pack: ContextPack): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO context_packs (pack_id, repo_id, snapshot_id, created_at_iso, pack_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run(pack.packId, pack.repoId, pack.snapshotId, pack.createdAtIso, JSON.stringify(pack));
  }

  public listContextPacks(repoId: string): readonly ContextPack[] {
    const rows = this.db
      .prepare(`SELECT pack_json FROM context_packs WHERE repo_id = ? ORDER BY created_at_iso DESC LIMIT 25`)
      .all(repoId) as { pack_json: string }[];
    return rows.map((r) => JSON.parse(r.pack_json) as ContextPack);
  }

  public saveChangeReview(report: ChangeReviewReport): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO change_reviews (review_id, repo_id, snapshot_id, created_at_iso, review_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        report.reviewId,
        report.repoId,
        report.snapshotId,
        report.createdAtIso,
        JSON.stringify(report)
      );
  }

  public listChangeReviews(repoId: string): readonly ChangeReviewReport[] {
    const rows = this.db
      .prepare(`SELECT review_json FROM change_reviews WHERE repo_id = ? ORDER BY created_at_iso DESC LIMIT 20`)
      .all(repoId) as { review_json: string }[];
    return rows.map((r) => JSON.parse(r.review_json) as ChangeReviewReport);
  }

  // ==========================================================================
  // AI Provider Settings, Outbound Consent & Index Privacy Controls
  // ==========================================================================

  public getAiProviderConfig(): AiProviderConfig {
    const row = this.db
      .prepare(`SELECT value_json FROM settings WHERE key = 'ai_provider_config'`)
      .get() as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as AiProviderConfig) : DEFAULT_AI_PROVIDER_CONFIG;
  }

  public saveAiProviderConfig(config: AiProviderConfig): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value_json) VALUES ('ai_provider_config', ?)`)
      .run(JSON.stringify(config));
  }

  public recordOutboundConsentApproval(token: OutboundConsentToken): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO outbound_consents
        (consent_id, provider_id, payload_sha256, disclosed_files_json, estimated_bytes, approved_at_iso)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        token.consentId,
        token.providerId,
        token.payloadSha256,
        JSON.stringify(token.disclosedFilePaths),
        token.estimatedBytes,
        token.approvedAtIso
      );
  }

  public verifyOutboundConsent(consentId: string, payloadSha256: string, providerId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT * FROM outbound_consents WHERE consent_id = ? AND payload_sha256 = ? AND provider_id = ?`
      )
      .get(consentId, payloadSha256, providerId) as Record<string, unknown> | undefined;
    return Boolean(row);
  }

  public recordOutboundAuditLog(entry: {
    readonly id: string;
    readonly timestampIso: string;
    readonly providerId: string;
    readonly endpointUrl: string;
    readonly payloadSha256: string;
    readonly fileCount: number;
    readonly byteCount: number;
  }): void {
    this.db
      .prepare(`
        INSERT INTO outbound_audit_log
        (id, timestamp_iso, provider_id, endpoint_url, payload_sha256, file_count, byte_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.timestampIso,
        entry.providerId,
        entry.endpointUrl,
        entry.payloadSha256,
        entry.fileCount,
        entry.byteCount
      );
  }

  public getPrivacyAndIndexStatus(): PrivacyAndIndexStatus {
    const repoCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM repositories`).get() as { c: number }).c
    );
    const snapCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM snapshots`).get() as { c: number }).c
    );
    const fileCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM search_entries WHERE kind = 'file'`).get() as { c: number }).c
    );
    const symbolCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM search_entries WHERE kind = 'symbol'`).get() as { c: number }).c
    );
    const knowledgeCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM knowledge_entries`).get() as { c: number }).c
    );
    const outboundCount = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM outbound_audit_log`).get() as { c: number }).c
    );

    let totalSecretsExcludedAllTime = 0;
    const snapshots = this.db
      .prepare(`SELECT snapshot_json FROM snapshots`)
      .all() as { snapshot_json: string }[];
    for (const row of snapshots) {
      try {
        const snap = JSON.parse(row.snapshot_json) as RepositorySnapshot;
        totalSecretsExcludedAllTime += snap.stats.secretExclusionsCount;
      } catch {
        // Ignore parse error
      }
    }

    let databaseSizeBytes = 0;
    if (this.dbFilePath !== ':memory:' && fs.existsSync(this.dbFilePath)) {
      databaseSizeBytes = fs.statSync(this.dbFilePath).size;
    }

    const auditRows = this.db
      .prepare(`SELECT * FROM outbound_audit_log ORDER BY timestamp_iso DESC LIMIT 50`)
      .all() as Record<string, unknown>[];

    return {
      databaseFilePath: this.dbFilePath,
      databaseSizeBytes,
      totalRepositoriesIndexed: repoCount,
      totalSnapshotsStored: snapCount,
      totalFilesIndexed: fileCount,
      totalSymbolsIndexed: symbolCount,
      totalKnowledgeEntries: knowledgeCount,
      totalSecretsExcludedAllTime,
      outboundAiRequestsCount: outboundCount,
      outboundAuditLog: auditRows.map((r) => ({
        id: String(r.id),
        timestampIso: String(r.timestamp_iso),
        providerId: String(r.provider_id),
        endpointUrl: String(r.endpoint_url),
        payloadSha256: String(r.payload_sha256),
        fileCount: Number(r.file_count),
        byteCount: Number(r.byte_count),
      })),
    };
  }

  /**
   * Purges all indexed repository data, snapshots, search entries, knowledge, and context packs.
   */
  public purgeAllIndexedData(): void {
    this.db.exec(`
      DELETE FROM search_entries;
      DELETE FROM context_packs;
      DELETE FROM change_reviews;
      DELETE FROM knowledge_entries;
      DELETE FROM snapshots;
      DELETE FROM repositories;
      DELETE FROM outbound_consents;
    `);
  }
}
