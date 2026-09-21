#!/usr/bin/env bash
# Shim: the check moved to pre-commit.mjs so it runs on Windows without bash.
exec node "$(dirname "$0")/pre-commit.mjs" "$@"
