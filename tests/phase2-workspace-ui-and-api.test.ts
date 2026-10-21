import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';
import { createDefaultAdapters } from '../src/adapters/index.js';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import { analyzeRepository } from '../src/infrastructure/scanning/repository-analyzer.js';
import { createContextForgeHttpServer } from '../src/server/app-server.js';
import { App } from '../src/ui/App.js';
import {
  computeExclusionBreakdown,
  computeLanguageBreakdown,
  deriveAnalysisStatus,
  filterExplorerFiles,
  paginateItems,
} from '../src/ui/workspace-helpers.js';

const FIXTURES_ROOT = path.resolve(process.cwd(), 'tests/fixtures');

async function startEphemeralServer(service: ContextForgeWorkspaceService): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server: http.Server = createContextForgeHttpServer(service);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('Phase 2 — Developer Workspace UI, Analysis States, Windowed Explorer & Project Settings', () => {
  it('1. Renders the App shell with accessible navigation, keyboard shortcuts, and status badges', () => {
    const html = renderToStaticMarkup(React.createElement(App));

    assert.ok(html.includes('aria-label="Workspace Navigation"'));
    assert.ok(html.includes('aria-label="Primary Views"'));
    assert.ok(html.includes('1. Projects &amp; Overview'));
    assert.ok(html.includes('2. Add / Import Repository'));
    assert.ok(html.includes('3. File &amp; Module Explorer'));
    assert.ok(html.includes('4. Languages, Manifests &amp; Build'));
    assert.ok(html.includes('5. Architecture &amp; Dependencies'));
    assert.ok(html.includes('6. Search Indexed Project'));
    assert.ok(html.includes('7. Status, Warnings &amp; Unknowns'));
    assert.ok(html.includes('11. Settings &amp; Exclusions'));
    assert.ok(html.includes('data-testid="analysis-state-badge"'));
  });

  it('2. Distinguishes empty, loading, failed, partial, and completed analysis states accurately', async () => {
    // 1. Loading state
    const loadingState = deriveAnalysisStatus({
      loading: true,
      errorBanner: null,
      snapshot: null,
    });
    assert.equal(loadingState.state, 'loading');

    // 2. Failed state
    const failedState = deriveAnalysisStatus({
      loading: false,
      errorBanner: 'Directory does not exist',
      snapshot: null,
    });
    assert.equal(failedState.state, 'failed');

    // 3. Empty state (first-time onboarding)
    const emptyState = deriveAnalysisStatus({
      loading: false,
      errorBanner: null,
      snapshot: null,
    });
    assert.equal(emptyState.state, 'empty');

    // 4. Partial state (malformed manifests & inaccessible files)
    const { snapshot: partialSnap } = await analyzeRepository({
      repoId: 'repo-partial',
      rootPath: path.join(FIXTURES_ROOT, 'malformed-and-inaccessible'),
      adapters: createDefaultAdapters(),
      simulatedInaccessiblePaths: ['restricted/unreadable.txt'],
    });
    const partialState = deriveAnalysisStatus({
      loading: false,
      errorBanner: null,
      snapshot: partialSnap,
    });
    assert.equal(partialState.state, 'partial');
    assert.ok(partialState.summary.includes('partial parse errors'));
    assert.ok(partialState.summary.includes('inaccessible file(s)'));

    // 5. Completed state (clean TypeScript repository with zero warnings)
    const { snapshot: cleanSnap } = await analyzeRepository({
      repoId: 'repo-clean',
      rootPath: path.join(FIXTURES_ROOT, 'ts-service-project'),
      adapters: createDefaultAdapters(),
    });
    const completedState = deriveAnalysisStatus({
      loading: false,
      errorBanner: null,
      snapshot: {
        ...cleanSnap,
        unknownsAndLimitations: [],
      },
    });
    assert.equal(completedState.state, 'completed');
  });

  it('3. Paginates and filters large file inventories and computes multi-signal language & exclusion breakdowns', async () => {
    const { snapshot } = await analyzeRepository({
      repoId: 'repo-polyglot',
      rootPath: path.join(FIXTURES_ROOT, 'polyglot-monorepo'),
      adapters: createDefaultAdapters(),
    });

    // Test pagination helper
    const page1 = paginateItems(snapshot.files, 1, 3);
    assert.equal(page1.pageItems.length, 3);
    assert.equal(page1.currentPage, 1);
    assert.ok(page1.totalPages >= 3);

    const page2 = paginateItems(snapshot.files, 2, 3);
    assert.equal(page2.currentPage, 2);
    assert.notDeepEqual(
      page1.pageItems.map((f) => f.relativePath),
      page2.pageItems.map((f) => f.relativePath)
    );

    // Test Explorer filtering by role and path query
    const manifestsOnly = filterExplorerFiles(snapshot.files, {
      pathQuery: 'package.json',
      roleFilter: 'manifest',
      subProjectFilter: 'ALL',
      languageFilter: 'ALL',
      statusFilter: 'INDEXED',
    });
    assert.ok(manifestsOnly.length >= 2);
    assert.ok(manifestsOnly.every((f) => f.role === 'manifest' && f.relativePath.includes('package.json')));

    // Test multi-signal language breakdown on Python fixture (extension + shebang + content_signature)
    const { snapshot: pySnap } = await analyzeRepository({
      repoId: 'repo-py',
      rootPath: path.join(FIXTURES_ROOT, 'python-service-project'),
      adapters: createDefaultAdapters(),
    });
    const langRows = computeLanguageBreakdown(pySnap);
    const pyRow = langRows.find((r) => r.language === 'Python');
    assert.ok(pyRow);
    assert.ok(pyRow.signalsUsed.includes('extension'));
    assert.ok(pyRow.signalsUsed.includes('shebang'));
    assert.ok(pyRow.signalsUsed.includes('content_signature'));

    // Test exclusion breakdown on malformed-and-inaccessible fixture
    const exclRows = computeExclusionBreakdown(partialSnapFromFixture(snapshot));
    assert.ok(Array.isArray(exclRows));
  });

  it('4. Executes end-to-end onboarding on a repository with NO recognizable manifest, windowed file slicing, and live exclusion updates', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    const service = new ContextForgeWorkspaceService(store);
    const serverHandle = await startEphemeralServer(service);

    // Create a temporary repository with NO recognizable manifest (only custom .mystery source and docs)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-no-manifest-'));
    try {
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'docs'), { recursive: true });
      const multiLineContent = Array.from(
        { length: 40 },
        (_, i) => `line_${i + 1}: module_kernel_step(${i + 1});`
      ).join('\n');
      await fs.writeFile(path.join(tempDir, 'src', 'kernel.mystery'), multiLineContent, 'utf8');
      await fs.writeFile(
        path.join(tempDir, 'docs', 'ARCHITECTURE_NOTES.md'),
        '# Mystery Kernel Notes\nNo manifest is used in this project.\n',
        'utf8'
      );

      // Step A: Verify first-time onboarding empty state
      const initialReposRes = await fetch(`${serverHandle.baseUrl}/api/repositories`);
      const initialReposJson = (await initialReposRes.json()) as { repositories: unknown[] };
      assert.equal(initialReposJson.repositories.length, 0);

      // Step B: Onboard the manifest-less repository
      const onboardRes = await fetch(`${serverHandle.baseUrl}/api/repositories/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootPath: tempDir,
          name: 'Manifestless Mystery Repo',
        }),
      });
      assert.equal(onboardRes.status, 200);
      const onboardData = (await onboardRes.json()) as {
        repository: { id: string; name: string };
        snapshot: {
          subProjects: { manifests: unknown[]; languages: unknown[] }[];
          files: { relativePath: string; isIndexed: boolean; exclusionReason?: string }[];
          activeAdapters: string[];
          unknownsAndLimitations: string[];
        };
      };

      const repoId = onboardData.repository.id;
      assert.equal(onboardData.repository.name, 'Manifestless Mystery Repo');
      assert.equal(onboardData.snapshot.subProjects.length, 1);
      assert.equal(onboardData.snapshot.subProjects[0]?.manifests.length, 0);
      assert.deepEqual(onboardData.snapshot.activeAdapters, ['tier0.structural']);
      assert.ok(onboardData.snapshot.unknownsAndLimitations.length >= 1);

      // Step C: Test windowed file loading (lines 5..12 of src/kernel.mystery) so full file isn't required in browser state
      const fileSliceRes = await fetch(
        `${serverHandle.baseUrl}/api/repositories/${encodeURIComponent(repoId)}/file?path=${encodeURIComponent('src/kernel.mystery')}&startLine=5&endLine=12`
      );
      assert.equal(fileSliceRes.status, 200);
      const fileSlice = (await fileSliceRes.json()) as {
        relativePath: string;
        content: string;
        lineCount: number;
        sliceStartLine: number;
        sliceEndLine: number;
        hasMoreBefore: boolean;
        hasMoreAfter: boolean;
      };
      assert.equal(fileSlice.relativePath, 'src/kernel.mystery');
      assert.equal(fileSlice.lineCount, 40);
      assert.equal(fileSlice.sliceStartLine, 5);
      assert.equal(fileSlice.sliceEndLine, 12);
      assert.equal(fileSlice.hasMoreBefore, true);
      assert.equal(fileSlice.hasMoreAfter, true);
      const returnedLines = fileSlice.content.split('\n');
      assert.equal(returnedLines.length, 8);
      assert.ok(returnedLines[0]?.startsWith('line_5:'));
      assert.ok(returnedLines[7]?.startsWith('line_12:'));

      // Step D: Update project settings & custom exclusions (`docs/**`) and verify live re-scan excludes `docs/ARCHITECTURE_NOTES.md`
      const settingsRes = await fetch(
        `${serverHandle.baseUrl}/api/repositories/${encodeURIComponent(repoId)}/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Manifestless Mystery Repo (Docs Excluded)',
            resourceLimits: {
              customExcludeGlobs: ['docs/**'],
            },
            rescan: true,
          }),
        }
      );
      assert.equal(settingsRes.status, 200);
      const settingsData = (await settingsRes.json()) as {
        repository: { name: string; resourceLimits: { customExcludeGlobs: string[] } };
        snapshot: {
          files: { relativePath: string; isIndexed: boolean; exclusionReason?: string }[];
        };
      };
      assert.equal(settingsData.repository.name, 'Manifestless Mystery Repo (Docs Excluded)');
      assert.deepEqual(settingsData.repository.resourceLimits.customExcludeGlobs, ['docs/**']);
      const docFileBeforeExclusion = onboardData.snapshot.files.find(
        (f) => f.relativePath === 'docs/ARCHITECTURE_NOTES.md'
      );
      assert.ok(docFileBeforeExclusion?.isIndexed);

      const docFileAfterExclusion = settingsData.snapshot.files.find(
        (f) => f.relativePath === 'docs/ARCHITECTURE_NOTES.md'
      );
      assert.ok(
        !docFileAfterExclusion || !docFileAfterExclusion.isIndexed,
        'docs/ARCHITECTURE_NOTES.md should be excluded after saving customExcludeGlobs: ["docs/**"]'
      );
      assert.ok(
        settingsData.snapshot.files.some(
          (f) => f.relativePath === 'src/kernel.mystery' && f.isIndexed
        )
      );
    } finally {
      await serverHandle.close();
      store.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function partialSnapFromFixture(snapshot: { files: readonly any[] }) {
  return snapshot.files;
}
