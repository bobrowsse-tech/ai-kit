#!/usr/bin/env node
// Configures MCP servers for THIS project: detects the stack, resolves the latest stable
// version of each applicable server from the live registry, pins it, smoke-tests it with a
// real MCP handshake, and writes client configs (.mcp.json / .vscode/mcp.json / .cursor/mcp.json).
//
//   node scripts/ai/setup-mcp.mjs              plan only (dry run, changes nothing)
//   node scripts/ai/setup-mcp.mjs --apply      verify, then write configs + .ai/mcp.lock.json
//        [--client claude,vscode,cursor,gemini,codex|all] [--include id,id] [--exclude id,id] [--no-verify]
//        [--windows]  write `cmd /c npx` wrappers (native Windows clients); recorded in the lock
//   node scripts/ai/setup-mcp.mjs --verify     handshake-test every configured server
//   node scripts/ai/setup-mcp.mjs --update     re-resolve latest, verify, re-pin (keeps old pin on failure)
//   node scripts/ai/setup-mcp.mjs --check      offline drift/secret check for CI and pre-commit
//   node scripts/ai/setup-mcp.mjs --discover [term...]   search the official MCP Registry (never auto-adds)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig, projectFacts } from './lib.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const list = (f) => (val(f) || '').split(',').map((s) => s.trim()).filter(Boolean);

const cfg = loadConfig();
const facts = projectFacts();
const NPM = () => process.env.AI_NPM_REGISTRY || 'https://registry.npmjs.org';
const MCP_REGISTRY = () => process.env.AI_MCP_REGISTRY || 'https://registry.modelcontextprotocol.io';
const LOCK = '.ai/mcp.lock.json';
const EXACT = /^\d+\.\d+\.\d+$/;

const stdioEntry = (s) => ({ type: 'stdio', command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) });
const CLIENTS = {
  claude: { file: '.mcp.json', key: 'mcpServers', entry: stdioEntry },
  vscode: { file: '.vscode/mcp.json', key: 'servers', extra: { inputs: [] }, entry: stdioEntry },
  cursor: { file: '.cursor/mcp.json', key: 'mcpServers', entry: ({ command, args, env }) => ({ command, args, ...(env ? { env } : {}) }) },
  // Gemini CLI: project settings file, same mcpServers shape (angular.dev/ai/mcp documents .gemini/settings.json).
  gemini: { file: '.gemini/settings.json', key: 'mcpServers', entry: ({ command, args, env }) => ({ command, args, ...(env ? { env } : {}) }) },
  // Codex: TOML, [mcp_servers.<name>] tables. Project-scoped .codex/config.toml is read for trusted projects only.
  codex: {
    file: '.codex/config.toml', format: 'toml',
    entry: ({ command, args, env }) => ({ command, args, ...(env ? { env } : {}) }),
    note: 'Codex loads a project .codex/config.toml only for trusted projects, and the Codex Desktop app has been reported to ignore it (openai/codex#13025); use the CLI or IDE extension, or copy the block to ~/.codex/config.toml.',
  },
};

