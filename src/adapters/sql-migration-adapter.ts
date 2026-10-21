import path from 'node:path';
import type {
  AdapterAnalysisFragment,
  AdapterDiffContext,
  AdapterFileContext,
  DatabaseObjectDescriptor,
  DependencyEdge,
  EvidenceBackedClaim,
  ExtractedSymbol,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
  ReviewFinding,
  SqlDialectName,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export interface SqlDialectDetectionResult {
  readonly dialect: SqlDialectName;
  readonly matchedSignals: readonly { readonly dialect: SqlDialectName; readonly marker: string }[];
  readonly hasDialectConflict: boolean;
  readonly conflictDescription?: string;
}

/**
 * Detects the SQL dialect of a static SQL script without treating all SQL dialects as interchangeable.
 */
export function detectSqlDialect(content: string): SqlDialectDetectionResult {
  const matchedSignals: { dialect: SqlDialectName; marker: string }[] = [];

  if (/\b(?:BIGSERIAL|SERIAL|JSONB|TIMESTAMPTZ|LANGUAGE\s+plpgsql|CREATE\s+MATERIALIZED\s+VIEW|CREATE\s+EXTENSION)\b/i.test(content) || /\$\$[\s\S]*?\$\$/.test(content)) {
    matchedSignals.push({
      dialect: 'PostgreSQL',
      marker: 'PostgreSQL-specific syntax (SERIAL/JSONB/TIMESTAMPTZ/plpgsql/$$/MATERIALIZED VIEW)',
    });
  }

  if (/\b(?:AUTO_INCREMENT|ENGINE\s*=\s*InnoDB|DELIMITER\s+\S+)\b/i.test(content) || /`[A-Za-z0-9_]+`\s+(?:INT|VARCHAR|BIGINT|DATETIME|TEXT)/i.test(content)) {
    matchedSignals.push({
      dialect: 'MySQL',
      marker: 'MySQL/MariaDB-specific syntax (AUTO_INCREMENT/ENGINE=InnoDB/backtick DDL/DELIMITER)',
    });
  }

  if (/\b(?:IDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)|NVARCHAR\s*\(|DATETIME2|CREATE\s+OR\s+ALTER\s+PROCEDURE|sp_executesql)\b/i.test(content) || /^\s*GO\s*$/im.test(content) || /\[dbo\]\.\[[A-Za-z0-9_]+\]/i.test(content)) {
    matchedSignals.push({
      dialect: 'TSQL',
      marker: 'T-SQL / SQL Server syntax (IDENTITY/NVARCHAR/[dbo]/GO/CREATE OR ALTER/sp_executesql)',
    });
  }

  if (/\b(?:AUTOINCREMENT|WITHOUT\s+ROWID|PRAGMA\s+foreign_keys)\b/i.test(content)) {
    matchedSignals.push({
      dialect: 'SQLite',
      marker: 'SQLite-specific syntax (AUTOINCREMENT/WITHOUT ROWID/PRAGMA)',
    });
  }

  const distinctDialects = Array.from(new Set(matchedSignals.map((m) => m.dialect)));
  if (distinctDialects.length > 1) {
    return {
      dialect: distinctDialects[0]!,
      matchedSignals,
      hasDialectConflict: true,
      conflictDescription: `Conflicting SQL dialect constructs detected in the same script (${distinctDialects.join(' vs. ')}): ${matchedSignals.map((m) => m.marker).join('; ')}.`,
    };
  }

  return {
    dialect: distinctDialects[0] ?? 'AnsiSQL',
    matchedSignals,
    hasDialectConflict: false,
  };
}

export class SqlMigrationAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.sql_migration';
  public readonly displayName = 'SQL Dialect, Schema & Migration Risk Adapter';
  public readonly description =
    'Extracts dialect-specific SQL DDL tables, views, routines (procedures/functions/triggers), indexes, foreign keys, static migration relationships, Prisma models, and destructive diff risks without connecting to live databases.';
  public readonly version = '1.2.0';
  public readonly capabilities = {
    detectsManifests: false,
    detectsLanguagesAndFrameworks: true,
    extractsSymbols: true,
    extractsModuleImports: true,
    detectsEntryPoints: false,
    detectsApiSurfaces: false,
    analyzesSqlObjects: true,
    extractsBuildAndTestMetadata: false,
    inspectsDiffRisks: true,
  } as const;

  public readonly supportedInputs = {
    extensions: ['.sql', '.prisma'],
    filenamesOrGlobs: ['*.sql', 'migrations/*.sql', 'schema.prisma', '*.prisma'],
    ecosystemsOrDialects: ['PostgreSQL', 'MySQL', 'TSQL', 'SQLite', 'AnsiSQL', 'Prisma'],
  } as const;

  public readonly limitations = [
    'Analyzes static SQL and Prisma scripts only; never connects to or queries live databases.',
    'Dynamic SQL strings executed via EXECUTE IMMEDIATE, EXECUTE format(), or sp_executesql cannot be statically resolved to target tables.',
    'Migration execution order is inferred from lexicographical version prefixes when no explicit migration manifest is present.',
  ] as const;

  public readonly requiredResources = {
    maxFileSizeBytes: 1_048_576,
    requiresSiblingFileIndex: true,
    executionMode: 'in_process_safe_static',
  } as const;

  public supportsFile(file: IndexedFileRecord): boolean {
    if (!file.isIndexed) return false;
    const ext = path.posix.extname(file.relativePath).toLowerCase();
    return ext === '.sql' || ext === '.prisma';
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const ext = path.posix.extname(ctx.file.relativePath).toLowerCase();
    if (ext === '.prisma') {
      return this.analyzePrismaSchema(ctx);
    }
    return this.analyzeSqlFile(ctx);
  }

  private analyzeSqlFile(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const databaseObjects: EvidenceBackedClaim<DatabaseObjectDescriptor>[] = [];
    const symbols: ExtractedSymbol[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];
    const notesOrLimitations: string[] = [];

    const dialectInfo = detectSqlDialect(ctx.content);
    if (dialectInfo.hasDialectConflict && dialectInfo.conflictDescription) {
      notesOrLimitations.push(
        `${ctx.file.relativePath}: ${dialectInfo.conflictDescription}`
      );
    }

    // Check if this SQL script is a versioned migration file and link sequential migrations
    const migrationPrefixMatch = /^(?:V|U)?(\d{1,14})[_-]/i.exec(
      path.posix.basename(ctx.file.relativePath)
    );
    const isMigrationFile =
      Boolean(migrationPrefixMatch) ||
      ctx.file.relativePath.toLowerCase().includes('migration');

    if (isMigrationFile) {
      const migRef = createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.file.relativePath,
        fileSha256: ctx.file.sha256,
        startLine: 1,
        endLine: Math.max(1, ctx.lines.length),
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });
      databaseObjects.push({
        id: `dbobj:migration:${ctx.file.relativePath}`,
        value: {
          objectType: 'migration',
          name: path.posix.basename(ctx.file.relativePath),
          dialectHint: dialectInfo.dialect,
        },
        certainty: 'verified',
        evidence: [migRef],
        rationale: `Static database migration script ${ctx.file.relativePath} (detected dialect: ${dialectInfo.dialect}).`,
        producerId: this.adapterId,
      });

      // Infer migration sequence edge from immediately preceding numbered migration in the same directory
      const dir = path.posix.dirname(ctx.file.relativePath);
      const siblingMigrations = ctx.siblingFilePaths
        .filter(
          (p) =>
            path.posix.dirname(p) === dir &&
            path.posix.extname(p).toLowerCase() === '.sql' &&
            /^(?:V|U)?(\d{1,14})[_-]/i.test(path.posix.basename(p))
        )
        .sort((a, b) => a.localeCompare(b));
      const idx = siblingMigrations.indexOf(ctx.file.relativePath);
      if (idx > 0) {
        const prevMigration = siblingMigrations[idx - 1]!;
        dependencyEdges.push({
          id: `edge:sqlmigseq:${prevMigration}->${ctx.file.relativePath}`,
          value: {
            fromPathOrModule: ctx.file.relativePath,
            toPathOrModule: prevMigration,
            kind: 'sql_migration_sequence',
          },
          certainty: 'inferred',
          evidence: [migRef],
          rationale: `Inferred sequential migration dependency: "${ctx.file.relativePath}" follows "${prevMigration}" by version prefix in "${dir || '.'}".`,
          producerId: this.adapterId,
        });
      }
    }

    const cleanIdentifier = (raw: string): string =>
      raw
        .replace(/["`[\]]/g, '')
        .replace(/^(?:dbo|public)\./i, '')
        .trim();

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;

      // Detect dynamic SQL constructs that cannot be statically resolved
      if (
        /\b(?:EXECUTE\s+IMMEDIATE|EXECUTE\s+format\s*\(|sp_executesql\b|PREPARE\s+[A-Za-z0-9_]+\s+FROM\s+@)/i.test(
          line
        )
      ) {
        notesOrLimitations.push(
          `Dynamic SQL execution detected at ${ctx.file.relativePath}:${lineNum} ("${line.trim().slice(0, 80)}"); target tables/columns cannot be statically verified and were not fabricated.`
        );
      }

      // Detect ALTER TABLE relationships (e.g. migration modifying an existing table or adding FK)
      const alterMatch =
        /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(
          line
        );
      if (alterMatch?.[1]) {
        const alteredTable = cleanIdentifier(alterMatch[1]);
        const alterRef = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: alteredTable,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        dependencyEdges.push({
          id: `edge:sqlalter:${ctx.file.relativePath}:${lineNum}:${alteredTable}`,
          value: {
            fromPathOrModule: ctx.file.relativePath,
            toPathOrModule: alteredTable,
            kind: 'sql_table_reference',
          },
          certainty: 'verified',
          evidence: [alterRef],
          rationale: `SQL ALTER TABLE statement modifies table "${alteredTable}" at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });

        const inlineAlterFk = /REFERENCES\s+([A-Za-z0-9_."`[\]]+)/i.exec(line);
        if (inlineAlterFk?.[1]) {
          const refTable = cleanIdentifier(inlineAlterFk[1]);
          dependencyEdges.push({
            id: `edge:sqlfk:${ctx.file.relativePath}:${lineNum}:${alteredTable}->${refTable}`,
            value: {
              fromPathOrModule: alteredTable,
              toPathOrModule: refTable,
              kind: 'sql_foreign_key',
            },
            certainty: 'verified',
            evidence: [alterRef],
            rationale: `SQL ALTER TABLE foreign key from "${alteredTable}" to "${refTable}" at ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }

      const createMatch =
        /^\s*CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:TEMP(?:ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)?(TABLE|VIEW|INDEX|PROCEDURE|FUNCTION|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(
          line
        );

      if (createMatch?.[1] && createMatch?.[2]) {
        const rawType = createMatch[1].toLowerCase();
        const cleanName = cleanIdentifier(createMatch[2]);
        const objType: DatabaseObjectDescriptor['objectType'] =
          rawType === 'table'
            ? 'table'
            : rawType === 'view'
              ? 'view'
              : rawType === 'index'
                ? 'index'
                : rawType === 'function'
                  ? 'function'
                  : rawType === 'trigger'
                    ? 'trigger'
                    : 'procedure';

        const columns: string[] = [];
        let endLine = lineNum;
        if (objType === 'table') {
          for (let j = i + 1; j < Math.min(ctx.lines.length, i + 55); j += 1) {
            const colLine = (ctx.lines[j] ?? '').trim();
            if (colLine.startsWith(')')) {
              endLine = j + 1;
              break;
            }
            const colMatch =
              /^["`[]?([a-zA-Z_][a-zA-Z0-9_]*)["`\]]?\s+[A-Za-z]+/.exec(colLine);
            if (
              colMatch?.[1] &&
              !['primary', 'foreign', 'constraint', 'unique', 'check', 'index'].includes(
                colMatch[1].toLowerCase()
              )
            ) {
              columns.push(colMatch[1]);
            }
            const fkMatch = /REFERENCES\s+([A-Za-z0-9_."`[\]]+)/i.exec(colLine);
            if (fkMatch?.[1]) {
              const targetTable = cleanIdentifier(fkMatch[1]);
              const fkRef = createSourceRef({
                repoId: ctx.repoId,
                relativePath: ctx.file.relativePath,
                fileSha256: ctx.file.sha256,
                startLine: j + 1,
                endLine: j + 1,
                ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
              });
              dependencyEdges.push({
                id: `edge:sqlfk:${ctx.file.relativePath}:${j + 1}:${cleanName}->${targetTable}`,
                value: {
                  fromPathOrModule: cleanName,
                  toPathOrModule: targetTable,
                  kind: 'sql_foreign_key',
                },
                certainty: 'verified',
                evidence: [fkRef],
                rationale: `SQL REFERENCES foreign key from "${cleanName}" to "${targetTable}" at ${ctx.file.relativePath}:${j + 1}.`,
                producerId: this.adapterId,
              });
            }
          }
        }

        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine,
          symbolName: cleanName,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });

        databaseObjects.push({
          id: `dbobj:${ctx.file.relativePath}:${lineNum}:${cleanName}`,
          value: {
            objectType: objType,
            name: cleanName,
            dialectHint: dialectInfo.dialect,
            ...(columns.length > 0 ? { columnsOrFields: columns } : {}),
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `SQL DDL "CREATE ${rawType.toUpperCase()} ${cleanName}" (${dialectInfo.dialect}) at ${ctx.file.relativePath}:${lineNum}-${endLine}.`,
          producerId: this.adapterId,
        });

        symbols.push({
          name: cleanName,
          kind:
            objType === 'table'
              ? 'sql_table'
              : objType === 'view'
                ? 'sql_view'
                : objType === 'index'
                  ? 'sql_index'
                  : 'function',
          exported: true,
          signature: line.trim().slice(0, 120),
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }
    }

    return {
      databaseObjects,
      symbols,
      dependencyEdges,
      ...(notesOrLimitations.length > 0 ? { notesOrLimitations } : {}),
    };
  }

  private analyzePrismaSchema(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const databaseObjects: EvidenceBackedClaim<DatabaseObjectDescriptor>[] = [];
    const symbols: ExtractedSymbol[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];

    let currentModel: string | null = null;
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const trimmed = line.trim();
      if (trimmed === '}') {
        currentModel = null;
        continue;
      }

      const match = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
      if (match?.[1]) {
        const modelName = match[1];
        currentModel = modelName;
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: i + 1,
          endLine: i + 1,
          symbolName: modelName,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        databaseObjects.push({
          id: `dbobj:${ctx.file.relativePath}:${i + 1}:${modelName}`,
          value: {
            objectType: 'schema_model',
            name: modelName,
            dialectHint: 'Prisma',
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `Prisma schema model "${modelName}" at ${ctx.file.relativePath}:${i + 1}.`,
          producerId: this.adapterId,
        });
        symbols.push({
          name: modelName,
          kind: 'sql_table',
          exported: true,
          signature: `model ${modelName}`,
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
        continue;
      }

      if (currentModel && trimmed.includes('@relation')) {
        const relFieldMatch = /^\s*[A-Za-z_][A-Za-z0-9_]*\s+([A-Z][A-Za-z0-9_]*)\??\s+@relation/.exec(
          line
        );
        if (relFieldMatch?.[1]) {
          const targetModel = relFieldMatch[1];
          const relRef = createSourceRef({
            repoId: ctx.repoId,
            relativePath: ctx.file.relativePath,
            fileSha256: ctx.file.sha256,
            startLine: i + 1,
            endLine: i + 1,
            ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
          });
          dependencyEdges.push({
            id: `edge:prismafk:${ctx.file.relativePath}:${i + 1}:${currentModel}->${targetModel}`,
            value: {
              fromPathOrModule: currentModel,
              toPathOrModule: targetModel,
              kind: 'sql_foreign_key',
            },
            certainty: 'verified',
            evidence: [relRef],
            rationale: `Prisma @relation from model "${currentModel}" to "${targetModel}" at ${ctx.file.relativePath}:${i + 1}.`,
            producerId: this.adapterId,
          });
        }
      }
    }

    return { databaseObjects, symbols, dependencyEdges };
  }

  public async inspectFileDiff(ctx: AdapterDiffContext): Promise<readonly ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const added of ctx.diff.addedLines) {
      const lineText = added.content.trim();
      if (!lineText || lineText.startsWith('--')) continue;

      const ref = createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.diff.relativePath,
        fileSha256: ctx.currentFileSha256,
        startLine: added.lineNumber,
        endLine: added.lineNumber,
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });

      // 1. Destructive DROP TABLE / TRUNCATE TABLE
      if (/\b(?:DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i.test(lineText)) {
        findings.push({
          id: `sqlrisk:drop_table:${ctx.diff.relativePath}:${added.lineNumber}`,
          severity: 'critical',
          category: 'risky_sql_operation',
          title: `Destructive SQL statement in ${ctx.diff.relativePath}:${added.lineNumber}`,
          description: `Line ${added.lineNumber} introduces "${lineText.slice(0, 100)}", which permanently destroys table data and breaks dependent queries if deployed without a staged deprecation window.`,
          certainty: 'verified',
          producerId: this.adapterId,
          evidence: [ref],
          impactedPaths: [ctx.diff.relativePath],
          remediationHint:
            'Verify backups, ensure application code no longer reads from the table, and consider a expand-contract migration pattern.',
        });
      }

      // 2. Destructive ALTER TABLE ... DROP COLUMN
      if (/\bDROP\s+COLUMN\b/i.test(lineText)) {
        findings.push({
          id: `sqlrisk:drop_column:${ctx.diff.relativePath}:${added.lineNumber}`,
          severity: 'warning',
          category: 'risky_sql_operation',
          title: `SQL column removal in ${ctx.diff.relativePath}:${added.lineNumber}`,
          description: `Line ${added.lineNumber} drops a column ("${lineText.slice(0, 100)}"), which can cause runtime query failures during rolling deployments.`,
          certainty: 'verified',
          producerId: this.adapterId,
          evidence: [ref],
          impactedPaths: [ctx.diff.relativePath],
          remediationHint:
            'Ensure all running service instances stop selecting this column in a prior release before dropping it.',
        });
      }

      // 3. Unbounded DELETE FROM or UPDATE without WHERE on a single-line statement
      if (
        /^\s*DELETE\s+FROM\s+[A-Za-z0-9_."`]+\s*;/i.test(lineText) ||
        (/^\s*UPDATE\s+[A-Za-z0-9_."`]+\s+SET\s+.*;/i.test(lineText) && !/\bWHERE\b/i.test(lineText))
      ) {
        findings.push({
          id: `sqlrisk:unbounded_dml:${ctx.diff.relativePath}:${added.lineNumber}`,
          severity: 'critical',
          category: 'risky_sql_operation',
          title: `Unbounded SQL DELETE/UPDATE without WHERE clause in ${ctx.diff.relativePath}:${added.lineNumber}`,
          description: `Statement "${lineText.slice(0, 100)}" modifies or deletes all rows in the target table without a WHERE filter.`,
          certainty: 'verified',
          producerId: this.adapterId,
          evidence: [ref],
          impactedPaths: [ctx.diff.relativePath],
          remediationHint: 'Add an explicit WHERE predicate or confirm full-table mutation is intentional.',
        });
      }

      // 4. Adding a NOT NULL column without DEFAULT
      if (
        /\bADD\s+(?:COLUMN\s+)?[A-Za-z0-9_."`]+\s+[A-Za-z0-9()]+\s+NOT\s+NULL\b/i.test(lineText) &&
        !/\bDEFAULT\b/i.test(lineText)
      ) {
        findings.push({
          id: `sqlrisk:notnull_no_default:${ctx.diff.relativePath}:${added.lineNumber}`,
          severity: 'warning',
          category: 'risky_sql_operation',
          title: `NOT NULL column added without DEFAULT in ${ctx.diff.relativePath}:${added.lineNumber}`,
          description: `Adding a NOT NULL column without a DEFAULT value ("${lineText.slice(0, 100)}") will fail on non-empty tables in production.`,
          certainty: 'verified',
          producerId: this.adapterId,
          evidence: [ref],
          impactedPaths: [ctx.diff.relativePath],
          remediationHint: 'Provide a DEFAULT value or add the column as nullable, backfill, and then set NOT NULL.',
        });
      }
    }

    return findings;
  }
}
