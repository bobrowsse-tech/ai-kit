#!/usr/bin/env node
// Language-agnostic duplicate-block report (normalized sliding window).
//   node scripts/ai/dupes.mjs                report only
//   node scripts/ai/dupes.mjs --fail-over 5  exit 1 if more than 5 duplicated file pairs
import crypto from 'node:crypto';
import { loadConfig, listSourceFiles, readText } from './lib.mjs';

const cfg = loadConfig();
const { minLines, maxReport } = cfg.dupes;
const fi = process.argv.indexOf('--fail-over');
const failOver = fi > -1 ? Number(process.argv[fi + 1]) : null;

const TRIVIAL = /^([\]\})[{(;,]+|(\/\/|#|\*|\/\*).*|(import|from|export \{|export \*|require)\b.*)$/;
const windows = new Map();

for (const rel of listSourceFiles(cfg)) {
  const norm = [];
  readText(rel).split(/\r?\n/).forEach((l, idx) => {
    const t = l.trim().replace(/\s+/g, ' ');
    if (t && !TRIVIAL.test(t)) norm.push({ t, line: idx + 1 });
  });
  for (let i = 0; i + minLines <= norm.length; i++) {
    const slice = norm.slice(i, i + minLines);
    const joined = slice.map((x) => x.t).join('\n');
    if (joined.length < minLines * 12) continue; // skip trivial/boilerplate windows
    const h = crypto.createHash('md5').update(joined).digest('hex');
    if (!windows.has(h)) windows.set(h, []);
    windows.get(h).push({ file: rel, line: slice[0].line, idx: i });
  }
}

const pairs = new Map();
for (const locs of windows.values()) {
  if (locs.length < 2) continue;
  const L = locs.slice(0, 10); // cap fan-out for boilerplate seen everywhere
  for (let a = 0; a < L.length; a++) {
    for (let b = a + 1; b < L.length; b++) {
      const A = L[a], B = L[b];
      if (A.file === B.file && Math.abs(A.idx - B.idx) < minLines) continue;
      const [X, Y] = A.file <= B.file ? [A, B] : [B, A];
      const key = `${X.file}|${Y.file}`;
      const e = pairs.get(key) || { count: 0, x: X, y: Y };
      e.count++;
      if (X.line < e.x.line) e.x = X;
      if (Y.line < e.y.line) e.y = Y;
      pairs.set(key, e);
    }
  }
}

const ranked = [...pairs.values()].sort((p, q) => q.count - p.count);
if (!ranked.length) {
  console.log(`No duplicated blocks of ${minLines}+ lines found.`);
} else {
  console.log(`${ranked.length} duplicated file pair(s) (blocks of ${minLines}+ lines). Extract shared code instead of copying:`);
  for (const p of ranked.slice(0, maxReport)) {
    console.log(`~${p.count + minLines - 1} lines  ${p.x.file}:${p.x.line}  <->  ${p.y.file}:${p.y.line}`);
  }
}
if (failOver !== null && ranked.length > failOver) {
  console.error(`\x1b[0;31m[ERROR] ${ranked.length} duplicated pairs exceeds the limit of ${failOver}.\x1b[0m`);
  process.exit(1);
}
