#!/usr/bin/env node
// Multi-repo workspace: let a session in one repo see, search, compare and hand work to its sister repos.
// Zero dependencies (Node >= 18). Sister repos are only ever READ here; the one write into another repo is
// `handoff`, and only into docs/cross-repo/inbox/ of a repo whose access is "inbox" or "write".
//
//   workspace.mjs init [--id <id>] [--force]         create .ai/workspace.json (+ docs/cross-repo/, .gitignore entry)
//   workspace.mjs scan                               list sibling folders that look like repos (writes nothing)
//   workspace.mjs add <path> [--id --role --access --summary --remote]
//   workspace.mjs status [--json]                    where each repo is, git state, inbox, warnings, launch hints
//   workspace.mjs link                               allow this Claude Code session to read the sister repos (.claude/settings.local.json)
//   workspace.mjs hub                                parent-folder CLAUDE.md + .code-workspace for sessions started above the repos
//   workspace.mjs brief <id> [--full]                compact digest of a sister repo (docs, stack, contract, open tasks)
//   workspace.mjs search <id|all> <words...> [--max N]   cross-language text search (C#, TS, Python, Terraform, ...)
//   workspace.mjs contracts [<id|all>] [--json]      HTTP surface each repo provides and consumes (heuristic)
//   workspace.mjs gaps [--json] [--report]           calls nobody provides, method mismatches, unused endpoints (leads, not proof)
//   workspace.mjs report new "<title>" [--type gap|journey|infra|feasibility]
//   workspace.mjs handoff --to <id> --title "<t>" [--from-report <file>] [--body-file <file>]
//   workspace.mjs inbox [<id>] | inbox close <file> [--note "..."]
//   workspace.mjs check                              validate the manifest shape (offline; used by CI)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, loadWorkspace, WORKSPACE_FILE, WORKSPACE_LOCAL, ACCESS, INBOX_DIR } from './lib.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flag = (n) => rest.includes(`--${n}`);
const opt = (n, d) => {
  const i = rest.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  if (rest[i].includes('=')) return rest[i].split('=').slice(1).join('=');
  const v = rest[i + 1];
  return v && !v.startsWith('--') ? v : d;
};
const VALUE_OPTS = ['id', 'role', 'access', 'summary', 'remote', 'type', 'to', 'title', 'from-report', 'body-file', 'max', 'note', 'name'];
const positional = () => {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { if (!rest[i].includes('=') && VALUE_OPTS.includes(rest[i].slice(2))) i++; continue; }
    out.push(rest[i]);
  }
  return out;
};

const abs = (rel) => path.join(ROOT, rel);
const posix = (p) => p.split(path.sep).join('/');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const writeFile = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

/** git in another repo, read-only. core.fsmonitor is disabled so a hostile repo config cannot run a program. */
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...args], { encoding: 'utf8', timeout: 8000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.status === 0 ? r.stdout.trim() : null;
}
/** Remote URL without embedded credentials (the manifest is committed). */
const remoteOf = (dir) => { const u = git(dir, 'config', '--get', 'remote.origin.url'); return u ? u.replace(/^([a-z+]+:\/\/)[^@/\s]+@/i, '$1') : null; };
const normRemote = (u) => String(u || '').trim().toLowerCase().replace(/^[a-z+]+:\/\//, '').replace(/^git@/, '').replace(':', '/').replace(/\.git$/, '').replace(/\/$/, '');

// ---------------------------------------------------------------- file walking

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.next', '.nuxt', '.angular', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', 'target', 'vendor', '.terraform', '.idea', '.vs', '.vscode', '.gradle', '.cache']);
const SECRET_FILE = /(^|\/)(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)|credentials|.*\.(pem|key|p12|pfx|tfstate|tfstate\.backup|tfvars|kdbx))$/i;
const SECRET_DIR = /(^|\/)secrets?(\/|$)/i;
const SECRET_LINE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\b(?:api[_-]?key|secret|token|passw(?:or)?d|connection[_-]?string)\b["']?\s*[:=])/i;

/** Relative posix file paths under dir (bounded, no secrets, no build output). */
function walk(dir, { maxFiles = 6000, maxDepth = 12 } = {}) {
  const out = [];
  const visit = (rel, depth) => {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let ents = [];
    try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !(e.name.startsWith('.') && !['.github', '.ai'].includes(e.name)) && !SECRET_DIR.test(child)) visit(child, depth + 1); }
      else if (e.isFile() && !SECRET_FILE.test(child)) out.push(child);
    }
  };
  visit('', 0);
  return out;
}

const textOf = (dir, rel, max = 400_000) => {
  try {
    const p = path.join(dir, rel);
    if (fs.statSync(p).size > max) return '';
    const buf = fs.readFileSync(p);
    return buf.subarray(0, 4096).includes(0) ? '' : buf.toString('utf8');
  } catch { return ''; }
};
/** A file inside this repo that is not a secret; dies otherwise (used for --body-file / --from-report). */
function safeRel(p) {
  const full = path.resolve(ROOT, p);
  const rel = posix(path.relative(ROOT, full));
  if (rel.startsWith('..') || path.isAbsolute(rel)) die(`${p} is outside this repo; copy what you need into the repo first.`);
  if (SECRET_FILE.test(rel) || SECRET_DIR.test(rel)) die(`${p} looks like a secrets file; not reading it.`);
  return rel;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ---------------------------------------------------------------- repo facts

function shallow(dir, depth = 2) {
  const out = [];
  const visit = (rel, d) => {
    let ents = [];
    try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      out.push(child);
      if (e.isDirectory() && d < depth) visit(child, d + 1);
    }
  };
  visit('', 0);
  return out;
}

/** Best-effort role from files in the repo: frontend | backend | infra | docs | other. */
function guessRole(dir) {
  const files = shallow(dir, 2);
  const has = (re) => files.some((f) => re.test(f));
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (['@angular/core', 'react', 'vue', 'svelte', 'next', 'nuxt', 'solid-js'].some((d) => deps[d])) return 'frontend';
  if (['express', 'fastify', '@nestjs/core', 'koa', 'hono', '@hapi/hapi'].some((d) => deps[d])) return 'backend';
  if (has(/\.(sln|csproj|fsproj)$/) || has(/(^|\/)(pom\.xml|build\.gradle(\.kts)?|go\.mod|Cargo\.toml)$/)) return 'backend';
  const py = (readText(path.join(dir, 'pyproject.toml')) + readText(path.join(dir, 'requirements.txt'))).toLowerCase();
  if (/fastapi|django|flask/.test(py)) return 'backend';
  if (has(/\.(tf|bicep)$/) || has(/(^|\/)(cdk\.json|serverless\.ya?ml|Pulumi\.ya?ml|Chart\.ya?ml|kustomization\.ya?ml)$/)) return 'infra';
  if (files.length && files.every((f) => /\.(md|mdx|png|jpe?g|svg)$/i.test(f) || !/\./.test(path.basename(f)))) return 'docs';
  return 'other';
}