// ---------- Codex TOML: the kit owns one marked block; everything else in the file is yours ----------
const T_BEGIN = '# BEGIN ai-kit managed MCP servers (scripts/ai/setup-mcp.mjs); do not edit between the markers';
const T_END = '# END ai-kit managed MCP servers';
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function renderToml(servers) {
  const out = [];
  for (const [id, sv] of Object.entries(servers)) {
    out.push(`[mcp_servers.${tomlKey(id)}]`, `command = ${JSON.stringify(sv.command)}`, `args = ${JSON.stringify(sv.args)}`);
    if (sv.env) { out.push(`[mcp_servers.${tomlKey(id)}.env]`); for (const [k, v] of Object.entries(sv.env)) out.push(`${tomlKey(k)} = ${JSON.stringify(v)}`); }
    out.push('');
  }
  return out.join('\n');
}
function splitToml(text) {
  const a = text.indexOf('# BEGIN ai-kit managed MCP servers');
  const b = text.indexOf(T_END);
  if (a > -1 && b > a) return { before: text.slice(0, a), block: text.slice(a, b + T_END.length), after: text.slice(b + T_END.length) };
  return { before: text, block: null, after: '' };
}
/** Parses the servers inside our block (we wrote them with JSON-compatible strings/arrays). */
function parseTomlBlock(block) {
  const out = {};
  let cur = null, inEnv = false;
  for (const line of (block || '').split('\n')) {
    const h = line.match(/^\[mcp_servers\.("[^"]+"|[A-Za-z0-9_-]+)(\.env)?\]$/);
    if (h) { const id = h[1].replace(/^"|"$/g, ''); cur = out[id] = out[id] || {}; inEnv = Boolean(h[2]); continue; }
    const kv = line.match(/^("[^"]+"|[A-Za-z0-9_-]+) = (.+)$/);
    if (!kv || !cur) continue;
    try {
      const val = JSON.parse(kv[2]);
      if (inEnv) (cur.env = cur.env || {})[kv[1].replace(/^"|"$/g, '')] = val; else cur[kv[1]] = val;
    } catch { cur.__unparsable = true; }
  }
  return out;
}
function writeToml(def, servers) {
  const file = path.join(ROOT, def.file);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const { before, after } = splitToml(text);
  const outside = before + after;
  const conflicts = [];
  const mine = {};
  for (const [id, sv] of Object.entries(servers)) {
    const hdr = new RegExp(`^\\[mcp_servers\\.(?:${reEsc(tomlKey(id))}|"${reEsc(id)}")(?:\\]|\\.)`, 'm');
    if (hdr.test(outside)) conflicts.push(id); else mine[id] = sv; // managed servers live inside our block, so a match outside is yours
  }
  const body = Object.keys(mine).length ? `${T_BEGIN}\n${renderToml(mine)}${T_END}\n` : '';
  const base = outside.replace(/\n{3,}/g, '\n\n').trimEnd();
  const next = base ? (body ? `${base}\n\n${body}` : `${base}\n`) : body;
  if (!next) { if (fs.existsSync(file)) fs.rmSync(file); return conflicts; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return conflicts;
}

// ---------- helpers ----------
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };
const writeJson = (rel, obj) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + '\n');
};
const readLock = () => readJson(LOCK) || { generatedBy: 'scripts/ai/setup-mcp.mjs', servers: {} };
const ageDays = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null);
const cmpDesc = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
// Native Windows cannot spawn npx directly: it is a .cmd shim, so clients need `cmd /c npx ...`.
const wrapNpx = (s) => (s.command === 'npx' ? { ...s, command: 'cmd', args: ['/c', 'npx', ...s.args] } : s);
const winWrap = (s) => (process.platform === 'win32' ? wrapNpx(s) : s); // used when this script spawns servers itself
// --windows renders the wrapper into the client files (recorded in the lock so --check/--update stay consistent).
const forClient = (servers, win) => (win ? Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, wrapNpx(v)])) : servers);

function loadCatalog() {
  const base = readJson('.ai/mcp-catalog.json');
  if (!base) throw new Error('.ai/mcp-catalog.json not found or invalid.');
  const local = readJson('.ai/mcp-catalog.local.json');
  const byId = new Map(base.servers.map((e) => [e.id, e]));
  for (const e of (local && local.servers) || []) byId.set(e.id, e);
  return [...byId.values()];
}

