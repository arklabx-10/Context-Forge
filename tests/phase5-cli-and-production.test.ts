import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseCliArgs, runCli } from '../src/cli/index.js';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import { createContextForgeHttpServer } from '../src/server/app-server.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

function createBufferedIo(): {
  io: { stdout(m: string): void; stderr(m: string): void };
  getStdout(): string;
  getStderr(): string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    io: {
      stdout: (m: string) => stdoutChunks.push(m),
      stderr: (m: string) => stderrChunks.push(m),
    },
    getStdout: () => stdoutChunks.join('\n'),
    getStderr: () => stderrChunks.join('\n'),
  };
}

describe('Phase 5 — ContextForge CLI, CI/CD Headless Workflows & Production Packaging', () => {
  it('1. Correctly parses commands, positionals, key-value flags, and short flags', () => {
    const parsed1 = parseCliArgs([
      'onboard',
      './my-repo',
      '--name',
      'test-project',
      '--json',
      '-v',
    ]);
    assert.equal(parsed1.command, 'onboard');
    assert.deepEqual(parsed1.positionals, ['./my-repo']);
    assert.equal(parsed1.flags.name, 'test-project');
    assert.equal(parsed1.flags.json, true);
    assert.equal(parsed1.flags.version, true);

    const parsed2 = parseCliArgs([
      'pack',
      '.',
      '--task=Refactor billing',
      '--budget=12000',
      '-o',
      'out.md',
    ]);
    assert.equal(parsed2.command, 'pack');
    assert.equal(parsed2.flags.task, 'Refactor billing');
    assert.equal(parsed2.flags.budget, '12000');
    assert.equal(parsed2.flags.o, 'out.md');
  });

  it('2. Outputs version and help information with exit code 0', async () => {
    const versionIo = createBufferedIo();
    const vCode = await runCli(['--version'], versionIo.io);
    assert.equal(vCode, 0);
    assert.ok(versionIo.getStdout().includes('contextforge 0.1.0'));

    const helpIo = createBufferedIo();
    const hCode = await runCli(['--help'], helpIo.io);
    assert.equal(hCode, 0);
    assert.ok(helpIo.getStdout().includes('USAGE:'));
    assert.ok(helpIo.getStdout().includes('onboard [path]'));
    assert.ok(helpIo.getStdout().includes('pack [path]'));
    assert.ok(helpIo.getStdout().includes('review [path]'));
  });

  it('3. Runs `onboard` command, analyzes repository, and supports --json output', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-cli-onboard-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const fixturePath = path.join(FIXTURES_DIR, 'polyglot-monorepo');

    try {
      // Human-readable format
      const humanIo = createBufferedIo();
      const code1 = await runCli(
        ['onboard', fixturePath, '--name', 'acme-monorepo', '--db', dbPath],
        humanIo.io
      );
      assert.equal(code1, 0);
      assert.ok(humanIo.getStdout().includes('ContextForge Analysis Complete: acme-monorepo'));
      assert.ok(humanIo.getStdout().includes('Total Files'));
      assert.ok(humanIo.getStdout().includes('Sub-Projects'));

      // JSON format
      const jsonIo = createBufferedIo();
      const code2 = await runCli(
        ['onboard', fixturePath, '--json', '--db', dbPath],
        jsonIo.io
      );
      assert.equal(code2, 0);
      const data = JSON.parse(jsonIo.getStdout()) as {
        repository: { name: string };
        snapshotStats: { totalFilesIndexed: number; totalSymbolsExtracted: number };
        subProjects: { name: string; languages: string[] }[];
      };
      assert.ok(data.repository.name);
      assert.ok(data.snapshotStats.totalFilesIndexed > 0);
      assert.ok(data.subProjects.length >= 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Runs `pack` command, enforces required --task, and writes deterministic context packs to file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-cli-pack-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const outFile = path.join(tmpDir, 'context-pack.md');
    const fixturePath = path.join(FIXTURES_DIR, 'polyglot-monorepo');

    try {
      // 1. Missing --task should fail with error message
      const failIo = createBufferedIo();
      const failCode = await runCli(['pack', fixturePath, '--db', dbPath], failIo.io);
      assert.equal(failCode, 1);
      assert.ok(failIo.getStderr().includes('--task <title> is required'));

      // 2. Successful context pack output to file
      const packIo = createBufferedIo();
      const packCode = await runCli(
        [
          'pack',
          fixturePath,
          '--task',
          'Implement multi-currency invoice calculation',
          '--target',
          'claude_code',
          '--budget',
          '8000',
          '--seed',
          'apps/web-portal/src/BillingView.tsx',
          '--db',
          dbPath,
          '-o',
          outFile,
        ],
        packIo.io
      );
      assert.equal(packCode, 0);

      const savedPack = await fs.readFile(outFile, 'utf-8');
      assert.ok(savedPack.includes('# ContextForge Task Context Pack: Implement multi-currency invoice calculation'));
      assert.ok(savedPack.includes('<untrusted_repository_content'));
      assert.ok(savedPack.includes('BillingView.tsx'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Runs `review` command with --fail-on-critical, failing CI pipelines on destructive SQL operations or prompt injections', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-cli-review-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const fixturePath = path.join(FIXTURES_DIR, 'polyglot-monorepo');
    const riskyDiffPath = path.join(tmpDir, 'risky.patch');
    const safeDiffPath = path.join(tmpDir, 'safe.patch');

    try {
      // Create a risky patch with destructive DROP TABLE and unbounded DELETE
      await fs.writeFile(
        riskyDiffPath,
        [
          'diff --git a/db/migrations/002_destructive.sql b/db/migrations/002_destructive.sql',
          'new file mode 100644',
          'index 0000000..1111111',
          '--- /dev/null',
          '+++ b/db/migrations/002_destructive.sql',
          '@@ -0,0 +1,3 @@',
          '+DROP TABLE customer_records;',
          '+DELETE FROM accounts;',
        ].join('\n'),
        'utf-8'
      );

      // Create a safe patch
      await fs.writeFile(
        safeDiffPath,
        [
          'diff --git a/docs/README.md b/docs/README.md',
          'index 0000000..1111111 100644',
          '--- a/docs/README.md',
          '+++ b/docs/README.md',
          '@@ -1,1 +1,2 @@',
          '+# Updated Documentation',
        ].join('\n'),
        'utf-8'
      );

      // 1. Risky diff with --fail-on-critical must exit with code 1
      const riskyIo = createBufferedIo();
      const riskyCode = await runCli(
        [
          'review',
          fixturePath,
          '--raw-diff',
          riskyDiffPath,
          '--fail-on-critical',
          '--db',
          dbPath,
        ],
        riskyIo.io
      );
      assert.equal(riskyCode, 1, 'Expected exit code 1 for critical diff issues in CI mode');
      assert.ok(riskyIo.getStdout().includes('[CRITICAL]'));
      assert.ok(riskyIo.getStdout().includes('Destructive SQL statement'));
      assert.ok(riskyIo.getStderr().includes('CI check failed'));

      // 2. Safe diff with --fail-on-critical must exit with code 0
      const safeIo = createBufferedIo();
      const safeCode = await runCli(
        [
          'review',
          fixturePath,
          '--raw-diff',
          safeDiffPath,
          '--fail-on-critical',
          '--db',
          dbPath,
        ],
        safeIo.io
      );
      assert.equal(safeCode, 0, 'Expected exit code 0 for safe diff');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Runs `report` command and outputs deterministic Markdown repository report', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-cli-report-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const reportFile = path.join(tmpDir, 'report.md');
    const fixturePath = path.join(FIXTURES_DIR, 'python-service-project');

    try {
      const reportIo = createBufferedIo();
      const code = await runCli(
        ['report', fixturePath, '--db', dbPath, '-o', reportFile],
        reportIo.io
      );
      assert.equal(code, 0);

      const content = await fs.readFile(reportFile, 'utf-8');
      assert.ok(content.includes('# ContextForge Repository Analysis Report:'));
      assert.ok(content.includes('Deterministic Local Engine'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('7. Serves production static UI assets and provides SPA routing fallback', async () => {
    const store = new ContextForgeSqliteStore(':memory:');
    const service = new ContextForgeWorkspaceService(store);
    const server = createContextForgeHttpServer(service, {
      workspaceRootDir: process.cwd(),
      staticUiDistDir: path.join(process.cwd(), 'dist', 'ui'),
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. GET / serves index.html
      const rootRes = await fetch(`${baseUrl}/`);
      assert.equal(rootRes.status, 200);
      assert.ok(rootRes.headers.get('content-type')?.includes('text/html'));
      const htmlText = await rootRes.text();
      assert.ok(htmlText.includes('<div id="root">') || htmlText.includes('ContextForge'));

      // 2. SPA route fallback (e.g. GET /explorer) serves index.html
      const spaRes = await fetch(`${baseUrl}/explorer`);
      assert.equal(spaRes.status, 200);
      assert.ok(spaRes.headers.get('content-type')?.includes('text/html'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
