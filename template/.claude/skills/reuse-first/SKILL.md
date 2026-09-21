---
name: reuse-first
description: Mandatory before creating any new function, component, hook, type, constant, validator, API client, or util in this repo. Searches existing code so it is reused or extended instead of duplicated.
---

# Reuse first

Run this before writing new code. It costs one command and prevents duplicate logic and wasted tokens.

## Steps
1. **Search** with 2-3 phrasings (name, purpose, synonyms):
   `node scripts/ai/find.mjs format date` then `node scripts/ai/find.mjs date display`
2. **Inspect** the top candidates by reading only the cited file and line range.
3. **Decide** (stop at the first that works):
   1. Reuse as-is
   2. Extend (backward-compatible signature; keep existing callers working)
   3. Compose from existing symbols
   4. Create new (write the one-line reason in the task note or commit body)
4. **If creating:** place it where `docs/conventions.md` says; add a one-line doc comment to every export (the search matches on it); run `node scripts/ai/build-index.mjs`.
5. **Check** `node scripts/ai/dupes.mjs`: do not introduce new duplicated blocks.

## Red flags (stop and search again)
- You are about to write a helper whose name starts with `format`, `parse`, `validate`, `get`, `to`, `is`, `use`, or a component named like an existing UI primitive.
- You are about to copy a block from another file "and tweak it".
- You are defining a type/constant that also appears in `docs/schema.md`, design tokens, or a config module.

## Limits
Search is name/description/path based over JS/TS/Python exports. If nothing matches, grep the source once for the concept before creating.
