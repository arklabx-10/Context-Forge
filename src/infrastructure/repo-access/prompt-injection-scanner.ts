import type { PromptInjectionAlert, SourceReference } from '../../domain/index.js';
import { createSourceRef } from '../../domain/index.js';

interface InjectionRule {
  readonly patternId: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly description: string;
  readonly regex: RegExp;
}

const INJECTION_RULES: readonly InjectionRule[] = [
  {
    patternId: 'instruction_override',
    severity: 'high',
    description: 'Contains imperative phrase attempting to override prior system/developer instructions.',
    regex:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions|prompts|rules|constraints)\b/i,
  },
  {
    patternId: 'role_spoofing_marker',
    severity: 'high',
    description: 'Contains chat-template or system role delimiter that could spoof prompt boundaries.',
    regex: /(?:<\|im_start\|>\s*system|<\|system\|>|\[INST\]|<<SYS>>|^###\s*System\s+Instruction\s*:)/im,
  },
  {
    patternId: 'data_exfiltration_directive',
    severity: 'high',
    description: 'Contains suspicious directive to exfiltrate secrets, environment variables, or files.',
    regex:
      /\b(?:exfiltrate|send|upload|post)\s+(?:the\s+)?(?:contents?\s+of\s+)?(?:\.env|private\s+keys?|secrets?|credentials?|environment\s+variables?)\s+to\b/i,
  },
  {
    patternId: 'hidden_bidi_unicode',
    severity: 'medium',
    description: 'Contains Unicode bidirectional override characters (Trojan Source / hidden text vector).',
    regex: /[\u202A-\u202E\u2066-\u2069]/,
  },
  {
    patternId: 'jailbreak_persona_switch',
    severity: 'medium',
    description: 'Attempts to reassign the AI assistant persona or bypass safety guards.',
    regex: /\byou\s+are\s+now\s+(?:in\s+developer\s+mode|an\s+unrestricted|a\s+jailbroken|DAN\b)/i,
  },
];

/**
 * Scans untrusted repository file content line-by-line for prompt injection indicators.
 */
export function scanForPromptInjection(params: {
  repoId: string;
  relativePath: string;
  fileSha256: string;
  commitSha?: string;
  content: string;
}): readonly PromptInjectionAlert[] {
  const alerts: PromptInjectionAlert[] = [];
  const lines = params.content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const rule of INJECTION_RULES) {
      const match = rule.regex.exec(line);
      if (match) {
        const ref: SourceReference = createSourceRef({
          repoId: params.repoId,
          relativePath: params.relativePath,
          fileSha256: params.fileSha256,
          startLine: i + 1,
          endLine: i + 1,
          ...(params.commitSha !== undefined ? { commitSha: params.commitSha } : {}),
        });
        alerts.push({
          severity: rule.severity,
          patternId: rule.patternId,
          description: rule.description,
          matchedExcerptRedacted: match[0].slice(0, 80),
          sourceRef: ref,
        });
      }
    }
  }

  return alerts;
}

/**
 * Wraps untrusted repository file content in a boundary fence that prevents closing-tag breakout
 * and strips Trojan Source bidirectional control characters.
 */
export function fenceUntrustedContent(params: {
  relativePath: string;
  fileSha256: string;
  startLine: number;
  endLine: number;
  content: string;
}): string {
  // Neutralize closing tag breakout and bidirectional control characters
  const escapedContent = params.content
    .replace(/<\/untrusted_repository_content>/gi, '<\\/untrusted_repository_content>')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '[UNICODE_BIDI_REMOVED]');

  return [
    `<untrusted_repository_content path="${params.relativePath}" lines="${params.startLine}-${params.endLine}" sha256="${params.fileSha256.slice(0, 12)}">`,
    escapedContent,
    `</untrusted_repository_content>`,
  ].join('\n');
}
