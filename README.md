# AI Project Kit 1.6

Drop-in structure, rules, and tooling that make AI agents reuse code instead of regenerating it, spend fewer tokens, learn per project, follow guardrails you can enforce, and use the right MCP servers for the stack. Zero dependencies (Node >= 18).

## Install and update

Pin as a **devDependency** in the target project (recommended), then install or refresh:

```bash
npm install -D @bobrowsse-tech/ai-kit@1.6.0
npx ai-kit install                    # new or existing project (cwd)
npx ai-kit update                     # refresh kit files, keep everything you customized
npx ai-kit install --dry-run          # show what would happen
npx ai-kit install /path/to/project   # explicit target
```

One-shot without adding a dependency:

```bash
npx @bobrowsse-tech/ai-kit install
```

From a local clone (development):

```bash
node install.mjs /path/to/project
node install.mjs /path/to/project --update
```

Every file has one of four classes (`kit.json`, recorded per project in `.ai/kit.json`):

| Class | Examples | On install / update |
|---|---|---|
| owned | `scripts/ai/`, built-in skills, `ai-guardrails.yml`, `.githooks/` | refreshed unless you modified them; then the kit version is saved as `<file>.kit-new` |
| seed | `docs/`, `.ai/config.json`, `CODEOWNERS`, `CLAUDE.md` | created once, never touched again |
| merge-doc | `AGENTS.md` | created; if yours differs, the kit version goes to `AGENTS.kit.md` |
| json-merge | `.claude/settings.json` | merged additively; your entries stay, dropped kit entries are removed |

`--force` also overwrites modified owned files (use it once when upgrading from 1.0). Only `--reset-seeds` overwrites docs and config. Then tell your agent: **"Read AGENTS.md and run the project-bootstrap skill."** Legacy repos with `^`/`~` ranges get `"pins": "warn"` automatically.

## What is inside

| Piece | Purpose |
|---|---|
| `AGENTS.md` (+ `CLAUDE.md`) | Canonical rules: boot sequence, reuse-first DRY, token discipline, guardrails, DoD, docs sync, memory, skills, MCP, monorepos. |
| `docs/` (12 + security checklist) | The standard docs plus `functionality-index.md`, `memory.md`, and seed `security-checklist.md`. |
| `find.mjs`, `build-index.mjs`, `dupes.mjs` | Reuse search, generated index (stale = failure), duplicate-block report. |
| `detect-stack.mjs`, `remember.mjs` | Stack detection and per-technology skills; dated project memory. |
| `setup-mcp.mjs` | MCP servers: plan, apply, verify, update, check, discover. |
| `hook.mjs` + agent hook configs | Live enforcement for Claude Code, Cursor, Codex, Copilot, and Gemini CLI (below). |
| `check-pins`, `check-coverage`, `check-auth-review`, `check-docs`, `preship-check` | CI/pre-commit checks (preship defaults to warn). |
| `pre-ship-security` skill | 21-point pre-launch review against `docs/security-checklist.md`. |
| `modern-css-workflows` skill | Modern CSS patterns (fluid type, OKLCH, subgrid, `:has()`, scroll-driven animation, popovers). |
| `sync-agents.mjs` | Mirrors `.claude/skills` to `.agents/skills` for other agents. |
| `.github/` | Workflow (JS, Python, e2e, pre-ship scan), Dependabot, PR template, CODEOWNERS. |

On install/update, if `.github/workflows/ai-guardrails.yml` exists but is missing the Pre-Ship Security Scan step, the installer **injects that step only** (custom workflow edits elsewhere are left alone). Set `"preship": "error"` in `.ai/config.json` when you want the scan to fail CI.
## Enforcement (multi-agent)

One policy in `scripts/ai/hook.mjs` is registered for every agent that exposes project hooks:

| Agent | Config | Hook modes |
|---|---|---|
| **Claude Code** | `.claude/settings.json` | `pre-tool`, `stop` (+ permission allow/ask/deny lists) |
| **Cursor** | `.cursor/hooks.json` | `cursor` (`beforeShellExecution`, `beforeReadFile`, write `preToolUse`), `stop` — `failClosed: true`, always emits permission JSON |
| **Codex** | `.codex/hooks.json` | `codex` (`PreToolUse`, including `Bash` + `apply_patch`), `stop` — project must be **trusted** and each hook definition reviewed via `/hooks` |
| **Copilot / VS Code Agent** | `.github/hooks/ai-kit.json` | `copilot` (`PreToolUse`), `stop` — cloud agent treats `ask` as deny; background subagents may bypass hooks |
| **Gemini CLI** | `.gemini/settings.json` (json-merge; MCP apply keeps other keys) | `gemini` (`BeforeTool`), `stop` via `AfterAgent` — no ask; guardrail-file edits are denied with a confirm message |

The guard blocks reading `.env`/keys/`secrets/` (including via `cat`), writing secrets into code (AWS/GitHub/Slack/Stripe/Google keys, private keys, `apiKey = "..."` patterns), `curl | sh`, `rm -rf` of roots, force pushes, `sudo`, and hand-edits of lockfiles and `.git`. Editing guardrail files asks for confirmation where the agent supports it.

**Hard backstop for every agent:** git pre-commit + `ai-guardrails.yml` CI. Hooks are strong but not a sandbox. Tune patterns in `.ai/config.json` under `guard`.

## Git hooks (no Husky required)

