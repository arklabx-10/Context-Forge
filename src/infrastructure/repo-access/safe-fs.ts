import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExclusionReason, ScanResourceLimits } from '../../domain/index.js';
import { detectEmbeddedSecrets, isSensitiveFilePath } from './secret-scanner.js';

export const DEFAULT_SCAN_RESOURCE_LIMITS: ScanResourceLimits = {
  maxFileSizeBytes: 1024 * 1024, // 1 MB max per text file
  maxTotalFiles: 25000,
  maxDirectoryDepth: 28,
  customExcludeGlobs: [],
};

const ALWAYS_SKIPPED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.nyc_output',
  '.contextforge-data',
  '.terraform',
  '.gradle',
]);

const WINDOWS_RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.o',
  '.obj',
  '.lib',
  '.a',
  '.pdb',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.pyc',
  '.pyo',
  '.pyd',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.db-shm',
  '.db-wal',
]);

export interface DiscoveredFileEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sizeBytes: number;
  readonly lineCount: number | null;
  readonly sha256: string;
  readonly isIndexed: boolean;
  readonly exclusionReason?: ExclusionReason;
  readonly lastModifiedIso: string;
  readonly decodedContent?: string;
}

export interface SafeWalkResult {
  readonly canonicalRootPath: string;
  readonly files: readonly DiscoveredFileEntry[];
  readonly symlinkEscapesBlocked: number;
  readonly secretExclusionsCount: number;
}

/**
 * Normalizes a filesystem path for containment comparison across Windows and POSIX.
 */
function normalizeForContainment(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (process.platform === 'win32') {
    // Normalize drive letter and case on Windows NTFS
    return resolved.replace(/\//g, '\\').toLowerCase();
  }
  return resolved;
}

/**
 * Verifies that `candidatePath` is equal to or strictly inside `canonicalRootPath`.
 */
export function isPathContainedInRoot(canonicalRootPath: string, candidatePath: string): boolean {
  const normRoot = normalizeForContainment(canonicalRootPath);
  const normCandidate = normalizeForContainment(candidatePath);

  if (normCandidate === normRoot) {
    return true;
  }

  const rootWithSep = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
  return normCandidate.startsWith(rootWithSep);
}

/**
 * Converts a relative OS path to POSIX forward-slash format without leading './' or '/'.
 */
export function toPosixRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Computes SHA-256 hash of LF-normalized text or raw buffer.
 */
export function computeSha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Decodes a Buffer into LF-normalized UTF-8 text if it is a text file (including UTF-16LE/BE with BOM).
 * Returns null if the buffer appears to be binary.
 */
export function decodeTextBufferNormalized(buffer: Buffer): string | null {
  if (buffer.length === 0) {
    return '';
  }

  let decoded: string;
  // Check UTF-8 BOM (EF BB BF)
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    decoded = buffer.subarray(3).toString('utf8');
  }
  // Check UTF-16LE BOM (FF FE)
  else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    decoded = buffer.subarray(2).toString('utf16le');
  }
  // Check UTF-16BE BOM (FE FF)
  else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const payload = buffer.subarray(2);
    const swapped = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i + 1 < payload.length; i += 2) {
      swapped[i] = payload[i + 1] ?? 0;
      swapped[i + 1] = payload[i] ?? 0;
    }
    decoded = swapped.toString('utf16le');
  } else {
    // Check first 8000 bytes for null byte (0x00) to detect binary
    const checkLen = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLen; i += 1) {
      if (buffer[i] === 0x00) {
        return null;
      }
    }
    decoded = buffer.toString('utf8');
  }

  // Normalize CRLF and bare CR to LF for cross-platform determinism
  return decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Lightweight gitignore / glob pattern matcher supporting *, **, directory prefixes, and negation (!).
 */
export class IgnoreRuleMatcher {
  private readonly rules: { readonly negated: boolean; readonly regex: RegExp }[] = [];

