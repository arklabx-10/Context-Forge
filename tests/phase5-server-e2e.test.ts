import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import { createContextForgeHttpServer } from '../src/server/app-server.js';

describe('Phase 5 — HTTP API Server, Self-Analysis & End-to-End Workflows', () => {
  it('onboards ContextForge itself via HTTP API, searches symbols, builds context packs, and enforces security boundaries', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    const service = new ContextForgeWorkspaceService(store);
    const server = createContextForgeHttpServer(service, {
      workspaceRootDir: process.cwd(),
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Check health & registered adapters
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthData = (await healthRes.json()) as {
        status: string;
        adapters: { adapterId: string }[];
      };
      expect(healthData.status).toBe('ok');
      expect(healthData.adapters.length).toBeGreaterThanOrEqual(6);

      // 2. Onboard ContextForge's own workspace directory
      const onboardRes = await fetch(`${baseUrl}/api/repositories/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootPath: process.cwd(),
          name: 'context-forge-self',
        }),
      });
      expect(onboardRes.status).toBe(200);
      const onboardData = (await onboardRes.json()) as {
        repository: { id: string; name: string };
        snapshot: { stats: { totalFilesIndexed: number; totalSymbolsExtracted: number } };
      };
      expect(onboardData.repository.name).toBe('context-forge-self');
      expect(onboardData.snapshot.stats.totalFilesIndexed).toBeGreaterThan(10);
      expect(onboardData.snapshot.stats.totalSymbolsExtracted).toBeGreaterThan(15);

      const repoId = onboardData.repository.id;

      // 3. Search for a known symbol across the indexed workspace
      const searchRes = await fetch(
        `${baseUrl}/api/search?q=assembleContextPack&repoId=${encodeURIComponent(repoId)}`
      );
      expect(searchRes.status).toBe(200);
      const searchData = (await searchRes.json()) as { hits: { title: string; kind: string }[] };
      expect(searchData.hits.some((h) => h.title.includes('assembleContextPack'))).toBe(true);

      // 4. Read a valid file and verify path traversal is rejected with 404
      const validFileRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repoId)}/file?path=src/domain/models.ts`
      );
      expect(validFileRes.status).toBe(200);

      const traversalRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repoId)}/file?path=../../etc/passwd`
      );
      expect(traversalRes.status).toBe(404);

      const envFileRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repoId)}/file?path=.env`
      );
      expect(envFileRes.status).toBe(404);

      // 5. Generate a Context Pack via HTTP API
      const packRes = await fetch(
        `${baseUrl}/api/repositories/${encodeURIComponent(repoId)}/context-packs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskType: 'understand_module',
            taskTitle: 'Understand ContextForge Domain Models',
            taskDescription: 'Review core epistemic contracts and SourceReference models',
            seedFilePaths: ['src/domain/models.ts'],
            assistantTarget: 'claude_code',
            budget: { maxTotalChars: 12000, maxFilesCount: 5 },
          }),
        }
      );
      expect(packRes.status).toBe(200);
      const packData = (await packRes.json()) as {
        pack: { includedItems: { relativePath: string }[] };
        markdownExport: string;
        plainTextExport: string;
      };
      expect(packData.pack.includedItems[0]?.relativePath).toBe('src/domain/models.ts');
      expect(packData.markdownExport).toContain('<untrusted_repository_content path="src/domain/models.ts"');
      expect(packData.plainTextExport).toContain('FILE: src/domain/models.ts');

      // 6. Test Privacy Purge endpoint
      const purgeRes = await fetch(`${baseUrl}/api/settings/privacy/purge`, { method: 'POST' });
      expect(purgeRes.status).toBe(200);
      const purgeData = (await purgeRes.json()) as {
        purged: boolean;
        status: { totalRepositoriesIndexed: number };
      };
      expect(purgeData.purged).toBe(true);
      expect(purgeData.status.totalRepositoriesIndexed).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
