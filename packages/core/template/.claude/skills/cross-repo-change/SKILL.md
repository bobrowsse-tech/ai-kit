---
name: cross-repo-change
description: Deliver one change that spans repos end to end (for example a new endpoint plus the screen that uses it) in a safe order with per-repo checks and handoffs. Use when asked to implement a feature across frontend and backend, run work in both repos, or coordinate a change with a sister repo.
---

# Cross-repo change

## Before any edit
1. Run `cross-repo-investigate` (a short pass is fine) so the contract is known: method, path, request, response, errors, auth.
2. Write the plan in a report (`workspace.mjs report new "<title>"`): repos, ordered steps, owner per step, per-repo checks, rollout order. Get the user's approval.
3. `workspace.mjs status`: only repos with `access: write` may be edited from this session. For the others use a handoff.

## Order: contract first
1. Agree the contract and write it down in the provider's contract source and in `docs/schema.md` of both repos.
2. Provider (usually backend): implement, test, migrate, document.
3. Consumer (usually frontend): implement against the contract, tests, e2e.
4. Infrastructure or config: only as the plan says, and never mutate cloud state from here (`cloud-inspect`).
If the consumer must ship first, put the feature behind a flag and say so in the report.

## In a repo you may write
- Work from that repo's directory (`cd ../api`), with its own commands (`.ai/stack.json`, `docs/environment.md`), and follow its AGENTS.md. This repo's rules do not replace its rules.
- One branch and one commit series per repo, one PR per repo with the same title prefix and links to the others. Do not push or open PRs unless the user asked.
- Run that repo's definition of done there (`verify-and-ship`). Report per repo what ran and what did not.

## In a repo you may not write
`node scripts/ai/workspace.mjs handoff --to <id> --from-report <report>` (needs `access: inbox`). The request lands in that repo's `docs/cross-repo/inbox/`, uncommitted; tell the user. Do not retry with other tools.
Receiving side: read `docs/cross-repo/inbox/` at boot, verify the claim in your own code, do the work or answer with a reason, then `workspace.mjs inbox close <file> --note "..."`.

## Verify end to end
- `workspace.mjs gaps` shows no new gap.
- Run both sides against each other locally when possible (ports and env in each `docs/environment.md`). If not, say which parts were verified only per side.
- Update `schema.md`, `features.md` and `tasks.md` in both repos. Record a lesson with `remember.mjs` in the repo it applies to.

## Stop and ask when
The contract is ambiguous, the change touches auth, permissions or data deletion, a sister repo is dirty or behind, or a step needs a cloud change or a new dependency.
