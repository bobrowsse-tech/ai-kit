// LIVE smoke test: needs network, the real npm registry, real npx downloads, and the real MCP Registry.
// It is NOT part of `npm test` (hermetic). Run: npm run test:live   (CI: the scheduled "live-smoke" job)
// Proves the things the hermetic suite cannot: every catalog package exists and has a bin, versions resolve,
// each default server really starts and answers an MCP initialize handshake, and the registry API shape still matches.
import fs from 'node:fs';
import path from 'node:path';
import { KIT, ai, install, put, read, tmp } from './helpers.mjs';

const results = [];
const check = async (name, fn) => {
  try { const note = await fn(); results.push({ name, ok: true, note }); console.log(`ok   ${name}${note ? ` - ${note}` : ''}`); }
  catch (e) { results.push({ name, ok: false, note: e.message }); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`); }
};
const warn = (m) => console.log(`warn ${m}`);
const live = { AI_NPM_REGISTRY: 'https://registry.npmjs.org', AI_MCP_REGISTRY: 'https://registry.modelcontextprotocol.io', AI_MCP_VERIFY_TIMEOUT_MS: '180000' };
const catalog = JSON.parse(fs.readFileSync(path.join(KIT, 'template/.ai/mcp-catalog.json'), 'utf8')).servers;

const d = tmp('aikit-live-');
put(d, { 'package.json': { name: 'live', dependencies: { next: '15.0.0', react: '19.0.0' }, devDependencies: { '@playwright/test': '1.50.0' } } });
install(d);

await check('every npm catalog entry exists on the registry and ships a bin', async () => {
  const bad = [];
  for (const e of catalog.filter((x) => x.source === 'npm')) {
    const r = await fetch(`https://registry.npmjs.org/${e.package.replace('/', '%2F')}/latest`);
    if (!r.ok) { bad.push(`${e.package}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    if (!j.bin) bad.push(`${e.package}@${j.version}: no "bin" field (npx would not run it)`);
  }
  if (bad.length) throw new Error(bad.join('\n'));
  return `${catalog.filter((x) => x.source === 'npm').length} packages`;
});

await check('plan resolves exact, stable versions for the default servers', () => {
  const r = ai(d, 'setup-mcp.mjs', [], live);
  if (r.code !== 0) throw new Error(r.all);
  const need = ['nextjs-devtools', 'context7', 'playwright'];
  const miss = need.filter((id) => !new RegExp(`\\+ ${id}\\s+\\S+\\s+\\S+@\\d+\\.\\d+\\.\\d+`).test(r.out.replace(/\n\s+-.*/g, '')));
  if (miss.length || /ERROR/.test(r.out)) throw new Error(`not resolved: ${miss.join(', ')}\n${r.out}`);
});

await check('apply: real servers start and answer the MCP handshake', () => {
  const r = ai(d, 'setup-mcp.mjs', ['--apply', '--include', 'chrome-devtools'], live);
  if (r.code !== 0) throw new Error(r.all);
  const lock = JSON.parse(read(d, '.ai/mcp.lock.json')).servers;
  return Object.entries(lock).map(([id, s]) => `${id}@${s.version}`).join(', ');
});

await check('--check passes on the generated configs', () => { const r = ai(d, 'setup-mcp.mjs', ['--check'], live); if (r.code !== 0) throw new Error(r.all); });
await check('--verify re-tests every locked server', () => { const r = ai(d, 'setup-mcp.mjs', ['--verify'], live); if (r.code !== 0) throw new Error(r.all); });
await check('--update runs cleanly', () => { const r = ai(d, 'setup-mcp.mjs', ['--update'], live); if (r.code !== 0) throw new Error(r.all); });

await check('MCP Registry API still has the shape --discover expects', async () => {
  const r = await fetch('https://registry.modelcontextprotocol.io/v0.1/servers?search=playwright&limit=3');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.servers) || !j.servers.length) throw new Error('no "servers" array in the response');
  const s = j.servers[0].server || j.servers[0];
  if (!s.name) throw new Error('entries have no server.name');
  const out = ai(d, 'setup-mcp.mjs', ['--discover', 'playwright'], live);
  if (out.code !== 0) throw new Error(out.all);
});

for (const e of catalog) {
  if (!e.docs) continue;
  try { const r = await fetch(e.docs, { redirect: 'follow' }); if (!r.ok) warn(`docs link for ${e.id} returned HTTP ${r.status}: ${e.docs}`); } catch (err) { warn(`docs link for ${e.id} unreachable: ${err.message}`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);
