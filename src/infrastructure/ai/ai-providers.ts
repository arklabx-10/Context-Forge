import crypto from 'node:crypto';
import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderCapabilities,
  AiProviderConfig,
  AiProviderPort,
  OutboundConsentPreview,
  OutboundConsentToken,
} from '../../domain/index.js';
import type { ContextForgeSqliteStore } from '../persistence/sqlite-store.js';
import { computeSha256 } from '../repo-access/safe-fs.js';
import { redactSecretsInText } from '../repo-access/secret-scanner.js';

export class ConsentRequiredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConsentRequiredError';
  }
}

/**
 * Default local-only deterministic provider.
 * Performs zero external network calls and clearly labels output as deterministic structural synthesis.
 */
export class NoOpDeterministicProvider implements AiProviderPort {
  public readonly providerId = 'noop_deterministic';
  public readonly displayName = 'Deterministic Local Analyzer (No External AI)';

  public getCapabilities(): AiProviderCapabilities {
    return {
      isConfigured: true,
      requiresExternalNetwork: false,
      maxContextTokens: 128000,
      supportsStructuredOutput: true,
      vendorName: 'ContextForge Built-In (Offline)',
      modelIdentifier: 'deterministic-local-v1',
    };
  }

  public async generateText(
    request: AiGenerationRequest,
    _consentToken: OutboundConsentToken
  ): Promise<AiGenerationResponse> {
    const startMs = Date.now();
    const fileList =
      request.disclosedFilePaths.length > 0
        ? request.disclosedFilePaths.map((p) => `- \`${p}\``).join('\n')
        : '- _(No files disclosed)_';

    const generatedText = [
      `### Deterministic Local Analysis Summary (No-AI Mode)`,
      `> Generated locally by \`NoOpDeterministicProvider\` without external AI network calls.`,
      '',
      `**Task Prompt**: ${request.taskPrompt}`,
      '',
      `**Verified Source Files Included (${request.disclosedFilePaths.length})**:`,
      fileList,
      '',
      `**Payload Size**: ${request.untrustedContextPackText.length.toLocaleString()} characters.`,
    ].join('\n');

    return {
      providerId: this.providerId,
      modelName: 'deterministic-local-v1',
      generatedText,
      certainty: 'verified',
      completedAtIso: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - startMs),
    };
  }
}

/**
 * External AI Provider Adapter (OpenAI-compatible / Anthropic-compatible / Local Ollama).
 * Strictly enforces OutboundConsentToken verification before any network request can occur.
 */
export class ConsentGatedExternalAiProvider implements AiProviderPort {
  public readonly providerId: string;
  public readonly displayName: string;
  private readonly config: AiProviderConfig;
  private readonly store: ContextForgeSqliteStore;
  private readonly apiKey?: string;

  public constructor(
    config: AiProviderConfig,
    store: ContextForgeSqliteStore,
    apiKey?: string
  ) {
    this.config = config;
    this.store = store;
    this.providerId = config.activeProviderId;
    this.displayName =
      config.activeProviderId === 'anthropic_compatible'
        ? `Anthropic Adapter (${config.modelName})`
        : config.activeProviderId === 'local_ollama'
          ? `Ollama Local LLM (${config.modelName})`
          : `OpenAI-Compatible Adapter (${config.modelName})`;
    if (apiKey !== undefined) {
      this.apiKey = apiKey;
    }
  }

  public getCapabilities(): AiProviderCapabilities {
    return {
      isConfigured: Boolean(this.config.endpointUrl && this.config.modelName),
      requiresExternalNetwork: true,
      maxContextTokens: this.config.maxRequestTokens,
      supportsStructuredOutput: false,
      vendorName: this.config.activeProviderId,
      modelIdentifier: this.config.modelName,
    };
  }

