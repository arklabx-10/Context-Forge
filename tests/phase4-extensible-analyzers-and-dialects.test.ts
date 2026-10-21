import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  ApiSchemaAdapter,
  createDefaultAdapters,
  detectSqlDialect,
  SqlMigrationAdapter,
} from '../src/adapters/index.js';
import type {
  AdapterAnalysisFragment,
  AdapterFileContext,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
} from '../src/domain/index.js';
import { analyzeRepository } from '../src/infrastructure/scanning/repository-analyzer.js';

describe('Phase 4 — Extensible Analyzer System, Dialect-Aware SQL, Dynamic Syntax & Fault Isolation', () => {
  it('1. Verifies all built-in analyzers declare explicit contracts, supported inputs, capabilities, versions, limitations, and safe resource requirements', async () => {
    const adapters = createDefaultAdapters();
    assert.ok(adapters.length >= 7, 'Expected at least 7 built-in adapters');

    const seenIds = new Set<string>();
    for (const adapter of adapters) {
      assert.ok(adapter.adapterId.startsWith('adapter.'));
      assert.ok(!seenIds.has(adapter.adapterId), `Duplicate adapterId: ${adapter.adapterId}`);
      seenIds.add(adapter.adapterId);

      assert.ok(adapter.displayName.length > 3);
      assert.ok(adapter.description.length > 10);
      assert.match(adapter.version, /^\d+\.\d+\.\d+$/);

      // Explicit capabilities contract
      assert.equal(typeof adapter.capabilities.detectsManifests, 'boolean');
      assert.equal(typeof adapter.capabilities.extractsSymbols, 'boolean');
      assert.equal(typeof adapter.capabilities.extractsModuleImports, 'boolean');
      assert.equal(typeof adapter.capabilities.detectsEntryPoints, 'boolean');
      assert.equal(typeof adapter.capabilities.detectsApiSurfaces, 'boolean');
      assert.equal(typeof adapter.capabilities.analyzesSqlObjects, 'boolean');
      assert.equal(typeof adapter.capabilities.inspectsDiffRisks, 'boolean');

      // Explicit supportedInputs, limitations & requiredResources
      assert.ok(adapter.supportedInputs, `${adapter.adapterId} must declare supportedInputs`);
      assert.ok(
        adapter.supportedInputs.extensions.length > 0 ||
          adapter.supportedInputs.filenamesOrGlobs.length > 0
      );
      assert.ok(adapter.supportedInputs.ecosystemsOrDialects.length > 0);

      assert.ok(
        adapter.limitations && adapter.limitations.length > 0,
        `${adapter.adapterId} must declare static analysis limitations`
      );
      assert.ok(adapter.requiredResources, `${adapter.adapterId} must declare requiredResources`);
      assert.ok(adapter.requiredResources.maxFileSizeBytes > 0);
      assert.equal(adapter.requiredResources.executionMode, 'in_process_safe_static');
    }

    // Verify analyzer architecture & onboarding documentation exists and covers required sections
    const docPath = path.resolve(process.cwd(), 'docs/ANALYZER_ARCHITECTURE.md');
    const docContent = await fs.readFile(docPath, 'utf-8');
    assert.ok(docContent.includes('Procedure for Introducing a New Analyzer Adapter'));
    assert.ok(docContent.includes('Epistemic Matrix: Statically Verified vs. Inferred vs. Unknown'));
    assert.ok(docContent.includes('SQL Dialect Differentiation'));
  });

  it('2. Distinguishes PostgreSQL, T-SQL, and MySQL dialects, extracts tables/views/routines/migrations/FKs, and flags dialect conflicts & dynamic SQL', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-phase4-sql-'));
    try {
      await fs.mkdir(path.join(tmpDir, 'migrations'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'mssql'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'mysql'), { recursive: true });

      // 1. PostgreSQL migration 001 (tables, materialized view, plpgsql function, trigger, and dynamic SQL)
      await fs.writeFile(
        path.join(tmpDir, 'migrations/001_init_postgres.sql'),
        [
          'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
          'CREATE TABLE customers (',
          '  id BIGSERIAL PRIMARY KEY,',
          '  profile JSONB NOT NULL,',
          '  created_at TIMESTAMPTZ DEFAULT now()',
          ');',
          'CREATE TABLE orders (',
          '  id BIGSERIAL PRIMARY KEY,',
          '  customer_id BIGINT NOT NULL,',
          '  total_cents INTEGER NOT NULL',
          ');',
          'CREATE MATERIALIZED VIEW customer_order_totals AS',
          '  SELECT customer_id, SUM(total_cents) AS lifetime_cents FROM orders GROUP BY customer_id;',
          'CREATE OR REPLACE FUNCTION archive_stale_orders(cutoff_days INT) RETURNS VOID AS $$',
          'BEGIN',
          "  EXECUTE format('DELETE FROM %I WHERE created_at < now()', 'orders_archive');",
          'END;',
          '$$ LANGUAGE plpgsql;',
          'CREATE TRIGGER trg_orders_audit AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION archive_stale_orders();',
        ].join('\n'),
        'utf-8'
      );

      // 2. PostgreSQL migration 002 (ALTER TABLE + FOREIGN KEY reference + sequential migration order)
      await fs.writeFile(
        path.join(tmpDir, 'migrations/002_alter_orders_fk.sql'),
        [
          'ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id);',
        ].join('\n'),
        'utf-8'
      );

      // 3. T-SQL (SQL Server) script with [dbo], IDENTITY, NVARCHAR, CREATE OR ALTER PROCEDURE, and sp_executesql
      await fs.writeFile(
        path.join(tmpDir, 'mssql/audit_procedures.sql'),
        [
          'CREATE TABLE [dbo].[audit_events] (',
          '  event_id INT IDENTITY(1,1) PRIMARY KEY,',
          '  actor_name NVARCHAR(128) NOT NULL,',
          '  recorded_at DATETIME2 NOT NULL',
          ');',
          'GO',
          'CREATE OR ALTER PROCEDURE [dbo].[sp_purge_audit_events]',
          'AS',
          'BEGIN',
          "  EXEC sp_executesql N'DELETE FROM [dbo].[audit_events] WHERE 1=0';",
          'END;',
          'GO',
        ].join('\n'),
        'utf-8'
      );

      // 4. MySQL script with AUTO_INCREMENT and ENGINE=InnoDB
      await fs.writeFile(
        path.join(tmpDir, 'mysql/legacy_catalog.sql'),
        [
          'CREATE TABLE `catalog_items` (',
          '  `item_id` INT AUTO_INCREMENT PRIMARY KEY,',
          '  `sku` VARCHAR(64) NOT NULL',
          ') ENGINE=InnoDB;',
        ].join('\n'),
        'utf-8'
      );

      // 5. Conflicting SQL dialect file mixing PostgreSQL BIGSERIAL/$$ and MySQL ENGINE=InnoDB
      await fs.writeFile(
        path.join(tmpDir, 'migrations/003_conflicting_dialect.sql'),
        [
          'CREATE TABLE mixed_table (',
          '  id BIGSERIAL PRIMARY KEY,',
          '  payload JSONB',
          ') ENGINE=InnoDB;',
        ].join('\n'),
        'utf-8'
      );

      const { snapshot } = await analyzeRepository({
        repoId: 'repo-phase4-sql',
        rootPath: tmpDir,
        adapters: [new SqlMigrationAdapter()],
      });

      const dbObjects = snapshot.subProjects.flatMap((sp) => sp.databaseObjects);

      // Verify dialect differentiation
      const pgTable = dbObjects.find((d) => d.value.name === 'customers' && d.value.objectType === 'table');
      assert.ok(pgTable, 'Expected PostgreSQL table customers');
      assert.equal(pgTable.value.dialectHint, 'PostgreSQL');

      const pgView = dbObjects.find((d) => d.value.name === 'customer_order_totals');
      assert.ok(pgView, 'Expected PostgreSQL materialized view');
      assert.equal(pgView.value.objectType, 'view');
      assert.equal(pgView.value.dialectHint, 'PostgreSQL');

      const pgFunc = dbObjects.find((d) => d.value.name === 'archive_stale_orders');
      assert.ok(pgFunc, 'Expected PostgreSQL function archive_stale_orders');
      assert.equal(pgFunc.value.objectType, 'function');
      assert.equal(pgFunc.value.dialectHint, 'PostgreSQL');

      const pgTrigger = dbObjects.find((d) => d.value.name === 'trg_orders_audit');
      assert.ok(pgTrigger, 'Expected PostgreSQL trigger trg_orders_audit');
      assert.equal(pgTrigger.value.objectType, 'trigger');

      const tsqlTable = dbObjects.find((d) => d.value.name === 'audit_events');
      assert.ok(tsqlTable, 'Expected T-SQL table audit_events');
      assert.equal(tsqlTable.value.dialectHint, 'TSQL');

      const tsqlProc = dbObjects.find((d) => d.value.name === 'sp_purge_audit_events');
      assert.ok(tsqlProc, 'Expected T-SQL procedure sp_purge_audit_events');
      assert.equal(tsqlProc.value.objectType, 'procedure');
      assert.equal(tsqlProc.value.dialectHint, 'TSQL');

      const mysqlTable = dbObjects.find((d) => d.value.name === 'catalog_items');
      assert.ok(mysqlTable, 'Expected MySQL table catalog_items');
      assert.equal(mysqlTable.value.dialectHint, 'MySQL');

      // Verify verified vs. inferred migration & reference relationships
      const fkEdge = snapshot.dependencyEdges.find(
        (e) =>
          e.value.kind === 'sql_foreign_key' &&
          e.value.fromPathOrModule === 'orders' &&
          e.value.toPathOrModule === 'customers'
      );
      assert.ok(fkEdge, 'Expected verified ALTER TABLE foreign key orders -> customers');
      assert.equal(fkEdge.certainty, 'verified');

      const alterTableEdge = snapshot.dependencyEdges.find(
        (e) =>
          e.value.kind === 'sql_table_reference' &&
          e.value.fromPathOrModule === 'migrations/002_alter_orders_fk.sql' &&
          e.value.toPathOrModule === 'orders'
      );
      assert.ok(alterTableEdge, 'Expected verified ALTER TABLE reference from migration 002 to orders');
      assert.equal(alterTableEdge.certainty, 'verified');

      const migSeqEdge = snapshot.dependencyEdges.find(
        (e) =>
          e.value.kind === 'sql_migration_sequence' &&
          e.value.fromPathOrModule === 'migrations/002_alter_orders_fk.sql' &&
          e.value.toPathOrModule === 'migrations/001_init_postgres.sql'
      );
      assert.ok(migSeqEdge, 'Expected inferred migration sequence edge 002 -> 001');
      assert.equal(migSeqEdge.certainty, 'inferred');

      // Verify dynamic SQL is reported as a limitation rather than inventing table edges
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) => u.includes('Dynamic SQL execution detected') && u.includes('001_init_postgres.sql')
        ),
        'Expected dynamic EXECUTE format(...) to be reported in unknownsAndLimitations'
      );
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) => u.includes('Dynamic SQL execution detected') && u.includes('audit_procedures.sql')
        ),
        'Expected dynamic sp_executesql to be reported in unknownsAndLimitations'
      );
      assert.ok(
        !snapshot.dependencyEdges.some((e) => e.value.toPathOrModule === 'orders_archive'),
        'Dynamic SQL target table must never be fabricated as a static dependency edge'
      );

      // Verify conflicting SQL dialect warning
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) =>
            u.includes('003_conflicting_dialect.sql') &&
            u.includes('Conflicting SQL dialect constructs')
        ),
        'Expected conflicting PostgreSQL + MySQL dialect constructs to be flagged'
      );

      // Direct unit check on detectSqlDialect
      const conflictCheck = detectSqlDialect('CREATE TABLE t (id BIGSERIAL) ENGINE=InnoDB;');
      assert.equal(conflictCheck.hasDialectConflict, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Analyzes OpenAPI, GraphQL, and Protobuf schemas, and reports unsupported versions, dynamic imports, and conflicting language signals', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-phase4-schemas-'));
    try {
      await fs.mkdir(path.join(tmpDir, 'specs'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });

      // 1. Valid OpenAPI 3.0 spec
      await fs.writeFile(
        path.join(tmpDir, 'specs/openapi.yaml'),
        [
          'openapi: "3.0.3"',
          'info:',
          '  title: Inventory API',
          '  version: "1.0.0"',
          'paths:',
          '  /inventory/items:',
          '    get:',
          '      summary: List items',
          '    post:',
          '      summary: Create item',
        ].join('\n'),
        'utf-8'
      );

      // 2. Unsupported legacy Swagger 1.2 spec
      await fs.writeFile(
        path.join(tmpDir, 'specs/swagger.yaml'),
        ['swagger: "1.2"', 'resourcePath: /legacy'].join('\n'),
        'utf-8'
      );

      // 3. GraphQL schema
      await fs.writeFile(
        path.join(tmpDir, 'specs/schema.graphql'),
        [
          'type Item {',
          '  id: ID!',
          '  name: String!',
          '}',
          'type Query {',
          '  itemById(id: ID!): Item',
          '}',
          'type Mutation {',
          '  archiveItem(id: ID!): Boolean!',
          '}',
        ].join('\n'),
        'utf-8'
      );

      // 4. Protobuf schema
      await fs.writeFile(
        path.join(tmpDir, 'specs/inventory.proto'),
        [
          'syntax = "proto3";',
          'message ReserveRequest { string sku = 1; }',
          'message ReserveResponse { bool ok = 1; }',
          'service InventoryService {',
          '  rpc ReserveStock (ReserveRequest) returns (ReserveResponse);',
          '}',
        ].join('\n'),
        'utf-8'
      );

      // 5. TypeScript file with dynamic import(variable)
      await fs.writeFile(
        path.join(tmpDir, 'src/plugin-loader.ts'),
        [
          'export async function loadPlugin(pluginPath: string) {',
          '  return await import(pluginPath);',
          '}',
        ].join('\n'),
        'utf-8'
      );

      // 6. Python file with dynamic importlib.import_module(name)
      await fs.writeFile(
        path.join(tmpDir, 'src/dyn_runner.py'),
        [
          'import importlib',
          'def load_handler(mod_name: str):',
          '    return importlib.import_module(mod_name)',
        ].join('\n'),
        'utf-8'
      );

      // 7. File with conflicting language signals (.py extension but #!/usr/bin/env node shebang)
      await fs.writeFile(
        path.join(tmpDir, 'src/conflicting_script.py'),
        ['#!/usr/bin/env node', 'console.log("misleading extension");'].join('\n'),
        'utf-8'
      );

      const { snapshot } = await analyzeRepository({
        repoId: 'repo-phase4-schemas',
        rootPath: tmpDir,
        adapters: createDefaultAdapters(),
      });

      const apis = snapshot.subProjects.flatMap((sp) => sp.apiSurfaces.map((a) => a.value));
      // OpenAPI routes
      assert.ok(
        apis.some(
          (a) =>
            a.protocol === 'http_rest' &&
            a.methodOrOperation === 'GET' &&
            a.routeOrSignature === '/inventory/items'
        )
      );
      assert.ok(
        apis.some(
          (a) =>
            a.protocol === 'http_rest' &&
            a.methodOrOperation === 'POST' &&
            a.routeOrSignature === '/inventory/items'
        )
      );

      // GraphQL Query & Mutation
      assert.ok(
        apis.some(
          (a) =>
            a.protocol === 'graphql' &&
            a.methodOrOperation === 'QUERY' &&
            a.routeOrSignature.startsWith('itemById')
        )
      );
      assert.ok(
        apis.some(
          (a) =>
            a.protocol === 'graphql' &&
            a.methodOrOperation === 'MUTATION' &&
            a.routeOrSignature.startsWith('archiveItem')
        )
      );

      // gRPC RPC method
      assert.ok(
        apis.some(
          (a) =>
            a.protocol === 'grpc' &&
            a.methodOrOperation === 'RPC' &&
            a.routeOrSignature.includes('InventoryService/ReserveStock')
        )
      );

      // Unsupported Swagger 1.2 version reported honestly
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) => u.includes('Unsupported SWAGGER specification version "1.2"')
        )
      );

      // Dynamic TS and Python imports reported in unknownsAndLimitations and NOT fabricated as dependency edges
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) => u.includes('Dynamic module import expression') && u.includes('src/plugin-loader.ts')
        )
      );
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) => u.includes('Dynamic Python import') && u.includes('src/dyn_runner.py')
        )
      );
      assert.equal(
        snapshot.dependencyEdges.filter(
          (e) =>
            e.value.fromPathOrModule === 'src/plugin-loader.ts' ||
            e.value.fromPathOrModule === 'src/dyn_runner.py'
        ).length,
        0,
        'Dynamic imports must never fabricate dependencyEdges'
      );

      // Conflicting language detection (.py extension vs node shebang) flagged in unknownsAndLimitations
      assert.ok(
        snapshot.unknownsAndLimitations.some(
          (u) =>
            u.includes('Conflicting language detection signals in "src/conflicting_script.py"') &&
            u.includes('Python') &&
            u.includes('JavaScript')
        ),
        'Expected conflicting extension vs shebang signals to be reported'
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Guarantees analyzer fault isolation: a crashing or resource-constrained custom analyzer does not prevent other analyzers from running', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-phase4-isolation-'));
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'src/service.ts'),
        'export function computeTotal(price: number, tax: number): number {\n  return price + tax;\n}\n',
        'utf-8'
      );

      // Custom analyzer 1: throws an unhandled exception on every TypeScript file
      const crashingAdapter: RepositoryAnalyzerAdapter = {
        adapterId: 'adapter.custom_crashing',
        displayName: 'Simulated Crashing Analyzer',
        description: 'Simulates a third-party parser crash to test fault isolation.',
        version: '0.1.0',
        capabilities: {
          detectsManifests: false,
          extractsSymbols: true,
          extractsModuleImports: false,
          detectsEntryPoints: false,
          detectsApiSurfaces: false,
          analyzesSqlObjects: false,
          inspectsDiffRisks: false,
        },
        supportedInputs: {
          extensions: ['.ts'],
          filenamesOrGlobs: ['*.ts'],
          ecosystemsOrDialects: ['TypeScript'],
        },
        limitations: ['Intentionally throws for fault-isolation testing.'],
        requiredResources: {
          maxFileSizeBytes: 100_000,
          requiresSiblingFileIndex: false,
          executionMode: 'in_process_safe_static',
        },
        supportsFile(file: IndexedFileRecord): boolean {
          return file.relativePath.endsWith('.ts');
        },
        async analyzeFile(_ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
          throw new Error('Simulated parser segmentation fault');
        },
      };

      // Custom analyzer 2: declares a tiny maxFileSizeBytes (10 bytes) so service.ts exceeds its resource cap
      const tinyResourceAdapter: RepositoryAnalyzerAdapter = {
        adapterId: 'adapter.custom_tiny_budget',
        displayName: 'Tiny Resource Budget Analyzer',
        description: 'Declares maxFileSizeBytes=10 to test per-adapter resource enforcement.',
        version: '0.1.0',
        capabilities: {
          detectsManifests: false,
          extractsSymbols: true,
          extractsModuleImports: false,
          detectsEntryPoints: false,
          detectsApiSurfaces: false,
          analyzesSqlObjects: false,
          inspectsDiffRisks: false,
        },
        supportedInputs: {
          extensions: ['.ts'],
          filenamesOrGlobs: ['*.ts'],
          ecosystemsOrDialects: ['TypeScript'],
        },
        limitations: ['Skips files larger than 10 bytes.'],
        requiredResources: {
          maxFileSizeBytes: 10,
          requiresSiblingFileIndex: false,
          executionMode: 'in_process_safe_static',
        },
        supportsFile(file: IndexedFileRecord): boolean {
          return file.relativePath.endsWith('.ts');
        },
        async analyzeFile(_ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
          return {};
        },
      };

      const { snapshot } = await analyzeRepository({
        repoId: 'repo-phase4-isolation',
        rootPath: tmpDir,
        adapters: [crashingAdapter, tinyResourceAdapter, ...createDefaultAdapters()],
      });

      // 1. Crashing adapter and tiny-budget adapter are logged as partial_error in analyzerExecutionLog
      const crashLog = snapshot.analyzerExecutionLog?.find(
        (l) => l.adapterId === 'adapter.custom_crashing'
      );
      assert.ok(crashLog);
      assert.equal(crashLog.status, 'partial_error');
      assert.ok(
        crashLog.reasonOrNotes.some((n) => n.includes('Simulated parser segmentation fault'))
      );

      const tinyLog = snapshot.analyzerExecutionLog?.find(
        (l) => l.adapterId === 'adapter.custom_tiny_budget'
      );
      assert.ok(tinyLog);
      assert.equal(tinyLog.status, 'partial_error');
      assert.ok(tinyLog.reasonOrNotes.some((n) => n.includes('exceeds adapter maxFileSizeBytes 10')));

      // 2. Unrelated NodeTypeScriptAdapter STILL ran cleanly on the exact same file and extracted computeTotal!
      const tsLog = snapshot.analyzerExecutionLog?.find(
        (l) => l.adapterId === 'adapter.node_typescript'
      );
      assert.ok(tsLog);
      assert.equal(tsLog.status, 'ran');

      assert.ok(
        snapshot.symbols.some(
          (s) =>
            s.name === 'computeTotal' &&
            s.producerId === 'adapter.node_typescript' &&
            s.sourceRef.relativePath === 'src/service.ts'
        ),
        'NodeTypeScriptAdapter must still extract computeTotal despite crashingAdapter failure on the same file'
      );

      // Verify ApiSchemaAdapter is also independently testable without full repository scan
      const apiAdapter = new ApiSchemaAdapter();
      assert.equal(apiAdapter.adapterId, 'adapter.api_schema');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
