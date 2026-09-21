# AGENTS.md - AI Development Rules & Project Guardrails

Canonical rules for every AI agent in this repo. This file stays lean on purpose: details live in `/docs` and `.claude/skills/`. **Read by task, never everything at once.**

## 1. Documentation map (`/docs`)

All 12 files must exist and be populated (enforced by CI and the pre-commit hook).

| File | Read when |
|---|---|
| `index.md` | Always (boot). Overview, context digest, project skills. |
| `tasks.md` | Always (boot). Backlog, status, check-off state. |
| `memory.md` | Always (boot): "Read First" plus recent entries. Lessons, decisions, corrections. |
| `functionality-index.md` | Before creating any code, **via `find.mjs`**. Never read it whole. |
| `conventions.md` | Before writing code. Style, folders, idioms, anti-patterns. |
| `architecture.md` | Structural change, new module, new dependency, cross-layer work. |
| `schema.md` | Touching API routes, data models, or shared types. |
| `design.md` | UI work. Design system, tokens, component specs. |
| `features.md` | Implementing or verifying a feature. Acceptance criteria. |
| `userjourney.md` | UX flows, personas, wireframe mapping. |
| `agents.md` | Agent roles, tool permissions, safety boundaries. |
| `environment.md` | Setup, CLI tools, build scripts, ports, `.env.example`. |

## 2. Boot sequence

Before reading or writing code:

1. **State recovery:** read `docs/index.md`, `docs/tasks.md`, top of `docs/memory.md`.
2. **Guardrails:** skim `docs/conventions.md` and `docs/architecture.md` (headings first) before proposing solutions.
3. **Contracts:** check `docs/schema.md` before creating or modifying API endpoints or data models.
4. **Reuse search:** run the reuse protocol (section 3) before writing any new code.
5. **Ecosystem and security:** verify live dependency status and security constraints when adding libraries or integrations (sections 5-6).
6. **Local context:** read target files and their direct dependencies fully (by line range for large files) before editing.

## 3. Reuse-first (DRY) protocol - mandatory

**Never write a function, component, hook, type, constant, validator, API client, or util without searching first.**

1. **Search:** `node scripts/ai/find.mjs <keywords and synonyms>` (searches live source symbols; try 2-3 phrasings, e.g. `format date`, `currency`, `money`).
2. **Decide, in this order:**
   1. **Reuse as-is.**
   2. **Extend** the existing symbol (backward-compatible signature; update its callers only if the task requires it).
   3. **Compose** from existing symbols.
   4. **Create new**, only if 1-3 are impossible. State the reason in one line in the task note or commit body.
3. **Register:** put new code in its canonical location (`docs/conventions.md`), give every exported symbol a one-line doc comment (this is what the search matches on), then run `node scripts/ai/build-index.mjs`.

Rules:
- **Single source of truth:** types come from `docs/schema.md`/generated types, design values from design tokens, config from one config module, HTTP calls from the one API client. Never redefine them locally.
- **No copy-paste:** duplicated blocks of 8+ lines are a defect (`node scripts/ai/dupes.mjs`). Extract, do not clone.
- **No pass-through wrappers** that only forward to another function.
- **AHA, not premature abstraction:** two similar snippets that change for different reasons may stay separate; extract at the third occurrence or when they must change together.
- **Update, do not fork:** fixing a bug in a shared function beats writing a corrected copy next to it.

## 4. Token and context discipline

- Use `find.mjs` instead of reading the index or grepping broadly. Read files by line range when they are large; do not re-read what you already have.
- Prefer targeted edits over rewrites; never paste large outputs back into the conversation, summarize them.
- Load a skill only when its description matches the task. Do not pre-read all skills or docs.
- Keep `docs/index.md` context digest under 60 lines and `docs/memory.md` under ~150 lines; prune instead of appending forever.
- Stop exploring once you can name the file, symbol, and change. Ask one focused question if you cannot.

## 5. Dynamic research and ecosystem verification

Training data is stale. Do not rely on memory when choosing dependencies or writing framework code.

- **Registry verification:** before `npm install` / `pip install` / `cargo add`, confirm the package exists on the live registry, is actively maintained, and the name is exact. Never install hallucinated or typosquatted packages.
- **Deprecation and API checks:** verify framework APIs against current official docs before implementing.
- **Audit:** prefer maintained packages with zero critical/high CVEs; run `npm audit` / `pip-audit` / `cargo audit` before adding third-party code.
- **Strict pinning:** exact versions in manifests (`save-exact`), lockfiles authoritative and committed. `node scripts/ai/check-pins.mjs` enforces it for `package.json` and Python `requirements*.txt` (`==`).

## 6. Security and supply chain

- **Zero hardcoded secrets:** never output keys, tokens, or credentials in code or docs; use `.env` and environment variables.
- **Input validation** on every boundary (HTTP, database, shell, file reads) against SQL injection, XSS, command injection.
- **Least privilege:** minimal shell, filesystem, and network access, limited to the task.
- **Auth changes** (flows, tokens, privilege levels) need explicit isolated review before merging. `.github/CODEOWNERS` assigns owners to auth-related paths (`scripts/ai/check-auth-review.mjs` warns when one has none); do not merge them without the code owner's review.
- **Enforcement:** in Claude Code, `.claude/settings.json` and `scripts/ai/hook.mjs` block secret access, secrets in code, destructive commands, and hand-edited lockfiles, and ask the user before guardrail files change. Other agents rely on this file plus CI. If something is blocked, do not look for a workaround: tell the user what you need.

