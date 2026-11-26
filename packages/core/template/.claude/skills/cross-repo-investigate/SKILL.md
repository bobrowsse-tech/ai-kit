---
name: cross-repo-investigate
description: Check whether a feature will actually work across frontend, backend and infrastructure, and report gaps with evidence and better alternatives. Use when asked to investigate, review feasibility, find what is missing in another repo, simplify a user journey, or before building something that depends on another repo.
---

# Cross-repo investigation

Goal: find what will break or be needlessly complex across repos before it is built, and say what to change where.

## Steps
1. **State the slice:** the journey or feature in 3-5 steps and which repo owns each step (`docs/userjourney.md`, `docs/features.md`).
2. **Orient:** `workspace.mjs status`, then `brief <id>` for each repo in the slice (skill `cross-repo-context`).
3. **Contract check:** `node scripts/ai/workspace.mjs gaps` lists calls nobody provides, method mismatches and unused endpoints. They are leads. Read the cited lines on both sides, then check what a scan cannot see: request and response fields, validation, error codes, pagination, auth and roles, idempotency, upload limits, CORS, versioning.
4. **Data and rules:** does the provider own the data and the rule the journey needs (permissions, state transitions, tenant isolation)? Is anything enforced only in the client?
5. **Infra and runtime** (skill `cloud-inspect`, read-only): env var and secret names, queues, buckets, domains, scopes, feature flags, deploy order, and differences between environments.
6. **Journey cost:** count round trips, repos crossed and manual steps per user action. Look for N+1 calls the provider could answer at once, state the client must rebuild, duplicated validation, polling where an event exists, two sources of truth.
7. **Report:** `node scripts/ai/workspace.mjs report new "<title>" --type feasibility|gap|journey|infra`. Fill every section from evidence and delete the ones that do not apply. `gaps --report` pre-fills the scan.

## Quality bar for a finding
Where (repo), type, severity (blocker, high, medium, low), evidence `repo:path:line`, why it matters in one sentence, and a proposed change with its benefit ("if the list endpoint also returned X, the client drops 3 calls and one loading state"). Anything unverified is UNKNOWN, not a finding.

## Verdict
Start the report with one line: works as planned, works with changes, or blocked, plus the biggest reason. Order proposed changes contract first.

## Then
- Change needed in this repo: proceed under the normal rules.
- Change needed elsewhere: do not edit it. After the user agrees, `workspace.mjs handoff --to <id> --from-report <file>`. Continue with `cross-repo-change` only if the user wants the work done end to end.

## Do not
- Present scan output as fact, or invent endpoints, fields or infrastructure.
- Propose a redesign when a small contract change fixes it.
