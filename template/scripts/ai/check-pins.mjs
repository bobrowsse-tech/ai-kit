#!/usr/bin/env node
// Enforces exact-version pinning: package.json (dependencies/devDependencies/optionalDependencies)
// and Python requirements*.txt (== pins). Config: .ai/config.json "pins": error | warn | off.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, workspaces } from './lib.mjs';

const mode = loadConfig().pins;
if (mode === 'off') { console.log('[SKIP] pin check is off.'); process.exit(0); }

const bad = [];
let checked = 0;

const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/;
const PROTOCOL = /^(workspace:|file:|link:|portal:|npm:|git|github:|https?:)/;
for (const dir of ['.', ...workspaces()]) {
  const pkgFile = path.join(ROOT, dir, 'package.json');
  if (!fs.existsSync(pkgFile)) continue;
  checked++;
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const label = dir === '.' ? 'package.json' : `${dir}/package.json`;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, ver] of Object.entries(pkg[field] || {})) {
      if (!EXACT.test(ver) && !PROTOCOL.test(ver)) bad.push(`${label} ${field}: ${name}@${ver}`);
    }
  }
}

for (const f of fs.readdirSync(ROOT).filter((n) => /^requirements.*\.txt$/.test(n))) {
  checked++;
  fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || /^(https?:|git\+)/.test(line)) return; // options, includes, urls
    if (!/^[A-Za-z0-9_.\-\[\],]+\s*===?\s*\S+/.test(line) && !/\s@\s/.test(line)) bad.push(`${f}:${i + 1}: ${line} (use ==)`);
  });
}

if (!checked) { console.log('[SKIP] no package.json or requirements*.txt to check.'); process.exit(0); }
if (!bad.length) { console.log('\x1b[0;32m[OK] All dependencies are pinned to exact versions.\x1b[0m'); process.exit(0); }

const tag = mode === 'warn' ? '\x1b[0;33m[WARN]' : '\x1b[0;31m[ERROR]';
console.error(`${tag} Unpinned dependencies (npm: --save-exact, Python: ==):\x1b[0m`);
bad.forEach((b) => console.error(`  - ${b}`));
process.exit(mode === 'warn' ? 0 : 1);