const stackOf = (dir) => {
  const s = readJson(path.join(dir, '.ai/stack.json'));
  if (s) return s;
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const fw = ['@angular/core', 'react', 'next', 'vue', 'express', '@nestjs/core', 'fastify', 'prisma'].filter((d) => deps[d]).map((d) => ({ label: d, version: deps[d] }));
  const files = shallow(dir, 2);
  const langs = [];
  if (files.some((f) => /\.(csproj|sln)$/.test(f))) langs.push('csharp/.net');
  if (files.some((f) => /\.tf$/.test(f))) langs.push('terraform');
  if (files.some((f) => /\.bicep$/.test(f))) langs.push('bicep');
  return { languages: langs, frameworks: fw, scripts: pkg.scripts || {} };
};

// ---------------------------------------------------------------- front matter + inbox

function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([A-Za-z_-]+):\s*(.*)$/); if (kv) out[kv[1]] = kv[2].trim(); }
  return out;
}

function openInbox(dir) {
  const d = path.join(dir, INBOX_DIR);
  let names = [];
  try { names = fs.readdirSync(d).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md'); } catch { return []; }
  return names.sort().map((f) => {
    const text = readText(path.join(d, f));
    const fm = frontMatter(text);
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f;
    const date = fm.date || (f.match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || '';
    const age = date ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : null;
    return { file: f, title, from: fm.from || '?', date, age, status: (fm.status || 'open').toLowerCase() };
  }).filter((x) => !['done', 'closed', 'rejected'].includes(x.status));
}

// ---------------------------------------------------------------- manifest

const readRaw = () => readJson(abs(WORKSPACE_FILE));
function saveRaw(m) { writeFile(abs(WORKSPACE_FILE), JSON.stringify(m, null, 2) + '\n'); }
function needWorkspace() {
  const ws = loadWorkspace(ROOT);
  if (!ws) die(`No workspace manifest (${WORKSPACE_FILE}). Run: node scripts/ai/workspace.mjs init   then: add <path-to-sister-repo>`);
  return ws;
}
const selfOf = (ws) => Object.values(ws.repos).find((r) => r.self);
const others = (ws) => Object.values(ws.repos).filter((r) => !r.self);
const pick = (ws, id) => ws.repos[id] || die(`Unknown repo "${id}". Known: ${Object.keys(ws.repos).join(', ')}`);
const present = (r) => isDir(r.abs);

function ensureGitignore() {
  const p = abs('.gitignore');
  const line = WORKSPACE_LOCAL;
  const cur = readText(p);
  if (!cur.split(/\r?\n/).includes(line)) writeFile(p, `${cur ? cur.replace(/\s*$/, '\n') : ''}\n# ai-kit: per-developer workspace overrides\n${line}\n`);
}

const CROSS_README = `# Cross-repo work

Written and read by AI sessions and people working across this repo and its sister repos
(see \`.ai/workspace.json\`, skills \`cross-repo-*\`, and \`node scripts/ai/workspace.mjs help\`).

- \`YYYY-MM-DD-<slug>.md\`  reports: gap analysis, journey review, feasibility, infrastructure findings.
- \`inbox/\`  requests that sister repos left for THIS repo. Check it at the start of a session; close an item with
  \`node scripts/ai/workspace.mjs inbox close <file>\` once it is done or rejected (it moves to \`inbox/done/\`).

Rules: evidence is \`repo:path:line\`; unknowns are written as UNKNOWN; never paste secrets.
`;

// ---------------------------------------------------------------- init / scan / add

function cmdInit() {
  if (fs.existsSync(abs(WORKSPACE_FILE)) && !flag('force')) { console.log(`${WORKSPACE_FILE} exists. Use "add <path>" to register a sister repo (or --force to start over).`); return; }
  const id = slug(opt('id', path.basename(ROOT)));
  const remote = remoteOf(ROOT);
  const manifest = { version: 1, name: opt('name', id), repos: { [id]: { role: guessRole(ROOT), path: '.', ...(remote ? { remote } : {}), access: 'write', summary: '' } } };
  saveRaw(manifest);
  ensureGitignore();
  if (!fs.existsSync(abs('docs/cross-repo/README.md'))) writeFile(abs('docs/cross-repo/README.md'), CROSS_README);
  if (!fs.existsSync(abs(`${INBOX_DIR}/.gitkeep`))) writeFile(abs(`${INBOX_DIR}/.gitkeep`), '');
  console.log(`Created ${WORKSPACE_FILE} (this repo = "${id}", role ${manifest.repos[id].role}), docs/cross-repo/, and a .gitignore entry for ${WORKSPACE_LOCAL}.`);
  console.log('Next: node scripts/ai/workspace.mjs scan     then:  add ../<sister-repo>   (do the same in each sister repo so the link goes both ways)');
}

function cmdScan() {
  const parent = path.dirname(ROOT);
  const rows = [];
  for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const d = path.join(parent, e.name);
    if (d === ROOT) continue;
    if (fs.existsSync(path.join(d, '.git')) || fs.existsSync(path.join(d, 'package.json'))) rows.push({ name: e.name, role: guessRole(d), remote: remoteOf(d) });
  }
  if (!rows.length) { console.log(`No sibling repos found next to ${path.basename(ROOT)} (looked in ${parent}).`); return; }
  console.log(`Folders next to ${path.basename(ROOT)} that look like repos (nothing was written; add only the ones that belong to THIS system):`);
  for (const r of rows.slice(0, 40)) console.log(`  ${r.name.padEnd(28)} ${r.role.padEnd(9)} node scripts/ai/workspace.mjs add ../${r.name} --role ${r.role}`);
  if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
}

function cmdAdd() {
  const [p] = positional();
  if (!p) die('usage: workspace.mjs add <path> [--id x --role backend --access read|inbox|write --summary "..."]');
  const raw = readRaw() || die(`No ${WORKSPACE_FILE}. Run init first.`);
  const dir = path.resolve(ROOT, p);
  if (!isDir(dir)) die(`Not a directory: ${dir}`);
  const rel = posix(path.relative(ROOT, dir)) || '.';
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) die('Sister repos must be reachable by a relative path (different drive?). Use a symlink or a hub folder.');
  const id = slug(opt('id', path.basename(dir)));
  const access = opt('access', 'read');
  if (!ACCESS.includes(access)) die(`--access must be one of: ${ACCESS.join(', ')}`);
  const remote = opt('remote', null) || remoteOf(dir);
  raw.repos = raw.repos || {};
  raw.repos[id] = { role: opt('role', guessRole(dir)), path: rel, ...(remote ? { remote } : {}), access, summary: opt('summary', '') };
  saveRaw(raw);
  console.log(`Added "${id}" (${raw.repos[id].role}, access ${access}) -> ${rel}`);
  console.log(`Next: node scripts/ai/workspace.mjs brief ${id}   |   status   |   link   (and run "add ${posix(path.relative(dir, ROOT)) || '.'}" inside ${id} so it can see this repo too)`);
}

