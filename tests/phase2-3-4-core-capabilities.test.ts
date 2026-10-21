import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import {
  ConsentGatedExternalAiProvider,
  ConsentRequiredError,
} from '../src/infrastructure/ai/ai-providers.js';
import { assembleContextPack } from '../src/infrastructure/context-engine/context-assembler.js';
import { exportContextPack } from '../src/infrastructure/context-engine/context-exporters.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Phases 2, 3 & 4 — Polyglot Analysis, Unknown Stacks, Deterministic Context Packs & Change Review', () => {
  it('analyzes a polyglot monorepo without assuming root is a single application', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      const service = new ContextForgeWorkspaceService(store);
      const monorepoPath = path.join(FIXTURES_DIR, 'polyglot-monorepo');

      const { snapshot } = await service.onboardRepository({
        rootPath: monorepoPath,
        name: 'acme-commerce-monorepo',
      });

      // Must discover nested sub-projects rather than treating root as one app
      const subProjectPaths = snapshot.subProjects.map((sp) => sp.rootPath);
      expect(subProjectPaths).toEqual(
        expect.arrayContaining([
          '',
          'apps/web-portal',
          'packages/shared-contracts',
          'services/python-pricing',
        ])
      );

      const webSp = snapshot.subProjects.find((sp) => sp.rootPath === 'apps/web-portal');
      expect(webSp?.frameworks.map((f) => f.value)).toContain('React');
      expect(webSp?.buildSystems.map((b) => b.value)).toEqual(
        expect.arrayContaining(['TypeScript Compiler (tsc)', 'Vite'])
      );
      expect(webSp?.testHarnesses.map((t) => t.value)).toContain('Vitest');

      const pySp = snapshot.subProjects.find((sp) => sp.rootPath === 'services/python-pricing');
      expect(pySp?.languages.map((l) => l.value)).toContain('Python');
      expect(pySp?.frameworks.map((f) => f.value)).toEqual(
        expect.arrayContaining(['FastAPI', 'Pydantic', 'SQLAlchemy'])
      );
      expect(pySp?.apiSurfaces.map((a) => `${a.value.methodOrOperation} ${a.value.routeOrSignature}`)).toEqual(
        expect.arrayContaining(['GET /api/v1/quote', 'POST /api/v1/recalculate'])
      );
      expect(pySp?.configTemplates.map((c) => c.relativePath)).toContain(
        'services/python-pricing/.env.example'
      );

      // SQL tables, views, and foreign keys
      const allDbObjs = snapshot.subProjects.flatMap((sp) => sp.databaseObjects.map((d) => d.value.name));
      expect(allDbObjs).toEqual(
        expect.arrayContaining(['accounts', 'invoices', 'idx_invoices_account_id', 'active_invoices_view'])
      );

      const fkEdges = snapshot.dependencyEdges.filter((e) => e.value.kind === 'sql_foreign_key');
      expect(fkEdges).toHaveLength(1);
      expect(fkEdges[0]?.value.fromPathOrModule).toBe('invoices');
      expect(fkEdges[0]?.value.toPathOrModule).toBe('accounts');
    } finally {
      store.close();
    }
  });

  it('proves stack-agnostic Tier-0 analysis and context assembly on an unrecognized (.qlang) repository', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      // Pass empty adapter list to prove zero Tier-1 language adapter dependency
      const service = new ContextForgeWorkspaceService(store, []);
      const unknownStackPath = path.join(FIXTURES_DIR, 'unknown-esoteric-stack');

      const { repository, snapshot } = await service.onboardRepository({
        rootPath: unknownStackPath,
        name: 'quantum-ledger-qlang',
      });

      expect(snapshot.stats.totalFilesIndexed).toBeGreaterThanOrEqual(5);

      const qlangFiles = snapshot.files.filter((f) => f.relativePath.endsWith('.qlang'));
      expect(qlangFiles.length).toBe(3);
      expect(qlangFiles.find((f) => f.relativePath === 'src/main.qlang')?.role).toBe('source');
      expect(qlangFiles.find((f) => f.relativePath === 'tests/engine_test.qlang')?.role).toBe('test');

      // Tier-0 must infer src/main.qlang as an entry point candidate with 'inferred' certainty
      const epClaims = snapshot.subProjects.flatMap((sp) => sp.entryPoints);
      const mainEp = epClaims.find((e) => e.value.identifier === 'src/main.qlang');
      expect(mainEp).toBeDefined();
      expect(mainEp?.certainty).toBe('inferred');
      expect(mainEp?.evidence[0]?.relativePath).toBe('src/main.qlang');

      // Tier-0 must record explicit unknowns and limitations
      expect(snapshot.unknownsAndLimitations.length).toBeGreaterThan(0);

      // Context pack generation must work on this unrecognized stack
      const { pack, markdownExport, plainTextExport } = await service.generateContextPack({
        repoId: repository.id,
        taskType: 'fix_bug',
        taskTitle: 'Fix shard balance check in ShardEngine',
        taskDescription: 'Verify reconcile_shard and invariant_balance_non_negative in engine.qlang',
        seedFilePaths: ['src/engine.qlang'],
      });

      expect(pack.includedItems.map((i) => i.relativePath)).toContain('src/engine.qlang');
      expect(pack.includedItems.map((i) => i.relativePath)).toContain('tests/engine_test.qlang');
      expect(markdownExport).toContain('<untrusted_repository_content path="src/engine.qlang"');
      expect(plainTextExport).toContain('FILE: src/engine.qlang');
    } finally {
      store.close();
    }
  });

  it('analyzes a .NET / C# repository with Minimal APIs and NuGet dependencies', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      const service = new ContextForgeWorkspaceService(store);
      const dotnetPath = path.join(FIXTURES_DIR, 'dotnet-sql-service');

      const { snapshot } = await service.onboardRepository({
        rootPath: dotnetPath,
      });

      const sp = snapshot.subProjects[0]!;
      expect(sp.frameworks.map((f) => f.value)).toEqual(
        expect.arrayContaining(['ASP.NET Core', '.NET (net10.0)', 'Dapper'])
      );
      expect(sp.testHarnesses.map((t) => t.value)).toContain('xunit');
      expect(sp.apiSurfaces.map((a) => `${a.value.methodOrOperation} ${a.value.routeOrSignature}`)).toEqual(
        expect.arrayContaining(['GET /api/orders', 'POST /api/orders'])
      );
    } finally {
      store.close();
    }
  });

  it('produces byte-identical deterministic context packs and strictly honors context budgets', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      const service = new ContextForgeWorkspaceService(store);
      const monorepoPath = path.join(FIXTURES_DIR, 'polyglot-monorepo');
      const { snapshot } = await service.onboardRepository({ rootPath: monorepoPath });

      const fixedMeta = {
        packId: 'pack_deterministic_1',
        createdAtIso: '2026-10-21T00:00:00.000Z',
      };

      const packA = await assembleContextPack({
        snapshot,
        knowledgeEntries: [],
        taskType: 'implement_feature',
        taskTitle: 'Add currency formatting and portal bootstrap',
        taskDescription: 'Update formatCurrency in BillingView and portal main entry',
        seedFilePaths: ['apps/web-portal/src/main.tsx'],
        budget: { maxTotalChars: 4000, maxFilesCount: 4, maxCharsPerFile: 1500 },
        deterministicIdAndTimestamp: fixedMeta,
      });

      const packB = await assembleContextPack({
        snapshot,
        knowledgeEntries: [],
        taskType: 'implement_feature',
        taskTitle: 'Add currency formatting and portal bootstrap',
        taskDescription: 'Update formatCurrency in BillingView and portal main entry',
        seedFilePaths: ['apps/web-portal/src/main.tsx'],
        budget: { maxTotalChars: 4000, maxFilesCount: 4, maxCharsPerFile: 1500 },
        deterministicIdAndTimestamp: fixedMeta,
      });

      // 1-hop dependency neighbor (BillingView.tsx) must be automatically ranked #2 right after seed file
      expect(packA.includedItems[0]?.relativePath).toBe('apps/web-portal/src/main.tsx');
      expect(packA.includedItems[1]?.relativePath).toBe('apps/web-portal/src/BillingView.tsx');
      expect(packA.usedChars).toBeLessThanOrEqual(4000);
      expect(packA.includedItems.length).toBeLessThanOrEqual(4);

      const mdA = exportContextPack(packA, 'markdown');
      const mdB = exportContextPack(packB, 'markdown');
      expect(mdA).toBe(mdB);
    } finally {
      store.close();
    }
  });

  it('produces evidence-backed change review findings for risky SQL, missing tests, blast radius, and stale ADRs', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      const service = new ContextForgeWorkspaceService(store);
      const monorepoPath = path.join(FIXTURES_DIR, 'polyglot-monorepo');
      const { repository } = await service.onboardRepository({ rootPath: monorepoPath });

      // Create an ADR linked to apps/web-portal/src/BillingView.tsx
      service.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'architecture_decision',
        title: 'ADR-004: Cents-Based Currency Formatting',
        contentMarkdown: 'All monetary amounts in `BillingView.tsx` must be integer cents.',
        linkedFilePaths: [{ relativePath: 'apps/web-portal/src/BillingView.tsx', startLine: 1, endLine: 8 }],
      });

      const riskyDiff = [
        'diff --git a/apps/web-portal/src/BillingView.tsx b/apps/web-portal/src/BillingView.tsx',
        'index 1111111..2222222 100644',
        '--- a/apps/web-portal/src/BillingView.tsx',
        '+++ b/apps/web-portal/src/BillingView.tsx',
        '@@ -5,3 +5,4 @@ export interface InvoiceSummary {',
        '-export function formatCurrency(amountCents: number): string {',
        '+export function formatCurrency(amountCents: number, locale = "en-US"): string {',
        '+  console.log(locale);',
        '   return `$${(amountCents / 100).toFixed(2)}`;',
        'diff --git a/db/migrations/001_initial_schema.sql b/db/migrations/001_initial_schema.sql',
        'index 3333333..4444444 100644',
        '--- a/db/migrations/001_initial_schema.sql',
        '+++ b/db/migrations/001_initial_schema.sql',
        '@@ -18,2 +18,4 @@ SELECT id, account_id, subtotal_cents',
        ' FROM invoices',
        " WHERE status = 'open';",
        '+DROP TABLE accounts;',
        '+DELETE FROM invoices;',
      ].join('\n');

      const review = await service.reviewChanges({
        repoId: repository.id,
        targetSpec: 'PR #42 Simulation',
        rawDiffOverride: riskyDiff,
      });

      const categories = review.findings.map((f) => f.category);
      expect(categories).toEqual(
        expect.arrayContaining([
          'potential_regression', // BillingView.tsx modified while dependent main.tsx was not updated
          'missing_test_coverage', // BillingView.tsx modified without test update
          'risky_sql_operation', // DROP TABLE accounts & unbounded DELETE FROM invoices
          'stale_knowledge_impact', // ADR-004 linked to BillingView.tsx
        ])
      );

      // Every finding must carry at least one valid SourceReference
      for (const finding of review.findings) {
        expect(finding.evidence.length).toBeGreaterThan(0);
        expect(finding.evidence[0]?.relativePath).toBeTruthy();
      }
    } finally {
      store.close();
    }
  });

  it('blocks external AI provider calls unless an explicit OutboundConsentToken matching payload SHA-256 is approved', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    try {
      const config = store.getAiProviderConfig();
      const externalConfig = {
        ...config,
        activeProviderId: 'openai_compatible' as const,
        endpointUrl: 'http://127.0.0.1:59999/v1/chat/completions',
        modelName: 'gpt-test',
      };
      store.saveAiProviderConfig(externalConfig);

      const provider = new ConsentGatedExternalAiProvider(externalConfig, store);
      const request = {
        systemInstruction: 'Analyze module.',
        taskPrompt: 'Explain main.tsx',
        untrustedContextPackText: '<untrusted_repository_content>const x = 1;</untrusted_repository_content>',
        disclosedFilePaths: ['src/main.tsx'],
      };

      const forgedConsent = {
        consentId: 'forged_1',
        approvedAtIso: new Date().toISOString(),
        providerId: 'openai_compatible',
        payloadSha256: 'wrong_sha256_hash',
        disclosedFilePaths: ['src/main.tsx'],
        estimatedBytes: 100,
      };

      await expect(provider.generateText(request, forgedConsent)).rejects.toThrow(
        ConsentRequiredError
      );
      expect(store.getPrivacyAndIndexStatus().outboundAiRequestsCount).toBe(0);
    } finally {
      store.close();
    }
  });
});
