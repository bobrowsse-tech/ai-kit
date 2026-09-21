---
name: project-memory
description: How to read and write the project's durable lessons in docs/memory.md. Use when the user corrects you, a bug or failed build reveals a repeatable pitfall, a non-obvious decision is made, or at the start of a task to load context.
---

# Project memory

## Read (boot)
Read the "Read First" section and skim the newest entries of `docs/memory.md`. Do not read the whole file if it is long; search it for the topic instead.

## Write
`node scripts/ai/remember.mjs <type> "<one or two lines>"`

| Type | Use for |
|---|---|
| `gotcha` | A pitfall that already cost time (include the fix or the rule) |
| `decision` | A non-obvious choice and its reason |
| `correction` | The user corrected you; state the right behavior |
| `pattern` | An approach that proved reliable here |

Write entries that a future agent can act on without context: name the file/symbol and the rule. Bad: "auth was tricky". Good: "Session cookie is set in src/lib/auth/session.ts only; never call cookies().set elsewhere."

## Do not record
Secrets, task status (use `tasks.md`), facts already in `conventions.md`, one-off details.

## Maintain
- **Promote:** if an entry recurs or applies broadly, move it into `conventions.md` or the relevant skill and delete it from memory.
- **Prune:** delete stale entries when you touch related code. Keep the file under ~150 lines.
- After a correction, apply the fix first, then record it.
