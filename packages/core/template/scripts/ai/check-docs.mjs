#!/usr/bin/env node
// Requires the 12 documentation files to exist and be non-empty; warns about leftover TODO placeholders.
// (Node port of check-docs.sh so it runs on Windows without bash; check-docs.sh remains as a shim.)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

// Keep in sync with packages/core/check-docs.mjs REQUIRED_DOCS (projects ship this file alone).
const REQUIRED = ['index', 'architecture', 'design', 'features', 'userjourney', 'agents', 'conventions', 'schema', 'tasks', 'environment', 'functionality-index', 'memory'].map((n) => `docs/${n}.md`);
const color = (c, t) => `\x1b[0;${c}m${t}\x1b[0m`;
const missing = [], empty = [], todo = [];

for (const rel of REQUIRED) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) missing.push(rel);
  else if (fs.statSync(p).size === 0) empty.push(rel);
  else if (/^[ \t]*[-*] (\[ \] )?TODO|TODO\(agent\)/m.test(fs.readFileSync(p, 'utf8'))) todo.push(rel);
}

if (missing.length) { console.log(color(31, '[ERROR] Missing required AI documentation files:')); missing.forEach((f) => console.log(`  - ${f}`)); }
if (empty.length) { console.log(color(31, '[ERROR] Required AI documentation files are empty:')); empty.forEach((f) => console.log(`  - ${f}`)); }
if (missing.length || empty.length) process.exit(1);
if (todo.length) { console.log(color(33, '[WARN] Docs still contain TODO placeholders (fill them from real code):')); todo.forEach((f) => console.log(`  - ${f}`)); }
console.log(color(32, `[OK] All ${REQUIRED.length} required AI documentation files are present and populated.`));
