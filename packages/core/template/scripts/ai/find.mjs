#!/usr/bin/env node
// Reuse search: find existing functions/components/hooks/types by keyword BEFORE writing new code.
//   node scripts/ai/find.mjs format date
//   node scripts/ai/find.mjs useAuth --json
import { loadConfig, listSourceFiles, extractSymbols, formatSymbol, readText } from './lib.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const terms = argv.filter((a) => !a.startsWith('--')).flatMap((a) => a.split(/[\s,]+/)).map((t) => t.toLowerCase()).filter(Boolean);
if (!terms.length) {
  console.error('usage: node scripts/ai/find.mjs <keyword...> [--json]');
  process.exit(2);
}

const cfg = loadConfig();
const hits = [];
for (const rel of listSourceFiles(cfg)) {
  const relLower = rel.toLowerCase();
  for (const s of extractSymbols(rel, readText(rel))) {
    const name = s.name.toLowerCase();
    const desc = (s.desc || '').toLowerCase();
    let score = 0;
    let strong = 0;
    for (const t of terms) {
      if (name.includes(t)) { score += 3; strong++; }
      if (desc.includes(t)) { score += 2; strong++; }
      if (relLower.includes(t)) score += 1;
    }
    if (score) hits.push({ score, strong, file: rel, ...s });
  }
}
// Path-only matches are noise when any symbol name/description matched.
const pool = hits.some((h) => h.strong) ? hits.filter((h) => h.strong) : hits;
pool.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
const top = pool.slice(0, 10);

if (asJson) {
  console.log(JSON.stringify(top.map(({ score, file, name, kind, line, desc }) => ({ score, file, line, kind, name, desc })), null, 2));
} else if (!top.length) {
  console.log(`No existing symbol matches "${terms.join(' ')}". Try synonyms or grep the source once, then create it in the canonical location and re-run: node scripts/ai/build-index.mjs`);
} else {
  console.log(`${top.length} candidate(s) for "${terms.join(' ')}" - reuse or extend before creating:`);
  for (const h of top) console.log(`${h.file}:${h.line}  ${formatSymbol(h).slice(2)}`);
}