  public async generateText(
    request: AiGenerationRequest,
    consentToken: OutboundConsentToken
  ): Promise<AiGenerationResponse> {
    const startMs = Date.now();
    const { redactedPayloadText, payloadSha256 } = buildRedactedOutboundPayload(request);

    // Non-negotiable security invariant: verify explicit user consent matching exact payload SHA-256
    if (
      !consentToken ||
      consentToken.payloadSha256 !== payloadSha256 ||
      consentToken.providerId !== this.providerId ||
      !this.store.verifyOutboundConsent(consentToken.consentId, payloadSha256, this.providerId)
    ) {
      throw new ConsentRequiredError(
        `Outbound AI request blocked: valid user OutboundConsentToken matching payload SHA-256 (${payloadSha256.slice(0, 12)}) is required before transmitting repository content to ${this.config.endpointUrl}.`
      );
    }

    // Record metadata-only audit log (never log source contents)
    this.store.recordOutboundAuditLog({
      id: `audit_${crypto.randomUUID().slice(0, 12)}`,
      timestampIso: new Date().toISOString(),
      providerId: this.providerId,
      endpointUrl: this.config.endpointUrl,
      payloadSha256,
      fileCount: request.disclosedFilePaths.length,
      byteCount: Buffer.byteLength(redactedPayloadText, 'utf8'),
    });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        if (this.config.activeProviderId === 'anthropic_compatible') {
          headers['x-api-key'] = this.apiKey;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
      }

      const body =
        this.config.activeProviderId === 'anthropic_compatible'
          ? JSON.stringify({
              model: this.config.modelName,
              max_tokens: request.maxOutputTokens ?? 1024,
              system: request.systemInstruction,
              messages: [{ role: 'user', content: redactedPayloadText }],
            })
          : JSON.stringify({
              model: this.config.modelName,
              max_tokens: request.maxOutputTokens ?? 1024,
              messages: [
                { role: 'system', content: request.systemInstruction },
                { role: 'user', content: redactedPayloadText },
              ],
            });

      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI Provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      let generatedText = '';

      if (Array.isArray(data.choices) && data.choices[0]) {
        const firstChoice = data.choices[0] as { message?: { content?: string } };
        generatedText = firstChoice.message?.content ?? '';
      } else if (Array.isArray(data.content) && data.content[0]) {
        const firstBlock = data.content[0] as { text?: string };
        generatedText = firstBlock.text ?? '';
      } else {
        generatedText = JSON.stringify(data);
      }

      return {
        providerId: this.providerId,
        modelName: this.config.modelName,
        generatedText,
        certainty: 'ai_generated',
        completedAtIso: new Date().toISOString(),
        durationMs: Math.max(1, Date.now() - startMs),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export function buildRedactedOutboundPayload(request: AiGenerationRequest): {
  readonly redactedPayloadText: string;
  readonly payloadSha256: string;
  readonly redactedSecretsCount: number;
} {
  const combined = [
    `# TASK PROMPT`,
    request.taskPrompt,
    '',
    `# UNTRUSTED REPOSITORY CONTEXT`,
    request.untrustedContextPackText,
  ].join('\n');

  const { redactedText, redactionCount } = redactSecretsInText(combined);
  return {
    redactedPayloadText: redactedText,
    payloadSha256: computeSha256(redactedText),
    redactedSecretsCount: redactionCount,
  };
}

export function createOutboundConsentPreview(
  config: AiProviderConfig,
  request: AiGenerationRequest
): OutboundConsentPreview {
  const { redactedPayloadText, payloadSha256, redactedSecretsCount } =
    buildRedactedOutboundPayload(request);

  return {
    consentId: `consent_${crypto.randomUUID().slice(0, 12)}`,
    providerId: config.activeProviderId,
    endpointUrl: config.endpointUrl,
    modelName: config.modelName,
    payloadSha256,
    disclosedFilePaths: request.disclosedFilePaths,
    totalCharacters: redactedPayloadText.length,
    estimatedTokens: Math.ceil(redactedPayloadText.length / 4),
    redactedSecretsCount,
    payloadPreviewText: redactedPayloadText.slice(0, 4000),
    createdAtIso: new Date().toISOString(),
  };
}
