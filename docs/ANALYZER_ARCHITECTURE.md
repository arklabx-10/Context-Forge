# ContextForge Extensible Analyzer Architecture & Onboarding Guide

## 1. Philosophy & Two-Tier Guarantee

ContextForge separates repository analysis into two strict layers so that **no language or framework requires a custom parser for the product to work**, while supported ecosystems gain deeper static intelligence:

1. **Tier-0 Universal Structural Layer (`src/infrastructure/scanning/tier0-scanner.ts`)**:
   - Runs unconditionally on every repository.
   - Discovers canonical file inventories, monorepo sub-project boundaries (`apps/*`, `services/*`, `packages/*`, nested manifests), documentation, configuration templates (`.env.example`), lockfiles, API specifications, Git branch/commit/status metadata, and multi-signal language classifications (`filename`, `shebang`, `extension`, `content_signature`).
2. **Tier-1 Optional Pluggable Adapters (`src/adapters/*`)**:
   - Independently testable, stateless, in-process static analyzers implementing [`RepositoryAnalyzerAdapter`](../src/domain/ports.ts).
   - Never execute repository-defined scripts, hooks, compilers, package managers, or external plugins with unrestricted privileges (`executionMode: 'in_process_safe_static'`).
   - Isolated behind per-adapter fault boundaries in [`analyzeRepository`](../src/infrastructure/scanning/repository-analyzer.ts): if one adapter throws or reports partial parse errors on a file, all other adapters continue normally.

---

## 2. Explicit Analyzer Contracts

Every Tier-1 analyzer implements [`RepositoryAnalyzerAdapter`](../src/domain/ports.ts), which unifies six explicit analysis contracts:

| Contract Area | Domain Output Interface | Description |
| :--- | :--- | :--- |
| **1. Language & Framework Detection** | `LanguageAndFrameworkAnalysisOutput` (`languages`, `frameworks`) | Detects languages, runtime frameworks (React, FastAPI, ASP.NET Core, Express, Prisma), and target runtimes. |
| **2. Source Parsing & Symbol Extraction** | `SourceSymbolAnalysisOutput` (`symbols`, `entryPoints`) | Extracts functions, classes, interfaces, structs, enums, types, SQL objects, and application entry points with exact `startLine`–`endLine` `SourceReference` locations. |
| **3. Dependency Extraction** | `DependencyAnalysisOutput` (`dependencyEdges`, `externalDependencies`) | Extracts static file imports (`file_import`), workspace/project references (`subproject_reference`), SQL foreign keys (`sql_foreign_key`), table mutations (`sql_table_reference`), migration sequences (`sql_migration_sequence`), and manifest packages. |
| **4. API & Schema Analysis** | `ApiAndSchemaAnalysisOutput` (`apiSurfaces`) | Extracts HTTP REST routes, OpenAPI/Swagger paths, GraphQL `Query`/`Mutation`/`Subscription` fields, and gRPC/Protobuf `service`/`rpc` operations. |
| **5. Database Object Analysis** | `DatabaseObjectAnalysisOutput` (`databaseObjects`) | Extracts dialect-tagged tables, views, routines (`procedure`, `function`, `trigger`), indexes, migrations, and ORM schema models (`Prisma`). |
| **6. Build & Test Metadata Extraction** | `BuildAndTestMetadataAnalysisOutput` (`packageManagers`, `buildSystems`, `testHarnesses`) | Extracts package managers (`npm`, `pnpm`, `Poetry`, `NuGet`, `Cargo`, `Go Modules`), build systems (`tsc`, `Vite`, `MSBuild`, `Docker`, `GNU Make`), and test runners (`Vitest`, `pytest`, `xUnit`). |

### Required Adapter Metadata Declarations

Every adapter class must declare:
- `adapterId`: Unique identifier (e.g., `'adapter.node_typescript'`).
- `displayName` & `description`: Human-readable summary.
- `version`: Semantic version string (e.g., `'1.1.0'`).
- `capabilities`: [`AdapterCapabilities`](../src/domain/ports.ts) boolean flags declaring which of the 6 contracts + diff risk inspection the adapter implements.
- `supportedInputs`: [`SupportedAnalyzerInputs`](../src/domain/ports.ts) listing supported `extensions`, `filenamesOrGlobs`, and `ecosystemsOrDialects`.
- `limitations`: `readonly string[]` documenting static analysis boundaries (e.g., dynamic imports, reflection, macro expansion).
- `requiredResources`: [`AdapterResourceRequirements`](../src/domain/ports.ts) declaring `maxFileSizeBytes`, `requiresSiblingFileIndex`, and `executionMode: 'in_process_safe_static'`.

