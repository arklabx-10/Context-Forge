import path from 'node:path';
import type {
  EntryPointDescriptor,
  EvidenceBackedClaim,
  ExtractedSymbol,
  FileRole,
  IndexedFileRecord,
  SourceReference,
  SubProject,
  SubProjectKind,
} from '../../domain/index.js';
import { createSourceRef } from '../../domain/index.js';
import type { DiscoveredFileEntry } from '../repo-access/safe-fs.js';
import { isConfigTemplateFilePath } from '../repo-access/secret-scanner.js';

const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript (ESM)',
  '.cjs': 'JavaScript (CJS)',
  '.py': 'Python',
  '.cs': 'C#',
  '.fs': 'F#',
  '.vb': 'Visual Basic .NET',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.cpp': 'C++',
  '.hpp': 'C++ Header',
  '.cc': 'C++',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.lua': 'Lua',
  '.r': 'R',
  '.jl': 'Julia',
  '.zig': 'Zig',
  '.nim': 'Nim',
  '.cob': 'COBOL',
  '.cbl': 'COBOL',
  '.sql': 'SQL',
  '.prisma': 'Prisma Schema',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.proto': 'Protocol Buffers',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.ps1': 'PowerShell',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.rst': 'reStructuredText',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.ini': 'INI',
};

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'pipfile',
  'cargo.toml',
  'go.mod',
  'go.work',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'composer.json',
  'gemfile',
  'mix.exs',
  'pubspec.yaml',
  'cmakelists.txt',
  'build.zig',
]);

const BUILD_CONFIG_BASENAMES = new Set([
  'makefile',
  'gnumakefile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'vite.config.ts',
  'vite.config.js',
  'vitest.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  'turbo.json',
  'nx.json',
  'pnpm-workspace.yaml',
  'lerna.json',
  'jest.config.js',
  'jest.config.ts',
]);

/**
 * Determines whether a filename is a project manifest (including *.csproj, *.fsproj, *.sln).
 */
export function isManifestPath(relativePath: string): boolean {
  const baseLower = path.posix.basename(relativePath).toLowerCase();
  if (MANIFEST_BASENAMES.has(baseLower)) {
    return true;
  }
  return (
    baseLower.endsWith('.csproj') ||
    baseLower.endsWith('.fsproj') ||
    baseLower.endsWith('.vbproj') ||
    baseLower.endsWith('.sln') ||
    baseLower.endsWith('.cabal')
  );
}

/**
 * Classifies a repository-relative path into its structural FileRole.
 */