const WEB = ['react', 'react-dom', 'next', '@angular/core', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', 'solid-js', 'vite', '@remix-run/react', '@playwright/test'];
function applicable(e) {
  const w = e.when || {};
  return Boolean(
    w.always ||
    (w.deps || []).some((d) => facts.deps[d]) ||
    (w.files || []).some(facts.exists) ||
    (w.py || []).some(facts.pyHas) ||
    (w.web && (WEB.some((d) => facts.deps[d]) || facts.exists('index.html') || facts.pyHas('django') || facts.pyHas('flask')))
  );
}

async function resolveLatest(pkg) {
  const res = await fetch(`${NPM()}/${pkg.replace('/', '%2F')}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${pkg}: registry responded ${res.status} (package missing or registry unreachable)`);
  const doc = await res.json();
  const time = doc.time || {};
  const cutoff = Date.now() - cfg.mcp.minAgeDays * 864e5;
  const stable = Object.keys(doc.versions || {}).filter((v) => EXACT.test(v) && !doc.versions[v].deprecated).sort(cmpDesc);
  const eligible = stable.filter((v) => !time[v] || Date.parse(time[v]) <= cutoff);
  const tagged = doc['dist-tags'] && doc['dist-tags'].latest;
  const pick = tagged && eligible.includes(tagged) ? tagged : eligible[0];
  if (!pick) throw new Error(`${pkg}: no stable, non-deprecated version older than ${cfg.mcp.minAgeDays} days`);
  return {
    version: pick,
    published: time[pick] || null,
    heldBack: stable[0] !== pick && stable[0] ? stable[0] : null,
    repository: (doc.repository && (doc.repository.url || doc.repository)) || null,
  };
}

async function resolveEntry(e) {
  if (e.source === 'command') return { source: 'command', command: e.command, args: e.args || [], version: null };
  if (e.source === 'local-cli') {
    const hasBin = (dir) => { const b = path.join(ROOT, dir, 'node_modules', '.bin', e.localBin); return fs.existsSync(b) || fs.existsSync(b + '.cmd'); };
    if (!hasBin('.')) {
      const inWs = facts.packages.map((f) => f.dir).find((d) => d !== '.' && hasBin(d));
      if (inWs) throw new Error(`${e.localBin} is only installed in ${inWs}, and MCP clients start servers from the repo root. Add an entry to .ai/mcp-catalog.local.json with "source": "command" (for example command "sh", args ["-c", "cd ${inWs} && npx ${e.localBin} ${(e.args || []).join(' ')}"]) and --include it`);
      throw new Error(`${e.localBin} is not installed locally; run your package manager's install first`);
    }
    let version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', e.cliPackage, 'package.json'), 'utf8')).version; } catch { /* optional */ }
    return { source: 'local-cli', package: e.cliPackage, version, command: 'npx', args: [e.localBin, ...(e.args || [])] };
  }
  if (e.source === 'npm') {
    const r = await resolveLatest(e.package);
    return { source: 'npm', package: e.package, version: r.version, published: r.published, heldBack: r.heldBack, repository: r.repository, command: 'npx', args: ['-y', `${e.package}@${r.version}`, ...(e.runArgs || [])] };
  }
  throw new Error(`unknown source "${e.source}" for ${e.id}`);
}

// Minimal environment for verification: enough to run node/npx, none of your tokens or cloud credentials.
const ENV_ALLOW = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
  'PROGRAMFILES', 'PROGRAMDATA', 'WINDIR', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', // Windows: Chrome and npm need these
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
const verifyEnv = () => ({ ...Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), CI: '1' });

// Real MCP stdio handshake (newline-delimited JSON-RPC): proves the server starts and speaks MCP.
function smoke(server, timeoutMs = Number(process.env.AI_MCP_VERIFY_TIMEOUT_MS) || 90000) {
  const s = winWrap(server);
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const child = spawn(s.command, s.args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: verifyEnv() });
    const finish = (ok, info) => { if (done) return; done = true; clearTimeout(timer); child.kill(); resolve({ ok, info, stderr: err.slice(-300).trim() }); };
    const timer = setTimeout(() => finish(false, 'timed out waiting for an initialize response'), timeoutMs);
    child.on('error', (e) => finish(false, `could not start: ${e.message}`));
    child.on('exit', (code) => finish(false, `exited before responding (code ${code})`));
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => {
      out += d;
      for (const line of out.split('\n')) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) return finish(true, `${(m.result.serverInfo || {}).name || 'server'} ${(m.result.serverInfo || {}).version || ''}`.trim());
        if (m.id === 1 && m.error) return finish(false, m.error.message);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-kit-verify', version: '1.0.0' } } }) + '\n');
  });
}

function writeClient(name, servers, prevIds) {
  const def = CLIENTS[name];
  if (!def) throw new Error(`unknown client "${name}" (use ${Object.keys(CLIENTS).join(', ')})`);
  if (def.format === 'toml') return writeToml(def, servers);
  let doc = {};
  if (fs.existsSync(path.join(ROOT, def.file))) {
    doc = readJson(def.file);
    if (!doc) throw new Error(`${def.file} exists but is not valid JSON; fix it first.`);
  }
  doc[def.key] = doc[def.key] || {};
  for (const id of prevIds) if (!(id in servers)) delete doc[def.key][id];
  const conflicts = [];
  for (const [id, s] of Object.entries(servers)) {
    if (doc[def.key][id] && !prevIds.includes(id)) { conflicts.push(id); continue; }
    doc[def.key][id] = def.entry(s);
  }
  for (const [k, v] of Object.entries(def.extra || {})) if (!(k in doc)) doc[k] = v;
  writeJson(def.file, doc);
  return conflicts;
}

const pickClients = () => {
  const v = val('--client');
  const names = v === 'all' ? Object.keys(CLIENTS) : v ? list('--client') : cfg.mcp.clients;
  return names;
};

