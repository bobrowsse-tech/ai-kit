# AI Agents

> Agent roles, tool permissions, safety boundaries, and task assignments. Default posture is least privilege.

## Roles

- **Implementer:** edits code within the assigned task scope; follows AGENTS.md; may run tests, lint, build, and the scripts in `scripts/ai/`.
- **Reviewer:** read-only; checks reuse (index and dupes), definition of done, and docs sync.
- **Bootstrapper:** runs the `project-bootstrap` skill; may write docs and skills.

## Tool Permissions

- TODO: allowed shell commands, network egress, and paths per role

## Safety Boundaries

- No secrets in code or docs. No dependency changes without user approval. Auth and privilege changes need isolated review.

## Task Assignments

- TODO: who/what owns which areas
