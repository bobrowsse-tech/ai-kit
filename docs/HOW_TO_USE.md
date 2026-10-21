# How to use AI Project Kit

This guide covers the **npm CLI** (`@bobrowsse-tech/ai-kit`) and the **editor extension** (`bobrowsse-tech.ai-kit`). Both use the same install engine and the same template.

Directory listing (after Open VSX publish): [bobrowsse-tech extensions](https://bobrowsse-tech.github.io/vscode-extensions/).

---

## Choose a path

| You want… | Use |
|---|---|
| One-shot or CI / scripts | CLI via `npx` |
| Stay in the editor, walkthrough, status bar | Extension |
| Both | Install with either; update with either — they share `.ai/kit.json` |

---

## Editor extension

### Install

- VS Code Marketplace / Open VSX: search **AI Project Kit** (`bobrowsse-tech.ai-kit`), or install a local build with `code --install-extension packages/vscode/ai-kit.vsix`.
- Reload the window if the commands do not appear yet.

### First run

1. **File → Open Folder** on your project.
2. Trust the workspace when prompted (Initialize / Update need trust).
3. Command Palette → **Welcome: Open Walkthrough…** → **Get started with AI Project Kit**, **or** run **AI Kit: Initialize Project**.
4. Confirm the dialog. The extension writes kit files with `noPost` (no MCP network plan from the UI).

### Everyday commands

| Command | When |
|---|---|
| **AI Kit: Initialize Project** | New or existing repo without a recorded kit install |
| **AI Kit: Update Rules** | After upgrading the kit — refreshes owned files, keeps your docs/config |
| **AI Kit: Check Docs** | Before a PR — twelve living docs present and non-empty |
| **AI Kit: Open AGENTS.md** | Jump to project rules |

**Status bar:** `AI Kit: N/12 docs` — click to Check Docs. Watches `docs/`.

**Problems:** missing/empty docs = errors; `TODO` placeholders = warnings.

### UI you get (no separate webview)

This extension does not ship a custom panel. Interaction is:

- Command Palette commands  
- Modal confirmations before writes  
- Status bar item  
- Problems / diagnostics  
- Built-in walkthrough (markdown steps)

That matches Marketplace expectations for a lightweight project-kit tool.

---

## npm CLI

### Install into a project

```bash
npm install -D @bobrowsse-tech/ai-kit@1.6.0
npx ai-kit install
```

One-shot without a dependency:

```bash
npx @bobrowsse-tech/ai-kit install
```

### Update

```bash
npx ai-kit update
```

### Useful flags

| Flag | Effect |
|---|---|
| `--dry-run` | Print the plan; write nothing |
| `--force` | Overwrite modified **owned** kit files (not docs/config seeds) |
| `--reset-seeds` | Also overwrite docs/config/CODEOWNERS (destructive) |
| `--no-post` | Skip stack detect, index, hooks, MCP plan (extension uses this) |

### After CLI install

```bash
node scripts/ai/setup-mcp.mjs --apply   # optional
node scripts/ai/setup-hooks.mjs         # or package.json "prepare"
```

Tell your agent: **Read AGENTS.md and run the project-bootstrap skill.**

---

## What gets installed

See the root [README](../README.md) for file classes (`owned` / `seed` / `merge-doc` / `json-merge`) and the multi-agent guardrail table. Required living docs (12):

`index`, `architecture`, `design`, `features`, `userjourney`, `agents`, `conventions`, `schema`, `tasks`, `environment`, `functionality-index`, `memory` — all under `docs/*.md`.

---

## Local development (this repo)

```bash
npm install
npm test
npm run stage                 # stage CLI pack layout
npm run pack:ext              # build packages/vscode/ai-kit.vsix
```

Extension package sources: `packages/vscode/`. Shared engine: `packages/core/`.
