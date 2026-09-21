#!/usr/bin/env bash
# Installs JS dependencies from a committed lockfile and exports PM_RUN / PM_EXEC (used by several CI jobs; DRY).
set -e
emit() { echo "$1=$2"; if [ -n "${GITHUB_ENV:-}" ]; then echo "$1=$2" >> "$GITHUB_ENV"; fi; }

if [ -f pnpm-lock.yaml ]; then
  corepack enable
  pnpm install --frozen-lockfile
  emit PM_RUN "pnpm run"; emit PM_EXEC "pnpm exec"
elif [ -f yarn.lock ]; then
  corepack enable
  yarn install --immutable
  emit PM_RUN "yarn run"; emit PM_EXEC "yarn"
elif [ -f package-lock.json ]; then
  npm ci
  emit PM_RUN "npm run"; emit PM_EXEC "npx --no-install"
elif [ -f package.json ]; then
  echo "::error::package.json found without a lockfile. Commit a lockfile (strict pinning rule)."
  exit 1
else
  echo "No package.json. Skipping JS install."
  emit PM_RUN "true"; emit PM_EXEC "true"
fi
