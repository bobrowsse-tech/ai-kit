# Changelog

## 1.6.0

Added
- Live guard adapters for Codex (`.codex/hooks.json`), GitHub Copilot / VS Code Agent (`.github/hooks/ai-kit.json`), and Gemini CLI (hooks merged into `.gemini/settings.json`).
- `hook.mjs codex|copilot|gemini` modes on the same shared evaluator as Claude and Cursor; `apply_patch` / Gemini `write_file`/`replace`/`run_shell_command` covered.
- Installer: per-file `rec.settings` tracking so Claude and Gemini json-merge do not overwrite each other's managed permission lists.

Changed
- Enforcement docs: all five agents with project hooks get live blocks; pre-commit + CI remain the universal backstop. Codex requires project trust + `/hooks` review; Copilot subagents may bypass hooks; Gemini maps ask → deny for guardrail files.

## 1.5.0

Added
- Shared live guardrails for Cursor: owned `.cursor/hooks.json` drives the same `scripts/ai/hook.mjs` policy as Claude Code (`beforeShellExecution`, `beforeReadFile`, `beforeTabFileRead`, write-focused `preToolUse`, `stop`).
- `hook.mjs cursor` adapter emits Cursor permission JSON (required with `failClosed`); Claude `pre-tool` protocol unchanged.

Changed
- Enforcement docs: Claude Code and Cursor get live hooks; Codex/Copilot/Gemini still rely on `AGENTS.md` plus pre-commit and CI.
- `guard.guardrailFiles` includes `.cursor/hooks.json`.

## 1.4.0

Added
- `modern-css-workflows` skill: fluid typography, OKLCH color, subgrid, `:has()`, scroll-driven animations, container style queries, popovers/anchor positioning, pure-CSS counters, and a modern reset (folded in from the modern-css add-on).

## 1.3.0

Added
- Pre-ship security: `pre-ship-security` skill, seed `docs/security-checklist.md` (21-point list), and `scripts/ai/preship-check.mjs` (best-effort static scan; config `"preship": "warn"|"error"|"off"`, default warn).
- CI: Pre-Ship Security Scan step in the shipped `ai-guardrails.yml`. On install/update, if a customized workflow is missing that step, the installer injects only the step (does not rewrite the rest of the file).
- `verify-and-ship` checklist item for pre-ship security before first deploy / public release.

## 1.2.1

Fixed
- npm CLI bin: ship `bin/ai-kit.js` so `npx ai-kit` is registered (npm 11 strips extensionless bin paths on publish).
- Drop `prepublishOnly` test gate so publish is not blocked by hung MCP registry stubs from interrupted runs.

## 1.2.0

Added
- MCP clients: Gemini CLI (`.gemini/settings.json`) and Codex (a marked block in `.codex/config.toml`; your TOML is untouched), plus `--windows` for `cmd /c npx` wrappers (recorded in the lock).
- Windows: `check-docs.mjs` and `pre-commit.mjs` (Node ports; the `.sh` files are now shims), an OS-independent git hook wrapper, and a `.gitattributes` block keeping scripts/hooks LF. The kit's Windows CI job is now blocking.
- Workflow linting: pinned actionlint job in the shipped workflow and in kit CI, workflow hygiene tests, and shellcheck directives for the intentional `$PM_RUN` word splitting.

Fixed
- `setup-mcp.mjs --apply --exclude <all>` now removes the servers from client files (it used to stop early).
- Windows env allowlist for MCP verification includes the variables Chrome and npm need.

## 1.1.0

Added
- Enforcement: `.claude/settings.json` (permissions + hooks) and `scripts/ai/hook.mjs` (secret/destructive-command/lockfile guard, guardrail-file prompts, index + skills refresh on Stop).
- Update-safe installer (`install.mjs`, `kit.json`, `.ai/kit.json`): `--update`, `--dry-run`, `--force`, `--reset-seeds`, `--no-post`. Docs, config, and CODEOWNERS are never overwritten; modified kit files get a `.kit-new` side file.
- Test suite (`npm test`, 96 hermetic tests, zero dependencies) and a live smoke test (`npm run test:live`); `.github/workflows/kit-ci.yml`.
- CI: coverage-threshold check, Playwright e2e job, auth-path CODEOWNERS check, shared `ci-install.sh`.
- Hooks without dependencies: `.githooks/` + `setup-hooks.mjs`; husky and pre-commit.com call the same `scripts/ai/pre-commit.sh`.
- Monorepos: workspace detection (npm/yarn/pnpm/uv), per-package stacks, pins/coverage per package, MCP applicability across packages.
- `.agents/skills` mirror (`sync-agents.mjs`) for Codex, Cursor, Copilot.
- Legacy repos: the installer sets `"pins": "warn"` when unpinned dependencies already exist.

Changed
- The seeded `.ai/config.json` now holds only overrides (defaults live in `scripts/ai/lib.mjs`). Default roots now include `apps/` and `services/`.

Fixed
- `setup-mcp.mjs --verify` no longer passes your full environment to third-party servers.
- The index freshness check ignores CRLF line endings.

Upgrading from 1.0
- Run `node install.mjs <project> --force` once (1.0 recorded no file hashes). Docs, config, and CODEOWNERS are untouched.
- In an existing `.ai/config.json`, delete the `roots` and `ignore` keys to inherit the new defaults (or add `apps`/`services` yourself).

## 1.0.0
Initial kit: rules, 12 docs, reuse index and search, duplicate report, stack detection and skills, project memory, MCP setup, JS and Python CI.
