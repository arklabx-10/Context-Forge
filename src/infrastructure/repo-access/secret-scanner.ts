import path from 'node:path';

const ALLOWED_TEMPLATE_FILENAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.defaults',
  'example.env',
  'sample.env',
]);

const SENSITIVE_EXACT_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  '.env.production',
  '.env.staging',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.htpasswd',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials.json',
  'client_secret.json',
  'terraform.tfstate',
  'terraform.tfstate.backup',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.kdbx',
  '.jks',
  '.keystore',
  '.ovpn',
]);

const SECRET_CONTENT_PATTERNS: readonly { readonly id: string; readonly regex: RegExp }[] = [
  {
    id: 'pem_private_key',
    regex: /-----BEGIN\s+(?:RSA\s+|DSA\s+|EC\s+|OPENSSH\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/i,
  },
  {
    id: 'aws_access_key_id',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'github_pat_token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{50,255}\b/,
  },
  {
    id: 'slack_token',
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}\b/,
  },
  {
    id: 'stripe_live_secret',
    regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,99}\b/,
  },
  {
    id: 'openai_or_anthropic_api_key',
    regex: /\bsk-(?:proj|ant-api03)-[A-Za-z0-9_-]{24,200}\b/,
  },
  {
    id: 'google_service_account_private_key',
    regex: /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"\s*:\s*"-----BEGIN/i,
  },
];

/**
 * Determines whether a relative file path represents a sensitive credential/secret file
 * that must be excluded by default.
 */
export function isSensitiveFilePath(relativePath: string): boolean {
  const posixPath = relativePath.replace(/\\/g, '/');
  const baseLower = path.posix.basename(posixPath).toLowerCase();

  if (ALLOWED_TEMPLATE_FILENAMES.has(baseLower)) {
    return false;
  }

  if (SENSITIVE_EXACT_FILENAMES.has(baseLower)) {
    return true;
  }

  if (baseLower.startsWith('.env.') && !ALLOWED_TEMPLATE_FILENAMES.has(baseLower)) {
    return true;
  }

  if (baseLower.endsWith('.pub')) {
    return false;
  }

  if (baseLower.startsWith('id_rsa.') || baseLower.startsWith('id_ed25519.')) {
    return true;
  }

  if (/^service[-_]?account.*\.json$/i.test(baseLower)) {
    return true;
  }

  const ext = path.posix.extname(baseLower);
  if (SENSITIVE_EXTENSIONS.has(ext)) {
    return true;
  }

  // Check if inside .ssh or .aws or .gnupg directories
  const segments = posixPath.toLowerCase().split('/');
  if (segments.includes('.ssh') || segments.includes('.aws') || segments.includes('.gnupg')) {
    return true;
  }

  return false;
}

/**
 * Checks if a file is a safe configuration template (e.g., .env.example).
 */
export function isConfigTemplateFilePath(relativePath: string): boolean {
  const baseLower = path.posix.basename(relativePath.replace(/\\/g, '/')).toLowerCase();
  if (ALLOWED_TEMPLATE_FILENAMES.has(baseLower)) {
    return true;
  }
  return (
    baseLower.endsWith('.example') ||
    baseLower.endsWith('.template') ||
    baseLower.endsWith('.sample') ||
    baseLower.includes('.example.') ||
    baseLower.includes('.template.')
  );
}

/**
 * Scans decoded text content for embedded private keys or high-confidence secret tokens.
 */
export function detectEmbeddedSecrets(content: string): {
  readonly hasSecrets: boolean;
  readonly matchedRuleIds: readonly string[];
} {
  const matchedRuleIds: string[] = [];

  for (const rule of SECRET_CONTENT_PATTERNS) {
    if (rule.regex.test(content)) {
      matchedRuleIds.push(rule.id);
    }
  }

  return {
    hasSecrets: matchedRuleIds.length > 0,
    matchedRuleIds,
  };
}

/**
 * Redacts credentials from Git remote URLs or connection strings.
 */
export function redactUrlCredentials(rawUrl: string): string {
  return rawUrl.replace(/(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1[REDACTED]@');
}

/**
 * Redacts any detected secrets inline if a text snippet is rendered in logs or previews.
 */
export function redactSecretsInText(content: string): {
  readonly redactedText: string;
  readonly redactionCount: number;
} {
  let redactedText = content;
  let redactionCount = 0;

  for (const rule of SECRET_CONTENT_PATTERNS) {
    const globalRegex = new RegExp(
      rule.regex.source,
      rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`
    );
    redactedText = redactedText.replace(globalRegex, () => {
      redactionCount += 1;
      return `[REDACTED:${rule.id.toUpperCase()}]`;
    });
  }

  return { redactedText, redactionCount };
}
