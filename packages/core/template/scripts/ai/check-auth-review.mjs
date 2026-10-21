#!/usr/bin/env node
// Auth, sessions, tokens, and permissions need isolated review (AGENTS.md section 6). This finds auth-related
// paths and verifies CODEOWNERS assigns them an owner (enable branch protection: "Require review from Code Owners").
//   node scripts/ai/check-auth-review.mjs                      whole repo
//   node scripts/ai/check-auth-review.mjs --changed-from REF   also list auth files changed since REF (PR jobs)
// Config: .ai/config.json "authReview": error | warn | off.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadConfig, listSourceFiles } from './lib.mjs';

const mode = loadConfig().authReview;
if (mode === 'off') { console.log('[SKIP] auth review check is off.'); process.exit(0); }

const AUTH = /(^|\/)(auth|authn|authz|authentication|authorization|login|logout|signin|signup|session|sessions|oauth|oidc|saml|jwt|token|tokens|permission|permissions|rbac|acl|credentials?|passwords?)([._-][^/]*)?(\/|$)/i;
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tracked = git('ls-files');
const all = tracked.status === 0 && tracked.stdout.trim() ? tracked.stdout.split('\n').filter(Boolean) : listSourceFiles();
const authFiles = all.filter((f) => AUTH.test(f) && !/(^|\/)(node_modules|docs)\//.test(f) && !/\.(md|png|svg|jpg)$/.test(f));

const ownersFile = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find((f) => fs.existsSync(path.join(ROOT, f)));
const rules = [];
if (ownersFile) {
  for (const raw of fs.readFileSync(path.join(ROOT, ownersFile), 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    let p = pattern;
    const anchored = p.startsWith('/');
    if (anchored) p = p.slice(1);
    if (p.endsWith('/')) p = p.slice(0, -1);
    const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*').replace(/\?/g, '[^/]');
    rules.push({ re: new RegExp((anchored || p.includes('/') ? '^' : '(^|.*/)') + body + '(/.*)?$'), owned: owners.some((o) => o.startsWith('@') || o.includes('@')) });
  }
}
const owned = (f) => { let hit = null; for (const r of rules) if (r.re.test(f)) hit = r; return Boolean(hit && hit.owned); };

if (!authFiles.length) { console.log('\x1b[0;32m[OK] no auth-related paths detected.\x1b[0m'); process.exit(0); }
const uncovered = authFiles.filter((f) => !owned(f));
const groups = [...new Set(uncovered.map((f) => path.posix.dirname(f)))].sort();

const ci = process.argv.indexOf('--changed-from');
if (ci > -1) {
  const changed = (git('diff', '--name-only', process.argv[ci + 1], 'HEAD').stdout || '').split('\n').filter((f) => AUTH.test(f));
  if (changed.length) console.log(`::notice::Auth-related files changed (isolated review required):\n${changed.map((f) => `  - ${f}`).join('\n')}`);
}
if (!uncovered.length) { console.log(`\x1b[0;32m[OK] ${authFiles.length} auth-related files all have CODEOWNERS owners (${ownersFile}).\x1b[0m`); process.exit(0); }

const tag = mode === 'warn' ? '\x1b[0;33m[WARN]' : '\x1b[0;31m[ERROR]';
console.error(`${tag} ${uncovered.length} auth-related file(s) have no CODEOWNERS owner${ownersFile ? '' : ' (no CODEOWNERS file)'}. Add rules in .github/CODEOWNERS for:\x1b[0m`);
groups.slice(0, 10).forEach((g) => console.error(`  - /${g}/`));
process.exit(mode === 'warn' ? 0 : 1);
