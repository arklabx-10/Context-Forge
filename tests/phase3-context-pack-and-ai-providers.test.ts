import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { createDefaultAdapters } from '../src/adapters/index.js';
import {
  AiInputSizeExceededError,
  AiRateLimitError,
  AiRequestCancelledError,
  AiSensitiveFileDisclosedError,
  AiTimeoutError,
  ConsentGatedExternalAiProvider,
  ConsentRequiredError,
  createOutboundConsentPreview,
  NoOpDeterministicProvider,
} from '../src/infrastructure/ai/ai-providers.js';
import { assembleContextPack } from '../src/infrastructure/context-engine/context-assembler.js';
import {
  AGENT_PROMPT_TEMPLATES,
  DeterministicContextExporter,
  exportContextPack,
} from '../src/infrastructure/context-engine/context-exporters.js';
import { ContextForgeSqliteStore } from '../src/infrastructure/persistence/sqlite-store.js';
import { analyzeRepository } from '../src/infrastructure/scanning/repository-analyzer.js';

const FIXTURES_ROOT = path.resolve(process.cwd(), 'tests/fixtures');

describe('Phase 3 — Task-Specific AI Context Generation, Budgets, Stale Files & Provider Resilience', () => {
  it('1. Enforces context budgets, maxCharsPerFile truncation, maxFileSizeBytes, user seed files, and user exclusions', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'polyglot-monorepo');
    const { snapshot, indexedFileContents } = await analyzeRepository({
      repoId: 'repo-phase3-budget',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const pack = await assembleContextPack({
      snapshot,
      indexedFileContents,
      knowledgeEntries: [],
      taskType: 'implement_feature',
      taskTitle: 'Update billing invoice calculation and currency formatting',
      taskDescription: 'Ensure BillingView and shared contracts stay synchronized.',
      seedFilePaths: ['apps/web-portal/src/BillingView.tsx'],
      excludedFilePaths: ['services/python-pricing/src/calculator.py'],
      budget: {
        maxTotalChars: 3500,
        maxFilesCount: 3,
        maxCharsPerFile: 600,
        maxFileSizeBytes: 50, // Intentionally tiny so non-seed files larger than 50 bytes are omitted as file_too_large
        includeTests: true,
        includeKnowledgeAndAdrs: true,
        includeDependencyGraphSummary: true,
      },
    });

    // 1. Budget & file count limits must be respected
    assert.ok(pack.includedItems.length <= 3);
    assert.ok(pack.usedChars <= 3500);

    // 2. Seed file must be ranked #1 with 'seed_file' contribution (+500)
    const firstItem = pack.includedItems[0];
    assert.ok(firstItem);
    assert.equal(firstItem.relativePath, 'apps/web-portal/src/BillingView.tsx');
    assert.ok(firstItem.scoreBreakdown.some((b) => b.ruleId === 'seed_file' && b.points === 500));

    // 3. User-excluded file must be in omittedItems with reason 'excluded_by_user'
    const userExcluded = pack.omittedItems.find(
      (o) => o.relativePath === 'services/python-pricing/src/calculator.py'
    );
    assert.ok(userExcluded, 'Expected calculator.py to be omitted as excluded_by_user');
    assert.equal(userExcluded.reason, 'excluded_by_user');

    // 4. Non-seed files larger than maxFileSizeBytes (50 bytes) must be omitted with reason 'file_too_large'
    assert.ok(
      pack.omittedItems.some((o) => o.reason === 'file_too_large'),
      'Expected non-seed files exceeding maxFileSizeBytes to be omitted with file_too_large'
    );

    // 5. Secret files (.env) must be omitted with reason 'excluded_sensitive'
    const secretsRepoPath = path.join(FIXTURES_ROOT, 'malformed-and-inaccessible');
    const secretsScan = await analyzeRepository({
      repoId: 'repo-phase3-secrets',
      rootPath: secretsRepoPath,
      adapters: createDefaultAdapters(),
    });
    const secretsPack = await assembleContextPack({
      snapshot: secretsScan.snapshot,
      indexedFileContents: secretsScan.indexedFileContents,
      knowledgeEntries: [],
      taskType: 'security_audit',
      taskTitle: 'Audit health check and environment handling',
      taskDescription: 'Verify secrets are never included in context packs.',
    });
    assert.ok(
      secretsPack.omittedItems.some(
        (o) => o.relativePath === '.env' && o.reason === 'excluded_sensitive'
      ),
      'Expected sensitive .env file to be omitted as excluded_sensitive'
    );
    assert.ok(
      !secretsPack.includedItems.some((i) => i.relativePath === '.env'),
      'Secret .env file must never appear in includedItems'
    );
  });

  it('2. Verifies source-reference integrity, selection rationale, multi-agent templates, and strict separation of AI interpretations', async () => {
    const repoPath = path.join(FIXTURES_ROOT, 'ts-service-project');
    const { snapshot, indexedFileContents } = await analyzeRepository({
      repoId: 'repo-phase3-integrity',
      rootPath: repoPath,
      adapters: createDefaultAdapters(),
    });

    const basePack = await assembleContextPack({
      snapshot,
      indexedFileContents,
      knowledgeEntries: [],
      taskType: 'implement_feature',
      taskTitle: 'Add order cancellation endpoint to router',
      taskDescription: 'Update router.ts and OpenAPI specification.',
      seedFilePaths: ['src/index.ts'],
      assistantTarget: 'claude_code',
      customTemplateInstruction: 'Always run unit tests after modifying router endpoints.',
    });

    // Verify source-reference integrity against snapshot file inventory
    const snapshotFileMap = new Map(snapshot.files.map((f) => [f.relativePath, f]));
    for (const item of basePack.includedItems) {
      const snapFile = snapshotFileMap.get(item.relativePath);
      assert.ok(snapFile, `Included file ${item.relativePath} must exist in snapshot`);
      assert.equal(item.sourceRef.fileSha256, snapFile.sha256);
      assert.ok(item.startLine >= 1);
      assert.ok(item.endLine >= item.startLine);
      assert.ok(item.endLine <= (snapFile.lineCount ?? 1));
      assert.ok(item.scoreBreakdown.length >= 1, 'Every selected file must explain why it was selected');
    }

    // Verify 1-hop dependency neighbor (src/router.ts is imported by seed src/index.ts)
    const routerItem = basePack.includedItems.find((i) => i.relativePath === 'src/router.ts');
    assert.ok(routerItem, 'Expected 1-hop neighbor src/router.ts to be selected');
    assert.ok(
      routerItem.scoreBreakdown.some((b) => b.ruleId === 'dependency_neighbor'),
      'Expected dependency_neighbor rule contribution on src/router.ts'
    );

    // Verify relevantDependencies includes the verified import edge
    assert.ok(
      basePack.relevantDependencies?.some((d) =>
        d.value.includes('src/index.ts -> src/router.ts')
      )
    );

    // Attach an optional AI interpretation and verify strict separation in Markdown & Plain-Text exports
    const packWithAi = {
      ...basePack,
      aiInterpretation: {
        providerId: 'openai_compatible',
        modelName: 'gpt-4.1-mini',
        certainty: 'ai_generated' as const,
        summaryMarkdown: 'Suggested adding `DELETE /api/orders/:id` in `src/router.ts`.',
        generatedAtIso: '2026-01-01T00:00:00.000Z',
      },
    };

    const exporter = new DeterministicContextExporter();
    const md = exporter.exportPack(packWithAi, 'markdown');
    const txt = exportContextPack(packWithAi, 'plaintext');

    // Verify Claude Code template directive & custom instruction
    assert.ok(md.includes(AGENT_PROMPT_TEMPLATES.claude_code.preambleDirective));
    assert.ok(md.includes('Always run unit tests after modifying router endpoints.'));
    assert.ok(md.includes('**Why Selected**:'));
    assert.ok(md.includes('<untrusted_repository_content'));

    // Verify strict separation between verified evidence (Section 2, 3, 5) and AI interpretation (Section 6)
    assert.ok(md.includes('## 2. Architecture & Sub-Project Topology (Verified Evidence)'));
    assert.ok(md.includes('## 3. Verified Dependencies & Module Relationships'));
    assert.ok(md.includes('## 5. Selected Repository Files (Untrusted Data Fence)'));
    assert.ok(
      md.includes(
        '## 6. Optional AI-Generated Task Interpretation [NON-AUTHORITATIVE — AI_GENERATED]'
      )
    );
    assert.ok(
      txt.includes(
        '--- SECTION 6: OPTIONAL AI-GENERATED INTERPRETATION [NON-AUTHORITATIVE - AI_GENERATED] ---'
      )
    );
  });

  it('3. Flags or rejects stale source files modified on disk after snapshot capture', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-stale-pack-'));
    try {
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      const filePath = path.join(tempDir, 'src', 'billing.ts');
      await fs.writeFile(
        filePath,
        'export function computeTotal(cents: number): number {\n  return cents;\n}\n',
        'utf8'
      );

      // Analyze initial state
      const { snapshot } = await analyzeRepository({
        repoId: 'repo-stale-check',
        rootPath: tempDir,
        adapters: createDefaultAdapters(),
      });

      // Modify src/billing.ts on disk AFTER the snapshot was taken
      await fs.writeFile(
        filePath,
        'export function computeTotal(cents: number): number {\n  return cents * 2; // modified on disk!\n}\n',
        'utf8'
      );

      // Policy A: 'flag' (default) — includes the file but flags it as stale
      const flaggedPack = await assembleContextPack({
        snapshot,
        // Omit indexedFileContents so assembleContextPack reads live disk and verifies SHA-256 against snapshot
        knowledgeEntries: [],
        taskType: 'fix_bug',
        taskTitle: 'Fix total computation',
        taskDescription: 'Inspect billing.ts',
        seedFilePaths: ['src/billing.ts'],
        budget: {
          staleFilePolicy: 'flag',
        },
      });

      const flaggedItem = flaggedPack.includedItems.find(
        (i) => i.relativePath === 'src/billing.ts'
      );
      assert.ok(flaggedItem);
      assert.equal(flaggedItem.isStaleComparedToDisk, true);
      assert.ok(flaggedItem.stalenessWarning?.includes('modified on disk since snapshot'));
      assert.ok(
        flaggedPack.constraintsAndSafetyNotes.some((n) => n.includes('Stale File Warning:'))
      );

      // Policy B: 'reject' — rejects stale files from inclusion and records 'stale_file_rejected'
      const rejectedPack = await assembleContextPack({
        snapshot,
        knowledgeEntries: [],
        taskType: 'fix_bug',
        taskTitle: 'Fix total computation',
        taskDescription: 'Inspect billing.ts',
        seedFilePaths: ['src/billing.ts'],
        budget: {
          staleFilePolicy: 'reject',
        },
      });

      assert.equal(
        rejectedPack.includedItems.some((i) => i.relativePath === 'src/billing.ts'),
        false
      );
      const rejectedOmission = rejectedPack.omittedItems.find(
        (o) => o.relativePath === 'src/billing.ts'
      );
      assert.ok(rejectedOmission);
      assert.equal(rejectedOmission.reason, 'stale_file_rejected');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('4. Handles AI provider consent, sensitive file blocking, oversized payloads, rate limits (429), timeouts, and cancellation', async () => {
    const store = new ContextForgeSqliteStore(':memory:');

    // Spin up a local test HTTP server to simulate OpenAI-compatible provider responses (429, slow timeout, 200 OK)
    let mockMode: 'ok' | 'rate_limit' | 'slow_timeout' = 'ok';
    const mockAiServer = http.createServer(async (_req, res) => {
      if (mockMode === 'rate_limit') {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '12',
        });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      if (mockMode === 'slow_timeout') {
        await new Promise((r) => setTimeout(r, 400));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'Too late' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Verified AI relevance summary.' } }],
        })
      );
    });

    await new Promise<void>((resolve) => mockAiServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockAiServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const endpointUrl = `http://127.0.0.1:${port}/v1/chat/completions`;

    try {
      // A. No-AI Mode (NoOpDeterministicProvider) works offline without external network
      const noOp = new NoOpDeterministicProvider();
      const noOpRes = await noOp.generateText(
        {
          systemInstruction: 'Summarize files.',
          taskPrompt: 'Explain router.',
          untrustedContextPackText: '<untrusted_repository_content>router</untrusted_repository_content>',
          disclosedFilePaths: ['src/router.ts'],
        },
        {
          consentId: 'noop',
          approvedAtIso: new Date().toISOString(),
          providerId: 'noop_deterministic',
          payloadSha256: 'none',
          disclosedFilePaths: ['src/router.ts'],
          estimatedBytes: 10,
        }
      );
      assert.equal(noOpRes.certainty, 'verified');
      assert.ok(noOpRes.generatedText.includes('No-AI Mode'));

      // B. Sensitive file (.env / id_rsa) in disclosedFilePaths is strictly blocked before preview or send
      const config = {
        activeProviderId: 'openai_compatible' as const,
        endpointUrl,
        modelName: 'gpt-4.1-mini',
        apiKeyConfigured: false,
        maxRequestTokens: 2000,
        timeoutMs: 120,
      };
      store.saveAiProviderConfig(config);

      assert.throws(
        () =>
          createOutboundConsentPreview(config, {
            systemInstruction: 'Summarize',
            taskPrompt: 'Check env',
            untrustedContextPackText: 'data',
            disclosedFilePaths: ['src/index.ts', '.env'],
          }),
        AiSensitiveFileDisclosedError
      );

      // C. Oversized request exceeding maxRequestTokens is rejected with AiInputSizeExceededError
      const smallLimitConfig = {
        ...config,
        maxRequestTokens: 250, // 250 * 4 = 1000 chars max
      };
      store.saveAiProviderConfig(smallLimitConfig);
      const smallLimitProvider = new ConsentGatedExternalAiProvider(smallLimitConfig, store);
      const hugeRequest = {
        systemInstruction: 'Summarize',
        taskPrompt: 'Analyze',
        untrustedContextPackText: 'x'.repeat(2500),
        disclosedFilePaths: ['src/index.ts'],
      };
      const hugePreview = createOutboundConsentPreview(smallLimitConfig, hugeRequest);
      const hugeToken = {
        consentId: hugePreview.consentId,
        approvedAtIso: new Date().toISOString(),
        providerId: hugePreview.providerId,
        payloadSha256: hugePreview.payloadSha256,
        disclosedFilePaths: hugePreview.disclosedFilePaths,
        estimatedBytes: hugePreview.totalCharacters,
      };
      store.recordOutboundConsentApproval(hugeToken);

      await assert.rejects(
        () => smallLimitProvider.generateText(hugeRequest, hugeToken),
        AiInputSizeExceededError
      );

      // D. Missing or mismatched consent token is blocked with ConsentRequiredError
      store.saveAiProviderConfig(config);
      const provider = new ConsentGatedExternalAiProvider(config, store);
      const validRequest = {
        systemInstruction: 'Summarize context pack.',
        taskPrompt: 'Check router.ts',
        untrustedContextPackText: '<untrusted_repository_content>const x = 1;</untrusted_repository_content>',
        disclosedFilePaths: ['src/router.ts'],
      };
      const preview = createOutboundConsentPreview(config, validRequest);
      const validToken = {
        consentId: preview.consentId,
        approvedAtIso: new Date().toISOString(),
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        disclosedFilePaths: preview.disclosedFilePaths,
        estimatedBytes: preview.totalCharacters,
      };
      store.recordOutboundConsentApproval(validToken);

      await assert.rejects(
        () =>
          provider.generateText(validRequest, {
            ...validToken,
            payloadSha256: 'tampered_sha256',
          }),
        ConsentRequiredError
      );

      // E. Rate limit (HTTP 429) throws AiRateLimitError with parsed Retry-After seconds
      mockMode = 'rate_limit';
      await assert.rejects(
        async () => {
          await provider.generateText(validRequest, validToken);
        },
        (err: unknown) =>
          err instanceof AiRateLimitError && err.retryAfterSeconds === 12
      );

      // F. Timeout throws AiTimeoutError when provider takes longer than config.timeoutMs (120ms)
      mockMode = 'slow_timeout';
      await assert.rejects(
        () => provider.generateText(validRequest, validToken),
        AiTimeoutError
      );

      // G. Caller cancellation via AbortSignal throws AiRequestCancelledError
      const abortController = new AbortController();
      abortController.abort();
      await assert.rejects(
        () =>
          provider.generateText(
            { ...validRequest, signal: abortController.signal },
            validToken
          ),
        AiRequestCancelledError
      );

      // H. Valid consented request succeeds and labels output as 'ai_generated'
      mockMode = 'ok';
      const successRes = await provider.generateText(validRequest, validToken);
      assert.equal(successRes.certainty, 'ai_generated');
      assert.equal(successRes.generatedText, 'Verified AI relevance summary.');
    } finally {
      await new Promise<void>((resolve) => mockAiServer.close(() => resolve()));
      store.close();
    }
  });
});