---

## 3. Built-In Adapters

| Adapter ID | Class | Supported Ecosystems & Dialects |
| :--- | :--- | :--- |
| `adapter.node_typescript` | [`NodeTypeScriptAdapter`](../src/adapters/node-ts-adapter.ts) | Node.js, TypeScript, JavaScript (ESM/CJS), `package.json`, Express/Fastify/Hono routes |
| `adapter.python` | [`PythonAdapter`](../src/adapters/python-adapter.ts) | Python 3.x, `pyproject.toml`, `requirements.txt`, FastAPI/Flask routes |
| `adapter.dotnet` | [`DotNetAdapter`](../src/adapters/dotnet-adapter.ts) | .NET / C#, `.csproj`/`.fsproj`/`.sln`, NuGet, ASP.NET Core Minimal APIs |
| `adapter.go_rust` | [`GoRustAdapter`](../src/adapters/go-rust-adapter.ts) | Go (`go.mod`, `.go`), Rust (`Cargo.toml`, `.rs`) |
| `adapter.sql_migration` | [`SqlMigrationAdapter`](../src/adapters/sql-migration-adapter.ts) | Static SQL scripts across **PostgreSQL**, **MySQL/MariaDB**, **T-SQL (SQL Server)**, **SQLite**, **ANSI SQL**, and **Prisma** (`.prisma`) |
| `adapter.api_schema` | [`ApiSchemaAdapter`](../src/adapters/api-schema-adapter.ts) | OpenAPI 3.x / Swagger 2.0 (`.yaml`, `.json`), GraphQL SDL (`.graphql`, `.gql`), Protocol Buffers (`.proto`) |
| `adapter.polyglot_build` | [`PolyglotBuildAdapter`](../src/adapters/polyglot-build-adapter.ts) | `Dockerfile`, `docker-compose.yml`, `Makefile` |

---

## 4. SQL Dialect Differentiation & Static Database Rules

[`SqlMigrationAdapter`](../src/adapters/sql-migration-adapter.ts) and [`detectSqlDialect`](../src/adapters/sql-migration-adapter.ts) distinguish SQL dialects rather than treating all SQL scripts as interchangeable:

- **PostgreSQL**: Recognizes `SERIAL` / `BIGSERIAL`, `JSONB`, `TIMESTAMPTZ`, `$$` dollar-quoted blocks, `LANGUAGE plpgsql`, `CREATE MATERIALIZED VIEW`, and `CREATE EXTENSION`.
- **T-SQL (SQL Server)**: Recognizes `IDENTITY(seed, increment)`, `NVARCHAR`, `DATETIME2`, `[dbo].[...]` bracketed identifiers, `GO` batch separators, `CREATE OR ALTER PROCEDURE`, and `sp_executesql`.
- **MySQL / MariaDB**: Recognizes `AUTO_INCREMENT`, `ENGINE=InnoDB`, `DELIMITER`, and backtick-quoted column/table definitions.
- **SQLite**: Recognizes `AUTOINCREMENT`, `WITHOUT ROWID`, and `PRAGMA foreign_keys`.
- **Dialect Conflict Detection**: If a single SQL file mixes incompatible dialect constructs (e.g., PostgreSQL `SERIAL`/`$$` alongside MySQL `ENGINE=InnoDB`), the adapter records a dialect conflict warning in `notesOrLimitations`.
- **Zero Live Database Connections**: ContextForge never connects to, queries, or modifies any database instance.

---

## 5. Epistemic Matrix: Statically Verified vs. Inferred vs. Unknown

ContextForge strictly labels every extracted claim with a [`CertaintyLevel`](../src/domain/models.ts) (`verified`, `inferred`, `ai_generated`, or `unknown`) and never fabricates relationships when encountering dynamic or unsupported syntax:

