import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangedFileDiff, GitMetadata } from '../../domain/index.js';
import { redactSecretsInText, redactUrlCredentials } from './secret-scanner.js';
import { toPosixRelativePath } from './safe-fs.js';

const execFileAsync = promisify(execFile);

const HARDENED_GIT_FLAGS = [
  '-c',
  'core.hooksPath=_contextforge_disabled_hooks_',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.external=',
  '-c',
  'protocol.file.allow=never',
];

const SAFE_REVISION_SPEC_REGEX = /^[A-Za-z0-9_./~^@{}]{1,100}$/;

/**
 * Runs a read-only Git command safely via execFile (no shell interpolation, hooks disabled).
 */
async function runSafeGit(canonicalRootPath: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [...HARDENED_GIT_FLAGS, ...args], {
      cwd: canonicalRootPath,
      timeout: 8000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        LC_ALL: 'C',
      },
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Extracts repository Git metadata safely without executing repository hooks or remotes.
 */
export async function extractGitMetadata(canonicalRootPath: string): Promise<GitMetadata> {
  const insideWorkTree = await runSafeGit(canonicalRootPath, ['rev-parse', '--is-inside-work-tree']);
  if (!insideWorkTree || insideWorkTree.trim() !== 'true') {
    return {
      isGitRepo: false,
      currentBranch: null,
      headCommitSha: null,
      isDirty: false,
      remotes: [],
      recentCommits: [],
    };
  }

  const [branchOut, headOut, statusOut, remoteOut, logOut] = await Promise.all([
    runSafeGit(canonicalRootPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runSafeGit(canonicalRootPath, ['rev-parse', 'HEAD']),
    runSafeGit(canonicalRootPath, ['status', '--porcelain', '--untracked-files=normal']),
    runSafeGit(canonicalRootPath, ['remote', '-v']),
    runSafeGit(canonicalRootPath, ['log', '-n', '10', '--format=%H%x1f%an%x1f%aI%x1f%s']),
  ]);

  const remotesMap = new Map<string, string>();
  if (remoteOut) {
    for (const line of remoteOut.split(/\r?\n/)) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
      if (match && match[1] && match[2]) {
        remotesMap.set(match[1], redactUrlCredentials(match[2]));
      }
    }
  }

  const recentCommits: {
    readonly sha: string;
    readonly author: string;
    readonly dateIso: string;
    readonly subject: string;
  }[] = [];

  if (logOut) {
    for (const line of logOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\x1f');
      if (parts.length >= 4 && parts[0]) {
        recentCommits.push({
          sha: parts[0].trim(),
          author: (parts[1] ?? '').trim(),
          dateIso: (parts[2] ?? '').trim(),
          subject: (parts[3] ?? '').trim(),
        });
      }
    }
  }

  return {
    isGitRepo: true,
    currentBranch: branchOut ? branchOut.trim() : null,
    headCommitSha: headOut ? headOut.trim() : null,
    isDirty: Boolean(statusOut && statusOut.trim().length > 0),
    remotes: Array.from(remotesMap.entries()).map(([name, urlRedacted]) => ({
      name,
      urlRedacted,
    })),
    recentCommits,
  };
}

/**
 * Validates a user-provided Git revision or range spec to prevent argument injection (e.g. --output=...).
 */
export function validateGitRevisionSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed || trimmed === 'WORKING_TREE') {
    return 'WORKING_TREE';
  }
  if (trimmed === 'STAGED') {
    return 'STAGED';
  }
  if (trimmed.startsWith('-')) {
    throw new Error('Invalid Git revision specification: flags are not permitted.');
  }
  if (!SAFE_REVISION_SPEC_REGEX.test(trimmed)) {
    throw new Error(`Invalid Git revision specification: ${trimmed}`);
  }
  return trimmed;
}

/**
 * Parses unified Git diff text into structured ChangedFileDiff records with line numbers.
 */
