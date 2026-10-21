#!/usr/bin/env bash
# Shim: the check moved to check-docs.mjs so it runs on Windows without bash.
exec node "$(dirname "$0")/check-docs.mjs" "$@"
