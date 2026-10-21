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
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export class SqlMigrationAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.sql_migration';
  public readonly displayName = 'SQL Schema & Migration Risk Adapter';
  public readonly description =
    'Extracts SQL DDL tables, views, indexes, foreign keys, Prisma models, and inspects diffs for destructive SQL operations.';
  public readonly version = '1.0.0';
  public readonly capabilities = {
    detectsManifests: false,
    extractsSymbols: true,
    extractsModuleImports: true,
    detectsEntryPoints: false,
    detectsApiSurfaces: false,
    analyzesSqlObjects: true,
    inspectsDiffRisks: true,
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

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;

      const createMatch =
        /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)?(TABLE|VIEW|INDEX|PROCEDURE|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(
          line
        );

      if (createMatch?.[1] && createMatch?.[2]) {
        const rawType = createMatch[1].toLowerCase();
        const cleanName = createMatch[2].replace(/["`[\]]/g, '');
        const objType: DatabaseObjectDescriptor['objectType'] =
          rawType === 'table'
            ? 'table'
            : rawType === 'view'
              ? 'view'
              : rawType === 'index'
                ? 'index'
                : 'procedure';

        // Collect column names if CREATE TABLE
        const columns: string[] = [];
        let endLine = lineNum;
        if (objType === 'table') {
          for (let j = i + 1; j < Math.min(ctx.lines.length, i + 45); j += 1) {
            const colLine = (ctx.lines[j] ?? '').trim();
            if (colLine.startsWith(')')) {
              endLine = j + 1;
              break;
            }
            const colMatch = /^["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?\s+[A-Za-z]+/.exec(colLine);
            if (
              colMatch?.[1] &&
              !['primary', 'foreign', 'constraint', 'unique', 'check', 'index'].includes(
                colMatch[1].toLowerCase()
              )
            ) {
              columns.push(colMatch[1]);
            }
            const fkMatch = /REFERENCES\s+([A-Za-z0-9_."`]+)/i.exec(colLine);
            if (fkMatch?.[1]) {
              const targetTable = fkMatch[1].replace(/["`]/g, '');
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
            ...(columns.length > 0 ? { columnsOrFields: columns } : {}),
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `SQL DDL "CREATE ${rawType.toUpperCase()} ${cleanName}" at ${ctx.file.relativePath}:${lineNum}-${endLine}.`,
          producerId: this.adapterId,
        });

        symbols.push({
          name: cleanName,
          kind: objType === 'table' ? 'sql_table' : objType === 'view' ? 'sql_view' : 'sql_index',
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
    };
  }

  private analyzePrismaSchema(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const databaseObjects: EvidenceBackedClaim<DatabaseObjectDescriptor>[] = [];
    const symbols: ExtractedSymbol[] = [];

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const match = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
      if (match?.[1]) {
        const modelName = match[1];
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
      }
    }

    return { databaseObjects, symbols };
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