export function classifyFileRole(relativePath: string, isIndexed: boolean, decodedContent?: string): FileRole {
  const lowerPath = relativePath.toLowerCase();
  const baseLower = path.posix.basename(lowerPath);
  const ext = path.posix.extname(baseLower);
  const segments = lowerPath.split('/');

  if (!isIndexed && !decodedContent) {
    if (
      ext === '.png' ||
      ext === '.jpg' ||
      ext === '.exe' ||
      ext === '.dll' ||
      ext === '.zip' ||
      ext === '.pdf' ||
      ext === '.wasm'
    ) {
      return 'binary';
    }
  }

  if (isConfigTemplateFilePath(relativePath)) {
    return 'config_template';
  }

  if (
    lowerPath.startsWith('.github/workflows/') ||
    lowerPath.startsWith('.gitlab-ci') ||
    lowerPath.startsWith('.circleci/') ||
    baseLower === 'jenkinsfile' ||
    baseLower === 'azure-pipelines.yml'
  ) {
    return 'ci_workflow';
  }

  if (isManifestPath(relativePath)) {
    return 'manifest';
  }

  if (
    BUILD_CONFIG_BASENAMES.has(baseLower) ||
    baseLower.startsWith('dockerfile.') ||
    baseLower.startsWith('tsconfig.') ||
    baseLower.endsWith('.config.js') ||
    baseLower.endsWith('.config.ts') ||
    baseLower.endsWith('.config.mjs')
  ) {
    return 'build_config';
  }

  if (
    ext === '.sql' ||
    ext === '.prisma' ||
    segments.includes('migrations') ||
    segments.includes('ddl') ||
    segments.includes('schema') && (ext === '.sql' || ext === '.graphql' || ext === '.gql')
  ) {
    return 'database_script';
  }

  if (
    ext === '.md' ||
    ext === '.mdx' ||
    ext === '.rst' ||
    ext === '.txt' ||
    segments.includes('docs') ||
    segments.includes('doc') ||
    baseLower.startsWith('readme') ||
    baseLower.startsWith('changelog') ||
    baseLower.startsWith('contributing') ||
    baseLower.startsWith('architecture') ||
    baseLower.startsWith('license')
  ) {
    return 'documentation';
  }

  if (
    segments.includes('test') ||
    segments.includes('tests') ||
    segments.includes('__tests__') ||
    segments.includes('spec') ||
    segments.includes('specs') ||
    baseLower.includes('.test.') ||
    baseLower.includes('.spec.') ||
    baseLower.startsWith('test_') ||
    baseLower.endsWith('_test.go') ||
    baseLower.endsWith('_test.py') ||
    baseLower.endsWith('tests.cs')
  ) {
    return 'test';
  }

  if (
    baseLower.endsWith('.lock') ||
    baseLower === 'package-lock.json' ||
    baseLower === 'pnpm-lock.yaml' ||
    baseLower === 'go.sum' ||
    baseLower.endsWith('.min.js') ||
    baseLower.endsWith('.min.css') ||
    baseLower.endsWith('.d.ts') ||
    segments.includes('generated')
  ) {
    return 'generated';
  }

  if (EXTENSION_LANGUAGE_MAP[ext]) {
    if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml' || ext === '.ini' || ext === '.xml') {
      return 'build_config';
    }
    return 'source';
  }

  // Stack-agnostic fallback: if it is a readable text file inside src/, lib/, app/, cmd/, pkg/, services/, or has code structure
  if (decodedContent !== undefined) {
    if (
      segments.includes('src') ||
      segments.includes('lib') ||
      segments.includes('app') ||
      segments.includes('pkg') ||
      segments.includes('cmd') ||
      segments.includes('core') ||
      segments.includes('modules') ||
      segments.includes('services') ||
      /[{}();=]/.test(decodedContent)
    ) {
      return 'source';
    }
  }

  return 'unknown';
}

/**
 * Detects language name from extension, special filename, shebang, or falls back to custom extension label.
 */
export function detectFileLanguage(relativePath: string, decodedContent?: string): string | null {
  const baseLower = path.posix.basename(relativePath).toLowerCase();
  const ext = path.posix.extname(baseLower);

  if (baseLower === 'dockerfile' || baseLower.startsWith('dockerfile.')) {
    return 'Dockerfile';
  }
  if (baseLower === 'makefile' || baseLower === 'gnumakefile') {
    return 'Makefile';
  }
  if (baseLower === 'cmakelists.txt') {
    return 'CMake';
  }

  if (EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext]!;
  }

  if (decodedContent) {
    const firstLine = decodedContent.split('\n', 1)[0] ?? '';
    if (firstLine.startsWith('#!')) {
      if (firstLine.includes('python')) return 'Python';
      if (firstLine.includes('node') || firstLine.includes('deno') || firstLine.includes('bun')) return 'JavaScript';
      if (firstLine.includes('bash') || firstLine.includes('sh')) return 'Shell';
      if (firstLine.includes('ruby')) return 'Ruby';
      if (firstLine.includes('perl')) return 'Perl';
    }
  }

  if (ext && ext.length > 1 && ext.length <= 10 && decodedContent !== undefined) {
    return `Unrecognized (${ext})`;
  }

  return null;
}

/**
 * Discovers SubProjects across the repository without assuming the root directory is a single application.
 * Supports monorepos (apps/*, services/*, packages/*, crates/*), nested manifests, and manifest-less repositories.
 */