`node scripts/ai/setup-hooks.mjs` sets `core.hooksPath=.githooks`; add `"prepare": "node scripts/ai/setup-hooks.mjs"` so every clone gets it. It leaves Husky or another manager alone. `.githooks/pre-commit`, `.husky/pre-commit`, and `.pre-commit-config.yaml` (Python teams, installed only for Python repos) all run the same `scripts/ai/pre-commit.mjs`. The hook wrapper skips with a warning when Node is missing (CI still checks). `check-docs.sh` and `pre-commit.sh` remain as one-line shims for setups that call them.

## Windows

Everything a developer runs locally is Node, so it works on native Windows without Git Bash or WSL: the installer, all `scripts/ai/*.mjs` (including `check-docs.mjs` and `pre-commit.mjs`, ported from bash), and the git hook (git always runs hooks with its bundled `sh`). The installer adds a `.gitattributes` block that keeps scripts and hooks LF, because CRLF breaks `#!/usr/bin/env sh`. For MCP, native Windows clients need `cmd /c npx`: run `setup-mcp.mjs --apply --windows` (recorded in the lock so `--check` and `--update` stay consistent; the default stays portable). The generated CI workflow runs on Linux runners (`ci-install.sh` is bash and only used there). The kit's own CI runs the hermetic suite on `windows-latest`; POSIX-only tests (fake `npx`, symlinks, `/bin/sh`) are skipped there. I could not execute anything on Windows when building this, so treat the first Windows CI run as the real verification.

## MCP servers

```bash
node scripts/ai/setup-mcp.mjs                # plan (changes nothing)
node scripts/ai/setup-mcp.mjs --apply        # verify, then write .mcp.json + .ai/mcp.lock.json
node scripts/ai/setup-mcp.mjs --apply --include chrome-devtools --client claude,vscode,cursor,gemini,codex
node scripts/ai/setup-mcp.mjs --verify | --update | --check | --discover
```

Versions are resolved live from the npm registry (latest stable, non-deprecated, older than `mcp.minAgeDays`), pinned exactly, and handshake-tested before anything is written; a failing version is never adopted. Angular and Prisma run the project's own pinned CLI. Client files: `claude` -> `.mcp.json`, `vscode` -> `.vscode/mcp.json`, `cursor` -> `.cursor/mcp.json`, `gemini` -> `.gemini/settings.json`, `codex` -> a marked block in `.codex/config.toml` (your other TOML is untouched; Codex reads project config only for trusted projects and its Desktop app has been reported to ignore it, openai/codex#13025). A server you defined yourself in any of these files is never overwritten. In a monorepo, a CLI installed only inside a workspace gets guidance to add a `command` entry in `.ai/mcp-catalog.local.json` (that file is also where private servers and `--discover` findings go). `setup-mcp.mjs` gives child processes a minimal environment, never your tokens.

## CI

`ai-guardrails.yml` runs: docs/index/pins/MCP/skills-mirror/coverage/auth checks; secret scan and audit; type check, lint, build, tests (uses `test:coverage` when present); Python (`ruff`, `mypy`, `pytest` with `--cov` when pytest-cov exists, `pip-audit`); Playwright e2e when a `playwright.config.*` exists (`playwright install --with-deps`); schema-sync and auth-change flags on PRs; and actionlint (pinned) on the workflow file itself. Turn on branch protection "Require review from Code Owners" so CODEOWNERS is enforced. `check-coverage` verifies a threshold is configured in vitest/jest/nyc/c8/pytest; the tool enforces it.

## Monorepos and other agents

- Workspaces (npm/yarn/pnpm, `pnpm-workspace.yaml`, uv) are detected: per-package frameworks in `.ai/stack.json`, "Used in" lines in stack skills, pins/coverage per package, MCP applicability across packages, index roots `apps/`, `packages/`, `services/`.
- `.claude/skills` is the source; `sync-agents.mjs` copies it to `.agents/skills` (Codex and Cursor read that directory; Copilot reads both). `--symlink` uses links on macOS/Linux. Mirrors are generated: never edit them. Codex/Cursor/Copilot also read `AGENTS.md`.

## Testing the kit

```bash
npm test          # 142 hermetic tests (no network), node:test
npm run test:live # real npm + MCP registries, real servers; also the scheduled CI job
```

Tests cover the scripts, guard, MCP flows for all five clients (against a local registry stub and a fake MCP server), installer/update safety, monorepos, and workflow hygiene. If `actionlint` is on your PATH, `npm test` also runs it on the shipped workflows; kit CI always does. The live test is the part I could not run when this was built.

## Known limits

- Symbol extraction is regex-based (top-level exports/defs of JS/TS and Python), not semantic.
- The MCP catalog only contains servers whose commands were checked against official docs. Other MCP clients (Windsurf, Zed, Cline, ...) are not written; add one to `CLIENTS` in `setup-mcp.mjs` if you need it.
- GitHub Actions tags and Gitleaks are unpinned by default (pin to SHAs if policy requires; Gitleaks needs a license secret on org repos). `NODE_VERSION`, `PYTHON_VERSION`, `PIP_AUDIT_VERSION` are single knobs to verify. `pip-audit` has no severity gate.
- Windows: see the Windows section; no Windows machine was available to run it.
- actionlint could not be run where this was built (no network, no binary). Both workflow files are covered by an actionlint CI job (pinned `ACTIONLINT_VERSION`, verify it), by hygiene tests, by YAML parsing, and by `bash -n` on every run block; shellcheck findings that actionlint would raise (word-splitting of `$PM_RUN`) are silenced with directives. Expect to fix-forward on the first CI run.
