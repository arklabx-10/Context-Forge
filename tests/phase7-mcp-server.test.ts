import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { ContextForgeWorkspaceService } from '../src/application/workspace-service.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import {
  JSON_RPC_ERRORS,
  MCP_TOOLS,
  createMcpMessageHandler,
  type JsonRpcResponse,
  type McpMessageHandler,
} from '../src/server/mcp-server.js';

const FIXTURES_ROOT = path.resolve(process.cwd(), 'tests/fixtures');
const POLYGLOT = path.join(FIXTURES_ROOT, 'polyglot-monorepo');
const SECRETS = path.join(FIXTURES_ROOT, 'malformed-and-inaccessible');

const RISKY_DIFF = [
  'diff --git a/db/migrations/001_initial_schema.sql b/db/migrations/001_initial_schema.sql',
  'index 3333333..4444444 100644',
  '--- a/db/migrations/001_initial_schema.sql',
  '+++ b/db/migrations/001_initial_schema.sql',
  '@@ -18,2 +18,3 @@ SELECT id, account_id, subtotal_cents',
  ' FROM invoices',
  " WHERE status = 'open';",
  '+DROP TABLE invoices;',
].join('\n');

function toolText(response: JsonRpcResponse | null): { text: string; isError: boolean } {
  assert.ok(response, 'expected a response');
  assert.equal(response.error, undefined, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`);
  const result = response.result as { content: { type: string; text: string }[]; isError: boolean };
  assert.equal(result.content[0]?.type, 'text');
  return { text: result.content[0]?.text ?? '', isError: result.isError };
}

describe('Phase 7 — MCP server (stdio JSON-RPC) for AI coding assistants', () => {
  let store: ContextForgeSqliteStore;
  let handle: McpMessageHandler;
  let nextId = 1;
  const call = (method: string, params?: unknown) => handle({ jsonrpc: '2.0', id: nextId++, method, params });
  const callTool = (name: string, args: unknown) => call('tools/call', { name, arguments: args });

  beforeAll(() => {
    store = new ContextForgeSqliteStore(':memory:');
    handle = createMcpMessageHandler(new ContextForgeWorkspaceService(store), { name: 'contextforge', version: 'test' });
  });

  afterAll(() => store.close());

  it('1. Negotiates protocol version, answers ping, and never responds to notifications', async () => {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const result = init?.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } };
    assert.equal(result.protocolVersion, '2025-06-18', 'echoes a supported client version');
    assert.ok(result.capabilities.tools);
    assert.equal(result.serverInfo.name, 'contextforge');

    const unknownVersion = await call('initialize', { protocolVersion: '1999-01-01' });
    assert.equal((unknownVersion?.result as { protocolVersion: string }).protocolVersion, '2025-11-25', 'falls back to latest supported');

    assert.deepEqual((await call('ping'))?.result, {});
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  });

  it('2. Lists five tools with object input schemas and required repoPath', async () => {
    const res = await call('tools/list');
    const tools = (res?.result as { tools: typeof MCP_TOOLS }).tools;
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['build_context_pack', 'knowledge_audit', 'onboard_repository', 'review_changes', 'search_repository'],
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok((tool.inputSchema.required as string[]).includes('repoPath'), `${tool.name} requires repoPath`);
      assert.ok(tool.description.length > 20);
    }
  });

  it('3. Returns JSON-RPC errors for unknown methods, unknown tools and malformed requests', async () => {
    assert.equal((await call('does/not/exist'))?.error?.code, JSON_RPC_ERRORS.methodNotFound);
    assert.equal((await callTool('rm_rf', {}))?.error?.code, JSON_RPC_ERRORS.invalidParams);
    assert.equal((await call('tools/call', {}))?.error?.code, JSON_RPC_ERRORS.invalidParams);
    assert.equal((await handle({ id: 5, method: 'ping' }))?.error?.code, JSON_RPC_ERRORS.invalidRequest);
    assert.equal((await handle([1, 2]))?.error?.code, JSON_RPC_ERRORS.invalidRequest);
  });

  it('3b. Reports invalid tool arguments in-band (isError) so the model can correct itself', async () => {
    const missing = toolText(await callTool('search_repository', { repoPath: POLYGLOT }));
    assert.equal(missing.isError, true);
    assert.match(missing.text, /"query" is required/);

    const badEnum = toolText(await callTool('build_context_pack', { repoPath: POLYGLOT, task: 'x', taskType: 'delete_everything' }));
    assert.equal(badEnum.isError, true);
    assert.match(badEnum.text, /"taskType" must be one of/);

    const notObject = toolText(await callTool('onboard_repository', 'not-an-object'));
    assert.equal(notObject.isError, true);
    assert.match(notObject.text, /must be a JSON object/);
  });

  it('4. Reports tool execution failures in-band with isError instead of crashing', async () => {
    const res = toolText(await callTool('onboard_repository', { repoPath: path.join(FIXTURES_ROOT, 'no-such-repo-xyz') }));
    assert.equal(res.isError, true);
    assert.match(res.text, /onboard_repository failed/);
  });

  it('5. onboard_repository summarizes sub-projects and languages of a polyglot monorepo', async () => {
    const { text, isError } = toolText(await callTool('onboard_repository', { repoPath: POLYGLOT }));
    assert.equal(isError, false);
    assert.match(text, /Sub-projects \(4\)/);
    assert.match(text, /@acme\/web-portal/);
    assert.match(text, /services\/python-pricing.*Python/);
  });

  it('6. search_repository returns hits with snippets fenced as untrusted repository content', async () => {
    const { text, isError } = toolText(await callTool('search_repository', { repoPath: POLYGLOT, query: 'invoice', limit: 5 }));
    assert.equal(isError, false);
    assert.match(text, /Search results for "invoice"/);
    const opens = text.match(/<untrusted_repository_content /g)?.length ?? 0;
    const closes = text.match(/<\/untrusted_repository_content>/g)?.length ?? 0;
    assert.ok(opens > 0, 'snippets are fenced');
    assert.equal(opens, closes, 'every fence is closed');
  });

  it('7. build_context_pack returns a fenced, deterministic pack and never includes secret files', async () => {
    const args = { repoPath: POLYGLOT, task: 'Add multi-currency support to invoice billing', budgetChars: 12000, maxFiles: 8 };
    const first = toolText(await callTool('build_context_pack', args));
    const second = toolText(await callTool('build_context_pack', args));
    assert.equal(first.isError, false);
    assert.match(first.text, /Add multi-currency support to invoice billing/);
    assert.match(first.text, /<untrusted_repository_content /);
    const stripVolatile = (t: string) => t.replace(/snap_[a-z0-9-]+/g, 'SNAP').replace(/pack_[a-z0-9-]+/g, 'PACK');
    assert.equal(stripVolatile(first.text), stripVolatile(second.text), 'same inputs produce the same pack');

    const secretPack = toolText(await callTool('build_context_pack', { repoPath: SECRETS, task: 'Explain configuration and env setup' }));
    assert.equal(secretPack.isError, false);
    assert.ok(!secretPack.text.includes('sk_live_do_not_index_or_export_999999'), 'secret values never leave via MCP');
    assert.ok(!secretPack.text.includes('top_secret_password'));
  });

  it('8. review_changes flags destructive SQL in a supplied diff and fences the report', async () => {
    const { text, isError } = toolText(await callTool('review_changes', { repoPath: POLYGLOT, diff: RISKY_DIFF }));
    assert.equal(isError, false);
    assert.match(text, /[1-9]\d* critical/);
    assert.match(text, /DROP TABLE/);
    assert.match(text, /<untrusted_repository_content path="change-review:/);
  });

  it('9. knowledge_audit reports drift counts for the repository', async () => {
    const { text, isError } = toolText(await callTool('knowledge_audit', { repoPath: POLYGLOT }));
    assert.equal(isError, false);
    assert.match(text, /Knowledge audit: polyglot-monorepo/);
    assert.match(text, /Total entries: \d+/);
  });

  it('10. `contextforge mcp` speaks newline-delimited JSON-RPC over real stdio with no stdout pollution', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-mcp-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', 'src/cli/index.ts', 'mcp', '--db', path.join(tempDir, 'mcp.db')],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_NO_WARNINGS: '1' } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));

    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'onboard_repository', arguments: { repoPath: POLYGLOT } } },
    ];
    child.stdin.write(messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
    child.stdin.write('this is not json\n');
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve));
    await fs.rm(tempDir, { recursive: true, force: true });

    assert.equal(exitCode, 0, `server exited cleanly (stderr: ${stderr})`);
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    const responses = lines.map((l) => JSON.parse(l) as JsonRpcResponse); // throws if anything but JSON hit stdout
    assert.deepEqual(responses.map((r) => r.id), [1, 2, 3, null], 'one response per request, none for the notification');
    assert.ok((responses[1]?.result as { tools: unknown[] }).tools.length === 5);
    assert.match(JSON.stringify(responses[2]?.result), /Sub-projects \(4\)/);
    assert.equal(responses[3]?.error?.code, JSON_RPC_ERRORS.parseError);
    assert.match(stderr, /MCP server .* ready on stdio/);
  }, 60_000);
});