export function discoverSubProjectsTier0(params: {
  readonly repoId: string;
  readonly repoName: string;
  readonly commitSha?: string;
  readonly analyzedAtIso: string;
  readonly discoveredFiles: readonly DiscoveredFileEntry[];
}): {
  readonly subProjects: SubProject[];
  readonly fileSubProjectAssignment: ReadonlyMap<string, string>;
} {
  const subProjectRoots = new Map<
    string,
    {
      id: string;
      name: string;
      rootPath: string;
      kind: SubProjectKind;
      manifests: SourceReference[];
    }
  >();

  // 1. Discover manifest-anchored sub-project roots
  for (const file of params.discoveredFiles) {
    if (isManifestPath(file.relativePath)) {
      const dir = path.posix.dirname(file.relativePath);
      const rootPath = dir === '.' ? '' : dir;
      const existing = subProjectRoots.get(rootPath);
      const ref = createSourceRef({
        repoId: params.repoId,
        relativePath: file.relativePath,
        fileSha256: file.sha256,
        startLine: 1,
        endLine: file.lineCount ?? 1,
        ...(params.commitSha ? { commitSha: params.commitSha } : {}),
        capturedAtIso: params.analyzedAtIso,
      });

      if (existing) {
        existing.manifests.push(ref);
      } else {
        const kind = inferSubProjectKindFromPath(rootPath, params.repoName);
        const name = rootPath ? rootPath.split('/').slice(-2).join('/') : params.repoName;
        subProjectRoots.set(rootPath, {
          id: rootPath ? `sp:${rootPath}` : 'sp:root',
          name,
          rootPath,
          kind,
          manifests: [ref],
        });
      }
    }
  }

  // 2. Also discover convention-based monorepo directories (apps/*, services/*, packages/*, modules/*)
  // even when a nested sub-project uses an unrecognized language without a known manifest!
  const CONVENTION_CONTAINERS = new Set(['apps', 'services', 'packages', 'modules', 'crates', 'microservices']);
  for (const file of params.discoveredFiles) {
    const parts = file.relativePath.split('/');
    if (parts.length >= 3 && parts[0] && parts[1] && CONVENTION_CONTAINERS.has(parts[0].toLowerCase())) {
      const candidateRoot = `${parts[0]}/${parts[1]}`;
      if (!subProjectRoots.has(candidateRoot)) {
        subProjectRoots.set(candidateRoot, {
          id: `sp:${candidateRoot}`,
          name: candidateRoot,
          rootPath: candidateRoot,
          kind: inferSubProjectKindFromPath(candidateRoot, params.repoName),
          manifests: [],
        });
      }
    }
  }

  // 3. Ensure a root fallback exists if no sub-projects were found or for top-level files
  const hasNestedSubProjects = Array.from(subProjectRoots.keys()).some((k) => k !== '');
  if (!subProjectRoots.has('')) {
    subProjectRoots.set('', {
      id: 'sp:root',
      name: hasNestedSubProjects ? `${params.repoName} (Workspace Root)` : params.repoName,
      rootPath: '',
      kind: hasNestedSubProjects ? 'workspace_root' : 'unknown',
      manifests: [],
    });
  } else if (hasNestedSubProjects) {
    const rootSp = subProjectRoots.get('')!;
    if (rootSp.kind === 'unknown' || rootSp.kind === 'application') {
      rootSp.kind = 'workspace_root';
    }
  }

  // Sort roots from deepest path to shallowest so files match their most specific owning SubProject
  const sortedRoots = Array.from(subProjectRoots.values()).sort(
    (a, b) => b.rootPath.length - a.rootPath.length
  );

  const fileSubProjectAssignment = new Map<string, string>();
  for (const file of params.discoveredFiles) {
    let assignedId = 'sp:root';
    for (const sp of sortedRoots) {
      if (sp.rootPath === '') {
        assignedId = sp.id;
        break;
      }
      if (file.relativePath === sp.rootPath || file.relativePath.startsWith(`${sp.rootPath}/`)) {
        assignedId = sp.id;
        break;
      }
    }
    fileSubProjectAssignment.set(file.relativePath, assignedId);
  }

  const subProjects: SubProject[] = Array.from(subProjectRoots.values())
    .sort((a, b) => a.rootPath.localeCompare(b.rootPath))
    .map((sp) => ({
      id: sp.id,
      name: sp.name,
      rootPath: sp.rootPath,
      kind: sp.kind,
      manifests: sp.manifests,
      languages: [],
      frameworks: [],
      packageManagers: [],
      buildSystems: [],
      testHarnesses: [],
      entryPoints: [],
      apiSurfaces: [],
      databaseObjects: [],
      configTemplates: [],
      documentationFiles: [],
    }));

  return { subProjects, fileSubProjectAssignment };
}

