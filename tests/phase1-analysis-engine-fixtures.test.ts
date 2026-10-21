import { beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDefaultAdapters } from '../src/adapters/index.js';
import { analyzeRepository } from '../src/infrastructure/scanning/repository-analyzer.js';
import {
  DeterministicMarkdownReportGenerator,
  generateRepositoryMarkdownReport,
} from '../src/infrastructure/reporting/markdown-report-generator.js';

const FIXTURES_ROOT = path.resolve(process.cwd(), 'tests/fixtures');

describe('Phase 1 — Stack-Agnostic Repository Analysis Engine & Fixture Matrix', () => {
  beforeAll(() => {
    // Ensure gitignored dummy .env fixture exists for local/CI secret-exclusion testing without committing .env
    const dummyEnvPath = path.join(FIXTURES_ROOT, 'malformed-and-inaccessible', '.env');
    if (!fs.existsSync(dummyEnvPath)) {
      fs.writeFileSync(
        dummyEnvPath,
        'SUPER_SECRET_API_TOKEN=sk_live_do_not_index_or_export_999999\nDATABASE_PASSWORD=top_secret_password\n',
        'utf8',
      );
    }
  });
  it('1. Analyzes a compiled-language application (Rust + C++ header FFI) with multi-signal language detection and module dependencies', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'compiled-rust-app');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-compiled-rust',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const rustFiles = snapshot.files.filter((f) => f.detectedLanguage === 'Rust');
    assert.ok(rustFiles.length >= 2, 'Expected at least 2 Rust source files');

    // Verify C++ header disambiguation via content_signature (#pragma once / namespace / class)
    const ffiHeader = snapshot.files.find((f) => f.relativePath === 'include/ffi_bridge.h');
    assert.ok(ffiHeader, 'Expected include/ffi_bridge.h to be indexed');
    assert.equal(ffiHeader.detectedLanguage, 'C++ Header');
    assert.ok(ffiHeader.languageDetectionSignals?.includes('extension'));
    assert.ok(ffiHeader.languageDetectionSignals?.includes('content_signature'));

    // Verify lockfile & manifest discovery on root sub-project
    const rootSubProject = snapshot.subProjects.find((sp) => sp.rootPath === '');
    assert.ok(rootSubProject, 'Expected root Rust sub-project');
    assert.ok(rootSubProject.manifests.some((m) => m.relativePath === 'Cargo.toml'));
    assert.ok(rootSubProject.lockfiles?.some((l) => l.relativePath === 'Cargo.lock'));
    assert.ok(rootSubProject.entryPoints.some((ep) => ep.value.identifier === 'src/main.rs'));

    // Verify internal module dependency edge (src/main.rs -> src/telemetry.rs)
    assert.ok(
      snapshot.dependencyEdges.some(
        (e) =>
          e.value.fromPathOrModule === 'src/main.rs' &&
          e.value.toPathOrModule === 'src/telemetry.rs' &&
          e.value.kind === 'file_import',
      ),
      'Expected verified Rust mod dependency edge from src/main.rs to src/telemetry.rs',
    );

    // Verify analyzer execution tracking
    assert.ok(snapshot.activeAdapters.includes('adapter.go_rust'));
    assert.ok(snapshot.skippedAdapters?.some((s) => s.adapterId === 'adapter.node_typescript'));
  });

  it('2. Analyzes a TypeScript/JavaScript project with lockfiles, OpenAPI specification, tests, and config templates', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'ts-service-project');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-ts-service',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const subProject = snapshot.subProjects.find((sp) => sp.rootPath === '');
    assert.ok(subProject, 'Expected root TypeScript sub-project');
    assert.ok(subProject.packageManagers.some((pm) => pm.value.includes('npm')));
    assert.ok(subProject.manifests.some((m) => m.relativePath === 'package.json'));
    assert.ok(subProject.lockfiles?.some((l) => l.relativePath === 'package-lock.json'));
    assert.ok(subProject.apiSpecifications?.some((a) => a.relativePath === 'openapi.yaml'));
    assert.ok(subProject.configTemplates.some((c) => c.relativePath === '.env.example'));

    const openApiFile = snapshot.files.find((f) => f.relativePath === 'openapi.yaml');
    assert.ok(openApiFile);
    assert.equal(openApiFile.role, 'api_spec');

    const lockFile = snapshot.files.find((f) => f.relativePath === 'package-lock.json');
    assert.ok(lockFile);
    assert.equal(lockFile.role, 'lockfile');

    // Verify TypeScript API route and import edge
    const allApis = snapshot.subProjects.flatMap((sp) => sp.apiSurfaces);
    assert.ok(
      allApis.some(
        (ep) =>
          ep.value.methodOrOperation === 'GET' &&
          ep.value.routeOrSignature === '/api/orders/status',
      ),
    );
    assert.ok(
      snapshot.dependencyEdges.some(
        (e) =>
          e.value.fromPathOrModule === 'src/index.ts' &&
          e.value.toPathOrModule === 'src/router.ts',
      ),
    );
  });

  it('3. Analyzes a Python project and detects extensionless scripts via shebang + content signature', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'python-service-project');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-python-service',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const daemonScript = snapshot.files.find((f) => f.relativePath === 'bin/worker-daemon');
    assert.ok(daemonScript, 'Expected extensionless bin/worker-daemon to be indexed');
    assert.equal(daemonScript.detectedLanguage, 'Python');
    assert.ok(daemonScript.languageDetectionSignals?.includes('shebang'));
    assert.ok(daemonScript.languageDetectionSignals?.includes('content_signature'));

    const subProject = snapshot.subProjects.find((sp) => sp.rootPath === '');
    assert.ok(subProject);
    assert.ok(subProject.manifests.some((m) => m.relativePath === 'pyproject.toml'));
    assert.ok(subProject.lockfiles?.some((l) => l.relativePath === 'poetry.lock'));
    assert.ok(subProject.frameworks.some((fw) => fw.value === 'FastAPI'));
    assert.ok(
      snapshot.symbols.some(
        (s) => s.name === 'compute_health_score' && s.sourceRef.relativePath === 'src/service.py',
      ),
    );
  });

  it('4. Analyzes a database-heavy repository (SQL DDL tables, views, procedures, foreign-key edges, and Prisma)', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'database-heavy-repo');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-database-heavy',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const allDbObjects = snapshot.subProjects.flatMap((sp) => sp.databaseObjects);
    const objectNames = allDbObjects.map((d) => `${d.value.objectType}:${d.value.name}`);
    assert.ok(objectNames.includes('table:customers'));
    assert.ok(objectNames.includes('table:customer_wallets'));
    assert.ok(objectNames.includes('table:ledger_entries'));
    assert.ok(objectNames.includes('view:active_customer_balances'));
    assert.ok(objectNames.includes('procedure:reconcile_wallet_balance'));

    // Verify SQL foreign-key dependency graph edges
    assert.ok(
      snapshot.dependencyEdges.some(
        (e) =>
          e.value.fromPathOrModule === 'customer_wallets' &&
          e.value.toPathOrModule === 'customers' &&
          e.value.kind === 'sql_foreign_key',
      ),
    );
    assert.ok(
      snapshot.dependencyEdges.some(
        (e) =>
          e.value.fromPathOrModule === 'ledger_entries' &&
          e.value.toPathOrModule === 'customer_wallets' &&
          e.value.kind === 'sql_foreign_key',
      ),
    );

    const prismaFile = snapshot.files.find((f) => f.relativePath === 'prisma/schema.prisma');
    assert.ok(prismaFile);
    assert.equal(prismaFile.role, 'database_script');
  });

  it('5. Analyzes a polyglot monorepo with multiple applications and workspace dependencies', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'polyglot-monorepo');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-polyglot-monorepo',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    assert.ok(snapshot.subProjects.length >= 3, 'Expected multiple sub-projects in monorepo');
    const subProjectPaths = snapshot.subProjects.map((sp) => sp.rootPath);
    assert.ok(subProjectPaths.includes('apps/web-portal'));
    assert.ok(subProjectPaths.includes('packages/shared-contracts'));
    assert.ok(subProjectPaths.includes('services/python-pricing'));
  });

  it('6. Analyzes an unfamiliar/unsupported stack using Tier-0 structural inventory and records skipped adapters', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'unknown-esoteric-stack');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-unknown-stack',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    assert.ok(snapshot.files.some((f) => f.relativePath.endsWith('.qlang')));
    // Only polyglot build adapter runs (on Makefile); all 5 language/SQL adapters are skipped
    assert.ok(
      (snapshot.skippedAdapters?.length ?? 0) >= 5,
      'All 5 language/SQL Tier-1 adapters should be recorded as skipped',
    );
    assert.ok(
      snapshot.unknownsAndLimitations.some(
        (u) => u.includes('.qlang') || u.includes('Unrecognized') || u.includes('Tier-1'),
      ),
    );
  });

  it('7. Supports partial analysis on malformed manifests and inaccessible files while excluding secrets', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'malformed-and-inaccessible');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-malformed-inaccessible',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
      simulatedInaccessiblePaths: ['restricted/unreadable.txt'],
    });

    // 1. Secret file (.env) must be excluded
    const secretFile = snapshot.files.find((f) => f.relativePath === '.env');
    assert.ok(secretFile);
    assert.equal(secretFile.isIndexed, false);
    assert.equal(secretFile.exclusionReason, 'sensitive_filename');

    // 2. Inaccessible file must be recorded safely without crashing
    const unreadableFile = snapshot.files.find(
      (f) => f.relativePath === 'restricted/unreadable.txt',
    );
    assert.ok(unreadableFile);
    assert.equal(unreadableFile.isIndexed, false);
    assert.equal(unreadableFile.exclusionReason, 'inaccessible_or_permission_denied');
    assert.equal(snapshot.stats.inaccessibleFilesCount, 1);

    // 3. Malformed manifests must be reported in unknownsAndLimitations and analyzerExecutionLog
    assert.ok(
      snapshot.unknownsAndLimitations.some((u) => u.includes('package.json')),
      'Malformed package.json should be reported in unknownsAndLimitations',
    );
    assert.ok(
      snapshot.unknownsAndLimitations.some((u) => u.includes('pyproject.toml')),
      'Malformed pyproject.toml should be reported in unknownsAndLimitations',
    );
    assert.ok(
      snapshot.unknownsAndLimitations.some((u) => u.includes('Broken.csproj')),
      'Malformed Broken.csproj should be reported in unknownsAndLimitations',
    );

    const partialAdapters = (snapshot.analyzerExecutionLog ?? []).filter(
      (entry) => entry.status === 'partial_error',
    );
    assert.ok(
      partialAdapters.length >= 3,
      'Expected node-ts-adapter, python-adapter, and dotnet-adapter to log partial_error',
    );

    // 4. Valid files in the same repository must still be analyzed!
    assert.ok(
      snapshot.symbols.some(
        (s) =>
          s.name === 'survivingHealthCheck' &&
          s.sourceRef.relativePath === 'src/valid_survivor.ts',
      ),
      'Valid TypeScript file should still be indexed and extracted despite broken manifests',
    );
  });

  it('8. Produces a deterministic, secret-safe Markdown report without requiring an AI provider', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'malformed-and-inaccessible');
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-malformed-inaccessible',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
      simulatedInaccessiblePaths: ['restricted/unreadable.txt'],
      deterministicSnapshotMeta: {
        snapshotId: 'snap-fixed-deterministic',
        analyzedAtIso: '2026-01-01T00:00:00.000Z',
      },
    });

    const generator = new DeterministicMarkdownReportGenerator();
    const reportA = generator.generateMarkdownReport(snapshot);
    const reportB = generateRepositoryMarkdownReport(snapshot);

    // Deterministic output for identical snapshot
    assert.equal(reportA, reportB);
    assert.ok(reportA.includes('# ContextForge Repository Analysis Report'));
    assert.ok(reportA.includes('## 2. Analyzer Execution Log'));
    assert.ok(reportA.includes('**[PARTIAL_ERROR]**'));
    assert.ok(reportA.includes('inaccessible_or_permission_denied'));
    assert.ok(reportA.includes('## 6. Unsupported Areas, Malformed Inputs & Honest Unknowns'));

    // Secret values inside .env must NEVER appear in the generated report
    assert.ok(!reportA.includes('sk_live_do_not_index_or_export_999999'));
    assert.ok(!reportA.includes('top_secret_password'));
  });
});
