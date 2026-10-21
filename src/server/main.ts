import path from 'node:path';
import { ContextForgeWorkspaceService } from '../application/workspace-service.js';
import { ContextForgeSqliteStore } from '../infrastructure/persistence/sqlite-store.js';
import { createContextForgeHttpServer } from './app-server.js';

const PORT = Number.parseInt(process.env.PORT ?? '4310', 10);
const DB_PATH =
  process.env.CONTEXTFORGE_DB_PATH ??
  path.join(process.cwd(), '.contextforge-data', 'contextforge.db');

async function bootstrap(): Promise<void> {
  const store = new ContextForgeSqliteStore(DB_PATH);
  const workspaceService = new ContextForgeWorkspaceService(store);

  // If no repositories are indexed yet, onboard the polyglot-monorepo fixture and current workspace
  // so the developer immediately has real analyzed repositories to explore upon opening the app.
  if (workspaceService.listRepositories().length === 0) {
    const fixtureMonorepo = path.join(process.cwd(), 'tests', 'fixtures', 'polyglot-monorepo');
    try {
      const { repository } = await workspaceService.onboardRepository({
        rootPath: fixtureMonorepo,
        name: 'acme-commerce-monorepo',
      });
      workspaceService.saveKnowledgeEntry({
        repoId: repository.id,
        category: 'architecture_decision',
        title: 'ADR-001: Multi-Service Boundary & Integer Cents Monetary Convention',
        contentMarkdown:
          'All monetary calculations across `apps/web-portal` and `services/python-pricing` must operate on integer cents (`amountCents`, `subtotal_cents`) to avoid IEEE-754 floating-point drift.',
        linkedFilePaths: [
          { relativePath: 'apps/web-portal/src/BillingView.tsx', startLine: 1, endLine: 8 },
          { relativePath: 'services/python-pricing/src/calculator.py', startLine: 1, endLine: 5 },
        ],
      });
    } catch {
      // Ignore if fixture directory is absent
    }
  }

  const server = createContextForgeHttpServer(workspaceService, {
    workspaceRootDir: process.cwd(),
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`ContextForge Server listening on http://127.0.0.1:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start ContextForge server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
