# Contributing

AI Project Kit (`@bobrowsse-tech/ai-kit`) is open source (MIT) — read the code,
fork it, run it, file issues against it. Contribution of *code* works a little
differently than most OSS projects, on purpose:

## Contribution policy

- **All changes to `main` land only through a pull request** — there is no
  direct push, even for maintainers (branch protection has
  `enforce_admins: true`).
- **Only the project's maintainer(s) can open a pull request against this
  repo.** GitHub doesn't have a native way to restrict PR authorship on a
  public repo, so this is enforced by
  [`.github/workflows/restrict-pr-authors.yml`](./.github/workflows/restrict-pr-authors.yml),
  which auto-closes any PR opened by someone not on the allow-list.
- **If you want to contribute a change:** please open an **issue** first —
  a bug report, a feature request, or a patch described in prose (or linked
  as a diff/gist). A maintainer will implement it, credit you in the
  changelog, and merge it through the normal PR flow above. This keeps a
  single point of review on everything that reaches `main` while still
  taking community input.
- **`main` cannot be deleted or force-pushed.** Branch protection disables
  both, on top of the PR-only, admin-cannot-bypass rule above.

See [`scripts/setup-branch-protection.sh`](./scripts/setup-branch-protection.sh)
for exactly what's configured and why, line by line.

## Local setup

```bash
npm install
npm test          # hermetic suite (no network)
npm run test:live # optional: real npm + MCP registries
```

Install into a throwaway project:

```bash
node install.mjs /tmp/ai-kit-smoke
```

## Release process

1. Land your change via PR (see policy above).
2. Bump `package.json` `version`, update `CHANGELOG.md` and the public README
   for that version in the same change.
3. Tag and create a GitHub release (`vX.Y.Z`). `.github/workflows/publish.yml`
   publishes `@bobrowsse-tech/ai-kit` to npm using the `NPM_TOKEN` repository
   secret (never commit token values).

## Code style

- Node >= 18, ESM. `npm test` must pass.
- Prefer small, reviewable PRs; changelog entries should say *why*.