export function parseUnifiedGitDiff(rawDiffText: string): readonly ChangedFileDiff[] {
  const normalized = rawDiffText.replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return [];
  }

  const results: ChangedFileDiff[] = [];
  const fileChunks = normalized.split(/^diff --git /m).filter((c) => c.trim().length > 0);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0] ?? '';
    const headerMatch = /^a\/(.+?)\s+b\/(.+)$/.exec(headerLine.trim());
    const oldPathRaw = headerMatch?.[1] ?? '';
    const newPathRaw = headerMatch?.[2] ?? '';
    const relativePath = toPosixRelativePath(newPathRaw || oldPathRaw);
    if (!relativePath) {
      continue;
    }

    let changeType: ChangedFileDiff['changeType'] = 'modified';
    if (chunk.includes('\nnew file mode ')) {
      changeType = 'added';
    } else if (chunk.includes('\ndeleted file mode ')) {
      changeType = 'deleted';
    } else if (chunk.includes('\nrename from ')) {
      changeType = 'renamed';
    }

    const addedLines: { readonly lineNumber: number; readonly content: string }[] = [];
    const removedLines: { readonly lineNumber: number; readonly content: string }[] = [];
    let currentNewLine = 0;
    let currentOldLine = 0;
    let inHunk = false;

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      if (hunkMatch) {
        currentOldLine = Number.parseInt(hunkMatch[1] ?? '1', 10);
        currentNewLine = Number.parseInt(hunkMatch[2] ?? '1', 10);
        inHunk = true;
        continue;
      }

      if (!inHunk) {
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = redactSecretsInText(line.slice(1)).redactedText;
        addedLines.push({ lineNumber: currentNewLine, content });
        currentNewLine += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const content = redactSecretsInText(line.slice(1)).redactedText;
        removedLines.push({ lineNumber: currentOldLine, content });
        currentOldLine += 1;
      } else if (line.startsWith(' ')) {
        currentNewLine += 1;
        currentOldLine += 1;
      }
    }

    const redactedExcerpt = redactSecretsInText(chunk.slice(0, 4000)).redactedText;

    results.push({
      relativePath,
      ...(changeType === 'renamed' && oldPathRaw ? { oldPath: toPosixRelativePath(oldPathRaw) } : {}),
      changeType,
      additions: addedLines.length,
      deletions: removedLines.length,
      addedLines,
      removedLines,
      rawPatchExcerpt: `diff --git ${redactedExcerpt}`,
    });
  }

  return results;
}

/**
 * Inspects Git changes for a repository (working tree, staged, or revision spec).
 */
export async function getRepositoryGitDiffs(
  canonicalRootPath: string,
  targetSpec: string = 'WORKING_TREE'
): Promise<{ readonly label: string; readonly files: readonly ChangedFileDiff[] }> {
  const validated = validateGitRevisionSpec(targetSpec);

  let diffOut: string | null = null;
  let label = 'Working Tree (Unstaged + Staged vs HEAD)';

  if (validated === 'WORKING_TREE') {
    diffOut = await runSafeGit(canonicalRootPath, ['diff', 'HEAD', '--unified=3', '--no-ext-diff']);
    if (diffOut === null) {
      // Repository may have staged/unstaged changes without HEAD or unstaged changes only
      diffOut = await runSafeGit(canonicalRootPath, ['diff', '--unified=3', '--no-ext-diff']);
    }
  } else if (validated === 'STAGED') {
    label = 'Staged Changes (--cached)';
    diffOut = await runSafeGit(canonicalRootPath, ['diff', '--cached', '--unified=3', '--no-ext-diff']);
  } else {
    label = `Revision Diff (${validated})`;
    diffOut = await runSafeGit(canonicalRootPath, ['diff', validated, '--unified=3', '--no-ext-diff']);
  }

  return {
    label,
    files: diffOut ? parseUnifiedGitDiff(diffOut) : [],
  };
}
