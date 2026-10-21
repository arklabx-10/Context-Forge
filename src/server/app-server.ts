import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { ContextForgeWorkspaceService } from '../application/workspace-service.js';
import type {
  AiGenerationRequest,
  AiProviderConfig,
  CodingAssistantTarget,
  ContextBudgetConfig,
  DevelopmentTaskType,
  KnowledgeCategory,
  OutboundConsentToken,
  ScanResourceLimits,
  SearchHit,
} from '../domain/index.js';
import { ConsentRequiredError } from '../infrastructure/ai/ai-providers.js';

export interface ServerInstance {
  readonly server: http.Server;
  readonly port: number;
  close(): Promise<void>;
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBodyBytes = 4 * 1024 * 1024; // 4 MB limit

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBodyBytes) {
      throw new Error('Request payload exceeds maximum allowed size (4 MB).');
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createContextForgeHttpServer(
  workspaceService: ContextForgeWorkspaceService,
  options?: {
    readonly workspaceRootDir?: string;
    readonly staticUiDistDir?: string;
  }
): http.Server {
  const workspaceRoot = options?.workspaceRootDir ?? process.cwd();
  const staticDir = options?.staticUiDistDir ?? path.join(workspaceRoot, 'dist', 'ui');

  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith('/api/')) {
        await handleApiRequest(method, pathname, parsedUrl, req, res, workspaceService, workspaceRoot);
        return;
      }

      // Serve static UI files if built
      await serveStaticUi(pathname, res, staticDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const status = err instanceof ConsentRequiredError ? 403 : 400;
      // Never log sensitive repository content; only log error type and path
      sendJson(res, status, { error: message });
    }
  });
}

