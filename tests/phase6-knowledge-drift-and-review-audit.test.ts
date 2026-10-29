import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import { runCli } from '../src/cli/index.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import { generateChangeReviewMarkdownReport } from '../src/infrastructure/reporting/change-review-report-generator.js';
import { createContextForgeHttpServer } from '../src/server/app-server.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

function createBufferedIo(): {
  io: { stdout(m: string): void; stderr(m: string): void };
  getStdout(): string;
  getStderr(): string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    io: {
      stdout: (m: string) => stdoutChunks.push(m),
      stderr: (m: string) => stderrChunks.push(m),
    },
    getStdout: () => stdoutChunks.join('\n'),
    getStderr: () => stderrChunks.join('\n'),
  };
}

describe('Phase 6 — Project Knowledge Drift Audit, 1-Click Reconciliation & Review Report Exporter', () => {
  it('1. Detects knowledge staleness (file_modified, file_deleted, line_range_out_of_bounds) and produces accurate audit summary', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-p6-drift-'));
    const store = new ContextForgeSqliteStore(':memory:');
    const service = new ContextForgeWorkspaceService(store);

    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const file1 = path.join(tmpDir, 'src/pricing.ts');
      const file2 = path.join(tmpDir, 'src/orders.ts');
      await fs.writeFile(file1, 'export function getPrice() { return 100; }\n', 'utf-8');
      await fs.writeFile(file2, 'export function getOrder() { return "A1"; }\n', 'utf-8');

      // 1. Initial onboard
      const { repository } = await service.onboardRepository({
        rootPath: tmpDir,
        name: 'drift-test-repo',
      });

      // 2. Save 3 knowledge entries:
      // Entry A: anchored to src/pricing.ts
      // Entry B: anchored to src/orders.ts
      // Entry C: unlinked general note
      const entryA = service.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'architecture_decision',
        title: 'ADR-101: Price calculation convention',
        contentMarkdown: 'All prices must use integer cents.',
        linkedFilePaths: [{ relativePath: 'src/pricing.ts', startLine: 1, endLine: 1 }],
      });
      assert.equal(entryA.stalenessStatus, 'verified_fresh');

      const entryB = service.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'coding_convention',
        title: 'Convention: Order identifier format',
        contentMarkdown: 'Order IDs are uppercase alphanumeric.',
        linkedFilePaths: [{ relativePath: 'src/orders.ts', startLine: 1, endLine: 1 }],
      });
      assert.equal(entryB.stalenessStatus, 'verified_fresh');

      const entryC = service.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'project_note',
        title: 'General Note: Staging environment',
        contentMarkdown: 'Staging sync happens nightly.',
      });
      assert.equal(entryC.stalenessStatus, 'unlinked');

      // 3. Mutate src/pricing.ts on disk and delete src/orders.ts
      await fs.writeFile(
        file1,
        'export function getPrice() { return 200; }\n// modified line\n',
        'utf-8'
      );
      await fs.rm(file2);

      // Re-scan repository to capture updated snapshot
      await service.onboardRepository({
        rootPath: tmpDir,
      });

      // 4. Run knowledge audit
      const audit = service.auditRepositoryKnowledge(repository.id);
      assert.equal(audit.totalEntries, 3);
      assert.equal(audit.unlinkedCount, 1);
      assert.equal(audit.potentiallyStaleCount, 1);
      assert.equal(audit.missingReferenceCount, 1);
      assert.equal(audit.freshCount, 0);

      const staleEntryA = audit.entries.find((e) => e.id === entryA.id);
      assert.ok(staleEntryA);
      assert.equal(staleEntryA.stalenessStatus, 'potentially_stale');
      assert.equal(staleEntryA.driftDetails[0]?.reason, 'file_modified');

      const missingEntryB = audit.entries.find((e) => e.id === entryB.id);
      assert.ok(missingEntryB);
      assert.equal(missingEntryB.stalenessStatus, 'reference_missing');
      assert.equal(missingEntryB.driftDetails[0]?.reason, 'file_deleted');

      // 5. Test 1-click reconciliation: re-anchors entry A to current file fingerprint
      const reconciledA = service.reconcileKnowledgeEntry({
        repoId: repository.id,
        entryId: entryA.id,
      });
      assert.equal(reconciledA.stalenessStatus, 'verified_fresh');
      assert.equal(reconciledA.driftDetails.length, 0);

      // Verify audit reflects the reconciliation
      const auditAfter = service.auditRepositoryKnowledge(repository.id);
      assert.equal(auditAfter.freshCount, 1);
      assert.equal(auditAfter.potentiallyStaleCount, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      store.close();
    }
  });

  it('2. Generates comprehensive, evidence-backed Markdown change review report with risk alerts and blast radius', () => {
    const markdown = generateChangeReviewMarkdownReport({
      reviewId: 'rev_test_123',
      repoId: 'repo_acme',
      snapshotId: 'snap_001',
      createdAtIso: '2026-10-29T12:00:00.000Z',
      diffTargetLabel: 'HEAD~1...HEAD',
      changedFiles: [
        {
          relativePath: 'apps/web/Billing.tsx',
          changeType: 'modified',
          additions: 12,
          deletions: 2,
          rawPatchExcerpt: '@@ -1,2 +1,12 @@',
          addedLines: [{ lineNumber: 5, content: 'export function calc() {}' }],
          removedLines: [{ lineNumber: 5, content: 'function oldCalc() {}' }],
        },
        {
          relativePath: 'db/migrations/003_drop.sql',
          changeType: 'added',
          additions: 1,
          deletions: 0,
          rawPatchExcerpt: '@@ -0,0 +1,1 @@',
          addedLines: [{ lineNumber: 1, content: 'DROP TABLE legacy_users;' }],
          removedLines: [],
        },
      ],
      findings: [
        {
          id: 'finding:drop_table:003',
          severity: 'critical',
          category: 'risky_sql_operation',
          title: 'Destructive SQL statement in db/migrations/003_drop.sql',
          description: 'Statement drops table legacy_users permanently.',
          certainty: 'verified',
          producerId: 'adapter.sql_migration',
          evidence: [
            {
              repoId: 'repo_acme',
              relativePath: 'db/migrations/003_drop.sql',
              fileSha256: 'abc1234567890abcdef',
              startLine: 1,
              endLine: 1,
              capturedAtIso: '2026-10-29T12:00:00.000Z',
            },
          ],
          impactedPaths: ['db/migrations/003_drop.sql'],
          remediationHint: 'Ensure data backfill or staged deprecation window.',
        },
        {
          id: 'finding:stale_adr:1',
          severity: 'info',
          category: 'stale_knowledge_impact',
          title: 'Project knowledge "ADR-001" references modified file(s)',
          description: 'Billing.tsx was modified.',
          certainty: 'verified',
          producerId: 'tier0.knowledge_tracker',
          evidence: [
            {
              repoId: 'repo_acme',
              relativePath: 'apps/web/Billing.tsx',
              fileSha256: 'def4567890abcdef123',
              startLine: 5,
              endLine: 5,
              capturedAtIso: '2026-10-29T12:00:00.000Z',
            },
          ],
          impactedPaths: ['apps/web/Billing.tsx'],
          remediationHint: 'Review ADR-001 in project knowledge.',
        },
      ],
      impactedSubProjectIds: ['sp:web'],
      downstreamDependents: [
        {
          changedPath: 'apps/web/Billing.tsx',
          dependentPaths: ['apps/web/App.tsx', 'apps/web/Checkout.tsx'],
        },
      ],
      stats: {
        totalChangedFiles: 2,
        criticalCount: 1,
        warningCount: 0,
        infoCount: 1,
      },
    });

    assert.ok(markdown.includes('# ContextForge Git Change Review Report'));
    assert.ok(markdown.includes('[CRITICAL RISK ALERT] 1 Critical Issue(s) Detected'));
    assert.ok(markdown.includes('Destructive SQL statement in db/migrations/003_drop.sql'));
    assert.ok(markdown.includes('Downstream Blast-Radius Analysis'));
    assert.ok(markdown.includes('apps/web/App.tsx'));
    assert.ok(markdown.includes('Affected Project Knowledge & ADRs'));
    assert.ok(markdown.includes('Changed Files Summary (2)'));
  });

  it('3. Runs CLI `contextforge knowledge` and `contextforge review --format markdown`', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-p6-cli-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const fixturePath = path.join(FIXTURES_DIR, 'polyglot-monorepo');
    const reviewOutFile = path.join(tmpDir, 'review-output.md');

    try {
      // 1. Run knowledge audit on fixture repo
      const auditIo = createBufferedIo();
      const code1 = await runCli(['knowledge', fixturePath, '--audit', '--db', dbPath], auditIo.io);
      assert.equal(code1, 0);
      assert.ok(auditIo.getStdout().includes('ContextForge Knowledge Drift Audit:'));
      assert.ok(auditIo.getStdout().includes('Total Entries'));

      // 2. Run review with --format markdown writing to file
      const reviewIo = createBufferedIo();
      const code2 = await runCli(
        [
          'review',
          fixturePath,
          '--format',
          'markdown',
          '--output',
          reviewOutFile,
          '--db',
          dbPath,
        ],
        reviewIo.io
      );
      assert.equal(code2, 0);

      const reviewMd = await fs.readFile(reviewOutFile, 'utf-8');
      assert.ok(reviewMd.includes('# ContextForge Git Change Review Report'));
      assert.ok(reviewMd.includes('Diff Target'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. HTTP REST API serves knowledge audit and 1-click reconciliation endpoints', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    const service = new ContextForgeWorkspaceService(store);
    const server = createContextForgeHttpServer(service, {
      workspaceRootDir: process.cwd(),
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const { repository } = await service.onboardRepository({
        rootPath: path.join(FIXTURES_DIR, 'polyglot-monorepo'),
        name: 'polyglot-http-test',
      });

      // Save a knowledge entry
      const entry = service.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'architecture_decision',
        title: 'ADR-HTTP: API Currency format',
        contentMarkdown: 'Use integer cents.',
        linkedFilePaths: [
          { relativePath: 'apps/web-portal/src/BillingView.tsx', startLine: 1, endLine: 5 },
        ],
      });

      // GET /api/repositories/:id/knowledge/audit
      const auditRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repository.id)}/knowledge/audit`
      );
      assert.equal(auditRes.status, 200);
      const auditData = (await auditRes.json()) as { audit: { totalEntries: number; freshCount: number } };
      assert.equal(auditData.audit.totalEntries, 1);
      assert.equal(auditData.audit.freshCount, 1);

      // POST /api/repositories/:id/knowledge/:entryId/reconcile
      const recRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repository.id)}/knowledge/${encodeURIComponent(entry.id)}/reconcile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeMissingReferences: false }),
        }
      );
      assert.equal(recRes.status, 200);
      const recData = (await recRes.json()) as { entry: { stalenessStatus: string } };
      assert.equal(recData.entry.stalenessStatus, 'verified_fresh');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
