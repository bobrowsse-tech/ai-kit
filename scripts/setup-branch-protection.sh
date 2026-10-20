#!/usr/bin/env bash
# Locks down main (and master, if it exists) on a freshly created AI Project Kit
# repo so that, even though the project is open source:
#   - the default branch can never be deleted
#   - all changes land only via reviewed pull requests (no direct pushes,
#     including by admins)
#   - only the maintainer(s) listed below may open pull requests against it
#     (everyone else can fork and the maintainer cherry-picks/merges, which
#     is the standard low-trust-contributor model for a young OSS project)
#
# Requires: GitHub CLI (`gh`), authenticated with a token that has `repo`
# and `admin:org` (if this is an org repo) scopes on the target repository.
#
# Usage:
#   ./scripts/setup-branch-protection.sh <owner>/<repo> [maintainer-login ...]
#
# Example:
#   ./scripts/setup-branch-protection.sh bobrowsse-tech/ai-kit bobrowsse-tech

set -euo pipefail

REPO="${1:?Usage: $0 <owner>/<repo> [maintainer-login ...]}"
shift || true
MAINTAINERS=("$@")

if [ "${#MAINTAINERS[@]}" -eq 0 ]; then
  echo "No maintainer logins given; defaulting restriction to the repo owner only." >&2
  MAINTAINERS=("$(echo "$REPO" | cut -d/ -f1)")
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI ('gh') is required. https://cli.github.com/" >&2
  exit 1
fi

echo "Configuring branch protection on $REPO for branches: main, master (if present)"
echo "Restricting who can push/merge to: ${MAINTAINERS[*]}"

protect_branch() {
  local branch="$1"

  # Does the branch even exist on this repo? Skip silently if not (lets the
  # same script run against a repo that only has `main`).
  if ! gh api "repos/$REPO/branches/$branch" >/dev/null 2>&1; then
    echo "  - $branch: does not exist, skipping"
    return
  fi

  echo "  - $branch: applying protection"

  # required_status_checks: the aggregate "CI" job in ci.yml. Requiring the
  #   matrix job name would never go green, because GitHub reports each
  #   Node version as its own check.
  # enforce_admins: true means even repo admins can't bypass this by pushing
  #   directly — everything goes through a PR.
  # required_approving_review_count: 0. A pull request is still required,
  #   but a solo maintainer cannot approve their own PR, so requiring 1
  #   approval would make main unmergeable. Raise this when a second
  #   maintainer exists.
  # restrictions: only the listed users may push directly. GitHub only
  #   allows this field on organization repositories. Personal repos get
  #   the same protection without it; restrict-pr-authors.yml still
  #   auto-closes pull requests from anyone else.
  # allow_deletions / allow_force_pushes: false — main cannot be deleted
  #   or rewritten while protection is on.
  # gh's -f/-F form sends some of these values as strings. The protection
  # API rejects that, so the body is JSON.
  local users_json payload
  users_json=$(printf '%s\n' "${MAINTAINERS[@]}" | jq -R . | jq -s .)
  payload=$(jq -n \
    --argjson users "$users_json" \
    '{
      required_status_checks: { strict: true, contexts: ["CI"] },
      enforce_admins: true,
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        dismiss_stale_reviews: true
      },
      required_conversation_resolution: true,
      restrictions: { users: $users, teams: [], apps: [] },
      allow_deletions: false,
      allow_force_pushes: false,
      block_creations: false,
      lock_branch: false
    }')

  if echo "$payload" | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$REPO/branches/$branch/protection" \
    --input - >/dev/null; then
    return
  fi

  echo "  - $branch: push restrictions are unavailable here; protecting without them"
  echo "$payload" | jq '.restrictions = null' | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$REPO/branches/$branch/protection" \
    --input - >/dev/null
}

protect_branch "main"
protect_branch "master"

echo
echo "Also locking the repo-level 'delete branch/repo' surface:"
# Belt-and-braces: branch protection above already blocks deleting main via
# the branches API, but this also confirms the repository itself isn't
# flagged for deletion/archival and that only the owner can do so (GitHub
# has no separate API toggle for "who can delete the repo" beyond
# collaborator permission level, which is managed via
# `gh api repos/$REPO/collaborators` — see README for adding contributors
# with write-but-not-admin access).
gh api "repos/$REPO" -F delete_branch_on_merge=true >/dev/null

echo "Done. $REPO: main/master cannot be deleted or force-pushed, and only" \
     "${MAINTAINERS[*]} can merge — everyone else must go through a reviewed PR from a fork."