function inferSubProjectKindFromPath(rootPath: string, _repoName: string): SubProjectKind {
  const lower = rootPath.toLowerCase();
  if (!lower) return 'unknown';
  if (lower.startsWith('apps/') || lower.includes('/app') || lower.includes('frontend') || lower.includes('web')) {
    return 'application';
  }
  if (lower.startsWith('services/') || lower.includes('api') || lower.includes('worker') || lower.includes('backend')) {
    return 'service';
  }
  if (lower.startsWith('packages/') || lower.startsWith('libs/') || lower.startsWith('crates/') || lower.includes('shared')) {
    return 'library';
  }
  if (lower.includes('db') || lower.includes('database') || lower.includes('migrations') || lower.includes('sql')) {
    return 'database';
  }
  if (lower.includes('infra') || lower.includes('deploy') || lower.includes('terraform')) {
    return 'infrastructure';
  }
  return 'application';
}

/**
 * Tier-0 generic structural entry point and symbol extractor for any file,
 * including unrecognized stacks.
 */
export function extractTier0FileSignals(params: {
  readonly repoId: string;
  readonly commitSha?: string;
  readonly analyzedAtIso: string;
  readonly file: IndexedFileRecord;
  readonly content: string;
}): {
  readonly entryPointClaim?: EvidenceBackedClaim<EntryPointDescriptor>;
  readonly genericSymbols: readonly ExtractedSymbol[];
} {
  const baseName = path.posix.basename(params.file.relativePath);
  const lowerBase = baseName.toLowerCase();
  const stem = path.posix.basename(lowerBase, path.posix.extname(lowerBase));

  const ref = createSourceRef({
    repoId: params.repoId,
    relativePath: params.file.relativePath,
    fileSha256: params.file.sha256,
    startLine: 1,
    endLine: Math.min(params.file.lineCount ?? 1, 25),
    ...(params.commitSha ? { commitSha: params.commitSha } : {}),
    capturedAtIso: params.analyzedAtIso,
  });

  let entryPointClaim: EvidenceBackedClaim<EntryPointDescriptor> | undefined;
  if (
    params.file.role === 'source' &&
    (stem === 'main' ||
      stem === 'index' ||
      stem === 'server' ||
      stem === 'app' ||
      stem === 'cli' ||
      stem === 'program' ||
      lowerBase === 'manage.py')
  ) {
    entryPointClaim = {
      id: `ep:tier0:${params.file.relativePath}`,
      value: {
        kind: stem === 'cli' ? 'cli' : stem === 'server' ? 'http_server' : 'main_function',
        identifier: params.file.relativePath,
      },
      certainty: 'inferred',
      evidence: [ref],
      rationale: `Tier-0 structural heuristic: filename '${baseName}' matches standard entry-point naming convention.`,
      producerId: 'tier0.structural',
    };
  }

  // If the file is in an unrecognized language, extract generic function/module/section declarations by regex
  const genericSymbols: ExtractedSymbol[] = [];
  if (params.file.detectedLanguage?.startsWith('Unrecognized')) {
    const lines = params.content.split('\n');
    const declRegex =
      /^\s*(?:export\s+|pub\s+|public\s+)?(?:proc|func|fn|function|def|module|service|record|entity|task|rule)\s+([A-Za-z_][A-Za-z0-9_]*)/;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const match = declRegex.exec(line);
      if (match?.[1]) {
        genericSymbols.push({
          name: match[1],
          kind: 'function',
          exported: true,
          signature: line.trim().slice(0, 100),
          sourceRef: createSourceRef({
            repoId: params.repoId,
            relativePath: params.file.relativePath,
            fileSha256: params.file.sha256,
            startLine: i + 1,
            endLine: i + 1,
            symbolName: match[1],
            ...(params.commitSha ? { commitSha: params.commitSha } : {}),
            capturedAtIso: params.analyzedAtIso,
          }),
          certainty: 'inferred',
          producerId: 'tier0.structural',
        });
      }
    }
  }

  return {
    ...(entryPointClaim ? { entryPointClaim } : {}),
    genericSymbols,
  };
}
