# Directive: Ship AI Kit as a VS Code / Open VSX Extension (while keeping the npm CLI)

> **Audience:** Cursor desktop agents working in `bobrowsse-tech/ai-kit`.
> **Place this file at:** `docs/directives/vscode-extension.md` and link it from `docs/index.md` and `docs/tasks.md`.
> **Status:** Approved for implementation. Phases must be executed in order. Each phase ends at a checkpoint where the agent stops and reports.

---

## 0. Mission

Turn the repo into a small monorepo with one shared core and two distribution channels:

| Package | Published as | Registry |
|---|---|---|
| `packages/core` | not published (internal, bundled) | — |
| `packages/cli` | `@bobrowsse-tech/ai-kit` (unchanged name and `bin`) | npm |
| `packages/vscode` | `bobrowsse-tech.ai-kit` | VS Code Marketplace + Open VSX (same `.vsix`) |

**Non-negotiable outcome:** existing npm users notice nothing. `npx @bobrowsse-tech/ai-kit <command>` keeps the same commands, flags, output files and exit codes.

---

## 1. Rules of engagement (apply to every phase)

1. **Boot sequence first.** Before touching code in any phase:
   - read `docs/index.md` and `docs/tasks.md`;
   - read `docs/conventions.md` and `docs/architecture.md`;
   - read `docs/schema.md` before changing any exported API, CLI flag or config format.
   - Read target files completely before editing.
2. **Scope lock.** Only touch files named in the current phase. If something outside scope needs changing, stop and ask.
3. **Small iterations.** Max ~100–150 changed lines per iteration. Use `git mv` for moves so history is preserved. Moves are not rewrites. Never rewrite a file wholesale unless this directive says so.
4. **Preserve logic.** Keep existing comments, types and exported signatures. A move must not change behavior.
5. **Dependencies.** Only the packages listed in §2 are pre-approved. Anything else needs the user's confirmation. For every package you add:
   - verify it on the live npm registry (exact name, publisher, recent activity, no typosquat);
   - pin the exact version (no `^` or `~`);
   - run `npm audit`.
6. **Secrets.** Never write tokens, client IDs or tenant IDs into code, docs or workflow files. Reference GitHub secrets and variables only.
7. **Verify against live docs.** Before writing VS Code API or publishing code, check current docs. Do not rely on memory.
   - VS Code API and publishing: https://code.visualstudio.com/api
   - Open VSX: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions
8. **No publishing.** Agents never run `npm publish`, `vsce publish` or `ovsx publish` locally, and never create tags that trigger a release. Releases happen only through CI after the user approves.
9. **Human-only steps.** Steps marked 🧑 HUMAN are done by the user: account creation, tokens, Azure identity, GitHub secrets. When you reach one, stop, list exactly what is needed, and wait.

---

## 2. Pre-approved dev dependencies

Verify each and pin the exact version at install time. Install into the package that needs it, not the root, unless noted.