const row = (mark, id, cat, text) => console.log(`  ${mark} ${id.padEnd(16)} ${cat.padEnd(16)} ${text}`);
const describe = (r) => r.source === 'npm'
  ? `${r.package}@${r.version} (published ${r.published ? r.published.slice(0, 10) : '?'}, ${ageDays(r.published) ?? '?'}d ago)${r.heldBack ? ` [newer ${r.heldBack} held back by ${cfg.mcp.minAgeDays}-day minimum age]` : ''}`
  : r.source === 'local-cli' ? `project's own ${r.package || r.args[0]}${r.version ? ' ' + r.version : ''}` : `${r.command} ${r.args.join(' ')}`;

// ---------- modes ----------
async function planOrApply() {
  const apply = has('--apply');
  const catalog = loadCatalog();
  const include = list('--include');
  const exclude = list('--exclude');
  const lock = readLock();
  const prevIds = Object.keys(lock.servers);
  const rows = [];

  for (const e of catalog) {
    const app = applicable(e);
    const locked = lock.servers[e.id];
    const wanted = !exclude.includes(e.id) && (Boolean(locked) || include.includes(e.id) || (app && e.defaultOn));
    const r = { e, app, wanted };
    try {
      if (wanted) r.resolved = locked ? { ...locked, fromLock: true } : await resolveEntry(e);
    } catch (err) { r.error = err.message; }
    rows.push(r);
  }

  const detected = Object.keys(facts.deps).length ? `${Object.keys(facts.deps).length} JS deps` : 'no package.json deps';
  console.log(`MCP plan for ${path.basename(ROOT)} (${detected}${facts.pyHas('django') || facts.pyHas('fastapi') || facts.pyHas('flask') ? ', Python web' : ''})`);
  console.log(`Registry: ${NPM()} | minimum release age: ${cfg.mcp.minAgeDays}d | clients: ${pickClients().join(', ')}\n`);

  console.log('Will configure:');
  const sel = rows.filter((r) => r.wanted);
  if (!sel.length) console.log('  (nothing applicable)');
  for (const r of sel) {
    if (r.error) row('!', r.e.id, r.e.category, `ERROR ${r.error}`);
    else row(r.resolved.fromLock ? '=' : '+', r.e.id, r.e.category, r.resolved.fromLock ? `locked: ${describe(r.resolved)}` : describe(r.resolved));
    if (!r.error && r.e.notes) for (const n of r.e.notes) console.log(`        - ${n}`);
  }
  const optional = rows.filter((r) => !r.wanted && r.app);
  if (optional.length) {
    console.log('\nApplicable but opt-in (add with --include <id>):');
    for (const r of optional) row('-', r.e.id, r.e.category, r.e.why);
  }
  const na = rows.filter((r) => !r.app && !r.wanted).map((r) => r.e.id);
  if (na.length) console.log(`\nNot applicable here: ${na.join(', ')}`);

  if (!apply) {
    console.log('\nNothing was changed. Re-run with --apply to verify and write the configs (--discover lists more servers for your dependencies).');
    return;
  }

  const fresh = {};
  let failed = 0;
  for (const r of sel) {
    if (r.error) { failed++; continue; }
    const s = r.resolved;
    const server = { source: s.source, package: s.package, version: s.version, published: s.published, command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) };
    if (!has('--no-verify') && !s.fromLock) {
      process.stdout.write(`verifying ${r.e.id} ... `);
      const v = await smoke(server);
      console.log(v.ok ? `ok (${v.info})` : `FAILED: ${v.info}${v.stderr ? `\n    ${v.stderr.split('\n').slice(-2).join('\n    ')}` : ''}`);
      if (!v.ok) { failed++; continue; }
    }
    fresh[r.e.id] = server;
  }
  for (const id of exclude) delete fresh[id];
  const servers = { ...Object.fromEntries(Object.entries(lock.servers).filter(([id]) => !exclude.includes(id))), ...fresh };
  if (!Object.keys(servers).length && !prevIds.length) { console.log('\nNo server passed verification; nothing written.'); process.exitCode = failed ? 1 : 0; return; }

  const clients = pickClients();
  const win = has('--windows') || lock.windows === true;
  const conflictSets = [];
  for (const c of clients) {
    const conflicts = writeClient(c, forClient(servers, win), prevIds);
    conflictSets.push(new Set(conflicts));
    console.log(`wrote ${CLIENTS[c].file}${conflicts.length ? ` (skipped, already defined by you: ${conflicts.join(', ')})` : ''}`);
    if (CLIENTS[c].note) console.log(`  note: ${CLIENTS[c].note}`);
  }
  // A server you defined yourself in every client is not ours to manage: keep it out of the lock.
  for (const id of Object.keys(servers)) if (conflictSets.every((set) => set.has(id))) delete servers[id];
  writeJson(LOCK, { generatedBy: 'scripts/ai/setup-mcp.mjs', registry: NPM(), clients, ...(win ? { windows: true } : {}), servers });
  console.log(`wrote ${LOCK}${failed ? `\n${failed} server(s) failed and were not configured.` : ''}`);
  console.log('Commit the config files and the lock. Claude Code asks each developer to approve project-scoped servers on first use.');
  if (failed) process.exitCode = 1;
}

