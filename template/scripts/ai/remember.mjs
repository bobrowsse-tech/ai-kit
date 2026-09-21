#!/usr/bin/env node
// Append one dated lesson to docs/memory.md.
//   node scripts/ai/remember.mjs gotcha "Prisma client must be imported from src/lib/db, never new PrismaClient()"
//   types: gotcha | decision | correction | pattern
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const SECTIONS = { gotcha: 'Gotchas', decision: 'Decisions', correction: 'Corrections', pattern: 'Patterns That Work' };
const [type, ...rest] = process.argv.slice(2);
const text = rest.join(' ').trim();
if (!SECTIONS[type] || !text) {
  console.error('usage: node scripts/ai/remember.mjs <gotcha|decision|correction|pattern> "<one or two lines>"');
  process.exit(2);
}

const file = path.join(ROOT, 'docs/memory.md');
if (!fs.existsSync(file)) { console.error('docs/memory.md not found - install the kit first.'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').split('\n');
if (lines.some((l) => l.includes(text))) { console.log('Already recorded; nothing added.'); process.exit(0); }

const entry = `- ${new Date().toISOString().slice(0, 10)} - ${text}`;
const heading = `## ${SECTIONS[type]}`;
const h = lines.findIndex((l) => l.trim() === heading);
if (h === -1) {
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('', heading, '', entry, '');
} else {
  let end = lines.findIndex((l, i) => i > h && l.startsWith('## '));
  if (end === -1) end = lines.length;
  let ins = end;
  while (ins > h + 1 && lines[ins - 1].trim() === '') ins--;
  if (ins === h + 1) lines.splice(ins, 0, '', entry); else lines.splice(ins, 0, entry);
  const after = lines[lines.indexOf(entry) + 1];
  if (after !== undefined && after.trim() !== '') lines.splice(lines.indexOf(entry) + 1, 0, '');
}
fs.writeFileSync(file, lines.join('\n'));
console.log(`Recorded under "${SECTIONS[type]}".`);
if (lines.length > 150) console.log('[HINT] docs/memory.md exceeds ~150 lines: prune stale entries and promote recurring ones to conventions.md or a skill.');
