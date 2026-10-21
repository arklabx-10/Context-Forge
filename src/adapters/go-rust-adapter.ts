import path from 'node:path';
import type {
  AdapterAnalysisFragment,
  AdapterFileContext,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExternalDependency,
  ExtractedSymbol,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export class GoRustAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.go_rust';
  public readonly displayName = 'Go (go.mod) & Rust (Cargo.toml) Adapter';
  public readonly description =
    'Analyzes go.mod and Cargo.toml manifests, Go/Rust entry points, and exported functions/structs.';
  public readonly version = '1.0.0';
  public readonly capabilities = {
    detectsManifests: true,
    extractsSymbols: true,
    extractsModuleImports: false,
    detectsEntryPoints: true,
    detectsApiSurfaces: false,
    analyzesSqlObjects: false,
    inspectsDiffRisks: false,
  } as const;

  public supportsFile(file: IndexedFileRecord): boolean {
    if (!file.isIndexed) return false;
    const base = path.posix.basename(file.relativePath).toLowerCase();
    const ext = path.posix.extname(base);
    return base === 'go.mod' || base === 'cargo.toml' || ext === '.go' || ext === '.rs';
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const base = path.posix.basename(ctx.file.relativePath).toLowerCase();
    if (base === 'go.mod') return this.analyzeGoMod(ctx);
    if (base === 'cargo.toml') return this.analyzeCargoToml(ctx);
    if (base.endsWith('.go')) return this.analyzeGoSource(ctx);
    if (base.endsWith('.rs')) return this.analyzeRustSource(ctx);
    return {};
  }

  private analyzeGoMod(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = (ctx.lines[i] ?? '').trim();
      const match = /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+)\s+(v[0-9A-Za-z.+_-]+)/.exec(line);
      if (match?.[1] && match?.[2]) {
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: i + 1,
          endLine: i + 1,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        externalDependencies.push({
          id: `extdep:${ctx.subProjectId}:${match[1]}`,
          value: {
            subProjectId: ctx.subProjectId,
            name: match[1],
            versionConstraint: match[2],
            scope: 'runtime',
            ecosystem: 'go',
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `Go module dependency in ${ctx.file.relativePath}:${i + 1}.`,
          producerId: this.adapterId,
        });
      }
    }
    return {
      packageManagers: [
        {
          id: `pm:${ctx.subProjectId}:gomod`,
          value: 'Go Modules',
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
          rationale: `Detected ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        },
      ],
      externalDependencies,
    };
  }

  private analyzeCargoToml(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const externalDependencies: EvidenceBackedClaim<ExternalDependency>[] = [];
    let inDeps = false;
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = (ctx.lines[i] ?? '').trim();
      if (line.startsWith('[')) {
        inDeps = line === '[dependencies]' || line === '[dev-dependencies]';
        continue;
      }
      if (inDeps) {
        const match = /^([A-Za-z0-9_-]+)\s*=\s*(?:["']([^"']+)["']|.*version\s*=\s*["']([^"']+)["'])/.exec(
          line
        );
        if (match?.[1]) {
          const ver = match[2] ?? match[3] ?? '*';
          const ref = createSourceRef({
            repoId: ctx.repoId,
            relativePath: ctx.file.relativePath,
            fileSha256: ctx.file.sha256,
            startLine: i + 1,
            endLine: i + 1,
          });
          externalDependencies.push({
            id: `extdep:${ctx.subProjectId}:${match[1]}`,
            value: {
              subProjectId: ctx.subProjectId,
              name: match[1],
              versionConstraint: ver,
              scope: 'runtime',
              ecosystem: 'cargo',
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `Cargo dependency in ${ctx.file.relativePath}:${i + 1}.`,
            producerId: this.adapterId,
          });
        }
      }
    }
    return {
      packageManagers: [
        {
          id: `pm:${ctx.subProjectId}:cargo`,
          value: 'Cargo',
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
          rationale: `Detected ${ctx.file.relativePath}.`,
          producerId: this.adapterId,
        },
      ],
      externalDependencies,
    };
  }

  private analyzeGoSource(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const symbols: ExtractedSymbol[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const fnMatch = /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (fnMatch?.[1]) {
        const name = fnMatch[1];
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: name,
        });
        symbols.push({
          name,
          kind: 'function',
          exported: /^[A-Z]/.test(name),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
        if (name === 'main') {
          entryPoints.push({
            id: `ep:${ctx.file.relativePath}:${lineNum}:main`,
            value: {
              kind: 'main_function',
              identifier: `${ctx.file.relativePath}:main`,
              runtimeCommandHint: `go run ${ctx.file.relativePath}`,
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `Go func main() entry point at ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }
    }
    return { symbols, entryPoints };
  }

  private analyzeRustSource(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const symbols: ExtractedSymbol[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const fnMatch = /^\s*(pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (fnMatch?.[2]) {
        const name = fnMatch[2];
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: name,
        });
        symbols.push({
          name,
          kind: 'function',
          exported: Boolean(fnMatch[1]),
          signature: line.trim().replace(/\{$/, '').trim().slice(0, 120),
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
        if (name === 'main') {
          entryPoints.push({
            id: `ep:${ctx.file.relativePath}:${lineNum}:main`,
            value: {
              kind: 'main_function',
              identifier: `${ctx.file.relativePath}:main`,
              runtimeCommandHint: 'cargo run',
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `Rust fn main() entry point at ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }
    }
    return { symbols, entryPoints };
  }
}