// ---------------------------------------------------------------- status / link / hub

function repoState(r) {
  if (!present(r)) return { found: false };
  const branch = git(r.abs, 'rev-parse', '--abbrev-ref', 'HEAD');
  const porcelain = git(r.abs, 'status', '--porcelain');
  const lr = git(r.abs, 'rev-list', '--left-right', '--count', '@{u}...HEAD');
  const [behind, ahead] = lr ? lr.split(/\s+/).map(Number) : [null, null];
  return {
    found: true,
    git: branch !== null,
    branch,
    dirty: porcelain === null ? null : porcelain ? porcelain.split('\n').length : 0,
    ahead, behind,
    last: git(r.abs, 'log', '-1', '--format=%cr'),
    kit: (readJson(path.join(r.abs, '.ai/kit.json')) || {}).kitVersion || null,
    agents: fs.existsSync(path.join(r.abs, 'AGENTS.md')),
    inbox: openInbox(r.abs),
  };
}

function cmdStatus() {
  const ws = needWorkspace();
  const self = selfOf(ws);
  const stale = loadConfig().workspace.staleDays;
  const rows = Object.values(ws.repos).map((r) => ({ r, s: repoState(r) }));
  const warnings = [];
  for (const { r, s } of rows) {
    if (r.self) continue;
    if (!s.found) { warnings.push(`${r.id}: not found at ${r.path}${r.remote ? `  (clone it: git clone ${r.remote} ${r.path})` : ''}`); continue; }
    if (s.behind > 0) warnings.push(`${r.id}: ${s.behind} commit(s) behind its upstream; pull before trusting what you read there`);
    if (s.dirty > 0) warnings.push(`${r.id}: ${s.dirty} uncommitted change(s); you may be reading work in progress`);
    if (!s.agents) warnings.push(`${r.id}: no AGENTS.md (kit not installed there); "brief ${r.id}" will be thin`);
    const theirs = loadWorkspace(r.abs);
    if (theirs && !Object.values(theirs.repos).some((x) => path.resolve(r.abs, x.path) === ROOT || (self?.remote && x.remote && normRemote(x.remote) === normRemote(self.remote)))) warnings.push(`${r.id}: its workspace.json does not list this repo, so sessions started there cannot see it`);
    if (!theirs && s.agents) warnings.push(`${r.id}: no ${WORKSPACE_FILE}; sessions started there cannot see this repo`);
  }
  const mine = rows.find((x) => x.r.self)?.s?.inbox || [];
  for (const i of mine) if (i.age !== null && i.age > stale) warnings.push(`inbox: "${i.title}" from ${i.from} has been open ${i.age} days`);
  if (flag('json')) { console.log(JSON.stringify({ name: ws.name, self: self?.id, repos: rows.map(({ r, s }) => ({ id: r.id, role: r.role, access: r.access, path: r.path, ...s })), warnings }, null, 2)); return; }
  console.log(`Workspace "${ws.name || '(unnamed)'}"  -  this repo: ${self ? self.id : '(not listed: add an entry with path ".")'}\n`);
  console.log(['id', 'role', 'access', 'path', 'git', 'kit', 'inbox'].map((h, i) => h.padEnd([14, 10, 8, 22, 34, 8, 6][i])).join(' '));
  for (const { r, s } of rows) {
    const g = !s.found ? 'MISSING' : !s.git ? 'not a git repo' : `${s.branch}${s.ahead != null ? ` +${s.ahead}/-${s.behind}` : ''}${s.dirty ? `, ${s.dirty} dirty` : ''}${s.last ? `, ${s.last}` : ''}`;
    console.log([r.id + (r.self ? '*' : ''), r.role, r.self ? '-' : r.access, r.path, g, s.kit || '-', s.found ? String(s.inbox.length) : '-'].map((x, i) => String(x).padEnd([14, 10, 8, 22, 34, 8, 6][i])).join(' '));
  }
  if (warnings.length) { console.log('\nWarnings:'); warnings.forEach((w) => console.log(`  - ${w}`)); }
  if (mine.length) { console.log(`\nOpen requests for this repo (${INBOX_DIR}/):`); mine.forEach((i) => console.log(`  - ${i.file}  from ${i.from}: ${i.title}`)); }
  const found = others(ws).filter(present);
  if (found.length) {
    console.log('\nLaunch hints (a session only sees folders it was given):');
    console.log(`  Claude Code:  claude ${found.map((r) => `--add-dir ${r.path}`).join(' ')}      (or: node scripts/ai/workspace.mjs link)`);
    console.log('                add CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 to also load their CLAUDE.md; "brief <id>" does not need it');
    console.log('  Cursor / VS Code:  open the .code-workspace from "workspace.mjs hub", or File > Add Folder to Workspace');
  }
}

function cmdLink() {
  const ws = needWorkspace();
  const dirs = others(ws).filter(present).map((r) => r.path);
  if (!dirs.length) die('No sister repos found on disk. Run status.');
  const p = abs('.claude/settings.local.json');
  const cur = readJson(p) || {};
  cur.permissions = cur.permissions || {};
  const set = new Set([...(cur.permissions.additionalDirectories || []), ...dirs]);
  cur.permissions.additionalDirectories = [...set];
  writeFile(p, JSON.stringify(cur, null, 2) + '\n');
  console.log(`Wrote ${posix(path.relative(ROOT, p))} (personal, not committed): Claude Code may now read and edit ${dirs.join(', ')} when started from this repo's root.`);
  console.log('Note: that setting grants file access only and does not load their CLAUDE.md or skills. Edits are still limited by each repo\'s "access" in .ai/workspace.json (guard hook).');
}

function cmdHub() {
  const ws = needWorkspace();
  const parent = path.dirname(ROOT);
  const list = Object.values(ws.repos).filter((r) => present(r));
  const dirName = (r) => path.relative(parent, r.abs) || r.id;
  const block = [
    '<!-- BEGIN ai-kit workspace -->',
    `# ${ws.name || 'Workspace'}: repos in this folder`,
    '',
    ...list.map((r) => `- \`${dirName(r)}/\` - ${r.role}${r.summary ? `: ${r.summary}` : ''}`),
    '',
    'Each repo has its own AGENTS.md. Rules of a sister repo are NOT loaded automatically when you work in another one.',
    'Before touching more than one repo: `node scripts/ai/workspace.mjs status`, then `brief <id>` for each repo involved.',
    'Skills: cross-repo-context, cross-repo-investigate, cross-repo-change, cloud-inspect. Sister repos are read-only unless their access in `.ai/workspace.json` says otherwise.',
    '<!-- END ai-kit workspace -->',
    '',
  ].join('\n');
  const md = path.join(parent, 'CLAUDE.md');
  const cur = readText(md);
  const re = /<!-- BEGIN ai-kit workspace -->[\s\S]*?<!-- END ai-kit workspace -->\n?/;
  writeFile(md, re.test(cur) ? cur.replace(re, block) : `${cur ? cur.replace(/\s*$/, '\n\n') : ''}${block}`);
  const cw = path.join(parent, `${slug(ws.name || 'workspace')}.code-workspace`);
  if (!fs.existsSync(cw)) writeFile(cw, JSON.stringify({ folders: list.map((r) => ({ name: r.id, path: dirName(r) })) }, null, 2) + '\n');
  console.log(`Wrote ${md} (Claude Code loads it for sessions started in any repo below ${parent}) and ${fs.existsSync(cw) ? cw : '(code-workspace unchanged)'}.`);
  console.log('Other agents do not read a CLAUDE.md above the git root; they rely on this repo\'s AGENTS.md section 15 and .ai/workspace.json.');
}