| Package | Where | Purpose |
|---|---|---|
| `@vscode/vsce` | `packages/vscode` (dev) | package/publish `.vsix` |
| `ovsx` | `packages/vscode` (dev) | publish to Open VSX |
| `esbuild` | `packages/vscode` (dev), optionally `packages/cli` | bundle extension (and CLI if it's already bundled) |
| `@types/vscode` | `packages/vscode` (dev) | API types; version must match `engines.vscode` |
| `@vscode/test-electron` *or* `@vscode/test-cli` | `packages/vscode` (dev) | extension integration tests. Check current docs for which is recommended. |

Use **npm workspaces** (built in, no new dependency). Do **not** add Changesets, Lerna, Nx, Turborepo or pnpm without asking.

---

## Phase 1 — Discovery (read-only)

**Goal:** understand the current repo before restructuring.

Tasks:
- [ ] Map the current layout: entry point, `bin`, build tool, test runner, lint config, tsconfig(s), template/asset folders, CI workflows, husky hooks.
- [ ] List every exported function and CLI command with its flags. This becomes the compatibility baseline.
- [ ] Identify pure logic (template rendering, file generation, docs checks) versus CLI-only code (arg parsing, prompts, console output, `process.exit`).
- [ ] Note any code that reads assets via `__dirname` or relative paths. These will break when bundled and must be flagged.

**Checkpoint 1 (stop and report):**
- a short layout summary;
- the proposed file-by-file move map into `core` and `cli`;
- a list of risks;
- any deviation from this directive the repo structure forces.

Wait for approval.

---

## Phase 2 — Compatibility safety net (before moving anything)

**Goal:** lock current CLI behavior so the refactor can be proven safe.

Tasks:
- [ ] Add snapshot or golden tests that run each CLI command against a temp directory and capture:
  - the generated file tree;
  - file contents;
  - exit code.
- [ ] Record the current `npm pack --dry-run` file list as a baseline (`docs/` or `test/fixtures/`).
- [ ] All existing tests plus the new ones must pass on the untouched code.

**Acceptance:** green test run on the current code; the baseline is committed.

---

## Phase 3 — Monorepo restructure

**Goal:** `packages/core` + `packages/cli` with identical behavior.

Tasks:
- [ ] Root `package.json`:
  - `"private": true`;
  - `"workspaces": ["packages/*"]`;
  - root scripts that fan out (`build`, `test`, `lint`, `typecheck`).
- [ ] `packages/core`:
  - move pure logic here (`git mv`);
  - `"private": true`;
  - no `console`, no `process.exit`, no prompts;
  - functions return results or throw typed errors;
  - assets are resolved through one helper (e.g. `getAssetPath()`) so CLI and extension can supply their own base path.
- [ ] `packages/cli`:
  - keep `name: "@bobrowsse-tech/ai-kit"`, the same `bin`, the same `files` and the same version line;
  - depends on `core` via the workspace;
  - make sure the published tarball is self-contained: either bundle core in, or publish core too. Prefer bundling, and ask the user if unclear.
- [ ] Update tsconfig project references, the lint config and husky hooks for the new paths.
- [ ] `npm pack --dry-run` in `packages/cli` must match the Phase 2 baseline, apart from intended internal paths.

**Acceptance:**
- the snapshot tests from Phase 2 pass unchanged;
- typecheck, lint, audit and build are clean;
- `npx` against a locally packed tarball works in an empty folder.

**Checkpoint 3:** report the diff summary and the pack comparison. Wait for approval.

---

## Phase 4 — Extension scaffold

**Goal:** a minimal, installable extension that calls `core` directly.

Tasks:
- [ ] `packages/vscode/package.json`:
  - `name: "ai-kit"`, `publisher: "bobrowsse-tech"`, `displayName`, `description`;
  - `engines.vscode`: pick a reasonable floor after checking current docs, and keep `@types/vscode` aligned to it;
  - `main: "./dist/extension.js"`;
  - `categories`, `keywords` (**max 30**), `repository`, `license`, `icon` (**PNG ≥128×128, no SVG**), `galleryBanner`, `pricing: "Free"`;
  - scripts: `vscode:prepublish` (esbuild production bundle), `package` (`vsce package`), `test`.
- [ ] Use activation events that fit current guidance (commands are auto-activated in recent VS Code). Do **not** use `*`.
- [ ] `.vscodeignore`: ship only `dist/`, assets, `README.md`, `CHANGELOG.md`, `LICENSE`, `icon.png`.
- [ ] esbuild config:
  - `platform: node`, `format: cjs`, `external: ["vscode"]`;
  - bundle `core` in;
  - copy templates/assets into `dist/`.
- [ ] Extension `README.md`, `CHANGELOG.md`, `LICENSE`:
  - all images must be https URLs;
  - no SVGs except from trusted badge providers.
- [ ] The extension must **not** shell out to `npx` or `node`. It imports `core`.

**Acceptance:**
- `npm run package` produces a `.vsix` with no vsce warnings;
- `code --install-extension <file>.vsix` installs it;
- the extension activates with no errors in the Extension Host log.

---

## Phase 5 — Extension features (one PR-sized iteration each)

Implement in this order. Each feature is wired to `core`, needs no network access, and respects Workspace Trust.

1. [ ] **Command "AI Kit: Initialize Project"**
   - Runs the same generation as the CLI `init` against the open workspace folder.
   - Asks for a folder via quick pick when there are several.
   - Confirms before overwriting any existing file.
2. [ ] **Command "AI Kit: Update Rules"**
   - Same as the CLI update path.
   - Shows a summary of changed files.
3. [ ] **Command "AI Kit: Check Docs"**
   - Reports which of the 10 required `/docs` files are missing or empty, in a notification and the Problems panel or output channel.
4. [ ] **Status bar item**
   - Shows docs health (e.g. `AI Kit: 8/10 docs`) and runs Check Docs on click.
   - Updates through a file watcher on `docs/`.
5. [ ] **Walkthrough** (`contributes.walkthroughs`)
   - A guided first run for non-technical users: initialize → review AGENTS.md → fill in docs → set up the pre-commit hook.
   - Use PNG or markdown media only.
6. [ ] **Workspace Trust**
   - In untrusted workspaces, the write commands are disabled. Declare `capabilities.untrustedWorkspaces` accordingly.

**Validation at boundaries:**
- normalize and validate every user-picked path;
- refuse to write outside the selected workspace folder;
- never execute shell commands built from user input.

**Acceptance per feature:**
- unit tests in `core` cover the logic;
- at least one integration test per command runs in the VS Code test host;
- manual smoke test notes go in the PR description.

---

## Phase 6 — CI and release pipeline

**Goal:** one workflow that gates and publishes each channel independently.

### 🧑 HUMAN prerequisites (agent stops and lists these)

- **Open VSX:**
  1. Log in to open-vsx.org.
  2. Confirm the Eclipse Publisher Agreement is signed.
  3. Confirm the `bobrowsse-tech` namespace exists and has an owner.
  4. Create an access token.
  5. Add it as the GitHub secret `OVSX_PAT`.
- **Marketplace (deadline: global Azure DevOps PATs retire Dec 1, 2026):**
  1. Create a user-assigned managed identity (or app registration) in Azure.
  2. Add a federated credential for GitHub OIDC scoped to this repo and the release environment.
  3. Add the identity to the Marketplace publisher `bobrowsse-tech` with the Contributor role.
  4. Store the client ID, tenant ID and subscription ID as GitHub **variables** in a protected `release` environment. They are not secrets, but they still must not be hardcoded.
- **npm:** configure trusted publishing (OIDC) for `@bobrowsse-tech/ai-kit` if not already done. Otherwise use the existing `NPM_TOKEN` secret.

### Agent tasks

- [ ] Update `ai-guardrails.yml` for monorepo paths:
  - docs presence, gitleaks, `npm audit`, tsc, lint and schema-sync must run across all workspaces;
  - add `vsce package` as a CI check, without publishing.
- [ ] New `release.yml`, tag-triggered and run in the protected `release` environment (requires approval):
  - `cli-v*` → gates → `npm publish --provenance` from `packages/cli`.
  - `ext-v*` → gates → `vsce package` once, then:
    1. `azure/login` (OIDC) → `vsce publish --packagePath <vsix> --azure-credential`
    2. `ovsx publish <vsix> -p ${{ secrets.OVSX_PAT }}`
    3. attach the `.vsix` to the GitHub Release.
  - Pin third-party actions to full commit SHAs.
  - Use minimal `permissions:` (`contents: write` and `id-token: write` only where needed).
- [ ] Verify the `azure/login` + `--azure-credential` combination against current Microsoft and vsce docs before writing it. Note the verified doc links in the PR.
- [ ] Add a `workflow_dispatch` dry-run mode that packages but does not publish.

**Acceptance:**
- the dry run succeeds;
- the first real release is a **pre-release** (`--pre-release`, odd minor, e.g. `0.1.0`), published to both registries and approved by the user;
- this must be done and verified **before Dec 1, 2026**.

---

## Phase 7 — Versioning policy (write into `docs/conventions.md`)

- **CLI:** semver, may use pre-release tags (`1.4.0-beta.1`) on the npm `next` dist-tag.
- **Extension:** plain `major.minor.patch` only, because the Marketplace has no semver pre-release tags. Use an **even minor for stable** and an **odd minor for pre-release**.
- **Independence:** CLI and extension versions are independent. Tags are prefixed (`cli-vX.Y.Z`, `ext-vX.Y.Z`).
- **Changelogs:** both packages keep a `CHANGELOG.md`. A `core` change that affects behavior requires an entry in both.

---

## Phase 8 — Living docs sync (part of every phase's DoD)

- `docs/architecture.md`: monorepo topology, the core/cli/vscode boundaries, the bundling strategy, the asset resolution helper.
- `docs/environment.md`: workspace commands, how to run the Extension Development Host (F5), how to package and install a `.vsix` locally, and the required GitHub secrets and variables (names only).
- `docs/schema.md`: core's public API, the CLI commands and flags, and the extension command IDs, settings and contribution points.
- `docs/features.md`: extension features with acceptance criteria and their checked state.
- `docs/userjourney.md`: the extension path for the non-technical persona (install → walkthrough → init).
- `docs/agents.md`: the "no local publishing" and "human-only steps" rules from §1.
- `docs/tasks.md`: every phase as tasks. Tick them off with notes and next steps as they complete.

---

## Definition of Done (whole directive)

- [ ] `tsc` strict: zero errors in all workspaces.
- [ ] Lint: zero errors and zero warnings.
- [ ] `npm audit`: zero critical or high vulnerabilities.
- [ ] Builds are clean, and `vsce package` has no warnings.
- [ ] All tests pass: unit, CLI snapshots and extension integration.
- [ ] The CLI behaves identically to the Phase 2 baseline.
- [ ] The `.vsix` installs and runs in VS Code **and** an Open VSX–based editor (e.g. VSCodium or Cursor).
- [ ] Clean Extension Host and CI logs: no unhandled rejections.
- [ ] One pre-release is live on the Marketplace and Open VSX via CI before Dec 1, 2026.
- [ ] All docs in Phase 8 are updated.
