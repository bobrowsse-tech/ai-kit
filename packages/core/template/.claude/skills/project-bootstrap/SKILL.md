---
name: project-bootstrap
description: Onboard or renovate a repository - detect the stack, build the functionality index, fill /docs from real code, and finish the generated project skills. Use right after installing this kit, when docs still contain TODO placeholders, or after a major architecture change.
---

# Project bootstrap

Goal: turn the scaffold into accurate project knowledge using only facts you can verify in the repo.

## Steps
1. **Detect:** `node scripts/ai/detect-stack.mjs --skills` (writes `.ai/stack.json`, scaffolds `stack-<tech>` skills). Adjust `.ai/config.json` roots if source lives elsewhere.
2. **Index:** `node scripts/ai/build-index.mjs`, then `node scripts/ai/dupes.mjs`. Note duplicates; do not refactor unasked (scope lock), list them in `docs/tasks.md`.
3. **Fill docs in this order, from real code** (cite file paths; use `UNKNOWN` and ask the user when you cannot verify):
   `index.md` (context digest <= 60 lines) -> `architecture.md` -> `conventions.md` (folder layout, naming, canonical examples, anti-patterns actually present) -> `schema.md` -> `environment.md` (commands from `.ai/stack.json`, `.env.example` keys, ports) -> `features.md` -> `design.md` -> `userjourney.md` -> `agents.md` -> `tasks.md`.
4. **Finish skills:** complete every `TODO` in `.claude/skills/stack-*/SKILL.md` with real patterns and canonical example paths. Add at most a few layer/workflow skills (for example `api-endpoint`, `ui-component`, `db-migration`) only where a multi-step workflow clearly repeats. Each under ~80 lines, trigger-style description.
5. **MCP servers:** run `node scripts/ai/setup-mcp.mjs` (plan only), summarize what it would configure and why, and ask the user before `--apply`. Record the result in `docs/environment.md`.
6. **Document exports:** add one-line doc comments to the most-used undocumented exports (max ~30 per pass, no logic changes), then re-run the index.
7. **Seed memory:** record 3-5 real gotchas you discovered (`remember.mjs`), and fill "Read First" in `docs/memory.md`.
8. **Verify:** `node scripts/ai/check-docs.mjs` (no TODO warnings left) and `node scripts/ai/build-index.mjs --check`.
9. **Report:** summarize what was filled, what is `UNKNOWN`, and the duplicate list; ask the user which to tackle.

## Rules
- Never invent architecture. If code and docs disagree, trust the code and flag it.
- Read files by range; sample representative modules instead of reading everything.
