import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextForgeWorkspaceService } from '../application/workspace-service.js';
import type {
  CodingAssistantTarget,
  DevelopmentTaskType,
} from '../domain/index.js';
import { ContextForgeSqliteStore } from '../infrastructure/persistence/sqlite-store.js';
import { createContextForgeHttpServer } from '../server/app-server.js';

export interface CliIo {
  stdout(msg: string): void;
  stderr(msg: string): void;
}

const DEFAULT_IO: CliIo = {
  stdout: (msg: string) => process.stdout.write(msg + '\n'),
  stderr: (msg: string) => process.stderr.write(msg + '\n'),
};

const VERSION = '0.1.0';

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(args: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const char = arg.slice(1);
      if (char === 'h') flags.help = true;
      else if (char === 'v') flags.version = true;
      else if (char === 'j') flags.json = true;
      else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[char] = next;
          i += 1;
        } else {
          flags[char] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
    i += 1;
  }

  const command = positionals[0]?.toLowerCase() ?? '';
  const remainingPositionals = positionals.slice(1);

  return {
    command,
    positionals: remainingPositionals,
    flags,
  };
}

export function getHelpText(): string {
  return `
ContextForge CLI v${VERSION}
Stack-agnostic repository intelligence, deterministic context assembly, and safe change review.

USAGE:
  contextforge <command> [options]
  npx contextforge <command> [options]

COMMANDS:
  onboard [path]          Analyze a repository, extract symbols & dependencies, and save a snapshot.
  pack [path]             Assemble a deterministic AI context pack for a development task.
  review [path]           Conduct an evidence-backed Git change review (blast-radius & risk analysis).
  report [path]           Generate a deterministic Markdown repository report without AI.
  serve                   Start the local HTTP API and UI static file server.
  help                    Show this help message.

OPTIONS:
  -h, --help              Show help information.
  -v, --version           Show version number.
  --json                  Output raw JSON instead of human-readable text.
  --db <path>             Path to SQLite database (default: .contextforge-data/contextforge.db).

ONBOARD OPTIONS:
  --name <name>           Custom repository name (default: directory basename).

PACK OPTIONS:
  --task <title>          (Required) Development task title or goal.
  --desc <text>           Task description or additional instructions.
  --type <type>           implement_feature | debug_issue | refactor | security_audit | understand_module
  --target <profile>      universal | claude_code | cursor | github_copilot | codex_aider
  --instruction <text>    Custom user prompt instruction appended to agent template.
  --budget <chars>        Max character budget (default: 16000).
  --max-files <count>     Max files to include in pack (default: 15).
  --seed <path1,path2>    Comma-separated explicit seed file paths.
  --exclude <p1,p2>       Comma-separated files to exclude from the pack.
  --format <fmt>          markdown (default) | plaintext
  --output, -o <file>     Write context pack to file instead of stdout.

REVIEW OPTIONS:
  --target <git-spec>     Git revision or range to review (default: WORKING_TREE).
  --raw-diff <file>       Path to unified diff patch file to review.
  --fail-on-critical      Exit with code 1 if critical risks are detected (ideal for CI/CD).
  --fail-on-warning       Exit with code 1 if warnings or critical risks are detected.
  --output, -o <file>     Write change review report to file.

SERVE OPTIONS:
  --port <port>           Server port (default: 4310).
  --host <host>           Host to bind (default: 127.0.0.1).

EXAMPLES:
  # Onboard current workspace
  contextforge onboard .

  # Build an evidence-backed context pack for Claude Code
  contextforge pack . --task "Add order refund endpoint" --target claude_code -o context.md

  # Run Git change review in CI pipeline and fail on critical issues (e.g. destructive SQL)
  contextforge review . --fail-on-critical
`;
}

