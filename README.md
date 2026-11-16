# ContextForge — Stack-Agnostic AI Engineering Workspace

ContextForge is a local-first, stack-agnostic AI engineering workspace that helps developers onboard unfamiliar repositories, maintain verified source-linked project knowledge, assemble deterministic context packs for AI coding assistants, and review Git changes safely.

## Core Capabilities

1. **Stack-Agnostic Repository Onboarding & Intelligence**:
   - **Tier-0 Universal Structural Scanner**: Works on *any* repository—even in unrecognized or custom languages (e.g., `.qlang`)—discovering monorepo sub-project boundaries (never assuming the root directory is a single application), file roles, SHA-256 LF-normalized fingerprints, config templates, documentation, and entry-point heuristics.
   - **Tier-1 Optional Pluggable Adapters**: Deeper analysis for Node.js/TypeScript/JavaScript, Python (`pyproject.toml`, `requirements.txt`, FastAPI/Flask), .NET/C# (`*.csproj`, ASP.NET Minimal APIs), Go (`go.mod`), Rust (`Cargo.toml`), SQL & Prisma schemas (`*.sql`, `*.prisma`), and Docker/Makefiles.
2. **Epistemic Transparency & Provenance**:
   - Every architectural, dependency, or review claim is wrapped in `EvidenceBackedClaim<T>` with an explicit `CertaintyLevel` (`verified`, `inferred`, `ai_generated`, or `unknown`) and `SourceReference` (`relativePath`, `startLine`, `endLine`, `fileSha256`, `commitSha`).
3. **Deterministic Context Pack Assembler & Prompt Injection Defense**:
   - Reproducible relevance scoring (seed files $\rightarrow$ 1-hop import neighbors $\rightarrow$ associated tests $\rightarrow$ sub-project manifests $\rightarrow$ task keyword matches) with lexicographical tie-breaking and strict character/token budget enforcement.
   - Exports **Markdown** and **Plain Text** context packs compatible with Claude Code, Cursor, GitHub Copilot, Codex/Aider, and generic coding agents.
   - Wraps all repository excerpts in `<untrusted_repository_content>` boundary fences and flags indirect prompt-injection patterns and Trojan Source bidirectional Unicode characters.
4. **Project Knowledge & Automatic Staleness Detection**:
   - Maintain Architecture Decision Records (ADRs), coding conventions, known limitations, and workflow templates anchored to `SourceReference` fingerprints.
   - Automatically flags entries as `potentially_stale` when referenced files change their SHA-256 hash.
5. **Evidence-Backed Git Change Review**:
   - Inspects working-tree diffs, commit ranges, or unified patches without executing repository code or migrations.
   - Detects downstream dependency blast radius (`potential_regression`), missing test updates (`missing_test_coverage`), sensitive file changes (`sensitive_file_change`), stale ADR impacts (`stale_knowledge_impact`), and destructive SQL operations (`DROP TABLE`, `TRUNCATE`, `DROP COLUMN`, unbounded `DELETE`/`UPDATE`).
6. **AI Provider Independence & Privacy Controls**:
   - Ships with `NoOpDeterministicProvider` active by default (100% local, zero network calls).
   - External AI adapters require an explicit per-request `OutboundConsentToken` bound to the exact `payloadSha256`.
   - Built-in SQLite index inspector and 1-click **Purge All Indexed Data** control.

## Command-Line Interface (CLI) & CI/CD Integration

ContextForge includes an executable CLI (`contextforge` / `npx contextforge`) for local developer workflows and automated CI pipelines:

```bash
# 1. Onboard and analyze any repository
contextforge onboard ./my-repo
contextforge onboard . --json

# 2. Assemble a deterministic AI context pack for an assistant
contextforge pack . --task "Add payment webhook handler" --target claude_code -o context.md
contextforge pack . --task "Fix SQL deadlock" --budget 12000 --format plaintext

# 3. Conduct an evidence-backed Git change review
contextforge review .
# Fail CI build if critical risks (destructive SQL, secret leaks, prompt injections) are introduced:
contextforge review . --fail-on-critical

# 4. Generate deterministic Markdown repository report (No AI required)
contextforge report . -o REPORT.md

# 5. Launch the local workspace server and static UI
contextforge serve --port 4310

# 6. Run as an MCP server so AI coding assistants can call ContextForge directly
contextforge mcp
```

### MCP Server (Claude Code, Cursor & other MCP clients)

`contextforge mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio. Your assistant can then fetch context packs and change reviews itself, without you exporting files by hand. The server has no extra dependencies. It never runs repository code and never calls an external AI provider, because the MCP client is the AI.

| Tool | What it does |
| :--- | :--- |
| `onboard_repository` | Analyze and index a local repository (any language); returns sub-projects, languages, frameworks and limitations. |
| `search_repository` | Full-text search over files, symbols, SQL objects, dependencies and knowledge. Snippets are fenced as untrusted content. |
| `build_context_pack` | Re-scan and assemble a deterministic, budget-limited context pack for a task (`task`, optional `taskType`, `target`, `seedFiles`, `budgetChars`, `maxFiles`). |
| `review_changes` | Evidence-backed review of the working tree, a revision range (`target`), or a supplied unified `diff`. |
| `knowledge_audit` | Report which recorded ADRs and conventions are fresh, potentially stale, or reference missing files. |

Register it with Claude Code after `npm run build`. Use an absolute path, and pass `--db` so the index doesn't land in whichever project the assistant is working in:

```bash
claude mcp add contextforge -- node /path/to/ContextForge/bin/contextforge.js mcp --db ~/.contextforge/contextforge.db
```

For other clients (e.g. Cursor's `mcp.json`), use the same command:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": ["/path/to/ContextForge/bin/contextforge.js", "mcp", "--db", "/home/you/.contextforge/contextforge.db"]
    }
  }
}
```

If you don't pass `--db`, the index is stored in `.contextforge-data/` under the server's working directory, the same as for the other CLI commands.

### GitHub Actions CI Example

```yaml
name: ContextForge Change Review Guard

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build
      - name: Evidence-Backed Diff Review
        run: npx contextforge review . --target "origin/${{ github.base_ref }}...HEAD" --fail-on-critical
```

## Quick Start

**Requirements:** Node.js 22.13 or newer (Node.js 24 recommended). ContextForge uses the built-in `node:sqlite` module, which needs no native build step. On Node 22, Node prints an `ExperimentalWarning: SQLite is an experimental feature` message; this is expected and harmless. Set `NODE_NO_WARNINGS=1` to hide it.

```bash
# 1. Typecheck and run automated test suite
npm run typecheck
npm test

# 2. Build production UI and server
npm run build

# 3. Start ContextForge Server (http://127.0.0.1:4310)
npm start
```

For development with hot reload:
```bash
npm run dev:server   # API server on http://127.0.0.1:4310
npm run dev:ui       # Vite dev server on http://127.0.0.1:5173
```
