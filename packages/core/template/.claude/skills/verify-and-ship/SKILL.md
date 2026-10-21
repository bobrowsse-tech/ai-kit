---
name: verify-and-ship
description: Definition-of-done checklist and living-docs sync. Use before declaring any task complete, opening a PR, or committing a finished feature.
---

# Verify and ship

Commands come from `.ai/stack.json` (`scripts`) and `docs/environment.md`. Do not claim a check passed unless you ran it.

Python equivalents: `ruff check .`, `mypy .`, `pytest -q`, `pip-audit -r <pinned requirements> --no-deps --disable-pip` (CI freezes the environment first).

## Checklist
1. Type check: zero errors (`tsc --noEmit` or language equivalent)
2. Lint: zero errors or warnings
3. Tests: existing and new pass
4. Build: clean, no bundler or runtime warnings
5. Audit + pins: `npm audit` (or `pip-audit`, `cargo audit`) has no critical findings; `node scripts/ai/check-pins.mjs`
6. Reuse: `node scripts/ai/build-index.mjs` then `--check`; `node scripts/ai/dupes.mjs` shows nothing you introduced
7. Logs: no unhandled exceptions or silent failures in the output
8. Coverage: run the coverage script (`test:coverage`, or `pytest --cov`); the threshold lives in the test tool's config (`node scripts/ai/check-coverage.mjs` confirms one exists)
9. e2e: if `playwright.config.*` exists, run the e2e suite (`test:e2e` or `npx playwright test`)
10. Auth: if you touched auth, sessions, tokens, or permissions, say so in the PR and check `node scripts/ai/check-auth-review.mjs`
11. Pre-ship security: before a first deploy or public release, run the `pre-ship-security` skill against `docs/security-checklist.md` (`node scripts/ai/preship-check.mjs` is the cheap static net only)

## Sync docs
- `docs/tasks.md`: mark done, add progress and next steps
- `docs/schema.md`: mirror any API/payload/DB change
- `docs/features.md`: tick completed acceptance criteria
- `docs/memory.md`: record lessons (see `project-memory`)

## Report
State which checks you ran and their result, list any you could not run and why, and flag anything touching auth or privilege levels for isolated review.
