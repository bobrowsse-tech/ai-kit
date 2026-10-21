#!/usr/bin/env node
// Best-effort static scan for the "21-point pre-ship checklist" (docs/security-checklist.md).
// This is a second, cheap net, not a replacement for actually going through the checklist:
// it flags likely misses; it cannot prove absence of a problem, and a clean run is not a pass.
//   node scripts/ai/preship-check.mjs                whole repo
//   node scripts/ai/preship-check.mjs --changed-from REF   only files changed since REF (PR jobs)
// Config: .ai/config.json "preship": error | warn | off (default warn).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadConfig, listSourceFiles, projectFacts } from './lib.mjs';

const mode = (loadConfig().preship) || 'warn';
if (mode === 'off') { console.log('[SKIP] pre-ship check is off.'); process.exit(0); }

const facts = projectFacts();
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tracked = git('ls-files');
const changedFromIdx = process.argv.indexOf('--changed-from');
const rawScope = changedFromIdx > -1
  ? (git('diff', '--name-only', process.argv[changedFromIdx + 1], 'HEAD').stdout || '').split('\n').filter(Boolean)
  : (tracked.status === 0 && tracked.stdout.trim() ? tracked.stdout.split('\n') : listSourceFiles());
// This script's own source (and other kit tooling under scripts/ai/) must not be scanned for the patterns
// it looks for, or it flags itself; skip the kit's own paths and non-project noise either way the list came from.
const NOISE = /(^|\/)(node_modules|dist|build|\.next|coverage|\.git|__pycache__|\.venv|venv|scripts\/ai|\.claude|\.ai|docs)\//;
const scope = rawScope.filter((f) => !NOISE.test(f) && f !== 'scripts/ai/preship-check.mjs');
const files = scope.filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|php)$/;
const findings = []; // { id, severity: 'error'|'note', msg, file? }
const flag = (id, msg, file) => findings.push({ id, msg, file });

// ---- 01/02/03: secrets and .env exposure not already caught by the guard hook / gitleaks ----
{
  const gi = read('.gitignore');
  if (files.includes('package.json') || facts.pyHas('') || files.length) {
    if (!/(^|\n)\.env(\n|$)/.test(gi) && !/(^|\n)\.env\*/.test(gi)) flag('02-env-gitignore', '.env is not covered by .gitignore (add ".env" or ".env*", and keep .env.example unignored)');
  }
  for (const f of files.filter((x) => /(^|\/)\.env(\.[^/]+)?$/.test(x) && !/\.(example|sample|template|dist)$/.test(x))) {
    flag('01-env-tracked', `${f} is tracked by git; a committed .env usually means committed secrets`, f);
  }
}

