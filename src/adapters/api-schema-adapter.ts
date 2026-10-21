import path from 'node:path';
import type {
  AdapterAnalysisFragment,
  AdapterFileContext,
  ApiSurfaceDescriptor,
  EvidenceBackedClaim,
  ExtractedSymbol,
  IndexedFileRecord,
  RepositoryAnalyzerAdapter,
} from '../domain/index.js';
import { createSourceRef } from '../domain/index.js';

export class ApiSchemaAdapter implements RepositoryAnalyzerAdapter {
  public readonly adapterId = 'adapter.api_schema';
  public readonly displayName = 'OpenAPI, GraphQL & Protocol Buffers Schema Adapter';
  public readonly description =
    'Extracts HTTP REST endpoints from OpenAPI/Swagger specifications, operations/types from GraphQL schemas, and RPC services/messages from Protocol Buffer definitions.';
  public readonly version = '1.1.0';
  public readonly capabilities = {
    detectsManifests: false,
    detectsLanguagesAndFrameworks: true,
    extractsSymbols: true,
    extractsModuleImports: false,
    detectsEntryPoints: false,
    detectsApiSurfaces: true,
    analyzesSqlObjects: false,
    extractsBuildAndTestMetadata: false,
    inspectsDiffRisks: false,
  } as const;

  public readonly supportedInputs = {
    extensions: ['.yaml', '.yml', '.json', '.graphql', '.gql', '.proto'],
    filenamesOrGlobs: ['openapi.*', 'swagger.*', 'asyncapi.*', '*.graphql', '*.gql', '*.proto'],
    ecosystemsOrDialects: ['OpenAPI 3.x', 'Swagger 2.0', 'GraphQL SDL', 'Protocol Buffers (proto2/proto3)'],
  } as const;

  public readonly limitations = [
    'External $ref URLs pointing outside the repository are not fetched over the network.',
    'OpenAPI 1.x / Swagger 1.x legacy specifications and unrecognized major versions are reported as unsupported.',
    'Code-first GraphQL or gRPC schemas generated dynamically at runtime require source-language adapters.',
  ] as const;

  public readonly requiredResources = {
    maxFileSizeBytes: 1_048_576,
    requiresSiblingFileIndex: false,
    executionMode: 'in_process_safe_static',
  } as const;

  public supportsFile(file: IndexedFileRecord): boolean {
    if (!file.isIndexed) return false;
    if (file.role === 'api_spec') return true;
    const ext = path.posix.extname(file.relativePath).toLowerCase();
    return ext === '.graphql' || ext === '.gql' || ext === '.proto';
  }

  public async analyzeFile(ctx: AdapterFileContext): Promise<AdapterAnalysisFragment> {
    const ext = path.posix.extname(ctx.file.relativePath).toLowerCase();
    if (ext === '.graphql' || ext === '.gql') {
      return this.analyzeGraphQlSchema(ctx);
    }
    if (ext === '.proto') {
      return this.analyzeProtoSchema(ctx);
    }
    return this.analyzeOpenApiSpec(ctx);
  }

