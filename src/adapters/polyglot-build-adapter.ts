import path from 'node:path';
import type {
  AdapterAnalysisFragment,
  AdapterFileContext,
  EntryPointDescriptor,
  EvidenceBackedClaim,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export class PolyglotBuildAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.polyglot_build';
  public readonly displayName = 'Docker, Compose & Makefile Adapter';
  public readonly description =
    'Analyzes Dockerfile, docker-compose.yml, and Makefile build/container definitions across any stack.';
  public readonly version = '1.0.0';
  public readonly capabilities = {
    detectsManifests: false,
    extractsSymbols: false,
    extractsModuleImports: false,
    detectsEntryPoints: true,
    detectsApiSurfaces: false,
    analyzesSqlObjects: false,
    inspectsDiffRisks: false,
  } as const;

  public supportsFile(file: IndexedFileRecord): boolean {
    if (!file.isIndexed) return false;
    const base = path.posix.basename(file.relativePath).toLowerCase();
    return (
      base === 'dockerfile' ||
      base.startsWith('dockerfile.') ||
      base === 'makefile' ||
      base === 'gnumakefile' ||
      base === 'docker-compose.yml' ||
      base === 'docker-compose.yaml'
    );
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const base = path.posix.basename(ctx.file.relativePath).toLowerCase();
    const buildSystems: EvidenceBackedClaim<string>[] = [];
    const entryPoints: EvidenceBackedClaim<EntryPointDescriptor>[] = [];

    const firstRef = createSourceRef({
      repoId: ctx.repoId,
      relativePath: ctx.file.relativePath,
      fileSha256: ctx.file.sha256,
      startLine: 1,
      endLine: 1,
      ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
    });

    if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
      buildSystems.push({
        id: `build:${ctx.subProjectId}:docker`,
        value: 'Docker',
        certainty: 'verified',
        evidence: [firstRef],
        rationale: `Detected ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });

      for (let i = 0; i < ctx.lines.length; i += 1) {
        const line = (ctx.lines[i] ?? '').trim();
        if (/^(?:ENTRYPOINT|CMD)\s+/.test(line)) {
          const ref = createSourceRef({
            repoId: ctx.repoId,
            relativePath: ctx.file.relativePath,
            fileSha256: ctx.file.sha256,
            startLine: i + 1,
            endLine: i + 1,
          });
          entryPoints.push({
            id: `ep:${ctx.file.relativePath}:${i + 1}`,
            value: {
              kind: 'container_entry',
              identifier: `${ctx.file.relativePath}:${i + 1}`,
              runtimeCommandHint: line,
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `Container launch command in ${ctx.file.relativePath}:${i + 1}.`,
            producerId: this.adapterId,
          });
        }
      }
    } else if (base === 'makefile' || base === 'gnumakefile') {
      buildSystems.push({
        id: `build:${ctx.subProjectId}:make`,
        value: 'GNU Make',
        certainty: 'verified',
        evidence: [firstRef],
        rationale: `Detected ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });
    } else if (base.startsWith('docker-compose')) {
      buildSystems.push({
        id: `build:${ctx.subProjectId}:docker_compose`,
        value: 'Docker Compose',
        certainty: 'verified',
        evidence: [firstRef],
        rationale: `Detected ${ctx.file.relativePath}.`,
        producerId: this.adapterId,
      });
    }

    return {
      buildSystems,
      entryPoints,
    };
  }
}
