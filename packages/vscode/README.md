# AI Project Kit

![AI Project Kit](https://github.com/bobrowsse-tech/ai-kit/raw/HEAD/packages/vscode/media/banner.png)

Drop the AI Project Kit into the folder you have open — rules, living docs, multi-agent guardrails, and MCP setup — using the **same engine** as the npm CLI [`@bobrowsse-tech/ai-kit`](https://www.npmjs.com/package/@bobrowsse-tech/ai-kit).

**Publisher:** [bobrowsse-tech](https://marketplace.visualstudio.com/publishers/bobrowsse-tech) · **Directory:** [bobrowsse-tech extensions](https://bobrowsse-tech.github.io/vscode-extensions/) · **Source:** [bobrowsse-tech/ai-kit](https://github.com/bobrowsse-tech/ai-kit)

Works in **VS Code**, **Cursor**, **VSCodium**, and other Open VSX–compatible editors.

## Install

1. Install **AI Project Kit** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=bobrowsse-tech.ai-kit) or [Open VSX](https://open-vsx.org/extension/bobrowsse-tech/ai-kit).
2. Open a project folder.
3. Open the Command Palette and run **AI Kit: Initialize Project** (or open the walkthrough: **Welcome: Open Walkthrough…** → **Get started with AI Project Kit**).

Prefer the terminal? Same kit:

```bash
npm install -D @bobrowsse-tech/ai-kit@1.6.0
npx ai-kit install
```

## What you will see

| UI | Purpose |
|---|---|
| **Status bar** — `AI Kit: N/12 docs` | Docs health for the open folder. Click to re-run **Check Docs**. Updates when files under `docs/` change. |
| **Problems** panel | Missing or empty required docs show as errors; leftover `TODO` placeholders as warnings. |
| **Walkthrough** | Guided first run: initialize → review `AGENTS.md` → fill docs → wire pre-commit. |
| **Confirm dialogs** | Initialize and Update ask before writing anything. |

## Commands

| Command | What it does |
|---|---|
| **AI Kit: Initialize Project** | Installs the kit into the chosen workspace folder (same as `npx ai-kit install --no-post`). |
| **AI Kit: Update Rules** | Refreshes kit-owned files; keeps docs and config you customized (same as `npx ai-kit update --no-post`). |
| **AI Kit: Check Docs** | Checks all **twelve** required `docs/*.md` files; notifies and fills Problems. |
| **AI Kit: Open AGENTS.md** | Opens the project rules file (used by the walkthrough). |

Initialize and Update require a **trusted** workspace. Check Docs stays available read-only in untrusted workspaces.

## After initialize

1. Tell your agent: *Read AGENTS.md and run the project-bootstrap skill.*
2. Optional MCP setup (terminal): `node scripts/ai/setup-mcp.mjs --apply`
3. Wire hooks: `node scripts/ai/setup-hooks.mjs` (or add `"prepare": "node scripts/ai/setup-hooks.mjs"` to `package.json`)
4. Commit the new kit files.

Full usage (CLI + extension + CI): [HOW_TO_USE.md](https://github.com/bobrowsse-tech/ai-kit/blob/main/docs/HOW_TO_USE.md).

## Privacy

The extension only reads and writes under the folder you choose. Install, update, and docs check do not send telemetry or call network APIs.
