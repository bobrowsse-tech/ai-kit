#!/usr/bin/env node
// The one pre-commit check, shared by .githooks/, .husky/, and .pre-commit-config.yaml. Portable (no bash).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const cwd = top.status === 0 ? top.stdout.trim() : process.cwd();

const steps = [['check-docs.mjs'], ['build-index.mjs', '--check'], ['setup-mcp.mjs', '--check'], ['sync-agents.mjs', '--check']];
for (const [script, ...args] of steps) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
