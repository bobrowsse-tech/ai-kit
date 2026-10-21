---
name: mcp-tools
description: Choose and use this project's MCP servers, and set up, update, or audit them. Use when you need current library docs, browser-based UI checks or e2e tests, framework diagnostics, or when asked to configure MCP servers.
---

# MCP tools

## Which server for which job
| Need | Category | Typical server |
|---|---|---|
| Current API/docs instead of guessing | docs | `context7` |
| Framework-aware help (routes, errors, best practices) | framework | `angular-cli`, `nextjs-devtools` |
| Look at or drive the running UI, write e2e tests | browser-testing | `playwright` |
| Performance traces, network/console debugging | browser-debug | `chrome-devtools` (opt-in) |
| Migrations, Studio | data | `prisma-cli` (opt-in, destructive tools) |

Unit tests, lint, and type checks do not need an MCP server: run the project's own commands (`.ai/stack.json`).
Use only the servers listed in `.mcp.json` / `.ai/mcp.lock.json`. Do not invent tool names; check what the client exposes (`/mcp` in Claude Code).

## Set up or change
1. `node scripts/ai/setup-mcp.mjs` shows the plan (nothing is written). Read the notes on each server.
2. Get the user's approval, then `node scripts/ai/setup-mcp.mjs --apply` (add `--include <id>` for opt-in servers, `--client claude,vscode,cursor,gemini,codex` for other agents' config files, `--windows` for native-Windows clients).
3. `node scripts/ai/setup-mcp.mjs --verify` re-tests every server with a real MCP handshake; `--check` is the offline drift/secret check used by CI.
4. Refresh monthly or when a server misbehaves: `--update` (keeps the old pin if the new version fails verification).
5. Other libraries with MCP servers: `--discover` lists candidates from the official MCP Registry. They are unvetted: review the source with the user, then add an entry to `.ai/mcp-catalog.local.json` and `--apply` (it pins and verifies).

## Safety
- Never inline secrets; use `${VAR}` in `env`/`headers`. Never commit `@latest`.
- Browser servers can see and act on page content: keep them isolated and away from signed-in sensitive sessions.
- Third-party hosted servers (for example docs services) receive your queries: mention this to the user before enabling.
- Native Windows clients need `cmd /c npx ...`: pass `--windows` (recorded in the lock). The default stays portable so the committed file works on macOS/Linux.
- Codex reads a project `.codex/config.toml` only for trusted projects, and its Desktop app may ignore it; the kit only edits its own marked block in that file.

## Troubleshooting
- Server missing or failing: `--verify` prints the failing command's stderr tail; try running the same command manually.
- A "latest" tag can point at a release without the feature you need (for example a Prisma release candidate with no `mcp` command): trust the pinned, verified version in the lock.
- Too many tools or slow sessions: remove unneeded servers (`--exclude <id>`) or use a slimmer mode where the server offers one.