export async function runCli(
  rawArgs: readonly string[],
  io: CliIo = DEFAULT_IO
): Promise<number> {
  const parsed = parseCliArgs(rawArgs);

  if (parsed.flags.version || parsed.command === 'version') {
    io.stdout(`contextforge ${VERSION}`);
    return 0;
  }

  if (parsed.flags.help || parsed.command === 'help' || !parsed.command) {
    io.stdout(getHelpText());
    return 0;
  }

  const dbPath =
    typeof parsed.flags.db === 'string'
      ? parsed.flags.db
      : process.env.CONTEXTFORGE_DB_PATH ??
        path.join(process.cwd(), '.contextforge-data', 'contextforge.db');

  const store = new ContextForgeSqliteStore(dbPath);
  const service = new ContextForgeWorkspaceService(store);

  try {
    switch (parsed.command) {
      case 'onboard': {
        const repoPath = parsed.positionals[0] ?? '.';
        const name = typeof parsed.flags.name === 'string' ? parsed.flags.name : undefined;

        io.stderr(`Analyzing repository at "${repoPath}"...`);
        const { repository, snapshot } = await service.onboardRepository({
          rootPath: repoPath,
          name,
        });

        if (parsed.flags.json) {
          io.stdout(
            JSON.stringify(
              {
                repository,
                snapshotStats: snapshot.stats,
                subProjects: snapshot.subProjects.map((s) => ({
                  id: s.id,
                  name: s.name,
                  rootPath: s.rootPath,
                  languages: s.languages.map((l) => l.value),
                  frameworks: s.frameworks.map((f) => f.value),
                })),
                warnings: snapshot.unknownsAndLimitations,
              },
              null,
              2
            )
          );
        } else {
          io.stdout('\n========================================================');
          io.stdout(`ContextForge Analysis Complete: ${repository.name}`);
          io.stdout('========================================================');
          io.stdout(`Repository ID    : ${repository.id}`);
          io.stdout(`Root Directory   : ${snapshot.rootPath}`);
          io.stdout(`Git Repository   : ${snapshot.gitMetadata.isGitRepo ? 'Yes' : 'No'} (${snapshot.gitMetadata.currentBranch ?? 'no branch'})`);
          io.stdout(`Total Files      : ${snapshot.stats.totalFilesDiscovered} discovered (${snapshot.stats.totalFilesIndexed} indexed, ${snapshot.stats.totalFilesExcluded} excluded)`);
          io.stdout(`Secret Exclusions: ${snapshot.stats.secretExclusionsCount}`);
          io.stdout(`Symbols Extracted: ${snapshot.stats.totalSymbolsExtracted}`);
          io.stdout(`Sub-Projects     : ${snapshot.subProjects.length}`);

          for (const sp of snapshot.subProjects) {
            const langs = sp.languages.map((l) => l.value).join(', ') || 'Structural';
            const fws = sp.frameworks.map((f) => f.value).join(', ');
            io.stdout(`  * ${sp.name || 'root'} (${sp.rootPath || '/'}): [${langs}]${fws ? ` - Frameworks: ${fws}` : ''}`);
          }

          if (snapshot.unknownsAndLimitations.length > 0) {
            io.stdout(`\nWarnings & Limitations (${snapshot.unknownsAndLimitations.length}):`);
            for (const warn of snapshot.unknownsAndLimitations.slice(0, 5)) {
              io.stdout(`  ! ${warn}`);
            }
          }
          io.stdout('========================================================\n');
        }
        return 0;
      }

      case 'pack': {
        const repoPath = parsed.positionals[0] ?? '.';
        const taskTitle =
          typeof parsed.flags.task === 'string' ? parsed.flags.task : '';
        if (!taskTitle.trim()) {
          io.stderr('Error: --task <title> is required to assemble an AI context pack.');
          return 1;
        }

        const taskDescription =
          typeof parsed.flags.desc === 'string' ? parsed.flags.desc : '';
        const taskType = (typeof parsed.flags.type === 'string'
          ? parsed.flags.type
          : 'implement_feature') as DevelopmentTaskType;
        const assistantTarget = (typeof parsed.flags.target === 'string'
          ? parsed.flags.target
          : 'universal') as CodingAssistantTarget;
        const customTemplateInstruction =
          typeof parsed.flags.instruction === 'string'
            ? parsed.flags.instruction
            : undefined;
        const format = parsed.flags.format === 'plaintext' ? 'plaintext' : 'markdown';

        const maxTotalChars =
          typeof parsed.flags.budget === 'string'
            ? Number.parseInt(parsed.flags.budget, 10) || 16000
            : 16000;
        const maxFilesCount =
          typeof parsed.flags['max-files'] === 'string'
            ? Number.parseInt(parsed.flags['max-files'], 10) || 15
            : 15;

        const seedFilePaths =
          typeof parsed.flags.seed === 'string'
            ? parsed.flags.seed.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined;
        const excludedFilePaths =
          typeof parsed.flags.exclude === 'string'
            ? parsed.flags.exclude.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined;

        io.stderr(`Analyzing repository and assembling context pack for "${taskTitle}"...`);
        const { repository } = await service.onboardRepository({
          rootPath: repoPath,
        });

        const result = await service.generateContextPack({
          repoId: repository.id,
          taskTitle,
          taskDescription,
          taskType,
          assistantTarget,
          customTemplateInstruction,
          seedFilePaths,
          excludedFilePaths,
          budget: {
            maxTotalChars,
            maxFilesCount,
          },
        });

        if (parsed.flags.json) {
          io.stdout(JSON.stringify(result.pack, null, 2));
          return 0;
        }

        const exportedContent =
          format === 'plaintext' ? result.plainTextExport : result.markdownExport;

        const outputFile =
          typeof parsed.flags.output === 'string'
            ? parsed.flags.output
            : typeof parsed.flags.o === 'string'
              ? parsed.flags.o
              : null;

        if (outputFile) {
          await fs.writeFile(outputFile, exportedContent, 'utf-8');
          io.stderr(`Context pack successfully written to "${outputFile}" (${exportedContent.length} chars, ${result.pack.includedItems.length} files).`);
        } else {
          io.stdout(exportedContent);
        }
        return 0;
      }

      case 'review': {
        const repoPath = parsed.positionals[0] ?? '.';
        const targetSpec =
          typeof parsed.flags.target === 'string' ? parsed.flags.target : undefined;
        let rawDiffOverride: string | undefined;

        if (typeof parsed.flags['raw-diff'] === 'string') {
          rawDiffOverride = await fs.readFile(parsed.flags['raw-diff'], 'utf-8');
        }

        io.stderr(`Reviewing changes in "${repoPath}" (${targetSpec ?? 'WORKING_TREE'})...`);
        const { repository } = await service.onboardRepository({
          rootPath: repoPath,
        });

        const report = await service.reviewChanges({
          repoId: repository.id,
          targetSpec,
          rawDiffOverride,
        });

        if (parsed.flags.json) {
          io.stdout(JSON.stringify(report, null, 2));
        } else {
          io.stdout('\n========================================================');
          io.stdout(`ContextForge Git Change Review: ${repository.name}`);
          io.stdout('========================================================');
          io.stdout(`Target Diff      : ${report.diffTargetLabel}`);
          io.stdout(`Changed Files    : ${report.stats.totalChangedFiles}`);
          io.stdout(`Critical Findings: ${report.stats.criticalCount}`);
          io.stdout(`Warning Findings : ${report.stats.warningCount}`);
          io.stdout(`Info Findings    : ${report.stats.infoCount}`);

          if (report.findings.length > 0) {
            io.stdout('\nFindings & Risks:');
            for (const f of report.findings) {
              const badge = f.severity === 'critical' ? '[CRITICAL]' : f.severity === 'warning' ? '[WARNING]' : '[INFO]';
              io.stdout(`  ${badge} (${f.category}): ${f.title}`);
              io.stdout(`    Description: ${f.description}`);
              if (f.remediationHint) {
                io.stdout(`    Remediation: ${f.remediationHint}`);
              }
            }
          } else {
            io.stdout('\nNo high-risk security, SQL, or blast-radius issues detected.');
          }
          io.stdout('========================================================\n');
        }

        const outputFile =
          typeof parsed.flags.output === 'string'
            ? parsed.flags.output
            : typeof parsed.flags.o === 'string'
              ? parsed.flags.o
              : null;

        if (outputFile) {
          await fs.writeFile(outputFile, JSON.stringify(report, null, 2), 'utf-8');
          io.stderr(`Review report written to "${outputFile}".`);
        }

        if (parsed.flags['fail-on-critical'] && report.stats.criticalCount > 0) {
          io.stderr(`CI check failed: ${report.stats.criticalCount} critical risk(s) detected.`);
          return 1;
        }

        if (
          parsed.flags['fail-on-warning'] &&
          (report.stats.criticalCount > 0 || report.stats.warningCount > 0)
        ) {
          io.stderr(`CI check failed: ${report.stats.criticalCount} critical, ${report.stats.warningCount} warning finding(s).`);
          return 1;
        }

        return 0;
      }

      case 'report': {
        const repoPath = parsed.positionals[0] ?? '.';
        io.stderr(`Generating deterministic report for "${repoPath}"...`);
        const { snapshot } = await service.onboardRepository({
          rootPath: repoPath,
        });

        const markdown = service.generateRepositoryReport(snapshot.repoId);
        const outputFile =
          typeof parsed.flags.output === 'string'
            ? parsed.flags.output
            : typeof parsed.flags.o === 'string'
              ? parsed.flags.o
              : null;

        if (outputFile) {
          await fs.writeFile(outputFile, markdown, 'utf-8');
          io.stderr(`Report written to "${outputFile}".`);
        } else {
          io.stdout(markdown);
        }
        return 0;
      }

      case 'serve': {
        const port =
          typeof parsed.flags.port === 'string'
            ? Number.parseInt(parsed.flags.port, 10) || 4310
            : 4310;
        const host =
          typeof parsed.flags.host === 'string' ? parsed.flags.host : '127.0.0.1';

        const server = createContextForgeHttpServer(service, {
          workspaceRootDir: process.cwd(),
        });

        server.listen(port, host, () => {
          io.stdout(`ContextForge Server running on http://${host}:${port}`);
          io.stdout(`API Endpoints available at http://${host}:${port}/api/health`);
          io.stdout('Press Ctrl+C to stop.');
        });

        return new Promise<number>(() => {
          // Keep running
        });
      }

      default:
        io.stderr(`Unknown command: "${parsed.command}". Run \`contextforge help\` for usage.`);
        return 1;
    }
  } finally {
    // Clean up SQLite connection if command completed
    if (parsed.command !== 'serve') {
      store.close();
    }
  }
}

// Auto-run if executed as main CLI script
const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === currentFilePath || invokedPath.endsWith('contextforge.js')) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }).catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