// ---------------------------------------------------------------- brief

function section(text, headingRe, max) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^#{1,4}\s/.test(l) && headingRe.test(l));
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < lines.length && out.length < max; k++) { if (/^#{1,4}\s/.test(lines[k])) break; if (lines[k].trim()) out.push(lines[k]); }
  return out;
}
const headings = (text, max = 14) => text.split(/\r?\n/).filter((l) => /^#{1,3}\s/.test(l)).slice(0, max);

function cmdBrief() {
  const ws = needWorkspace();
  const [id] = positional();
  const r = pick(ws, id || die('usage: workspace.mjs brief <id> [--full]'));
  if (!present(r)) die(`${r.id} is not on disk at ${r.path}${r.remote ? `. Clone: git clone ${r.remote} ${r.path}` : ''}`);
  const full = flag('full');
  const cap = full ? 400 : 150;
  const out = [];
  const s = repoState(r);
  out.push(`# ${r.id} (${r.role}, access: ${r.self ? 'this repo' : r.access}) at ${r.path}`);
  if (r.summary) out.push(r.summary);
  if (s.git) out.push(`git: ${s.branch}${s.behind ? `, ${s.behind} behind upstream` : ''}${s.dirty ? `, ${s.dirty} uncommitted` : ''}${s.last ? `, last commit ${s.last}` : ''}`);
  const st = stackOf(r.abs);
  const fw = (st.frameworks || []).map((f) => f.label + (f.version ? ` ${f.version}` : '')).join(', ');
  out.push(`stack: ${[...(st.languages || []), fw].filter(Boolean).join(' | ') || 'UNKNOWN'}${st.scripts && Object.keys(st.scripts).length ? `; scripts: ${Object.keys(st.scripts).join(', ')}` : ''}`);
  const docs = (rel) => textOf(r.abs, rel);
  const missing = []; const unfilled = [];
  const NOISE = /\bTODO\b/;
  const body = (text) => text.split(/\r?\n/).filter((l) => l.trim() && !/^(#|>|---|\|?[\s:|-]+\|?$)/.test(l.trim()) && !NOISE.test(l) && !/^\[[^\]]*\]\([^)]*\)(\s*\|\s*\[[^\]]*\]\([^)]*\))*$/.test(l.trim()));
  /** Print the picked lines when the doc has real content; otherwise record it as missing or still a template. */
  const take = (title, rel, text, pickLines, minBody = 2) => {
    if (!docs(rel)) { missing.push(rel); return; }
    if (body(text).length < minBody) { unfilled.push(rel); return; }
    const lines = pickLines(text).filter((l) => !NOISE.test(l));
    if (lines.length) out.push('', `## ${title} (${rel})`, ...lines);
  };

  const agents = docs('AGENTS.md');
  if (!agents) missing.push('AGENTS.md');
  const skills = (() => { try { return fs.readdirSync(path.join(r.abs, '.claude/skills')).filter((n) => isDir(path.join(r.abs, '.claude/skills', n))); } catch { return []; } })();
  if (agents) out.push('', `rules: AGENTS.md (${headings(agents, 60).filter((h) => /^##\s/.test(h)).length} sections; read the ones for your task before editing there)${skills.length ? `; skills: ${skills.join(', ')}` : ''}`);

  const idx = docs('docs/index.md');
  const digest = section(idx, /context digest/i, 60).join('\n');
  take('Context digest', 'docs/index.md', digest, (t) => t.split('\n').slice(0, full ? 60 : 24));
  const mem = docs('docs/memory.md');
  take('Read first', 'docs/memory.md', section(mem, /read first/i, 60).join('\n'), (t) => t.split('\n').slice(0, full ? 40 : 14), 1);
  const arch = docs('docs/architecture.md');
  take('Architecture headings', 'docs/architecture.md', arch, (t) => headings(t), 3);
  const schema = docs('docs/schema.md');
  take('Contracts doc', 'docs/schema.md', schema, (t) => [...headings(t, 10), ...t.split(/\r?\n/).filter((l) => /\b(GET|POST|PUT|PATCH|DELETE)\b\s+`?\//.test(l)).slice(0, full ? 60 : 20)], 3);
  const open = docs('docs/tasks.md').split(/\r?\n/).filter((l) => /^\s*[-*] \[ \]/.test(l) && !NOISE.test(l));
  if (open.length) out.push('', `## Open tasks (${open.length}) (docs/tasks.md)`, ...open.slice(0, full ? 25 : 8));

  const c = extractContracts(r);
  if (c.provides.length || c.consumes.length) {
    out.push('', `## HTTP surface (heuristic; ${c.provides.length} provided, ${c.consumes.length} consumed)`);
    for (const p of c.provides.slice(0, full ? 80 : 20)) out.push(`- provides ${p.method} ${p.path}  (${p.file}:${p.line})`);
    for (const p of c.consumes.slice(0, full ? 40 : 8)) out.push(`- calls    ${p.method} ${p.path}  (${p.file}:${p.line})`);
  }
  if (s.inbox?.length) out.push('', `## Open requests in its inbox (${s.inbox.length})`, ...s.inbox.slice(0, 6).map((i) => `- ${i.file}: ${i.title} (from ${i.from})`));
  if (unfilled.length) out.push('', `Still template placeholders in ${r.id} (do not rely on them; a documentation gap worth reporting): ${unfilled.join(', ')}`);
  if (missing.length) out.push('', `Missing in ${r.id}: ${missing.join(', ')}`);

  const lines = out.join('\n').split('\n');
  console.log(lines.slice(0, cap).join('\n'));
  if (lines.length > cap) console.log(`... ${lines.length - cap} more line(s); use --full, or read the file you need by line range.`);
}

// ---------------------------------------------------------------- search

function cmdSearch() {
  const ws = needWorkspace();
  const [target, ...words] = positional();
  const terms = words.flatMap((w) => w.split(/[\s,]+/)).map((t) => t.toLowerCase()).filter(Boolean);
  if (!target || !terms.length) die('usage: workspace.mjs search <id|all> <keyword...> [--max N]');
  const repos = target === 'all' ? Object.values(ws.repos).filter(present) : [pick(ws, target)];
  const max = Number(opt('max', 30)) || 30;
  const hits = [];
  for (const r of repos) {
    if (!present(r)) { console.log(`(${r.id} is not on disk)`); continue; }
    for (const rel of walk(r.abs)) {
      if (!/\.(cs|ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rb|php|rs|tf|bicep|ya?ml|json|sql|md|proto|graphql|html|scss|css|razor|cshtml|csproj|sh)$/i.test(rel)) continue;
      const text = textOf(r.abs, rel);
      if (!text) continue;
      const lower = text.toLowerCase();
      const pathLower = rel.toLowerCase();
      const present_ = terms.filter((t) => lower.includes(t) || pathLower.includes(t));
      if (!present_.length) continue;
      const all = present_.length === terms.length;
      const lines = text.split('\n');
      const matched = [];
      for (let i = 0; i < lines.length && matched.length < 3; i++) if (terms.some((t) => lines[i].toLowerCase().includes(t))) matched.push({ n: i + 1, t: lines[i].trim().slice(0, 150) });
      hits.push({ repo: r.id, rel, all, score: present_.length * 10 + (all ? 50 : 0) + terms.filter((t) => pathLower.includes(t)).length * 5, matched });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const strong = hits.some((h) => h.all) ? hits.filter((h) => h.all) : hits;
  if (!strong.length) { console.log(`No matches for "${terms.join(' ')}" in ${repos.map((r) => r.id).join(', ')}. Try synonyms.`); return; }
  console.log(`${Math.min(max, strong.length)} of ${strong.length} file(s) for "${terms.join(' ')}"${strong[0].all ? '' : ' (no file has every word; showing partial matches)'}:`);
  for (const h of strong.slice(0, max)) {
    console.log(`${h.repo}:${h.rel}`);
    for (const m of h.matched) console.log(`  ${m.n}: ${SECRET_LINE.test(m.t) ? '[line hidden: looks like a credential]' : m.t}`);
  }
}

// ---------------------------------------------------------------- contracts

const METHODS = 'get|post|put|patch|delete';
const DYN = /\$\{[^}]*\}|\{\{[^}]*\}\}|\{[^}/]*\}|:[A-Za-z_]\w*|\[\.{0,3}[^\]/]+\]|<(?:[^>:]+:)?[^>]+>/g;
const STATIC_ASSET = /\.(json|svg|png|jpe?g|gif|webp|css|js|map|html|ico|woff2?|ttf|txt|xml|md)$|^\/?assets\//i;

/** "https://h/api/Orders/{id}/?x=1" -> "/api/orders/{}" */
function normPath(p) {
  let s = String(p).trim().replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
  s = s.replace(/^(\$\{[^}]*\}|\{\{[^}]*\}\})(?=\/)/, ''); // leading base-url variable
  s = s.replace(DYN, '{}').replace(/\{\}(?:\{\})+/g, '{}').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (!s.startsWith('/')) s = `/${s}`;
  return s.toLowerCase();
}
const usable = (p) => /^\/[\w\-./{}~%]*$/.test(p) && p !== '/' && !STATIC_ASSET.test(p);
const join = (...parts) => normPath(parts.filter(Boolean).map((x) => String(x).replace(/^\/|\/$/g, '')).join('/'));

function globRe(g) { return new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`); }

function fromOpenApi(rel, text) {
  const out = [];
  let spec = null;
  if (/\.json$/i.test(rel)) { try { spec = JSON.parse(text); } catch { return out; } }
  if (spec && spec.paths) {
    const base = (() => { try { return new URL((spec.servers || [])[0]?.url || '', 'http://x').pathname.replace(/\/$/, ''); } catch { return ''; } })();
    for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops || {})) if (new RegExp(`^(${METHODS})$`).test(m)) out.push({ method: m.toUpperCase(), path: join(base, p), file: rel, line: 1, via: 'openapi' });
    return out;
  }
  if (!/^\s*(openapi|swagger)\s*:/m.test(text)) return out;
  const lines = text.split('\n');
  let inPaths = false; let cur = null;
  const base = (text.match(/^servers:\s*\n\s*-\s*url:\s*['"]?([^\s'"]+)/m) || [])[1];
  const prefix = base ? (() => { try { return new URL(base, 'http://x').pathname.replace(/\/$/, ''); } catch { return ''; } })() : '';
  lines.forEach((l, i) => {
    if (/^paths:\s*$/.test(l)) { inPaths = true; return; }
    if (inPaths && /^\S/.test(l)) inPaths = false;
    if (!inPaths) return;
    const p = l.match(/^ {2}['"]?(\/[^\s'":]*)['"]?:\s*$/);
    if (p) { cur = p[1]; return; }
    const m = l.match(new RegExp(`^ {4}(${METHODS}):`));
    if (m && cur) out.push({ method: m[1].toUpperCase(), path: join(prefix, cur), file: rel, line: i + 1, via: 'openapi' });
  });
  return out;
}

const HTTP_NAME = (n) => n.toUpperCase();

/** Provided and consumed HTTP endpoints of one repo (regex-based: leads to verify, not a parser). */
function extractContracts(r) {
  const provides = []; const consumes = [];
  const seen = new Set();
  const add = (list, kind, o) => {
    const p = o.path;
    if (!usable(p)) return;
    const key = `${kind}|${o.method}|${p}|${o.file}`;
    if (seen.has(key)) return;
    seen.add(key); list.push({ ...o });
  };
  const prov = (o) => add(provides, 'p', o);
  const cons = (o) => add(consumes, 'c', o);
  const globs = (r.contracts || []).map(globRe);
  const files = walk(r.abs);
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    const isSpec = /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i.test(rel) || globs.some((g) => g.test(rel));
    if (isSpec && /\.(json|ya?ml)$/i.test(rel)) { fromOpenApi(rel, textOf(r.abs, rel, 3_000_000)).forEach(prov); continue; }
    if (rel === 'docs/schema.md') {
      textOf(r.abs, rel).split('\n').forEach((l, i) => { const m = l.match(/\b(GET|POST|PUT|PATCH|DELETE)\b\s+`?(\/[^\s`|)]*)/); if (m) prov({ method: m[1], path: normPath(m[2]), file: rel, line: i + 1, via: 'docs' }); });
      continue;
    }
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.cs', '.py', '.java', '.kt', '.go'].includes(ext)) continue;
    if (/\.(spec|test)\.|(^|\/)(tests?|__tests__|e2e|mocks?|fixtures?)\//i.test(rel)) continue;
    const text = textOf(r.abs, rel);
    if (!text) continue;
    const at = (m) => lineOf(text, m.index);
    const P = (method, p, m, via) => prov({ method, path: normPath(p), file: rel, line: at(m), via });
    const C = (method, p, m, via) => cons({ method, path: normPath(p), file: rel, line: at(m), via });

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'].includes(ext)) {
      const serverFile = /from\s+['"](express|fastify|koa-router|@koa\/router|hono|@hapi\/hapi|itty-router)['"]|require\(\s*['"](express|fastify|koa-router|@koa\/router|hono)['"]\s*\)/.test(text);
      const nest = text.match(/@Controller\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/);
      if (nest) {
        for (const m of text.matchAll(new RegExp(`@(${METHODS})\\(\\s*(?:(['"\`])([^'"\`]*)\\2)?\\s*\\)`, 'gi'))) P(HTTP_NAME(m[1]), join(nest[2] || '', m[3] || ''), m, 'nest');
      } else if (serverFile) {
        for (const m of text.matchAll(new RegExp(`\\b(?:router|app|server|api|fastify|route|routes|r)\\.(${METHODS}|all)\\(\\s*(['"\`])(\\/[^'"\`]*)\\2`, 'gi'))) P(m[1].toLowerCase() === 'all' ? 'ANY' : HTTP_NAME(m[1]), m[3], m, 'router');
      }
      const next = rel.match(/(?:^|\/)(?:src\/)?app\/(.*)\/route\.(?:ts|js|tsx|jsx|mjs)$/);
      if (next) {
        const p = `/${next[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')}`;
        for (const m of text.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) P(m[1], p, m, 'next-route');
      }
      const pages = rel.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+)\.(?:ts|js)$/);
      if (pages) P('ANY', `/api/${pages[1].replace(/(^|\/)index$/, '')}`, { index: 0 }, 'next-pages');
      // consumers
      for (const m of text.matchAll(/\b(?:\$fetch|useFetch|fetch)\(\s*(['"`])([^'"`]*)\1([\s\S]{0,200})/g)) {
        const meth = (m[3].match(/method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i) || [])[1];
        C((meth || 'GET').toUpperCase(), m[2], m, 'fetch');
      }
      if (!serverFile && !nest) {
        for (const m of text.matchAll(new RegExp(`\\b(?:axios|http|httpClient|client|api|this\\.http|this\\.httpClient|\\$http|ky|got|this\\.api|this\\.client)\\.(${METHODS})(?:<[^>(]*>)?\\(\\s*(['"\`])([^'"\`]*)\\2`, 'gi'))) C(HTTP_NAME(m[1]), m[3], m, 'http-client');
        for (const m of text.matchAll(new RegExp(`\\.(${METHODS})(?:<[^>(]*>)?\\(\\s*[\\w.$]+\\s*\\+\\s*(['"\`])([^'"\`]*)\\2`, 'gi'))) C(HTTP_NAME(m[1]), m[3], m, 'http-client');
      }
    } else if (ext === '.cs') {
      let routePrefix = ''; let controller = ''; let pending = '';
      text.split('\n').forEach((l, i) => {
        const route = l.match(/\[Route\(\s*"([^"]*)"\s*\)\]/);
        if (route) pending = route[1];
        const cls = l.match(/\bclass\s+(\w+)Controller\b/);
        if (cls) { controller = cls[1].toLowerCase(); routePrefix = pending.replace(/\[controller\]/gi, controller); pending = ''; return; }
        const h = l.match(/\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\]/);
        if (h && controller) { prov({ method: HTTP_NAME(h[1]), path: join(routePrefix, (h[2] ?? pending).replace(/\[action\]/gi, '{}')), file: rel, line: i + 1, via: 'aspnet' }); pending = ''; }
      });
      const groups = {};
      for (const m of text.matchAll(/\b(\w+)\s*=\s*[\w.]+\.MapGroup\(\s*"([^"]*)"/g)) groups[m[1]] = m[2];
      for (const m of text.matchAll(new RegExp(`\\b(\\w+)\\.Map(${METHODS})\\(\\s*"([^"]*)"`, 'gi'))) P(HTTP_NAME(m[2]), join(groups[m[1]] || '', m[3]), m, 'minimal-api');
      if (/HttpClient/.test(text)) for (const m of text.matchAll(/\.(Get|Post|Put|Patch|Delete)(?:FromJson|AsJson)?Async(?:<[^>]*>)?\(\s*\$?"([^"]*)"/g)) C(HTTP_NAME(m[1]), m[2], m, 'httpclient');
    } else if (ext === '.py') {
      const prefixes = {};
      for (const m of text.matchAll(/\b(\w+)\s*=\s*APIRouter\([^)]*prefix\s*=\s*['"]([^'"]*)['"]/g)) prefixes[m[1]] = m[2];
      for (const m of text.matchAll(new RegExp(`@(\\w+)\\.(${METHODS})\\(\\s*(['"])([^'"]*)\\3`, 'gi'))) P(HTTP_NAME(m[2]), join(prefixes[m[1]] || '', m[4]), m, 'fastapi');
      for (const m of text.matchAll(/@(\w+)\.route\(\s*['"]([^'"]*)['"]([^)]*)\)/g)) {
        const ms = (m[3].match(/methods\s*=\s*\[([^\]]*)\]/) || [])[1];
        for (const meth of (ms ? ms.match(/[A-Za-z]+/g) : ['GET'])) P(meth.toUpperCase(), m[2], m, 'flask');
      }
      if (/import\s+(requests|httpx|aiohttp)|from\s+(requests|httpx)/.test(text)) for (const m of text.matchAll(new RegExp(`\\b(?:requests|httpx|client|session)\\.(${METHODS})\\(\\s*f?(['"])([^'"]*)\\2`, 'gi'))) C(HTTP_NAME(m[1]), m[3], m, 'python-http');
    } else if (ext === '.java' || ext === '.kt') {
      const base = (text.match(/@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?"([^"]*)"/) || [])[1] || '';
      for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)")?/g)) P(HTTP_NAME(m[1]), join(base, m[2] || ''), m, 'spring');
    } else if (ext === '.go') {
      for (const m of text.matchAll(/\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]*)"/g)) P(m[1], m[2], m, 'go');
    }
  }
  return { provides, consumes };
}

const segs = (p) => p.split('/').filter(Boolean);
/** Right-aligned segment match; {} matches any one segment; at least one literal segment must agree. */
function shapeMatch(a, b) {
  const x = segs(a); const y = segs(b);
  const n = Math.min(x.length, y.length);
  let lit = 0;
  for (let i = 1; i <= n; i++) {
    const p = x[x.length - i]; const q = y[y.length - i];
    if (p === '{}' || q === '{}') continue;
    if (p !== q) return false;
    lit++;
  }
  return n > 0 && lit >= 1;
}
const GENERIC_SEG = /^(api|v\d+|rest|services?)$/;
const methodOk = (a, b) => a === b || a === 'ANY' || b === 'ANY';

function cmdContracts() {
  const ws = needWorkspace();
  const [target = 'all'] = positional();
  const repos = target === 'all' ? Object.values(ws.repos).filter(present) : [pick(ws, target)];
  const result = repos.map((r) => ({ id: r.id, role: r.role, ...extractContracts(r) }));
  if (flag('json')) { console.log(JSON.stringify(result, null, 2)); return; }
  for (const c of result) {
    console.log(`\n## ${c.id} (${c.role}): provides ${c.provides.length}, calls ${c.consumes.length}`);
    for (const p of c.provides.slice(0, 80)) console.log(`  provides ${p.method.padEnd(6)} ${p.path}   ${p.file}:${p.line} [${p.via}]`);
    for (const p of c.consumes.slice(0, 80)) console.log(`  calls    ${p.method.padEnd(6)} ${p.path}   ${p.file}:${p.line} [${p.via}]`);
  }
  console.log('\nHeuristic extraction (regex over source, OpenAPI files and docs/schema.md). A missing endpoint here may be a framework pattern the scan does not know: check the code.');
}

function analyseGaps(ws) {
  const per = Object.values(ws.repos).filter(present).map((r) => ({ r, ...extractContracts(r) }));
  const providers = per.flatMap((x) => x.provides.map((p) => ({ ...p, repo: x.r.id })));
  const gaps = []; const mismatches = []; let dynamic = 0; let matched = 0;
  const used = new Set();
  for (const x of per) for (const c of x.consumes) {
    if (!segs(c.path).some((s) => s !== '{}')) { dynamic++; continue; }
    const hits = providers.filter((p) => shapeMatch(c.path, p.path));
    const exact = hits.filter((p) => methodOk(c.method, p.method));
    if (exact.length) { matched++; exact.forEach((p) => used.add(`${p.repo}|${p.method}|${p.path}`)); continue; }
    if (hits.length) {
      const exactPath = hits.filter((p) => p.path === c.path);
      const shown = exactPath.length ? exactPath : hits.filter((p) => segs(p.path).length === segs(c.path).length);
      mismatches.push({ consumer: x.r.id, call: c, provider: (shown.length ? shown : hits).slice(0, 3) });
      hits.forEach((p) => used.add(`${p.repo}|${p.method}|${p.path}`));
      continue;
    }
    const lit = new Set(segs(c.path).filter((s) => s !== '{}' && !GENERIC_SEG.test(s)));
    const near = providers
      .map((p) => ({ p, score: segs(p.path).filter((s) => lit.has(s)).length ? segs(p.path).filter((s) => lit.has(s)).length * 2 + (p.method === c.method ? 1 : 0) + (segs(p.path).length === segs(c.path).length ? 1 : 0) : 0 }))
      .filter((z) => z.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((z) => z.p);
    gaps.push({ consumer: x.r.id, call: c, nearest: near });
  }
  const unused = providers.filter((p) => !used.has(`${p.repo}|${p.method}|${p.path}`) && p.via !== 'docs');
  return { repos: per.map((x) => ({ id: x.r.id, provides: x.provides.length, calls: x.consumes.length })), matched, dynamic, gaps, mismatches, unused };
}

function cmdGaps() {
  const ws = needWorkspace();
  const a = analyseGaps(ws);
  if (flag('json')) { console.log(JSON.stringify(a, null, 2)); return; }
  const fmt = (c) => `${c.method} ${c.path}  (${c.file}:${c.line})`;
  const out = [];
  out.push(`Contract gap scan across ${a.repos.map((r) => `${r.id} (provides ${r.provides}, calls ${r.calls})`).join(', ')}`);
  out.push(`matched calls: ${a.matched}; unresolvable dynamic calls skipped: ${a.dynamic}`);
  if (a.gaps.length) { out.push('', `NO PROVIDER FOUND (${a.gaps.length}): a repo calls an endpoint no repo here provides`); for (const g of a.gaps) out.push(`  - ${g.consumer} calls ${fmt(g.call)}${g.nearest.length ? `\n      nearest: ${g.nearest.map((p) => `${p.repo} ${p.method} ${p.path}`).join(' | ')}` : ''}`); }
  if (a.mismatches.length) { out.push('', `METHOD MISMATCH (${a.mismatches.length}): path exists, method does not`); for (const m of a.mismatches) out.push(`  - ${m.consumer} calls ${fmt(m.call)}; provided as ${m.provider.map((p) => `${p.repo} ${p.method} ${p.path}`).join(' | ')}`); }
  if (a.unused.length) { out.push('', `PROVIDED BUT NOT CALLED HERE (${a.unused.length}, informational: other clients may use them)`); for (const u of a.unused.slice(0, 25)) out.push(`  - ${u.repo} ${u.method} ${u.path}  (${u.file}:${u.line})`); if (a.unused.length > 25) out.push(`  ... ${a.unused.length - 25} more`); }
  if (!a.gaps.length && !a.mismatches.length) out.push('', 'No contract gaps found by the scan. That does not prove compatibility: payload shapes, auth, and behaviour still need the cross-repo-investigate skill.');
  out.push('', 'These are leads. Verify each in code before reporting it; the scan is regex-based and cannot see generated clients, gateways, or dynamic URLs.');
  console.log(out.join('\n'));
  if (flag('report')) {
    const p = newReport('Contract gap scan', 'gap', out.join('\n'));
    console.log(`\nWrote ${p}`);
  }
}

// ---------------------------------------------------------------- reports, handoff, inbox

function reportBody(type, title, selfId, scan) {
  return `---
type: ${type}
status: draft
date: ${today()}
from: ${selfId}
---

# ${title}

## Context
What is being built or changed, in which repo, and what the user journey is. One paragraph. Link the task or issue.

## Verdict
One line: **works as planned** | **works with changes** | **blocked**, and the single biggest reason.

## Findings
| # | Where | Type | Severity | Evidence (repo:path:line) | Why it matters |
|---|---|---|---|---|---|
| 1 | backend | missing-endpoint | blocker | UNKNOWN | |

Types: missing-endpoint, contract-mismatch, auth, data-model, infra, config, observability, performance, journey-complexity, docs-gap.
Severity: blocker (cannot ship), high (ships broken in a common path), medium, low.
${scan ? `\n## Automated scan (leads, verify each)\n\n\`\`\`\n${scan}\n\`\`\`\n` : ''}
## Journey and workflow review
Steps the user takes today vs. the minimum. Where does the flow cross repos more often than it needs to?

## Proposed changes
| Repo | Change | Benefit | Effort (S/M/L) | Order |
|---|---|---|---|---|
| backend | e.g. return X in the list response | frontend drops N extra calls | S | 1 |

Order contract first: agree the request/response, then the provider, then the consumer.

## Cloud and infrastructure
What was inspected (read-only), where (environment, account, namespace), and what differs from what the code assumes. UNKNOWN if not inspected.

## Decisions needed
-

## Handoff
One \`## Handoff to <repo-id>\` block per repo that must act; \`workspace.mjs handoff --to <id> --from-report <this file>\` sends it.
`;
}

function newReport(title, type, scan) {
  const ws = loadWorkspace(ROOT);
  const selfId = (ws && selfOf(ws)?.id) || path.basename(ROOT);
  let rel = `docs/cross-repo/${today()}-${slug(title)}.md`;
  for (let n = 2; fs.existsSync(abs(rel)); n++) rel = `docs/cross-repo/${today()}-${slug(title)}-${n}.md`;
  writeFile(abs(rel), reportBody(type, title, selfId, scan));
  return rel;
}

function cmdReport() {
  const [sub, ...t] = positional();
  if (sub !== 'new' || !t.length) die('usage: workspace.mjs report new "<title>" [--type gap|journey|infra|feasibility]');
  const type = opt('type', 'feasibility');
  if (!['gap', 'journey', 'infra', 'feasibility'].includes(type)) die('--type must be gap, journey, infra or feasibility');
  console.log(`Created ${newReport(t.join(' '), type, null)}. Fill it from evidence only; write UNKNOWN where you could not verify.`);
}

function handoffBody(title, to, self, fromReport) {
  let body = '';
  if (opt('body-file')) body = textOf(ROOT, safeRel(opt('body-file')));
  else if (fromReport) {
    const text = textOf(ROOT, fromReport);
    const m = text.match(new RegExp(`^## Handoff to ${to.id}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'mi'));
    body = m ? m[1].trim() : '';
    if (!body) die(`${fromReport} has no "## Handoff to ${to.id}" section. Add one, or pass --body-file.`);
  }
  if (!body) body = '## Requested change\n\n## Why (what breaks or gets worse in the sender without it)\n\n## Contract (request / response / errors; example JSON)\n\n## Acceptance criteria\n- \n\n## Urgency and ordering\n';
  return `---
from: ${self.id}
to: ${to.id}
date: ${today()}
status: open
${fromReport ? `report: ${fromReport}\n` : ''}---

# ${title}

${body.replace(/\s+$/, '')}

---
Sent by an AI session in \`${self.id}\`. The receiver should verify the claims in its own code before acting, and close this with
\`node scripts/ai/workspace.mjs inbox close <file>\`.
`;
}

function cmdHandoff() {
  const ws = needWorkspace();
  const self = selfOf(ws) || die(`This repo is not listed in ${WORKSPACE_FILE} (needs an entry with path ".").`);
  const to = pick(ws, opt('to') || die('--to <repo-id> is required'));
  if (to.self) die('--to must be a sister repo');
  const title = opt('title') || die('--title "<short request>" is required');
  const fromReport = opt('from-report') ? safeRel(opt('from-report')) : null;
  const body = handoffBody(title, to, self, fromReport);
  const name = `${today()}-from-${self.id}-${slug(title)}.md`;
  if (!['inbox', 'write'].includes(to.access)) {
    console.log(`${to.id} has access "${to.access}": nothing was written there. Give this to a session or person in ${to.id} (or raise access to "inbox" in ${WORKSPACE_FILE}):\n\n--- ${INBOX_DIR}/${name} ---\n${body}`);
    process.exit(3);
  }
  if (!present(to)) die(`${to.id} is not on disk at ${to.path}`);
  const dest = path.join(to.abs, INBOX_DIR, name);
  if (fs.existsSync(dest)) die(`Already exists: ${dest}`);
  writeFile(dest, body);
  console.log(`Wrote ${to.path}/${INBOX_DIR}/${name}. It is uncommitted in ${to.id}: tell the user, who decides when to commit it there.`);
}

function cmdInbox() {
  const ws = loadWorkspace(ROOT);
  const [a, b] = positional();
  if (a === 'close') {
    if (!b) die('usage: workspace.mjs inbox close <file> [--note "..."]');
    const src = abs(`${INBOX_DIR}/${path.basename(b)}`);
    if (!fs.existsSync(src)) die(`Not found: ${INBOX_DIR}/${path.basename(b)}`);
    const text = readText(src).replace(/^status:.*$/m, 'status: done').replace(/\s*$/, '\n') + (opt('note') ? `\nClosed ${today()}: ${opt('note')}\n` : '');
    writeFile(path.join(path.dirname(src), 'done', path.basename(src)), text);
    fs.rmSync(src);
    console.log(`Closed ${path.basename(src)} (moved to ${INBOX_DIR}/done/).`);
    return;
  }
  const repo = a && ws ? pick(ws, a) : null;
  const dir = repo ? repo.abs : ROOT;
  const items = openInbox(dir);
  if (!items.length) { console.log(`No open requests in ${repo ? repo.id : 'this repo'}.`); return; }
  for (const i of items) console.log(`${i.file}  from ${i.from}${i.age !== null ? `  ${i.age}d` : ''}  ${i.title}`);
}

// ---------------------------------------------------------------- check

function cmdCheck() {
  const raw = readRaw();
  if (!fs.existsSync(abs(WORKSPACE_FILE))) { console.log(`No ${WORKSPACE_FILE}: single-repo project, nothing to check.`); return; }
  const errs = [];
  if (!raw) errs.push(`${WORKSPACE_FILE} is not valid JSON`);
  else {
    if (raw.version !== 1) errs.push('"version" must be 1');
    if (!raw.repos || typeof raw.repos !== 'object' || Array.isArray(raw.repos)) errs.push('"repos" must be an object');
    else {
      let selfCount = 0;
      for (const [id, r] of Object.entries(raw.repos)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) errs.push(`repo id "${id}" must be lowercase letters, digits and dashes`);
        if (!r || typeof r.path !== 'string') { errs.push(`${id}: "path" is required`); continue; }
        if (path.isAbsolute(r.path) || /^[A-Za-z]:|^~/.test(r.path)) errs.push(`${id}: path must be relative to this repo (absolute and ~ paths do not work on a teammate's machine)`);
        if (r.path === '.') selfCount++;
        if (r.access !== undefined && !ACCESS.includes(r.access)) errs.push(`${id}: access must be one of ${ACCESS.join(', ')}`);
        if (typeof r.remote === 'string' && /^[a-z+]+:\/\/[^@/\s]+@/i.test(r.remote)) errs.push(`${id}: remote contains credentials; remove them`);
        if (r.contracts !== undefined && !Array.isArray(r.contracts)) errs.push(`${id}: contracts must be an array of globs`);
      }
      if (selfCount > 1) errs.push('only one repo may have path "."');
    }
  }
  if (errs.length) { console.error(`${WORKSPACE_FILE} problems:\n${errs.map((e) => `  - ${e}`).join('\n')}`); process.exit(1); }
  console.log(`${WORKSPACE_FILE}: ok (${Object.keys(raw.repos).length} repo(s)). Sister repo folders are not required in CI.`);
}

// ---------------------------------------------------------------- dispatch

const COMMANDS = { init: cmdInit, scan: cmdScan, add: cmdAdd, status: cmdStatus, link: cmdLink, hub: cmdHub, brief: cmdBrief, search: cmdSearch, contracts: cmdContracts, gaps: cmdGaps, report: cmdReport, handoff: cmdHandoff, inbox: cmdInbox, check: cmdCheck };
if (!cmd || cmd === 'help' || cmd === '--help' || !COMMANDS[cmd]) {
  const head = readText(fileURLToPath(import.meta.url)).split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, ''));
  console.log(head.join('\n'));
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}
COMMANDS[cmd]();
