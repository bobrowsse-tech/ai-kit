# Kit-repo tasks

Track work on this repository (not consumer template docs).

## Directive: VS Code / Open VSX extension

Source of truth: [directives/vscode-extension.md](./directives/vscode-extension.md).

| Phase | Status | Notes |
|---|---|---|
| 0 — Seat directive + kit living docs | done | `docs/directives/vscode-extension.md` |
| 1 — Discovery (Checkpoint 1) | done | Approved; plan may be refined |
| 2 — Compatibility safety net | done | Golden CLI tests, npm pack baseline, Windows `.env` guard fix |
| 3 — Monorepo (`core` + `cli`) | done | Workspaces; core vendored into CLI pack; publish.yml → `packages/cli` |
| 4 — Extension scaffold | done | `packages/vscode` → `ai-kit.vsix` (0.1.0); Init + Update commands call core |
| 5 — Extension features | done | Check Docs (12), status bar, walkthrough, Workspace Trust |
| 6 — CI / release | prep done | `publish-extension.yml` + catalog overrides/SEO ready; 🧑 HUMAN secrets still required before first publish |
| 7 — Versioning policy | blocked | |
| 8 — Living docs sync | ongoing | |

## Next

1. Phase 4 — scaffold `packages/vscode` calling `installKit` from core (no `npx` shell-out).
2. Keep CLI goldens green after every change (`UPDATE_GOLDEN=1` only when intentional).
