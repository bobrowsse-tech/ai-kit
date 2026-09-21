#!/usr/bin/env node
// CLI for @bobrowsse-tech/ai-kit
//   npx ai-kit install [target] [flags]
//   npx ai-kit update  [target] [flags]
//   npx ai-kit [target] [flags]          (same as install; pass --update for refresh)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'install.mjs');

const raw = process.argv.slice(2);
const cmd = raw[0];
const rest = [...raw];

if (cmd === 'install') {
  rest.shift();
} else if (cmd === 'update') {
  rest.shift();
  if (!rest.includes('--update')) rest.push('--update');
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(`Usage:
  ai-kit install [target-dir] [--dry-run] [--force] [--reset-seeds] [--no-post]
  ai-kit update  [target-dir] [--dry-run] [--force] [--reset-seeds] [--no-post]

Target defaults to the current directory.
Install once as a pinned devDependency, then refresh with:  npx ai-kit update
`);
  process.exit(0);
}
// else: pass through (path and/or flags) for backwards compatibility with install.mjs

const r = spawnSync(process.execPath, [installer, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