  public constructor(rawPatterns: readonly string[]) {
    for (const raw of rawPatterns) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const negated = trimmed.startsWith('!');
      const pattern = negated ? trimmed.slice(1).trim() : trimmed;
      if (!pattern) {
        continue;
      }
      this.rules.push({
        negated,
        regex: IgnoreRuleMatcher.globToRegExp(pattern),
      });
    }
  }

  public isIgnored(posixRelativePath: string, isDirectory: boolean): boolean {
    let ignored = false;
    const candidate = isDirectory ? `${posixRelativePath}/` : posixRelativePath;

    for (const rule of this.rules) {
      if (rule.regex.test(posixRelativePath) || rule.regex.test(candidate)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }

  private static globToRegExp(glob: string): RegExp {
    let normalized = glob.replace(/\\/g, '/');
    const anchoredToRoot = normalized.startsWith('/');
    if (anchoredToRoot) {
      normalized = normalized.slice(1);
    }
    const dirOnly = normalized.endsWith('/');
    if (dirOnly) {
      normalized = normalized.slice(0, -1);
    }

    let regexStr = '';
    for (let i = 0; i < normalized.length; i += 1) {
      const ch = normalized[i]!;
      if (ch === '*') {
        if (normalized[i + 1] === '*') {
          if (normalized[i + 2] === '/') {
            regexStr += '(?:.*/)?';
            i += 2;
          } else {
            regexStr += '.*';
            i += 1;
          }
        } else {
          regexStr += '[^/]*';
        }
      } else if (ch === '?') {
        regexStr += '[^/]';
      } else if ('.+^${}()|[]\\'.includes(ch)) {
        regexStr += `\\${ch}`;
      } else {
        regexStr += ch;
      }
    }

    const prefix = anchoredToRoot || normalized.includes('/') ? '^' : '(?:^|/)';
    const suffix = dirOnly ? '(?:/|$)' : '(?:$|/.*$)';
    return new RegExp(`${prefix}${regexStr}${suffix}`, 'i');
  }
}

/**
 * Validates that a local directory exists, is a directory, and resolves its canonical realpath.
 */
export async function validateAndResolveRepoRoot(inputPath: string): Promise<string> {
  if (!inputPath || typeof inputPath !== 'string' || inputPath.includes('\0')) {
    throw new Error('Invalid repository path provided.');
  }

  const resolved = path.resolve(inputPath.trim());
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repository path does not exist or is not a directory: ${resolved}`);
  }

  return fs.realpath(resolved);
}

/**
 * Safely walks a repository directory tree while enforcing:
 * - Canonical path containment (prevents directory traversal, symlink escapes, and junction escapes)
 * - Cycle detection
 * - .gitignore / .contextforgeignore / custom exclusion rules
 * - Secret filename & content exclusions
 * - Resource limits (max file size, max total files, max depth)
 */
export async function walkRepositorySafely(
  inputRootPath: string,
  limits: ScanResourceLimits = DEFAULT_SCAN_RESOURCE_LIMITS
): Promise<SafeWalkResult> {
  const canonicalRootPath = await validateAndResolveRepoRoot(inputRootPath);

  // Load root .gitignore and .contextforgeignore if present inside root
  const ignorePatterns: string[] = [...limits.customExcludeGlobs];
  for (const ignoreFile of ['.gitignore', '.contextforgeignore']) {
    const candidate = path.join(canonicalRootPath, ignoreFile);
    try {
      const lstat = await fs.lstat(candidate);
      if (lstat.isFile() && lstat.size < 128 * 1024) {
        const text = await fs.readFile(candidate, 'utf8');
        ignorePatterns.push(...text.split(/\r?\n/));
      }
    } catch {
      // Ignore missing or unreadable ignore file
    }
  }

  const ignoreMatcher = new IgnoreRuleMatcher(ignorePatterns);
  const visitedDirectories = new Set<string>([normalizeForContainment(canonicalRootPath)]);
  const files: DiscoveredFileEntry[] = [];
  let symlinkEscapesBlocked = 0;
  let secretExclusionsCount = 0;

  async function walkDir(currentAbsDir: string, depth: number): Promise<void> {
    if (depth > limits.maxDirectoryDepth || files.length >= limits.maxTotalFiles) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentAbsDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort entries deterministically by name
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (files.length >= limits.maxTotalFiles) {
        break;
      }

      if (WINDOWS_RESERVED_BASENAMES.test(entry.name)) {
        continue;
      }

      const absEntryPath = path.join(currentAbsDir, entry.name);
      const relPosixPath = toPosixRelativePath(path.relative(canonicalRootPath, absEntryPath));

      if (!relPosixPath || relPosixPath.startsWith('..')) {
        symlinkEscapesBlocked += 1;
        continue;
      }

      // Check lstat and realpath containment for symlinks / Windows junctions
      let lstat;
      try {
        lstat = await fs.lstat(absEntryPath);
      } catch {
        continue;
      }

      let realEntryPath: string;
      try {
        realEntryPath = await fs.realpath(absEntryPath);
      } catch {
        // Broken symlink or inaccessible target
        if (lstat.isSymbolicLink()) {
          symlinkEscapesBlocked += 1;
          files.push({
            relativePath: relPosixPath,
            absolutePath: absEntryPath,
            sizeBytes: 0,
            lineCount: null,
            sha256: computeSha256(relPosixPath),
            isIndexed: false,
            exclusionReason: 'symlink_escape_blocked',
            lastModifiedIso: lstat.mtime.toISOString(),
          });
        }
        continue;
      }

      if (!isPathContainedInRoot(canonicalRootPath, realEntryPath)) {
        symlinkEscapesBlocked += 1;
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes: 0,
          lineCount: null,
          sha256: computeSha256(relPosixPath),
          isIndexed: false,
          exclusionReason: 'symlink_escape_blocked',
          lastModifiedIso: lstat.mtime.toISOString(),
        });
        continue;
      }

      let targetStat = lstat;
      if (lstat.isSymbolicLink()) {
        try {
          targetStat = await fs.stat(realEntryPath);
        } catch {
          continue;
        }
      }

      if (targetStat.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRS.has(entry.name.toLowerCase())) {
          continue;
        }
        if (ignoreMatcher.isIgnored(relPosixPath, true)) {
          continue;
        }

        const normRealDir = normalizeForContainment(realEntryPath);
        if (visitedDirectories.has(normRealDir)) {
          // Prevent cyclic symlink loops
          continue;
        }
        visitedDirectories.add(normRealDir);
        await walkDir(absEntryPath, depth + 1);
        continue;
      }

      if (!targetStat.isFile()) {
        continue;
      }

      const lastModifiedIso = targetStat.mtime.toISOString();
      const sizeBytes = targetStat.size;

      // 1. Check sensitive filename first (never read or index sensitive credential files)
      if (isSensitiveFilePath(relPosixPath)) {
        secretExclusionsCount += 1;
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes,
          lineCount: null,
          sha256: computeSha256(`excluded-sensitive:${relPosixPath}:${sizeBytes}`),
          isIndexed: false,
          exclusionReason: 'sensitive_filename',
          lastModifiedIso,
        });
        continue;
      }

      // 2. Check ignore rules
      if (ignoreMatcher.isIgnored(relPosixPath, false)) {
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes,
          lineCount: null,
          sha256: computeSha256(`ignored:${relPosixPath}:${sizeBytes}`),
          isIndexed: false,
          exclusionReason: 'git_ignored',
          lastModifiedIso,
        });
        continue;
      }

      // 3. Check binary extension or oversized file
      const ext = path.posix.extname(relPosixPath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext) || sizeBytes > limits.maxFileSizeBytes) {
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes,
          lineCount: null,
          sha256: computeSha256(`binary-or-oversized:${relPosixPath}:${sizeBytes}`),
          isIndexed: false,
          exclusionReason: 'binary_or_oversized',
          lastModifiedIso,
        });
        continue;
      }

      // 4. Read file buffer safely and decode
      let rawBuffer: Buffer;
      try {
        rawBuffer = await fs.readFile(realEntryPath);
      } catch {
        continue;
      }

      const decodedText = decodeTextBufferNormalized(rawBuffer);
      if (decodedText === null) {
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes,
          lineCount: null,
          sha256: computeSha256(rawBuffer),
          isIndexed: false,
          exclusionReason: 'binary_or_oversized',
          lastModifiedIso,
        });
        continue;
      }

      const sha256 = computeSha256(decodedText);

      // 5. Scan content for embedded secrets before indexing
      const secretScan = detectEmbeddedSecrets(decodedText);
      if (secretScan.hasSecrets) {
        secretExclusionsCount += 1;
        files.push({
          relativePath: relPosixPath,
          absolutePath: absEntryPath,
          sizeBytes,
          lineCount: null,
          sha256,
          isIndexed: false,
          exclusionReason: 'secret_content_detected',
          lastModifiedIso,
        });
        continue;
      }

      const lineCount = decodedText.length === 0 ? 0 : decodedText.split('\n').length;

      files.push({
        relativePath: relPosixPath,
        absolutePath: absEntryPath,
        sizeBytes,
        lineCount,
        sha256,
        isIndexed: true,
        lastModifiedIso,
        decodedContent: decodedText,
      });
    }
  }

  await walkDir(canonicalRootPath, 0);

  return {
    canonicalRootPath,
    files,
    symlinkEscapesBlocked,
    secretExclusionsCount,
  };
}

/**
 * Safely reads a single file inside an already-validated repository root,
 * enforcing path containment, sensitive-file checks, and LF normalization.
 */
export async function readSafeRepoFile(
  canonicalRootPath: string,
  relativePath: string,
  maxBytes: number = DEFAULT_SCAN_RESOURCE_LIMITS.maxFileSizeBytes
): Promise<{ readonly content: string; readonly sha256: string; readonly lineCount: number } | null> {
  const cleanRel = toPosixRelativePath(relativePath);
  if (!cleanRel || cleanRel.includes('\0') || isSensitiveFilePath(cleanRel)) {
    return null;
  }

  const candidateAbs = path.resolve(canonicalRootPath, cleanRel);
  if (!isPathContainedInRoot(canonicalRootPath, candidateAbs)) {
    return null;
  }

  try {
    const realTarget = await fs.realpath(candidateAbs);
    if (!isPathContainedInRoot(canonicalRootPath, realTarget)) {
      return null;
    }
    const stat = await fs.stat(realTarget);
    if (!stat.isFile() || stat.size > maxBytes) {
      return null;
    }
    const buf = await fs.readFile(realTarget);
    const decoded = decodeTextBufferNormalized(buf);
    if (decoded === null) {
      return null;
    }
    if (detectEmbeddedSecrets(decoded).hasSecrets) {
      return null;
    }
    return {
      content: decoded,
      sha256: computeSha256(decoded),
      lineCount: decoded.length === 0 ? 0 : decoded.split('\n').length,
    };
  } catch {
    return null;
  }
}
