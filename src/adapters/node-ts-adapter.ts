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

export class NodeTypeScriptAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.node_typescript';
  public readonly displayName = 'Node.js / TypeScript / JavaScript Adapter';
  public readonly description =
    'Analyzes package.json manifests, workspaces, TS/JS symbols, module imports, and HTTP/RPC routes.';
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
    if (base === 'package.json') return true;
    const ext = path.posix.extname(base);
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const base = path.posix.basename(ctx.file.relativePath).toLowerCase();
    if (base === 'package.json') {
      return this.analyzePackageJson(ctx);
    }
    return this.analyzeJsTsSource(ctx);
  }

  private analyzePackageJson(ctx: AdapterFileContext): AdapterAnalysisFragment {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ctx.content) as Record<string, unknown>;
    } catch {
      return {
        notesOrLimitations: [`Malformed JSON in ${ctx.file.relativePath}`],
      };
    }

    const findLine = (needle: string): number => {
      const idx = ctx.lines.findIndex((l) => l.includes(`"${needle}"`));
      return idx >= 0 ? idx + 1 : 1;
    };

    const makeRef = (needle: string) => {
      const line = findLine(needle);
      return createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.file.relativePath,
        fileSha256: ctx.file.sha256,
        startLine: line,
        endLine: line,
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });
    };

    const frameworks: EvidenceBackedClaim<string>[] = [];
    const packageManagers: EvidenceBackedClaim<string>[] = [];
    const buildSystems: EvidenceBackedClaim<string>[] = [];
    const testHarnesses: EvidenceBackedClaim<string>[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];

    // Package manager detection
    if (typeof parsed.packageManager === 'string') {
      const pmName = parsed.packageManager.split('@')[0] ?? parsed.packageManager;
      packageManagers.push({
        id: `pm:${ctx.file.relativePath}:${pmName}`,
        value: pmName,
        certainty: 'verified',
        evidence: [makeRef('packageManager')],
        rationale: `Declared in package.json "packageManager": "${parsed.packageManager}".`,
        producerId: this.adapterId,
      });
    } else {
      packageManagers.push({
        id: `pm:${ctx.file.relativePath}:npm`,
        value: 'npm / Node Package Manager',
        certainty: 'inferred',
        evidence: [makeRef('name')],
        rationale: `Inferred from presence of ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });
    }

    const depSections: { key: string; scope: ExternalDependency['scope'] }[] = [
      { key: 'dependencies', scope: 'runtime' },
      { key: 'devDependencies', scope: 'development' },
      { key: 'peerDependencies', scope: 'peer' },
    ];

    const allDepNames = new Set<string>();

    for (const section of depSections) {
      const depsObj = parsed[section.key];
      if (depsObj && typeof depsObj === 'object' && !Array.isArray(depsObj)) {
        for (const [depName, versionVal] of Object.entries(depsObj as Record<string, unknown>)) {
          const versionConstraint = typeof versionVal === 'string' ? versionVal : '*';
          allDepNames.add(depName);
          const ref = makeRef(depName);

          externalDependencies.push({
            id: `extdep:${ctx.subProjectId}:${depName}`,
            value: {
              subProjectId: ctx.subProjectId,
              name: depName,
              versionConstraint,
              scope: section.scope,
              ecosystem: 'npm',
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `Declared in ${ctx.file.relativePath} under "${section.key}".`,
            producerId: this.adapterId,
          });

          if (versionConstraint.startsWith('workspace:')) {
            dependencyEdges.push({
              id: `edge:ws:${ctx.file.relativePath}:${depName}`,
              value: {
                fromPathOrModule: ctx.subProjectRootPath || '.',
                toPathOrModule: depName,
                kind: 'subproject_reference',
                rawSpecifier: versionConstraint,
              },
              certainty: 'verified',
              evidence: [ref],
              rationale: `Workspace dependency reference to "${depName}" in ${ctx.file.relativePath}.`,
              producerId: this.adapterId,
            });
          }
        }
      }
    }

    // Known Frameworks, Build Systems & Test Harnesses
    const frameworkChecks: [string, string][] = [
      ['next', 'Next.js'],
      ['react', 'React'],
      ['vue', 'Vue.js'],
      ['@angular/core', 'Angular'],
      ['svelte', 'Svelte'],
      ['express', 'Express'],
      ['fastify', 'Fastify'],
      ['@nestjs/core', 'NestJS'],
      ['hono', 'Hono'],
      ['koa', 'Koa'],
      ['prisma', 'Prisma'],
      ['drizzle-orm', 'Drizzle ORM'],
    ];
    for (const [pkg, label] of frameworkChecks) {
      if (allDepNames.has(pkg)) {
        frameworks.push({
          id: `fw:${ctx.subProjectId}:${label}`,
          value: label,
          certainty: 'verified',
          evidence: [makeRef(pkg)],
          rationale: `Package "${pkg}" is declared in ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        });
      }
    }

    const buildChecks: [string, string][] = [
      ['typescript', 'TypeScript Compiler (tsc)'],
      ['vite', 'Vite'],
      ['webpack', 'Webpack'],
      ['esbuild', 'esbuild'],
      ['turbo', 'Turborepo'],
      ['tsup', 'tsup'],
    ];
    for (const [pkg, label] of buildChecks) {
      if (allDepNames.has(pkg)) {
        buildSystems.push({
          id: `build:${ctx.subProjectId}:${label}`,
          value: label,
          certainty: 'verified',
          evidence: [makeRef(pkg)],
          rationale: `Build tool "${pkg}" is declared in ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        });
      }
    }

    const testChecks: [string, string][] = [
      ['vitest', 'Vitest'],
      ['jest', 'Jest'],
      ['@playwright/test', 'Playwright'],
      ['cypress', 'Cypress'],
      ['mocha', 'Mocha'],
    ];
    for (const [pkg, label] of testChecks) {
      if (allDepNames.has(pkg)) {
        testHarnesses.push({
          id: `test:${ctx.subProjectId}:${label}`,
          value: label,
          certainty: 'verified',
          evidence: [makeRef(pkg)],
          rationale: `Test runner "${pkg}" is declared in ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        });
      }
    }

    // Entry point detection from main, module, bin, scripts
    if (typeof parsed.main === 'string' && parsed.main.trim()) {
      const target = path.posix.join(ctx.subProjectRootPath, parsed.main.replace(/^\.\//, ''));
      entryPoints.push({
        id: `ep:${ctx.file.relativePath}:main`,
        value: {
          kind: 'library_export',
          identifier: target,
        },
        certainty: 'verified',
        evidence: [makeRef('main')],
        rationale: `Declared as "main" entry in ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });
    }

    if (parsed.scripts && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)) {
      const scripts = parsed.scripts as Record<string, unknown>;
      for (const [scriptName, scriptCmd] of Object.entries(scripts)) {
        if (typeof scriptCmd === 'string' && ['start', 'dev', 'serve', 'dev:server'].includes(scriptName)) {
          entryPoints.push({
            id: `ep:${ctx.file.relativePath}:script:${scriptName}`,
            value: {
              kind: 'script',
              identifier: `npm run ${scriptName}`,
              runtimeCommandHint: scriptCmd,
            },
            certainty: 'verified',
            evidence: [makeRef(scriptName)],
            rationale: `Executable script "${scriptName}": "${scriptCmd}" in ${ctx.file.relativePath}.`,
            producerId: this.adapterId,
          });
        }
      }
    }

    return {
      ...(typeof parsed.name === 'string' ? { subProjectNameHint: parsed.name } : {}),
      ...(parsed.workspaces ? { subProjectKindHint: 'workspace_root' as const } : {}),
      frameworks,
      packageManagers,
      buildSystems,
      testHarnesses,
      entryPoints,
      externalDependencies,
      dependencyEdges,
    };
  }

  private analyzeJsTsSource(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const symbols: ExtractedSymbol[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];
    const apiSurfaces: EvidenceBackedClaim<ApiSurfaceDescriptor>[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];

    const dir = path.posix.dirname(ctx.file.relativePath);

    // Scan line by line for symbols, imports, and HTTP route declarations
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;

      const makeLineRef = (symbolName?: string) =>
        createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          ...(symbolName ? { symbolName } : {}),
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });

      // 1. ES Module import / export from / CommonJS require
      const importMatch =
        /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/.exec(
          line
        );
      const rawSpec = importMatch?.[1] ?? importMatch?.[2];
      if (rawSpec) {
        let resolvedTarget = rawSpec;
        if (rawSpec.startsWith('.')) {
          const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, rawSpec));
          resolvedTarget = this.resolveRelativeModulePath(joined, ctx.siblingFilePaths);
        }
        dependencyEdges.push({
          id: `edge:${ctx.file.relativePath}:${lineNum}:${resolvedTarget}`,
          value: {
            fromPathOrModule: ctx.file.relativePath,
            toPathOrModule: resolvedTarget,
            kind: rawSpec.startsWith('.') ? 'file_import' : 'subproject_reference',
            rawSpecifier: rawSpec,
          },
          certainty: 'verified',
          evidence: [makeLineRef()],
          rationale: `Module import "${rawSpec}" at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      // 2. Symbol extraction (functions, classes, interfaces, types, exported constants)
      const fnMatch = /^\s*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(line);
      if (fnMatch?.[2]) {
        symbols.push({
          name: fnMatch[2],
          kind: 'function',
          exported: Boolean(fnMatch[1]),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: makeLineRef(fnMatch[2]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const classMatch = /^\s*(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
      if (classMatch?.[2]) {
        symbols.push({
          name: classMatch[2],
          kind: 'class',
          exported: Boolean(classMatch[1]),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: makeLineRef(classMatch[2]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const ifaceMatch = /^\s*(export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
      if (ifaceMatch?.[2]) {
        symbols.push({
          name: ifaceMatch[2],
          kind: 'interface',
          exported: Boolean(ifaceMatch[1]),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: makeLineRef(ifaceMatch[2]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const typeMatch = /^\s*(export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/.exec(line);
      if (typeMatch?.[2]) {
        symbols.push({
          name: typeMatch[2],
          kind: 'type',
          exported: Boolean(typeMatch[1]),
          signature: line.trim().slice(0, 120),
          sourceRef: makeLineRef(typeMatch[2]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const constMatch = /^\s*export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/.exec(line);
      if (constMatch?.[1]) {
        symbols.push({
          name: constMatch[1],
          kind: 'constant',
          exported: true,
          signature: line.trim().slice(0, 120),
          sourceRef: makeLineRef(constMatch[1]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      // 3. HTTP Route detection (Express / Fastify / Hono / Router)
      const routeMatch =
        /\b(?:app|router|server|fastify|api)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(
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
          evidence: [makeLineRef(`${method} ${routePath}`)],
          rationale: `HTTP ${method} route handler registered at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      // 4. Server listen detection
      if (/\b(?:server|app|fastify)\.listen\s*\(/.test(line) || /\bcreateRoot\s*\(/.test(line)) {
        const isUi = /\bcreateRoot\s*\(/.test(line);
        entryPoints.push({
          id: `ep:${ctx.file.relativePath}:${lineNum}`,
          value: {
            kind: isUi ? 'ui_root' : 'http_server',
            identifier: `${ctx.file.relativePath}:${lineNum}`,
          },
          certainty: 'verified',
          evidence: [makeLineRef()],
          rationale: isUi
            ? `React DOM root mount detected at ${ctx.file.relativePath}:${lineNum}.`
            : `HTTP server listener started at ${ctx.file.relativePath}:${lineNum}.`,
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

  private resolveRelativeModulePath(
    normalizedBase: string,
    siblingPaths: readonly string[]
  ): string {
    const siblingSet = new Set(siblingPaths);
    const strippedJs = normalizedBase.replace(/\.(?:js|mjs|cjs)$/, '');

    const candidates = [
      normalizedBase,
      `${strippedJs}.ts`,
      `${strippedJs}.tsx`,
      `${strippedJs}.js`,
      `${strippedJs}.jsx`,
      `${normalizedBase}.ts`,
      `${normalizedBase}.tsx`,
      `${normalizedBase}.js`,
      `${normalizedBase}/index.ts`,
      `${normalizedBase}/index.tsx`,
      `${normalizedBase}/index.js`,
    ];

    for (const c of candidates) {
      if (siblingSet.has(c)) {
        return c;
      }
    }
    return normalizedBase;
  }
}