async function verifyAll() {
  const lock = readLock();
  const ids = Object.keys(lock.servers);
  if (!ids.length) { console.log('No MCP servers configured (run setup-mcp.mjs --apply).'); return; }
  let bad = 0;
  for (const id of ids) {
    process.stdout.write(`verifying ${id} ... `);
    const v = await smoke(lock.servers[id]);
    console.log(v.ok ? `ok (${v.info})` : `FAILED: ${v.info}`);
    if (!v.ok) bad++;
  }
  process.exitCode = bad ? 1 : 0;
}

async function update() {
  const lock = readLock();
  const catalog = new Map(loadCatalog().map((e) => [e.id, e]));
  const servers = { ...lock.servers };
  let changed = 0;
  for (const [id, cur] of Object.entries(lock.servers)) {
    const e = catalog.get(id);
    if (!e || e.source !== 'npm') continue;
    let next;
    try { next = await resolveEntry(e); } catch (err) { console.log(`! ${id}: ${err.message}`); continue; }
    if (next.version === cur.version) { console.log(`= ${id} ${cur.version} (latest eligible)`); continue; }
    const cand = { source: next.source, package: next.package, version: next.version, published: next.published, command: next.command, args: next.args };
    process.stdout.write(`~ ${id} ${cur.version} -> ${next.version}: verifying ... `);
    const v = await smoke(cand);
    console.log(v.ok ? `ok (${v.info})` : `FAILED (${v.info}); keeping ${cur.version}`);
    if (v.ok) { servers[id] = cand; changed++; }
  }
  if (!changed) { console.log('Nothing to update.'); return; }
  const clients = lock.clients || cfg.mcp.clients;
  for (const c of clients) writeClient(c, forClient(servers, lock.windows === true), Object.keys(lock.servers));
  writeJson(LOCK, { ...lock, registry: NPM(), servers });
  console.log(`Updated ${changed} server pin(s). Review the diff and commit.`);
}

function checkToml(name, def, lock, errors, warns, secretKey) {
  const file = path.join(ROOT, def.file);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  let table = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^\[([^\]]+)\]/);
    if (h) { table = h[1]; continue; }
    const kv = line.match(/^("[^"]+"|[A-Za-z0-9_-]+)\s*=\s*"(.*)"\s*$/);
    if (table && /^mcp_servers\..+\.env$/.test(table) && kv && secretKey.test(kv[1]) && kv[2]) errors.push(`${def.file}: [${table}] has an inline secret in ${kv[1]}; forward it with env_vars = ["${kv[1].replace(/"/g, '')}"] instead`);
  }
  const { before, block, after } = splitToml(text);
  if ((before + after).match(/@latest\b/)) warns.push(`${def.file}: a server you defined uses @latest; pin an exact version`);
  if (!lock) return;
  const entries = parseTomlBlock(block);
  for (const [id, managed] of Object.entries(lock.servers)) {
    if (!(lock.clients || []).includes(name)) continue;
    if (!(id in entries)) { errors.push(`${def.file}: managed server "${id}" is missing`); continue; }
    if (JSON.stringify(def.entry(lock.windows === true ? wrapNpx(managed) : managed)) !== JSON.stringify(entries[id])) errors.push(`${def.file}: "${id}" differs from ${LOCK}; re-run setup-mcp.mjs --apply or revert the manual edit`);
  }
}