async function handleApiRequest(
  method: string,
  pathname: string,
  parsedUrl: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  service: ContextForgeWorkspaceService,
  workspaceRoot: string
): Promise<void> {
  // 1. Health, adapters & quick-onboard presets
  if (method === 'GET' && pathname === '/api/health') {
    const presets = [
      {
        label: 'ContextForge Workspace (Self-Analysis)',
        description: 'Analyze ContextForge itself (TypeScript modular monolith + React UI + Vitest)',
        path: workspaceRoot,
      },
      {
        label: 'Polyglot Commerce Monorepo (Fixture)',
        description: 'Multi-app repo with React portal, Python FastAPI service, shared library, and SQL schema',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'polyglot-monorepo'),
      },
      {
        label: 'QuantumLedger Unrecognized .qlang Stack (Fixture)',
        description: 'Custom .qlang repository demonstrating Tier-0 stack-agnostic analysis without language adapters',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'unknown-esoteric-stack'),
      },
      {
        label: '.NET 10 Order Service + SQL (Fixture)',
        description: 'ASP.NET Core Minimal API with C#, Dapper, xUnit, and MSBuild .csproj',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'dotnet-sql-service'),
      },
      {
        label: 'Compiled Rust + C++ Header FFI App (Fixture)',
        description: 'Rust Cargo binary with C++ header FFI, Cargo.lock, and internal mod graph',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'compiled-rust-app'),
      },
      {
        label: 'TypeScript Service + OpenAPI Spec (Fixture)',
        description: 'Node/TypeScript service with package-lock.json, OpenAPI spec, and Vitest tests',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'ts-service-project'),
      },
      {
        label: 'Python Service + Extensionless Daemon (Fixture)',
        description: 'PEP 621 pyproject.toml, poetry.lock, FastAPI service, and shebang worker script',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'python-service-project'),
      },
      {
        label: 'Database-Heavy SQL & Prisma Repo (Fixture)',
        description: 'SQL DDL migrations (tables, views, procedures, foreign keys) and Prisma schema',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'database-heavy-repo'),
      },
      {
        label: 'Malformed Manifests & Partial Analysis (Fixture)',
        description: 'Broken package.json, pyproject.toml, and .csproj demonstrating partial analysis & warnings',
        path: path.join(workspaceRoot, 'tests', 'fixtures', 'malformed-and-inaccessible'),
      },
    ];

    sendJson(res, 200, {
      status: 'ok',
      adapters: service.getRegisteredAdapters(),
      privacy: service.getPrivacyAndIndexStatus(),
      presets,
    });
    return;
  }

  // 2. Repositories list & onboarding
  if (method === 'GET' && pathname === '/api/repositories') {
    sendJson(res, 200, { repositories: service.listRepositories() });
    return;
  }

  if (method === 'POST' && pathname === '/api/repositories/onboard') {
    const body = await readJsonBody<{
      rootPath: string;
      name?: string;
      resourceLimits?: Partial<ScanResourceLimits>;
    }>(req);
    const result = await service.onboardRepository(body);
    sendJson(res, 200, result);
    return;
  }

  // Match /api/repositories/:repoId...
  const repoMatch = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (repoMatch?.[1]) {
    const repoId = decodeURIComponent(repoMatch[1]);
    const subRoute = repoMatch[2] ?? '';

    if (method === 'DELETE' && subRoute === '') {
      service.deleteRepositoryData(repoId);
      sendJson(res, 200, { deleted: true, repoId });
      return;
    }

    if (method === 'POST' && subRoute === 'rescan') {
      const snapshot = await service.rescanRepository(repoId);
      sendJson(res, 200, { snapshot });
      return;
    }

    if (method === 'PUT' && subRoute === 'settings') {
      const body = await readJsonBody<{
        name?: string;
        resourceLimits?: Partial<ScanResourceLimits>;
        rescan?: boolean;
      }>(req);
      const updated = await service.updateRepositorySettings({
        repoId,
        ...body,
      });
      sendJson(res, 200, updated);
      return;
    }

    if (method === 'GET' && subRoute === 'snapshot') {
      const snapshot = service.getRepositorySnapshot(repoId);
      if (!snapshot) {
        sendJson(res, 404, { error: `Snapshot not found for repository ${repoId}` });
        return;
      }
      sendJson(res, 200, { snapshot });
      return;
    }

    if (method === 'GET' && subRoute === 'report') {
      const reportMarkdown = service.generateRepositoryReport(repoId);
      sendJson(res, 200, { reportMarkdown });
      return;
    }

    if (method === 'GET' && subRoute === 'file') {
      const relPath = parsedUrl.searchParams.get('path') ?? '';
      const startParam = parsedUrl.searchParams.get('startLine');
      const endParam = parsedUrl.searchParams.get('endLine');
      const startLine = startParam ? Number.parseInt(startParam, 10) : undefined;
      const endLine = endParam ? Number.parseInt(endParam, 10) : undefined;
      const fileData = await service.readRepositoryFile(repoId, relPath, {
        ...(startLine !== undefined && !Number.isNaN(startLine) ? { startLine } : {}),
        ...(endLine !== undefined && !Number.isNaN(endLine) ? { endLine } : {}),
      });
      if (!fileData) {
        sendJson(res, 404, {
          error: `File "${relPath}" cannot be read (missing, excluded as sensitive, or outside repository root).`,
        });
        return;
      }
      sendJson(res, 200, fileData);
      return;
    }

    if (method === 'GET' && subRoute === 'context-packs') {
      sendJson(res, 200, { packs: service.listContextPacks(repoId) });
      return;
    }

    if (method === 'POST' && subRoute === 'context-packs') {
      const body = await readJsonBody<{
        taskType: DevelopmentTaskType;
        taskTitle: string;
        taskDescription: string;
        targetSubProjectId?: string | null;
        seedFilePaths?: string[];
        assistantTarget?: CodingAssistantTarget;
        budget?: Partial<ContextBudgetConfig>;
      }>(req);
      const result = await service.generateContextPack({
        repoId,
        ...body,
      });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'GET' && subRoute === 'knowledge') {
      sendJson(res, 200, { entries: service.listKnowledgeEntries(repoId) });
      return;
    }

    if (method === 'POST' && subRoute === 'knowledge') {
      const body = await readJsonBody<{
        id?: string;
        category: KnowledgeCategory;
        title: string;
        contentMarkdown: string;
        isAiGeneratedSummary?: boolean;
        linkedFilePaths?: { relativePath: string; startLine?: number; endLine?: number }[];
      }>(req);
      const entry = service.saveKnowledgeEntry({
        repoId,
        ...body,
      });
      sendJson(res, 200, { entry });
      return;
    }

    if (method === 'GET' && subRoute === 'reviews') {
      sendJson(res, 200, { reviews: service.listChangeReviews(repoId) });
      return;
    }

    if (method === 'POST' && subRoute === 'reviews') {
      const body = await readJsonBody<{
        targetSpec?: string;
        rawDiffOverride?: string;
      }>(req);
      const report = await service.reviewChanges({
        repoId,
        ...body,
      });
      sendJson(res, 200, { report });
      return;
    }
  }

  // 3. Delete Knowledge Entry
  const knowDeleteMatch = /^\/api\/knowledge\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && knowDeleteMatch?.[1]) {
    service.deleteKnowledgeEntry(decodeURIComponent(knowDeleteMatch[1]));
    sendJson(res, 200, { deleted: true });
    return;
  }

  // 4. Global & Project-Specific Search
  if (method === 'GET' && pathname === '/api/search') {
    const query = parsedUrl.searchParams.get('q') ?? '';
    const repoId = parsedUrl.searchParams.get('repoId') || undefined;
    const kind = (parsedUrl.searchParams.get('kind') || undefined) as SearchHit['kind'] | undefined;
    const limit = Number.parseInt(parsedUrl.searchParams.get('limit') ?? '50', 10);

    const hits = service.search({
      query,
      ...(repoId ? { repoId } : {}),
      ...(kind ? { kind } : {}),
      limit: Number.isNaN(limit) ? 50 : limit,
    });
    sendJson(res, 200, { hits });
    return;
  }

  // 5. AI Provider Settings & Consent Gate
  if (method === 'GET' && pathname === '/api/settings/ai') {
    sendJson(res, 200, { config: service.getAiProviderConfig() });
    return;
  }

  if (method === 'PUT' && pathname === '/api/settings/ai') {
    const body = await readJsonBody<AiProviderConfig>(req);
    const updated = service.saveAiProviderConfig(body);
    sendJson(res, 200, { config: updated });
    return;
  }

  if (method === 'POST' && pathname === '/api/ai/consent-preview') {
    const body = await readJsonBody<AiGenerationRequest>(req);
    const preview = service.createOutboundAiConsentPreview(body);
    sendJson(res, 200, { preview });
    return;
  }

  if (method === 'POST' && pathname === '/api/ai/generate') {
    const body = await readJsonBody<{
      request: AiGenerationRequest;
      consentToken: OutboundConsentToken;
      apiKey?: string;
    }>(req);
    const response = await service.executeAiGenerationWithConsent(
      body.request,
      body.consentToken,
      body.apiKey
    );
    sendJson(res, 200, { response });
    return;
  }

  // 6. Privacy & Index Inspection / Deletion
  if (method === 'GET' && pathname === '/api/settings/privacy') {
    sendJson(res, 200, { status: service.getPrivacyAndIndexStatus() });
    return;
  }

  if (method === 'POST' && pathname === '/api/settings/privacy/purge') {
    service.purgeAllIndexedData();
    sendJson(res, 200, {
      purged: true,
      status: service.getPrivacyAndIndexStatus(),
    });
    return;
  }

  sendJson(res, 404, { error: `Unknown API endpoint: ${method} ${pathname}` });
}

async function serveStaticUi(
  pathname: string,
  res: http.ServerResponse,
  staticDir: string
): Promise<void> {
  const cleanRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(staticDir, cleanRel);
  if (!candidate.startsWith(path.resolve(staticDir))) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8',
      };
      const content = await fs.readFile(candidate);
      res.writeHead(200, { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' });
      res.end(content);
      return;
    }
  } catch {
    // Fall back to index.html for SPA routes if built
  }

  try {
    const indexHtml = await fs.readFile(path.join(staticDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ContextForge API Server is running. Run `npm run dev:ui` or `npm run build` for UI.');
  }
}