| Relationship / Claim Type | Certainty Level | Evidence & Condition |
| :--- | :--- | :--- |
| Literal ES/CommonJS/Python/Rust module import (`import x from './y'`, `from a import b`, `mod c;`) | **`verified`** | Exact line `SourceReference` in source file; resolved against indexed sibling paths. |
| Manifest package dependency (`package.json`, `pyproject.toml`, `requirements.txt`, `.csproj`, `Cargo.toml`, `go.mod`) | **`verified`** | Exact line `SourceReference` in manifest file. |
| SQL `REFERENCES` / `FOREIGN KEY` constraint & Prisma `@relation` (`sql_foreign_key`) | **`verified`** | Exact line `SourceReference` in `.sql` or `.prisma` file. |
| SQL `ALTER TABLE <target>` statement in migration script (`sql_table_reference`) | **`verified`** | Exact line `SourceReference` linking migration script to mutated table. |
| Sequential SQL migration ordering (`001_init.sql -> 002_orders.sql`, `sql_migration_sequence`) | **`inferred`** | Inferred from lexicographical version prefix ordering of sibling `.sql` migration files in the same directory. |
| Language detection via unambiguous extension, filename, or shebang | **`verified`** | Multi-signal agreement (`extension`, `filename`, `shebang`). |
| Language detection when extension conflicts with shebang (e.g. `.py` file with `#!/usr/bin/env node`) | **`inferred`** | Logged as a conflicting signal in `unknownsAndLimitations` with `certainty: 'inferred'`. |
| Tier-0 entry point discovered purely by filename convention (`main.*`, `server.*`, `index.*`) | **`inferred`** | Heuristic filename match when no manifest or adapter entry point is declared. |
| Dynamic imports (`import(variable)`, `require(expr)`, `importlib.import_module(var)`) | **`unknown` (Omitted)** | Reported in `unknownsAndLimitations` (`notesOrLimitations`); **no dependency edge is invented**. |
| Dynamic SQL (`EXECUTE IMMEDIATE`, `EXECUTE format(...)`, `sp_executesql`) | **`unknown` (Omitted)** | Reported in `unknownsAndLimitations` (`notesOrLimitations`); **no table reference edge is invented**. |
| Malformed manifests (`package.json`, `pyproject.toml`, `.csproj`) or unsupported spec versions (`swagger: "1.2"`) | **`unknown` (Partial)** | Reported in `unknownsAndLimitations` and `analyzerExecutionLog` (`partial_error`); remaining valid files continue to be analyzed. |

---

## 6. Procedure for Introducing a New Analyzer Adapter

To add a new language, framework, schema, or database analyzer safely:

1. **Create the Adapter Class in `src/adapters/<ecosystem>-adapter.ts`**:
   - Implement [`RepositoryAnalyzerAdapter`](../src/domain/ports.ts).
   - Keep the implementation strictly deterministic, stateless, and free of child-process execution or network I/O (`executionMode: 'in_process_safe_static'`).
   - Declare `adapterId`, `displayName`, `description`, `version`, `capabilities`, `supportedInputs`, `limitations`, and `requiredResources`.
2. **Implement `supportsFile(file: IndexedFileRecord): boolean`**:
   - Return `false` immediately if `!file.isIndexed`.
   - Match on normalized lowercase file extension or basename (`path.posix.basename(file.relativePath).toLowerCase()`).
3. **Implement `analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment>`**:
   - Attach `createSourceRef({ repoId, relativePath, fileSha256, startLine, endLine, symbolName, commitSha })` to every extracted symbol, dependency edge, API surface, database object, and framework claim.
   - For malformed files, unsupported versions, or dynamic syntax (reflection, dynamic imports, dynamic SQL), append a descriptive message to `notesOrLimitations` and return partial findings rather than throwing or inventing edges.
4. **Register the Adapter in [`src/adapters/index.ts`](../src/adapters/index.ts)**:
   - Export the class and add an instance to `createDefaultAdapters()`.
5. **Add Representative Fixtures & Unit/Integration Tests**:
   - Test valid extraction, malformed input handling, unsupported versions, dynamic syntax reporting, and fault isolation in `tests/`.
   - Run `npm run typecheck`, `npm test`, and `npm run build`.
