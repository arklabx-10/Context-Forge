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

## Quick Start

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