  private analyzeOpenApiSpec(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const apiSurfaces: EvidenceBackedClaim<ApiSurfaceDescriptor>[] = [];
    const notesOrLimitations: string[] = [];
    const ext = path.posix.extname(ctx.file.relativePath).toLowerCase();

    if (ext === '.json') {
      try {
        JSON.parse(ctx.content);
      } catch {
        return {
          notesOrLimitations: [
            `Malformed JSON in API specification ${ctx.file.relativePath}; OpenAPI endpoint extraction skipped.`,
          ],
        };
      }
    }

    // Check OpenAPI / Swagger version support
    const versionMatch =
      /^\s*["']?(openapi|swagger)["']?\s*:\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?)["']?/im.exec(
        ctx.content
      );
    if (versionMatch?.[1] && versionMatch?.[2]) {
      const specKind = versionMatch[1].toLowerCase();
      const specVer = versionMatch[2];
      if (
        (specKind === 'swagger' && !specVer.startsWith('2.')) ||
        (specKind === 'openapi' && !specVer.startsWith('3.'))
      ) {
        notesOrLimitations.push(
          `Unsupported ${specKind.toUpperCase()} specification version "${specVer}" in ${ctx.file.relativePath}; only OpenAPI 3.x and Swagger 2.0 are statically supported.`
        );
        return { notesOrLimitations };
      }
    }

    let currentPath: string | null = null;
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;

      // Detect path keys like `  /orders/{id}:` or `"/orders/{id}": {`
      const pathMatch = /^\s*["']?(\/[A-Za-z0-9_./{}-]*)["']?\s*:/.exec(line);
      if (pathMatch?.[1]) {
        currentPath = pathMatch[1];
        continue;
      }

      if (currentPath) {
        const methodMatch =
          /^\s*["']?(get|post|put|delete|patch|options|head)["']?\s*:/i.exec(line);
        if (methodMatch?.[1]) {
          const method = methodMatch[1].toUpperCase();
          const ref = createSourceRef({
            repoId: ctx.repoId,
            relativePath: ctx.file.relativePath,
            fileSha256: ctx.file.sha256,
            startLine: lineNum,
            endLine: lineNum,
            symbolName: `${method} ${currentPath}`,
            ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
          });
          apiSurfaces.push({
            id: `api:openapi:${ctx.file.relativePath}:${lineNum}:${method}:${currentPath}`,
            value: {
              protocol: 'http_rest',
              methodOrOperation: method,
              routeOrSignature: currentPath,
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `OpenAPI operation "${method} ${currentPath}" defined in ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }
    }

    return {
      apiSurfaces,
      ...(notesOrLimitations.length > 0 ? { notesOrLimitations } : {}),
    };
  }

  private analyzeGraphQlSchema(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const apiSurfaces: EvidenceBackedClaim<ApiSurfaceDescriptor>[] = [];
    const symbols: ExtractedSymbol[] = [];
    let currentRootType: 'Query' | 'Mutation' | 'Subscription' | null = null;

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const trimmed = line.trim();

      if (trimmed === '}') {
        currentRootType = null;
        continue;
      }

      const typeMatch = /^\s*(type|input|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (typeMatch?.[1] && typeMatch?.[2]) {
        const typeName = typeMatch[2];
        if (typeName === 'Query' || typeName === 'Mutation' || typeName === 'Subscription') {
          currentRootType = typeName;
        } else {
          currentRootType = null;
        }

        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: typeName,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        symbols.push({
          name: typeName,
          kind: typeMatch[1] === 'enum' ? 'enum' : 'type',
          exported: true,
          signature: trimmed.replace(/\{$/, '').trim(),
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
        continue;
      }

      if (currentRootType) {
        const fieldMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_![\]]+)/.exec(
          line
        );
        if (fieldMatch?.[1] && fieldMatch?.[2]) {
          const fieldName = fieldMatch[1];
          const ref = createSourceRef({
            repoId: ctx.repoId,
            relativePath: ctx.file.relativePath,
            fileSha256: ctx.file.sha256,
            startLine: lineNum,
            endLine: lineNum,
            symbolName: `${currentRootType}.${fieldName}`,
            ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
          });
          apiSurfaces.push({
            id: `api:graphql:${ctx.file.relativePath}:${lineNum}:${currentRootType}.${fieldName}`,
            value: {
              protocol: 'graphql',
              methodOrOperation: currentRootType.toUpperCase(),
              routeOrSignature: `${fieldName}: ${fieldMatch[2]}`,
            },
            certainty: 'verified',
            evidence: [ref],
            rationale: `GraphQL ${currentRootType} field "${fieldName}" at ${ctx.file.relativePath}:${lineNum}.`,
            producerId: this.adapterId,
          });
        }
      }
    }

    return { apiSurfaces, symbols };
  }

  private analyzeProtoSchema(ctx: AdapterFileContext): AdapterAnalysisFragment {
    const apiSurfaces: EvidenceBackedClaim<ApiSurfaceDescriptor>[] = [];
    const symbols: ExtractedSymbol[] = [];
    const notesOrLimitations: string[] = [];
    let currentService: string | null = null;

    for (let i = 0; i < ctx.lines.length; i += 1) {
      const line = ctx.lines[i] ?? '';
      const lineNum = i + 1;
      const trimmed = line.trim();

      const syntaxMatch = /^\s*syntax\s*=\s*["']([^"']+)["']/.exec(line);
      if (syntaxMatch?.[1] && syntaxMatch[1] !== 'proto2' && syntaxMatch[1] !== 'proto3') {
        notesOrLimitations.push(
          `Unsupported Protocol Buffers syntax version "${syntaxMatch[1]}" in ${ctx.file.relativePath}:${lineNum}.`
        );
      }

      if (trimmed === '}') {
        currentService = null;
        continue;
      }

      const svcMatch = /^\s*service\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (svcMatch?.[1]) {
        currentService = svcMatch[1];
        continue;
      }

      const msgMatch = /^\s*(message|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (msgMatch?.[1] && msgMatch?.[2]) {
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: msgMatch[2],
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        symbols.push({
          name: msgMatch[2],
          kind: msgMatch[1] === 'enum' ? 'enum' : 'struct',
          exported: true,
          signature: trimmed.replace(/\{$/, '').trim(),
          sourceRef: ref,
          certainty: 'verified',
          producerId: this.adapterId,
        });
      }

      const rpcMatch = /^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)\s*returns\s*\(([^)]+)\)/.exec(
        line
      );
      if (rpcMatch?.[1]) {
        const rpcName = rpcMatch[1];
        const qualified = currentService ? `${currentService}/${rpcName}` : rpcName;
        const ref = createSourceRef({
          repoId: ctx.repoId,
          relativePath: ctx.file.relativePath,
          fileSha256: ctx.file.sha256,
          startLine: lineNum,
          endLine: lineNum,
          symbolName: qualified,
          ...(ctx.commitSha ? { commitSha: ctx.commitSha } : {}),
        });
        apiSurfaces.push({
          id: `api:grpc:${ctx.file.relativePath}:${lineNum}:${qualified}`,
          value: {
            protocol: 'grpc',
            methodOrOperation: 'RPC',
            routeOrSignature: `${qualified}(${rpcMatch[2]?.trim() ?? ''}) -> (${rpcMatch[3]?.trim() ?? ''})`,
          },
          certainty: 'verified',
          evidence: [ref],
          rationale: `gRPC RPC method "${qualified}" defined in ${ctx.file.relativePath}:${lineNum}.`,
          producerId: this.adapterId,
        });
      }
    }

    return {
      apiSurfaces,
      symbols,
      ...(notesOrLimitations.length > 0 ? { notesOrLimitations } : {}),
    };
  }
}
