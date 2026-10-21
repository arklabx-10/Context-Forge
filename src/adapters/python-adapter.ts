import path from 'node:path';
import type {
  AdapterAnalysisFragment,
  AdapterFileContext,
  ApiSurfaceDescriptor,
  DependencyEdge,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExternalDependency,
  ExtractedSymbol,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export class PythonAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.python';
  public readonly displayName = 'Python & PyProject Adapter';
  public readonly description =
    'Analyzes pyproject.toml, requirements.txt, Python classes/functions, module imports, and FastAPI/Flask endpoints.';
  public readonly version = '1.0.0';
  public readonly capabilities = {
    detectsManifests: true,
    extractsSymbols: true,
    extractsModuleImports: true,
    detectsEntryPoints: true,
    detectsApiSurfaces: true,
    analyzesSqlObjects: false,
    inspectsDiffRisks: false,
  } as const;

  public supportsFile(file: IndexedFileRecord): boolean {
    if (!file.isIndexed) return false;
    const base = path.posix.basename(file.relativePath).toLowerCase();
    return (
      base === 'pyproject.toml' ||
      base === 'requirements.txt' ||
      path.posix.extname(base) === '.py'
    );
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const base = path.posix.basename(ctx.file.relativePath).toLowerCase();
    if (base === 'requirements.txt') {
      return this.analyzeRequirementsTxt(ctx);
    }
    if (base === 'pyproject.toml') {
      return this.analyzePyprojectToml(ctx);
    }
    return this.analyzePythonSource(ctx);
  }

  private analyzeRequirementsTxt(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    const frameworks: EvidenceBackedClaim<string>[] = [];
    const testHarnesses: EvidenceBackedClaim<string>[] = [];

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const raw = (ctx.lines[i] ?? '').trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('-')) continue;

      const match = /^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/.exec(raw);
      if (!match?.[1]) continue;

      const pkgName = match[1].toLowerCase();
      const versionConstraint = (match[2] ?? '*').trim();
      const ref = createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.file.relativePath,
        fileSha256: ctx.file.sha256,
        startLine: i + 1,
        endLine: i + 1,
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });

      externalDependencies.push({
        id: `extdep:${ctx.subProjectId}:${pkgName}`,
        value: {
          subProjectId: ctx.subProjectId,
          name: pkgName,
          versionConstraint,
          scope: 'runtime',
          ecosystem: 'pypi',
        },
        certainty: 'verified',
        evidence: [ref],
        rationale: `Specified on line ${i + 1} of ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });

      this.detectPythonEcosystemSignals(pkgName, ref, ctx.subProjectId, frameworks, testHarnesses);
    }

    return {
      packageManagers: [
        {
          id: `pm:${ctx.subProjectId}:pip`,
          value: 'pip',
          certainty: 'verified',
          evidence: [
            createSourceRef({
              repoId: ctx.repoId,
              relativePath: ctx.file.relativePath,
              fileSha256: ctx.file.sha256,
              startLine: 1,
              endLine: 1,
            }),
          ],
          rationale: `Detected pip manifest ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        },
      ],
      externalDependencies,
      frameworks,
      testHarnesses,
    };
  }

  private analyzePyprojectToml(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    const frameworks: EvidenceBackedClaim<string>[] = [];
    const testHarnesses: EvidenceBackedClaim<string>[] = [];
    const packageManagers: EvidenceBackedClaim<string>[] = [];
    const notesOrLimitations: string[] = [];

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = (ctx.lines[i] ?? '').trim();
      if (line.startsWith('[') && !line.endsWith(']')) {
        notesOrLimitations.push(
          `Malformed TOML section header in ${ctx.file.relativePath}:${i + 1} ("${line.slice(0, 60)}").`
        );
        continue;
      }
      const ref = createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.file.relativePath,
        fileSha256: ctx.file.sha256,
        startLine: i + 1,
        endLine: i + 1,
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });

      if (line.includes('[tool.poetry]')) {
        packageManagers.push({
          id: `pm:${ctx.subProjectId}:poetry`,
          value: 'Poetry',
          certainty: 'verified',
          evidence: [ref],
          rationale: `[tool.poetry] section found in ${ctx.file.relativePath}:${i + 1}.`,
          producerId: this.adapterId,
        });
      } else if (line.includes('[project]')) {
        packageManagers.push({
          id: `pm:${ctx.subProjectId}:pep621`,
          value: 'PEP 621 / pyproject',
          certainty: 'verified',
          evidence: [ref],
          rationale: `[project] table found in ${ctx.file.relativePath}:${i + 1}.`,
          producerId: this.adapterId,
        });
      }

      // Match dependency strings like "fastapi>=0.110.0" or fastapi = "^0.110.0"
      const quotedDep = /^["']([A-Za-z0-9_.-]+)\s*([<>=!~^][^"']*)?["']\s*,?$/.exec(line);
      const kvDep = /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']$/.exec(line);
      const pkg = (quotedDep?.[1] ?? (kvDep?.[1] && !['name', 'version', 'description', 'readme', 'python', 'requires-python'].includes(kvDep[1].toLowerCase()) ? kvDep[1] : undefined))?.toLowerCase();
      const ver = (quotedDep?.[2] ?? kvDep?.[2] ?? '*').trim();
      if (pkg) {
        externalDependencies.push({
          id: `extdep:${ctx.subProjectId}:${pkg}`,
          value: {
            subProjectId: ctx.subProjectId,
            name: pkg,
            versionConstraint: ver,
            scope: 'runtime',
            ecosystem: 'pypi',
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `Declared in ${ctx.file.relativePath}:${i + 1}.`,
          producerId: this.adapterId,
        });
        this.detectPythonEcosystemSignals(pkg, ref, ctx.subProjectId, frameworks, testHarnesses);
      }
    }

    return {
      packageManagers,
      externalDependencies,
      frameworks,
      testHarnesses,
      ...(notesOrLimitations.length > 0 ? { notesOrLimitations } : {}),
    };
  }

  private detectPythonEcosystemSignals(
    pkgName: string,
    ref: ReturnType<typeof createSourceRef>,
    subProjectId: string,
    frameworks: EvidenceBackedClaim<string>[],
    testHarnesses: EvidenceBackedClaim<string>[]
  ): void {
    const fwMap: Readonly<Record<string, string>> = {
      fastapi: 'FastAPI',
      flask: 'Flask',
      django: 'Django',
      sqlalchemy: 'SQLAlchemy',
      alembic: 'Alembic',
      pydantic: 'Pydantic',
      celery: 'Celery',
    };
    if (fwMap[pkgName]) {
      frameworks.push({
        id: `fw:${subProjectId}:${fwMap[pkgName]}`,
        value: fwMap[pkgName]!,
        certainty: 'verified',
        evidence: [ref],
        rationale: `Python package "${pkgName}" declared in manifest.`,
        producerId: this.adapterId,
      });
    }
    if (pkgName === 'pytest') {
      testHarnesses.push({
        id: `test:${subProjectId}:pytest`,
        value: 'pytest',
        certainty: 'verified',
        evidence: [ref],
        rationale: `Python test runner "pytest" declared in manifest.`,
        producerId: this.adapterId,
      });
    }
  }

  private analyzePythonSource(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const symbols: ExtractedSymbol[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];
    const apiSurfaces: EvidenceBackedClaim<ApiSurfaceDescriptor>[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const makeRef = (symbolName?: string) =>
        createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          ...(symbolName ? { symbolName } : {}),
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });

      // 1. Python function / class definitions
      const defMatch = /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (defMatch?.[1]) {
        symbols.push({
          name: defMatch[1],
          kind: 'function',
          exported: !defMatch[1].startsWith('_'),
          signature: line.trim().replace(/:$/, '').slice(0, 120),
          sourceRef: makeRef(defMatch[1]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const classMatch = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (classMatch?.[1]) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          exported: !classMatch[1].startsWith('_'),
          signature: line.trim().replace(/:$/, '').slice(0, 120),
          sourceRef: makeRef(classMatch[1]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      // 2. Python imports
      const fromImportMatch = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_.*, ]+)/.exec(line);
      if (fromImportMatch?.[1]) {
        const modSpec = fromImportMatch[1];
        const resolved = this.resolvePythonImport(modSpec, ctx.subProjectRootPath, ctx.siblingFilePaths);
        dependencyEdges.push({
          id: `edge:${ctx.file.relativePath}:${lineNum}:${resolved}`,
          value: {
            fromPathOrModule: ctx.file.relativePath,
            toPathOrModule: resolved,
            kind: resolved.endsWith('.py') ? 'file_import' : 'subproject_reference',
            rawSpecifier: modSpec,
          },
          certainty: 'verified',
          evidence: [makeRef()],
          rationale: `Python import "from ${modSpec} import ..." at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      // 3. FastAPI / Flask decorators
      const routeMatch =
        /^\s*@(?:app|router|bp|blueprint)\.(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/i.exec(
          line
        );
      if (routeMatch?.[1] && routeMatch?.[2]) {
        const method = routeMatch[1].toUpperCase();
        const routePath = routeMatch[2];
        apiSurfaces.push({
          id: `api:${ctx.file.relativePath}:${lineNum}:${method}:${routePath}`,
          value: {
            protocol: 'http_rest',
            methodOrOperation: method,
            routeOrSignature: routePath,
          },
          certainty: 'verified',
          evidence: [makeRef(`${method} ${routePath}`)],
          rationale: `Python route decorator @...${routeMatch[1]}("${routePath}") at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      // 4. __main__ block
      if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(line)) {
        entryPoints.push({
          id: `ep:${ctx.file.relativePath}:${lineNum}`,
          value: {
            kind: 'main_function',
            identifier: ctx.file.relativePath,
            runtimeCommandHint: `python ${ctx.file.relativePath}`,
          },
          certainty: 'verified',
          evidence: [makeRef('__main__')],
          rationale: `Python __main__ execution guard at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }
    }

    return {
      symbols,
      dependencyEdges,
      apiSurfaces,
      entryPoints,
    };
  }

  private resolvePythonImport(
    modSpec: string,
    subProjectRoot: string,
    siblingPaths: readonly string[]
  ): string {
    const cleanMod = modSpec.replace(/^\.+/, '').replace(/\./g, '/');
    if (!cleanMod) return modSpec;
    const prefix = subProjectRoot ? `${subProjectRoot}/` : '';
    const candidates = [
      `${prefix}${cleanMod}.py`,
      `${prefix}src/${cleanMod}.py`,
      `${prefix}${cleanMod}/__init__.py`,
      `${cleanMod}.py`,
    ];
    const set = new Set(siblingPaths);
    for (const c of candidates) {
      if (set.has(c)) return c;
    }
    return modSpec;
  }
}
