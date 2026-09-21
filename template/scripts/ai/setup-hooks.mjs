#!/usr/bin/env node
// Points git at .githooks (no dependencies). Leaves husky or another hook manager alone.
// Wire it so every clone gets it: package.json "prepare": "node scripts/ai/setup-hooks.mjs"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
if (git('rev-parse', '--git-dir').status !== 0) { console.log('[SKIP] not a git repository yet; run again after git init.'); process.exit(0); }
try { fs.chmodSync(path.join(ROOT, '.githooks/pre-commit'), 0o755); } catch { /* not installed */ }

const cur = (git('config', '--get', 'core.hooksPath').stdout || '').trim();
if (!cur) {
  git('config', 'core.hooksPath', '.githooks');
  console.log('Git hooks now use .githooks (pre-commit runs scripts/ai/pre-commit.mjs). Note: hooks in .git/hooks are bypassed.');
} else if (cur === '.githooks') console.log('[OK] core.hooksPath is already .githooks');
else if (/^\.husky/.test(cur)) console.log('[OK] husky manages hooks; .husky/pre-commit runs the same scripts/ai/pre-commit.mjs');
else console.log(`[WARN] core.hooksPath is "${cur}" (another hook manager). Not changed. Make it run: node scripts/ai/pre-commit.mjs`);