// ---- 09: Firebase/Supabase rules shipped open ----
for (const f of files.filter((x) => /(^|\/)(firestore|storage)\.rules$/.test(x) || /(^|\/)database\.rules\.json$/.test(x))) {
  const t = read(f);
  if (/allow\s+[\w,\s]*\b(read|write)\b[\w,\s]*:\s*if\s+true\s*;/.test(t) || /"\.read"\s*:\s*true/.test(t) || /"\.write"\s*:\s*true/.test(t)) flag('09-open-rules', `${f} allows unconditional read/write`, f);
}
for (const f of files.filter((x) => /supabase\/migrations\//.test(x) && x.endsWith('.sql'))) {
  const t = read(f);
  if (/create\s+table/i.test(t) && !/row\s+level\s+security/i.test(t)) flag('09-no-rls', `${f}: CREATE TABLE with no "ROW LEVEL SECURITY" in the same file — confirm RLS is enabled somewhere before shipping`, f);
}

// ---- 11: production debug mode ----
for (const f of files.filter((x) => CODE.test(x))) {
  const t = read(f);
  if (/\bDEBUG\s*=\s*True\b/.test(t) && /settings\.py$/.test(f)) flag('11-debug-django', `${f}: DEBUG = True (Django) — must be False in production, driven by an env var`, f);
  if (/app\.set\(\s*['"]debug['"]\s*,\s*true\s*\)/.test(t)) flag('11-debug-express', `${f}: debug mode hardcoded on`, f);
}
// ---- 12: detailed error messages leaking to clients ----
for (const f of files.filter((x) => CODE.test(x) && !/\.(test|spec)\./.test(x))) {
  const t = read(f);
  if (/res\.(json|send)\(\s*\{[^}]*\b(err|error)\.stack\b/.test(t)) flag('12-stack-to-client', `${f}: sends err.stack in an HTTP response`, f);
  if (/return\s+(JsonResponse|Response)\([^)]*\btraceback\.format_exc\(\)/.test(t)) flag('12-stack-to-client', `${f}: returns a traceback in a response`, f);
}

// ---- 15: unrestricted file uploads (very rough: multer/formidable with no fileFilter/limits nearby) ----
for (const f of files.filter((x) => CODE.test(x))) {
  const t = read(f);
  if (/multer\(\s*\{/.test(t) && !/fileFilter/.test(t) && !/limits\s*:/.test(t)) flag('15-upload-unrestricted', `${f}: multer() with no fileFilter/limits — any file type/size is accepted`, f);
}

// ---- 16: string-built SQL (parameterized queries are the fix) ----
const SQLI = /\b(SELECT|INSERT|UPDATE|DELETE)\b[^`'"]{0,200}\$\{|\b(SELECT|INSERT|UPDATE|DELETE)\b.{0,80}["']\s*\+\s*\w|f["'](?:SELECT|INSERT|UPDATE|DELETE)\b.{0,120}\{/i;
for (const f of files.filter((x) => CODE.test(x))) {
  const t = read(f);
  if (SQLI.test(t)) flag('16-sql-concat', `${f}: SQL string appears built with template/string concatenation — use parameterized queries or an ORM`, f);
}

// ---- 17: auth endpoints with no visible rate limiting ----
{
  const hasLimiterDep = ['express-rate-limit', 'rate-limiter-flexible', 'fastify-rate-limit', '@upstash/ratelimit', 'django-ratelimit', 'flask-limiter', 'slowapi'].some((d) => facts.deps[d] || facts.pyHas(d.replace(/-/g, '_')));
  const authRoute = /(^|\/)(auth|login|signin|signup|register)([._-][^/]*)?\.(ts|tsx|js|jsx|py|rb|go)$/i;
  const hits = files.filter((f) => authRoute.test(f));
  if (hits.length && !hasLimiterDep) flag('17-no-rate-limit', `auth route(s) found (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', ...' : ''}) but no rate-limiting package is in dependencies`);
}

// ---- 19: security headers (helmet / Next headers() / nginx) ----
{
  const hasHelmet = Boolean(facts.deps.helmet || facts.deps['@fastify/helmet']);
  const hasNextHeaders = files.some((f) => /next\.config\.(js|mjs|ts)$/.test(f) && /headers\s*\(\s*\)/.test(read(f)) && /(X-Frame-Options|Content-Security-Policy|Strict-Transport-Security)/i.test(read(f)));
  const usesExpressLike = facts.deps.express || facts.deps.fastify || facts.deps.koa;
  const usesNext = Boolean(facts.deps.next);
  if (usesExpressLike && !hasHelmet) flag('19-no-security-headers', 'Express/Fastify/Koa found, no helmet-style security headers configured');
  if (usesNext && !hasNextHeaders) flag('19-no-security-headers', 'Next.js found, no security headers set in next.config headers()');
}

// ---- 20: CORS wide open ----
for (const f of files.filter((x) => CODE.test(x))) {
  const t = read(f);
  if (/\bcors\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/.test(t) || /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/.test(t) || /CORS_ORIGIN_ALLOW_ALL\s*=\s*True/.test(t)) flag('20-cors-wildcard', `${f}: CORS origin is "*" — restrict to known origins`, f);
  if (/\bcors\(\)/.test(t) && facts.deps.cors) flag('20-cors-default', `${f}: cors() called with no options — the default allows any origin`, f);
}

// ---- report ----
const byId = new Map();
for (const f of findings) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f); }
if (!findings.length) {
  console.log('\x1b[0;32m[OK] no likely misses found by the static scan.\x1b[0m This does not replace docs/security-checklist.md.');
  process.exit(0);
}
const tag = mode === 'error' ? '\x1b[0;31m[ERROR]' : '\x1b[0;33m[WARN]';
console.log(`${tag} ${findings.length} possible pre-ship issue(s) — verify against docs/security-checklist.md:\x1b[0m`);
for (const [id, list] of byId) for (const f of list) console.log(`  [${id}] ${f.msg}`);
console.log('\nMany checklist items (auth, permissions, isolation, DB lockdown, production config) cannot be checked by grep — see the pre-ship-security skill and docs/security-checklist.md.');
process.exit(mode === 'error' ? 1 : 0);
