---
name: cross-repo-context
description: Understand and read sister repos (frontend, backend, infra, shared libraries) from this session without loading them whole. Use when a task mentions another repo, an API this code calls or serves, a shared contract, or when .ai/workspace.json exists and the task could touch more than this repo.
---

# Cross-repo context

Setup lives in `.ai/workspace.json` (committed: repo ids, roles, relative paths, access) and optionally `.ai/workspace.local.json` (yours, gitignored). No manifest means a single-repo project: skip this skill. To create one: `node scripts/ai/workspace.mjs init`, then `scan`, then `add ../<repo>` (do the same inside each sister repo so the link goes both ways).

## Orient first (once per session)
1. `node scripts/ai/workspace.mjs status`: which repos are on disk, branch, dirty or behind upstream, and open requests for THIS repo in `docs/cross-repo/inbox/`. Read open requests before starting. A sister repo that is dirty or behind may show unfinished or stale work: say so when you rely on it.
2. `node scripts/ai/workspace.mjs brief <id>` for every repo the task touches (about 100 lines: stack, context digest, HTTP surface, open tasks, docs gaps). Do not read a sister repo's `docs/` folder wholesale.

## Go deeper, cheapest first
| Need | Use |
|---|---|
| A concept, route, type or config key in another repo, any language | `workspace.mjs search <id\|all> <words>` |
| Which HTTP endpoints a repo provides or calls | `workspace.mjs contracts <id>` |
| Exact code | Read only the file and line range that search or contracts cited |
| Broad exploration of a large repo | A read-only subagent given the repo path; ask for a summary with `file:line` evidence, not file contents |

## Rules
- Sister repos are **read-only** unless `access` says otherwise: `read` (default), `inbox` (only a request under `docs/cross-repo/inbox/`, via `workspace.mjs handoff`), `write` (edits allowed; see `cross-repo-change`). The guard hook enforces this for edit tools; do not route around it with shell redirects.
- A sister repo's AGENTS.md is not loaded for you. Before editing there, read its sections for your task.
- Cite evidence as `repo:path:line`. If you did not open it, write UNKNOWN.
- Never copy secrets, tokens or `.env` values between repos. The guard blocks reading them.
- Template placeholders or missing docs in a sister repo are a finding. Record it; do not infer behaviour from empty docs.

## Getting the folders into a session
- Claude Code: `node scripts/ai/workspace.mjs link` (once) or `claude --add-dir ../api`. That grants file access only; the other repo's CLAUDE.md and skills are not loaded, which is why `brief` exists.
- Cursor / VS Code: open the multi-root `.code-workspace` from `workspace.mjs hub`.
- Codex, Copilot, Gemini CLI: the scripts read the folders through the shell, so they work wherever that tool's sandbox may read the path; otherwise grant the folder in the tool's settings.