function check() {
  const lock = readJson(LOCK);
  const errors = [], warns = [];
  const secretKey = /(key|token|secret|passw)/i;
  for (const [name, def] of Object.entries(CLIENTS)) {
    if (def.format === 'toml') { checkToml(name, def, lock, errors, warns, secretKey); continue; }
    const doc = readJson(def.file);
    if (!doc) continue;
    const entries = doc[def.key] || {};
    for (const [id, s] of Object.entries(entries)) {
      for (const [k, v] of Object.entries(s.env || {})) {
        if (secretKey.test(k) && typeof v === 'string' && !v.startsWith('${')) errors.push(`${def.file}: "${id}" has an inline secret in env.${k}; use \${${k}} expansion`);
      }
      for (const [k, v] of Object.entries(s.headers || {})) {
        if (/authorization|key|token/i.test(k) && typeof v === 'string' && !/\$\{/.test(v)) errors.push(`${def.file}: "${id}" has an inline credential in headers.${k}`);
      }
      const a = (s.args || []).join(' ');
      const managed = lock && lock.servers && lock.servers[id];
      if (!managed && /@latest\b/.test(a)) warns.push(`${def.file}: "${id}" (yours) uses @latest; pin an exact version`);
      if (managed) {
        const want = def.entry(lock.windows === true ? wrapNpx(managed) : managed);
        if (JSON.stringify(want) !== JSON.stringify(entries[id])) errors.push(`${def.file}: "${id}" differs from ${LOCK}; re-run setup-mcp.mjs --apply or revert the manual edit`);
      }
    }
    if (lock) for (const id of Object.keys(lock.servers)) if ((lock.clients || []).includes(name) && !(id in entries)) errors.push(`${def.file}: managed server "${id}" is missing`);
  }
  if (lock) for (const [id, s] of Object.entries(lock.servers)) {
    if (s.source === 'npm' && !(s.args || []).some((x) => /@\d+\.\d+\.\d+$/.test(x))) errors.push(`${LOCK}: "${id}" is not pinned to an exact version`);
  }
  warns.forEach((w) => console.log(`\x1b[0;33m[WARN] ${w}\x1b[0m`));
  if (errors.length) { errors.forEach((x) => console.error(`\x1b[0;31m[ERROR] ${x}\x1b[0m`)); process.exit(1); }
  console.log(lock ? '\x1b[0;32m[OK] MCP configs match the lock, are pinned, and contain no inline secrets.\x1b[0m' : '[SKIP] No MCP lock yet (run: node scripts/ai/setup-mcp.mjs).');
}

async function discover() {
  const terms = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--client');
  const catalog = loadCatalog();
  const covered = new Set(catalog.flatMap((e) => [e.package, e.cliPackage, ...((e.when && e.when.deps) || [])]).filter(Boolean));
  const names = terms.length ? terms : Object.keys(facts.deps).filter((d) => !d.startsWith('@types/') && !covered.has(d)).sort().slice(0, 25);
  if (!names.length) { console.log('No dependencies to look up.'); return; }
  console.log(`Official MCP Registry candidates (${MCP_REGISTRY()}). UNVETTED third-party code: nothing is added automatically.\n`);
  for (const n of names) {
    let json;
    try {
      const res = await fetch(`${MCP_REGISTRY()}/v0.1/servers?search=${encodeURIComponent(n.replace(/^@[^/]+\//, ''))}&limit=10`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { console.log(`${n}: registry responded ${res.status}`); continue; }
      json = await res.json();
    } catch (err) { console.log(`${n}: lookup failed (${err.message})`); continue; }
    const token = n.replace(/^@[^/]+\//, '').toLowerCase();
    const hits = (json.servers || [])
      .map((e) => ({ s: e.server || e, m: (e._meta && e._meta['io.modelcontextprotocol.registry/official']) || {} }))
      .filter(({ s, m }) => m.status !== 'deleted' && m.isLatest !== false && `${s.name} ${s.description || ''}`.toLowerCase().includes(token))
      .slice(0, 3);
    if (!hits.length) continue;
    console.log(`${n}:`);
    for (const { s } of hits) {
      const pk = (s.packages || []).map((p) => `${p.registryType}:${p.identifier}@${p.version || '?'}`).join(', ');
      const rm = (s.remotes || []).map((r) => r.url).join(', ');
      console.log(`  - ${s.name} v${s.version || '?'}  ${(s.description || '').slice(0, 90)}`);
      if (pk) console.log(`      package: ${pk}`);
      if (rm) console.log(`      remote:  ${rm}`);
      if (s.repository && s.repository.url) console.log(`      repo:    ${s.repository.url}`);
    }
  }
  console.log('\nTo adopt one: review its source, add an entry to .ai/mcp-catalog.local.json, then run --apply (which pins and verifies it).');
}

(async () => {
  if (has('--check')) return check();
  if (has('--discover')) return discover();
  if (has('--verify')) return verifyAll();
  if (has('--update')) return update();
  return planOrApply();
})().catch((e) => { console.error(`[ERROR] ${e.message}`); process.exit(1); });
