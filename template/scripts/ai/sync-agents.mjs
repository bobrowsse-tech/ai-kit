#!/usr/bin/env node
// One source of truth for skills: .claude/skills. Codex, Cursor, and Copilot also scan .agents/skills
// (Copilot reads .claude/skills natively), so this mirrors the skills there. Mirrors are generated: edit the source.
//   node scripts/ai/sync-agents.mjs             copy .claude/skills/* -> .agents/skills/*
//   node scripts/ai/sync-agents.mjs --symlink   use relative symlinks instead of copies (macOS/Linux)
//   node scripts/ai/sync-agents.mjs --check     exit 1 if the mirror is missing or stale (CI, pre-commit)
// Only skills this script created are managed; a skill you put in .agents/skills yourself is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const SRC = '.claude/skills';
const DST = '.agents/skills';
const MARK = '.ai-kit-managed.json';
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SYMLINK = args.includes('--symlink');
const abs = (p) => path.join(ROOT, p);
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const present = (p) => fs.existsSync(p) || isLink(p);

const skills = fs.existsSync(abs(SRC))
  ? fs.readdirSync(abs(SRC), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(abs(SRC), e.name, 'SKILL.md'))).map((e) => e.name).sort()
  : [];
let marker = { skills: [] };
try { marker = JSON.parse(fs.readFileSync(path.join(abs(DST), MARK), 'utf8')); } catch { /* first run */ }

const text = (b) => b.toString('latin1').replace(/\r\n/g, '\n');
function tree(dir) {
  const out = new Map();
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, r); else out.set(r, text(fs.readFileSync(p)));
    }
  };
  walk(dir);
  return out;
}
function inSync(src, dst) {
  if (isLink(dst)) return path.resolve(path.dirname(dst), fs.readlinkSync(dst)) === src;
  const a = tree(src), b = tree(dst);
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}
function place(src, dst) {
  if (SYMLINK) {
    try { fs.symlinkSync(path.relative(path.dirname(dst), src), dst, 'dir'); return; }
    catch (e) { console.log(`[WARN] symlink failed (${e.code}); copying instead`); }
  }
  fs.cpSync(src, dst, { recursive: true });
}

const problems = [];
const managed = new Set(marker.skills);
for (const name of skills) {
  const src = path.join(abs(SRC), name), dst = path.join(abs(DST), name);
  if (present(dst) && !managed.has(name)) { if (!CHECK) console.log(`skip ${name}: ${DST}/${name} exists and is not managed by the kit`); continue; }
  if (CHECK) { if (!present(dst)) problems.push(`missing ${DST}/${name}`); else if (!inSync(src, dst)) problems.push(`stale ${DST}/${name}`); continue; }
  if (present(dst)) { if (inSync(src, dst)) continue; fs.rmSync(dst, { recursive: true, force: true }); }
  fs.mkdirSync(abs(DST), { recursive: true });
  place(src, dst);
  managed.add(name);
}
for (const name of [...managed]) {
  if (skills.includes(name)) continue;
  if (CHECK) { problems.push(`obsolete ${DST}/${name} (source skill was removed)`); continue; }
  fs.rmSync(path.join(abs(DST), name), { recursive: true, force: true });
  managed.delete(name);
}

if (CHECK) {
  if (problems.length) { problems.forEach((p) => console.error(`\x1b[0;31m[ERROR] ${p}. Run: node scripts/ai/sync-agents.mjs\x1b[0m`)); process.exit(1); }
  console.log(`\x1b[0;32m[OK] ${DST} mirrors ${SRC} (${skills.length} skills).\x1b[0m`);
} else if (skills.length) {
  fs.mkdirSync(abs(DST), { recursive: true });
  fs.writeFileSync(path.join(abs(DST), MARK), JSON.stringify({ generatedBy: 'scripts/ai/sync-agents.mjs', mode: SYMLINK ? 'symlink' : 'copy', skills: [...managed].sort() }, null, 2) + '\n');
  console.log(`Mirrored ${skills.length} skill(s) from ${SRC} to ${DST} (read by Codex, Cursor, Copilot, Gemini CLI).`);
}
