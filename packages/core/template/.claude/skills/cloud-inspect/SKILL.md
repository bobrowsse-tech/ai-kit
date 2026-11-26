---
name: cloud-inspect
description: Inspect what is actually deployed (AWS, Azure, GCP, Kubernetes, Terraform or Bicep state) read-only, to verify what the code assumes. Use when asked what is in the cloud, whether an environment matches the code, why something works locally but not when deployed, or when a feature depends on infrastructure, config or permissions.
---

# Cloud inspect (read-only)

The repos say what should exist; the cloud says what does. Compare, then report differences. You observe: no creating, changing, deploying, and no secret values.

## Order of evidence
1. **Infrastructure as code first:** the sister infra repo, or Terraform, Bicep, CDK, Helm in any repo. `workspace.mjs search infra <name>` finds resources, env var names, queues and domains without credentials.
2. **CI/CD and config:** workflows, deployment manifests, `.env.example`, app setting names (names only).
3. **Live state through a read-only CLI**, only if the user is already logged in. Use the environment the user named, never production by default, and list/describe/get/show verbs.

## Commands that fit
- AWS: `aws sts get-caller-identity`, `aws <service> describe-*|list-*|get-*`, `aws logs tail <group> --since 1h`
- Azure: `az account show`, `az <group> list|show`, `az monitor activity-log list`
- GCP: `gcloud <group> list|describe`, `gcloud logging read '<filter>' --limit 50`
- Kubernetes: `kubectl config current-context` first, then `get|describe|logs|top`
- Terraform / OpenTofu: `validate`, `plan` (never `apply`), `state list`
- Repos that are not cloned: `gh api repos/<owner>/<repo>/contents/<path>` (GET only), `gh search code`

## What the guard does (`scripts/ai/hook.mjs`, `workspace.cloud` in `.ai/config.json`)
- Mutating commands (`apply`, `delete`, `create`, `put`, `deploy`, `exec`, `login`, and any verb it does not recognise) ask for confirmation, or are denied with `"cloud": "deny"`.
- Commands that print secret values (secret managers, decrypting parameters, access tokens, `kubectl get secret`, Terraform state and outputs) are denied. Ask for names, metadata or a masked value.
- It is a guard rail, not a sandbox. Give AI sessions credentials with a read-only role.

## Report
For each difference: what the code assumes (`repo:path:line`), what the environment has (the command and environment, never output containing secrets), and the impact. Use the "Cloud and infrastructure" section of a report (`workspace.mjs report new "<title>" --type infra`).

## Do not
- Touch production unless the user named it and agreed.
- Paste tokens, keys, connection strings or full resource dumps into reports; summarise names, counts and flags.
- Change cloud state to make a test pass: propose it in the report and hand it to the owner.
