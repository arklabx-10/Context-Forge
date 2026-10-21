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

export class DotNetAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.dotnet';
  public readonly displayName = '.NET / C# / MSBuild Adapter';
  public readonly description =
    'Analyzes .csproj/.sln files, NuGet PackageReferences, ProjectReferences, C# types, and ASP.NET endpoints.';
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
    const ext = path.posix.extname(file.relativePath).toLowerCase();
    return ['.csproj', '.fsproj', '.sln', '.cs'].includes(ext);
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const ext = path.posix.extname(ctx.file.relativePath).toLowerCase();
    if (ext === '.csproj' || ext === '.fsproj') {
      return this.analyzeCsproj(ctx);
    }
    if (ext === '.cs') {
      return this.analyzeCSharpSource(ctx);
    }
    return {};
  }

  private analyzeCsproj(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const frameworks: EvidenceBackedClaim<string>[] = [];
    const packageManagers: EvidenceBackedClaim<string>[] = [];
    const buildSystems: EvidenceBackedClaim<string>[] = [];
    const testHarnesses: EvidenceBackedClaim<string>[] = [];
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    const dependencyEdges: EvidenceBackedClaim<DependencyEdge>[] = [];

    const firstRef = createSourceRef({
      repoId: ctx.repoId,
      relativePath: ctx.file.relativePath,
      fileSha256: ctx.file.sha256,
      startLine: 1,
      endLine: 1,
      ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
    });

    packageManagers.push({
      id: `pm:${ctx.subProjectId}:nuget`,
      value: 'NuGet',
      certainty: 'verified',
      evidence: [firstRef],
      rationale: `Detected MSBuild project file ${ctx.file.relativePath}.`,
      producerId: this.adapterId,
    });

    buildSystems.push({
      id: `build:${ctx.subProjectId}:dotnet`,
      value: '.NET SDK / MSBuild',
      certainty: 'verified',
      evidence: [firstRef],
      rationale: `Detected MSBuild project file ${ctx.file.relativePath}.`,
      producerId: this.adapterId,
    });

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const ref = createSourceRef({
        repoId: ctx.repoId,
        relativePath: ctx.file.relativePath,
        fileSha256: ctx.file.sha256,
        startLine: lineNum,
        endLine: lineNum,
        ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
      });

      if (/<Project\s+Sdk=["']Microsoft\.NET\.Sdk\.Web["']/i.test(line)) {
        frameworks.push({
          id: `fw:${ctx.subProjectId}:aspnet_core`,
          value: 'ASP.NET Core',
          certainty: 'verified',
          evidence: [ref],
          rationale: `Project SDK "Microsoft.NET.Sdk.Web" declared at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      const tfmMatch = /<TargetFramework>([^<]+)<\/TargetFramework>/i.exec(line);
      if (tfmMatch?.[1]) {
        frameworks.push({
          id: `fw:${ctx.subProjectId}:${tfmMatch[1]}`,
          value: `.NET (${tfmMatch[1]})`,
          certainty: 'verified',
          evidence: [ref],
          rationale: `<TargetFramework>${tfmMatch[1]}</TargetFramework> at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      const pkgMatch =
        /<PackageReference\s+Include=["']([^"']+)["'](?:\s+Version=["']([^"']+)["'])?/i.exec(line);
      if (pkgMatch?.[1]) {
        const pkgName = pkgMatch[1];
        const version = pkgMatch[2] ?? '*';
        externalDependencies.push({
          id: `extdep:${ctx.subProjectId}:${pkgName}`,
          value: {
            subProjectId: ctx.subProjectId,
            name: pkgName,
            versionConstraint: version,
            scope: 'runtime',
            ecosystem: 'nuget',
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `<PackageReference Include="${pkgName}"> at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });

        if (/xunit|nunit|mstest/i.test(pkgName)) {
          testHarnesses.push({
            id: `test:${ctx.subProjectId}:${pkgName}`,
            value: pkgName,
            certainty: 'verified',
            evidence: [ref],
            rationale: `Test package "${pkgName}" referenced in ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
        if (/EntityFrameworkCore|Dapper/i.test(pkgName)) {
          frameworks.push({
            id: `fw:${ctx.subProjectId}:${pkgName}`,
            value: pkgName,
            certainty: 'verified',
            evidence: [ref],
            rationale: `Data access framework "${pkgName}" referenced in ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }

      const projRefMatch = /<ProjectReference\s+Include=["']([^"']+)["']/i.exec(line);
      if (projRefMatch?.[1]) {
        const relRef = projRefMatch[1].replace(/\\/g, '/');
        const dir = path.posix.dirname(ctx.file.relativePath);
        const resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, relRef));
        dependencyEdges.push({
          id: `edge:${ctx.file.relativePath}:${lineNum}:${resolved}`,
          value: {
            fromPathOrModule: ctx.file.relativePath,
            toPathOrModule: resolved,
            kind: 'subproject_reference',
            rawSpecifier: projRefMatch[1],
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `<ProjectReference> to "${resolved}" at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }
    }

    return {
      frameworks,
      packageManagers,
      buildSystems,
      testHarnesses,
      externalDependencies,
      dependencyEdges,
    };
  }

  private analyzeCSharpSource(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const symbols: ExtractedSymbol[] = [];
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

      const typeMatch =
        /^\s*(?:public|internal|private|protected)?\s*(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(class|interface|record|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
          line
        );
      if (typeMatch?.[1] && typeMatch?.[2]) {
        const kindMap: Record<string, ExtractedSymbol['kind']> = {
          class: 'class',
          interface: 'interface',
          record: 'class',
          struct: 'struct',
          enum: 'enum',
        };
        symbols.push({
          name: typeMatch[2],
          kind: kindMap[typeMatch[1]] ?? 'class',
          exported: line.includes('public'),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: makeRef(typeMatch[2]),
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      if (/\bWebApplication\.CreateBuilder\b/.test(line) || /\bstatic\s+(?:async\s+)?(?:Task|void|int)\s+Main\s*\(/.test(line)) {
        entryPoints.push({
          id: `ep:${ctx.file.relativePath}:${lineNum}`,
          value: {
            kind: line.includes('WebApplication') ? 'http_server' : 'main_function',
            identifier: `${ctx.file.relativePath}:${lineNum}`,
            runtimeCommandHint: 'dotnet run',
          },
          certainty: 'verified',
          evidence: [makeRef('Main')],
          rationale: `.NET application entry point detected at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }

      const minimalApiMatch = /\b(?:app|endpoints|group)\.Map(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']/i.exec(
        line
      );
      if (minimalApiMatch?.[1] && minimalApiMatch?.[2]) {
        const method = minimalApiMatch[1].toUpperCase();
        const route = minimalApiMatch[2];
        apiSurfaces.push({
          id: `api:${ctx.file.relativePath}:${lineNum}:${method}:${route}`,
          value: {
            protocol: 'http_rest',
            methodOrOperation: method,
            routeOrSignature: route,
          },
          certainty: 'verified',
          evidence: [makeRef(`${method} ${route}`)],
          rationale: `ASP.NET Minimal API route Map${minimalApiMatch[1]}("${route}") at ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }
    }

    return {
      symbols,
      apiSurfaces,
      entryPoints,
    };
  }
}