## 7. Code generation guardrails

- **Incremental scope:** focused edits (max ~100-150 lines per iteration); no full-file rewrites unless instructed.
- **Scope lock:** do not modify, move, or delete files outside the assigned task. Report adjacent problems instead of fixing them.
- **Preserve:** keep existing comments, type definitions, and exported signatures unless refactoring is requested.
- **No unapproved dependencies:** new third-party packages need user confirmation plus registry verification.

## 8. Definition of done

A task is complete only when all pass:

1. Strict type check, zero errors (`tsc`, `mypy`, or equivalent).
2. Lint, zero errors or warnings (`eslint`/`ruff`).
3. Dependency audit (`npm audit` / `pip-audit`), zero critical vulnerabilities; pins check passes.
4. Clean build, no runtime or bundler warnings.
5. Existing and new tests pass.
6. Clean logs, no unhandled exceptions or silent failures.
7. `node scripts/ai/build-index.mjs --check` passes and `dupes.mjs` shows nothing new you introduced.
8. Coverage threshold configured and met (`test:coverage`, or `pytest --cov` with `fail_under`); Playwright e2e passes when the project has it.
9. Auth-related changes are covered by CODEOWNERS and flagged for review.
10. Living docs synced (section 9).

## 9. Living documentation sync

- **tasks.md:** on completion, mark done with progress details and next steps.
- **schema.md:** any change to API routes, payloads, or DB tables is mirrored immediately.
- **features.md:** update completed acceptance criteria.
- **functionality-index.md:** regenerate after adding/renaming/removing exports.
- **memory.md:** record lessons (section 10).

## 10. Project memory (agents improve over time)

`docs/memory.md` is the project's durable lessons file. Write with `node scripts/ai/remember.mjs <gotcha|decision|correction|pattern> "<one or two lines>"`.

- **Record when:** the user corrects you; a bug or failed build reveals a repeatable pitfall; a non-obvious decision is made; a pattern proves reliable.
- **Do not record:** secrets, task status (that is `tasks.md`), anything already in `conventions.md`, one-off details.
- **Promote:** when an entry recurs or applies broadly, move it into `conventions.md` or the relevant skill and delete it from memory.
- **Prune:** remove stale entries during related work; keep the file under ~150 lines.

## 11. Project skills

Project-specific skills live in `.claude/skills/<name>/SKILL.md` (other agents: symlink or copy that folder to their skills directory).

- Built in: `reuse-first`, `project-bootstrap`, `project-memory`, `verify-and-ship`, `mcp-tools`.
- `.claude/skills` is the source of truth. `node scripts/ai/sync-agents.mjs` mirrors it to `.agents/skills` (read by Codex, Cursor, Copilot); the Claude Code Stop hook and pre-commit keep it in sync. Never edit the mirror.
- `node scripts/ai/detect-stack.mjs --skills` scaffolds `stack-<tech>` skills for the detected architecture; the `project-bootstrap` skill completes them from real code.
- A skill is short (under ~80 lines), has a trigger-style `description`, cites real file paths, and contains project facts, not generic tutorials.
- When you notice a repeated multi-step workflow or a recurring mistake class, propose a new skill to the user instead of silently expanding this file.

## 12. MCP servers

Tools beyond the shell (current docs, browser checks, framework diagnostics). Load the `mcp-tools` skill when you need them or are asked to set them up.

- **Setup:** `node scripts/ai/setup-mcp.mjs` prints a plan (changes nothing); `--apply` verifies and writes `.mcp.json` (Claude Code) and `.ai/mcp.lock.json`, plus `.vscode/mcp.json`, `.cursor/mcp.json`, `.gemini/settings.json`, and a managed block in `.codex/config.toml` for the clients listed in `.ai/config.json` (`mcp.clients`) or `--client`.
- **How versions are chosen:** applicable servers come from the vetted catalog `.ai/mcp-catalog.json` (plus `.ai/mcp-catalog.local.json`). The latest stable, non-deprecated version older than the minimum release age is resolved live from the npm registry, pinned exactly, and handshake-tested before it is written. Framework CLIs that bundle an MCP server (Angular, Prisma) run the project's own pinned CLI. `--update` re-resolves; a new version that fails verification is not adopted.
- **Discovery:** `--discover` searches the official MCP Registry for servers matching the project's dependencies. Results are unvetted third-party code: never add one without user approval and a review of its source.
- **Rules:** enable only what the task needs (every server adds tool descriptions to context); no inline secrets (use `${VAR}` expansion); browser servers run isolated; servers with destructive tools stay off unless the user opts in; never commit `@latest`; adding or changing an MCP server is a dependency change and needs user approval (section 7).

## 13. Monorepos

- `.ai/stack.json` lists `workspaces` (path, frameworks, scripts). Run a package's own commands from its directory.
- `find.mjs` and the index cover `apps/`, `packages/`, and `services/`. Search the whole repo before creating shared code in a package; prefer an existing shared package over a copy.
- `stack-<tech>` skills say which packages use the technology ("Used in").
- Pins, coverage, and dependency checks apply to every workspace package.

## 14. When unsure

Ask one focused question rather than guessing when a decision affects architecture, data, auth, or dependencies. Otherwise state your assumption in one line and proceed.
