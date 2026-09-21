import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const posix = process.platform !== 'win32';
const NO_NET = { AI_NPM_REGISTRY: 'http://127.0.0.1:1', AI_MCP_REGISTRY: 'http://127.0.0.1:1' };

export const tmp = (prefix = 'aikit-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Write { 'rel/path': string | object } into dir. */
export function put(dir, map) {
  for (const [rel, content] of Object.entries(map)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  return dir;
}
export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
export const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

/** Run a node script with cwd=dir. Network is disabled by default so tests are hermetic. */
export function node(dir, script, args = [], env = {}, input) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', input, env: { ...process.env, ...NO_NET, ...env } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}
/** Run scripts/ai/<name> inside an installed project. */
export const ai = (dir, name, args = [], env = {}, input) => node(dir, path.join(dir, 'scripts/ai', name), args, env, input);
export const sh = (dir, cmd, env = {}) => { const r = spawnSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr }; };

/** Install the kit (from KIT or a modified copy) into dir without post steps. */
export const install = (dir, args = [], kit = KIT, env = {}) => node(dir, path.join(kit, 'install.mjs'), [dir, '--no-post', ...args], env);

/** Create a project from files, install the kit, return dir. */
export function project(map = {}, { git = false } = {}) {
  const d = tmp();
  if (git) sh(d, 'git init -q');
  put(d, map);
  const r = install(d);
  if (r.code !== 0) throw new Error(`install failed: ${r.all}`);
  return d;
}

/** Copy of the kit in a temp dir, so tests can simulate "a new kit version". */
export function kitCopy() {
  const d = tmp('aikit-copy-');
  fs.cpSync(KIT, d, { recursive: true, filter: (s) => !s.includes(`${path.sep}node_modules`) });
  return d;
}

/** Starts tests/registry-server.mjs in its own process. bump() publishes a newer @playwright/mcp. */
export async function registry() {
  const child = spawn(process.execPath, [path.join(KIT, 'tests/registry-server.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    child.once('error', reject);
    child.once('exit', () => reject(new Error('registry stub exited')));
  });
  const url = `http://127.0.0.1:${port}`;
  return { url, env: { AI_NPM_REGISTRY: url, AI_MCP_REGISTRY: url }, bump: () => fetch(`${url}/__bump`).then((r) => r.text()), close: () => { child.kill(); } };
}

/** A fake `npx` that speaks just enough MCP for the initialize handshake (POSIX only). mode: 'ok' | 'fail'.
 *  The mode is baked into the script because setup-mcp passes children a minimal environment. */
export function fakeNpx(mode = 'ok') {
  const bin = tmp('aikit-bin-');
  fs.writeFileSync(path.join(bin, 'server.mjs'), `
import readline from 'node:readline';
if (process.argv[2] === 'fail') process.exit(1);
const leaked = Object.keys(process.env).filter((k) => /SECRET|TOKEN|PASSWORD/i.test(k));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (l) => { const m = JSON.parse(l); if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: leaked.length ? 'LEAKED:' + leaked.join(',') : 'clean' } } })); });
`);
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'server.mjs')}" ${mode}\n`, { mode: 0o755 });
  return { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` }, server: path.join(bin, 'server.mjs') };
}
