# AI Kit — kit-repo docs

Living docs for agents working **on** `bobrowsse-tech/ai-kit` (this repository).  
Consumer projects that install the kit get a separate set under `packages/core/template/docs/` — do not confuse the two.

## Context

- **Product today:** zero-dependency npm CLI `@bobrowsse-tech/ai-kit` that copies the kit template into a target project (`install` / `update`).
- **Layout:** npm workspaces — `packages/core` (engine + template), `packages/cli` (npm), `packages/vscode` (Marketplace / Open VSX).
- **Non-negotiable:** existing npm users notice nothing (`npx @bobrowsse-tech/ai-kit`, same commands/flags/exit codes).

## Directives

| Directive | Status |
|---|---|
| [Ship as VS Code / Open VSX extension](./directives/vscode-extension.md) | Phase 5 done; Phase 6 CI/release next (🧑 HUMAN Marketplace + Open VSX) |

## Quick map

| Path | Role |
|---|---|
| `packages/cli/bin/ai-kit.js` | npm `bin` → thin argv shim → `install.mjs` |
| `packages/cli/install.mjs` | CLI argv / print / exit; calls core |
| `packages/core/` | `installKit()`, `setAssetRoot()`, `kit.json`, `template/` |
| `packages/vscode/` | Extension; `npm run pack:ext` → `ai-kit.vsix` |
| `packages/cli/scripts/stage-pack.mjs` | Vendors core + copies assets for a self-contained `npm pack` |
| `tests/` | Hermetic `node:test` suite + golden fixtures (`npm test`) |
| `.github/workflows/` | Kit CI, npm publish from `packages/cli`, PR-author gate |

## Related

- [HOW_TO_USE.md](./HOW_TO_USE.md) — CLI + extension usage (user-facing)
- [tasks.md](./tasks.md) — phase checklist for the extension directive
- Root [README.md](../README.md) — user-facing CLI docs
- [CONTRIBUTING.md](../CONTRIBUTING.md) — release and PR policy
- Public directory: https://bobrowsse-tech.github.io/vscode-extensions/ (extension page appears after Open VSX publish + `extension-published` dispatch)
