import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ai, exists, fakeNpx, posix, project, put, read, registry } from './helpers.mjs';

const WEB = { 'package.json': { name: 'web', dependencies: { next: '15.0.0', react: '19.0.0' } } };
const json = (d, rel) => JSON.parse(read(d, rel));
let reg, npx, npxFail;
before(async () => { reg = await registry(); npx = posix ? fakeNpx() : null; npxFail = posix ? fakeNpx('fail') : null; });
after(() => { reg.close(); });
const mcp = (d, args = [], env = {}) => ai(d, 'setup-mcp.mjs', args, { ...reg.env, AI_MCP_VERIFY_TIMEOUT_MS: '8000', ...(npx ? npx.env : {}), ...env });

describe('setup-mcp plan (dry run)', () => {
  it('resolves stable, old-enough, non-deprecated versions and writes nothing', async () => {
    const d = project(WEB);
    const r = mcp(d);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /next-devtools-mcp@0\.4\.0/);
    assert.match(r.out, /newer 0\.4\.1 held back by 3-day minimum age/);
    assert.doesNotMatch(r.out, /0\.5\.0-rc/);
    assert.match(r.out, /@playwright\/mcp@0\.0\.32/);
    assert.match(r.out, /@upstash\/context7-mcp@1\.1\.0/);
    assert.match(r.out, /opt-in[\s\S]*chrome-devtools/);
    assert.match(r.out, /Not applicable here: angular-cli, prisma-cli/);
    assert.ok(!exists(d, '.mcp.json') && !exists(d, '.ai/mcp.lock.json'));
  });
});

describe('setup-mcp apply', { skip: !posix }, () => {
  it('verifies with a real handshake, pins exactly, and writes all client formats', () => {
    const d = project(WEB);
    const r = mcp(d, ['--apply', '--client', 'all']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /verifying playwright \.\.\. ok \(fake clean\)/);
    const claude = json(d, '.mcp.json').mcpServers;
    assert.deepEqual(claude.playwright, { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.32', '--isolated'] });
    const vs = json(d, '.vscode/mcp.json');
    assert.equal(vs.servers.context7.type, 'stdio');
    assert.deepEqual(vs.inputs, []);
    assert.equal(json(d, '.cursor/mcp.json').mcpServers.context7.type, undefined);
    const lock = json(d, '.ai/mcp.lock.json');
    for (const s of Object.values(lock.servers)) assert.ok(s.args.some((a) => /@\d+\.\d+\.\d+$/.test(a)), 'exact pin');
    assert.ok(!/@latest/.test(read(d, '.mcp.json')));
    assert.equal(mcp(d, ['--check']).code, 0);
  });
  it('refuses to write a server that fails verification', () => {
    const d = project(WEB);
    const r = mcp(d, ['--apply'], npxFail.env);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAILED/);
    assert.ok(!exists(d, '.mcp.json'));
  });
  it('does not hand the developer environment to third-party code', () => {
    const d = project(WEB);
    const r = mcp(d, ['--apply'], { MY_SECRET_TOKEN: 'shh', AWS_SECRET_ACCESS_KEY: 'shh' });
    assert.match(r.out, /ok \(fake clean\)/);
    assert.doesNotMatch(r.all, /LEAKED/);
  });
  it('never overwrites a server you defined, and keeps it out of the lock', () => {
    const d = project(WEB);
    put(d, { '.mcp.json': { mcpServers: { context7: { type: 'stdio', command: 'mine', args: [] } } } });
    const r = mcp(d, ['--apply']);
    assert.match(r.out, /already defined by you: context7/);
    assert.equal(json(d, '.mcp.json').mcpServers.context7.command, 'mine');
    assert.ok(!('context7' in json(d, '.ai/mcp.lock.json').servers));
    assert.equal(mcp(d, ['--check']).code, 0);
  });
  it('--include adds opt-in servers; --exclude removes managed ones', () => {
    const d = project(WEB);
    mcp(d, ['--apply', '--include', 'chrome-devtools']);
    assert.ok(json(d, '.mcp.json').mcpServers['chrome-devtools'].args.includes('--no-usage-statistics'));
    mcp(d, ['--apply', '--exclude', 'chrome-devtools']);
    assert.ok(!('chrome-devtools' in json(d, '.mcp.json').mcpServers));
  });
  it('local catalog: private "command" servers are verified too', () => {
    const d = project(WEB);
    put(d, { '.ai/mcp-catalog.local.json': { servers: [{ id: 'internal', category: 'docs', why: 'x', when: { always: true }, source: 'command', command: process.execPath, args: [npx.server], defaultOn: true }, { id: 'broken', category: 'docs', why: 'x', when: { always: true }, source: 'command', command: process.execPath, args: ['-e', 'process.exit(2)'], defaultOn: true }] } });
    const r = mcp(d, ['--apply', '--exclude', 'nextjs-devtools,context7,playwright']);
    assert.match(r.out, /verifying internal \.\.\. ok/);
    assert.match(r.out, /verifying broken \.\.\. FAILED/);
    const servers = json(d, '.mcp.json').mcpServers;
    assert.ok(servers.internal && !servers.broken);
  });
});

describe('setup-mcp --windows', { skip: !posix }, () => {
  it('renders cmd /c npx wrappers, records it in the lock, and keeps --check/--update consistent', () => {
    const d = project(WEB);
    const r = mcp(d, ['--apply', '--windows', '--client', 'claude,codex']);
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(json(d, '.mcp.json').mcpServers.playwright, { type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@0.0.32', '--isolated'] });
    assert.match(read(d, '.codex/config.toml'), /command = "cmd"\nargs = \["\/c","npx","-y","@playwright\/mcp@0\.0\.32","--isolated"\]/);
    assert.equal(json(d, '.ai/mcp.lock.json').windows, true);
    assert.equal(json(d, '.ai/mcp.lock.json').servers.playwright.command, 'npx', 'lock stays portable');
    assert.equal(mcp(d, ['--check']).code, 0);
    mcp(d, ['--apply']);
    assert.equal(json(d, '.mcp.json').mcpServers.playwright.command, 'cmd', 'the choice sticks');
  });
  it('is off by default (committed files stay portable)', () => {
    const d = project(WEB);
    mcp(d, ['--apply']);
    assert.equal(json(d, '.mcp.json').mcpServers.playwright.command, 'npx');
  });
});

describe('setup-mcp: Gemini and Codex clients', { skip: !posix }, () => {
  it('writes .gemini/settings.json (JSON, keeps your other keys) and a managed block in .codex/config.toml (keeps your TOML)', () => {
    const d = project(WEB);
    put(d, { '.gemini/settings.json': { theme: 'dark', mcpServers: { mine: { command: 'x', args: [] } } }, '.codex/config.toml': 'model = "gpt-5"\n\n[mcp_servers.mine]\ncommand = "y"\n' });
    const r = mcp(d, ['--apply', '--client', 'gemini,codex']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Codex loads a project \.codex\/config\.toml only for trusted projects/);
    const g = json(d, '.gemini/settings.json');
    assert.equal(g.theme, 'dark');
    assert.ok(g.mcpServers.mine);
    assert.deepEqual(g.mcpServers.playwright, { command: 'npx', args: ['-y', '@playwright/mcp@0.0.32', '--isolated'] });
    const t = read(d, '.codex/config.toml');
    assert.match(t, /^model = "gpt-5"/);
    assert.match(t, /\[mcp_servers\.mine\]\ncommand = "y"/);
    assert.match(t, /# BEGIN ai-kit managed MCP servers[\s\S]*\[mcp_servers\.playwright\]\ncommand = "npx"\nargs = \["-y","@playwright\/mcp@0\.0\.32","--isolated"\][\s\S]*# END ai-kit managed MCP servers/);
    assert.equal(mcp(d, ['--check']).code, 0, mcp(d, ['--check']).all);
    // idempotent: a second apply does not duplicate the block
    mcp(d, ['--apply', '--client', 'gemini,codex']);
    assert.equal(read(d, '.codex/config.toml').split('# BEGIN ai-kit').length, 2);
  });
  it('never overwrites a Codex server you defined, and detects drift and inline secrets', () => {
    const d = project(WEB);
    put(d, { '.codex/config.toml': '[mcp_servers.context7]\ncommand = "mine"\n\n[mcp_servers.other.env]\nAPI_TOKEN = "abc123"\n' });
    const r = mcp(d, ['--apply', '--client', 'codex']);
    assert.match(r.out, /already defined by you: context7/);
    assert.match(read(d, '.codex/config.toml'), /\[mcp_servers\.context7\]\ncommand = "mine"/);
    assert.doesNotMatch(read(d, '.codex/config.toml').split('# BEGIN')[1], /context7/);
    let c = mcp(d, ['--check']);
    assert.equal(c.code, 1);
    assert.match(c.err, /inline secret in API_TOKEN; forward it with env_vars/);
    put(d, { '.codex/config.toml': read(d, '.codex/config.toml').replace('API_TOKEN = "abc123"', 'API_TOKEN = "abc123"').replace('[mcp_servers.other.env]\nAPI_TOKEN = "abc123"\n', '').replace('@playwright/mcp@0.0.32', '@playwright/mcp@latest') });
    c = mcp(d, ['--check']);
    assert.match(c.err, /"playwright" differs from \.ai\/mcp\.lock\.json/);
  });
  it('--exclude removes the server from TOML and deletes the block when nothing is left', () => {
    const d = project(WEB);
    mcp(d, ['--apply', '--client', 'codex']);
    mcp(d, ['--apply', '--client', 'codex', '--exclude', 'nextjs-devtools,context7,playwright']);
    assert.ok(!exists(d, '.codex/config.toml'), 'file the kit created is removed when it manages nothing');
  });
  it('--update rewrites the TOML pins', async () => {
    const r2 = await registry();
    const d = project(WEB);
    mcp(d, ['--apply', '--client', 'codex'], r2.env);
    await r2.bump();
    mcp(d, ['--update'], r2.env);
    r2.close();
    assert.match(read(d, '.codex/config.toml'), /@playwright\/mcp@0\.0\.40/);
    assert.equal(mcp(d, ['--check']).code, 0);
  });
});

describe('setup-mcp update / check / verify', { skip: !posix }, () => {
  it('--update adopts a newer verified version and keeps the old pin when verification fails', async () => {
    const r2 = await registry();
    const d = project(WEB);
    mcp(d, ['--apply'], r2.env);
    await r2.bump();
    let r = mcp(d, ['--update'], { ...r2.env, ...npxFail.env });
    assert.match(r.out, /keeping 0\.0\.32/);
    assert.match(read(d, '.mcp.json'), /@playwright\/mcp@0\.0\.32/);
    r = mcp(d, ['--update'], r2.env);
    r2.close();
    assert.match(r.out, /0\.0\.32 -> 0\.0\.40: verifying \.\.\. ok/);
    assert.match(read(d, '.mcp.json'), /@playwright\/mcp@0\.0\.40/);
    assert.equal(mcp(d, ['--check']).code, 0);
  });
  it('--check catches drift, inline secrets, and warns on @latest', () => {
    const d = project(WEB);
    mcp(d, ['--apply']);
    const c = json(d, '.mcp.json');
    c.mcpServers.playwright.args[1] = '@playwright/mcp@latest';
    c.mcpServers.mine = { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp@latest'], env: { API_TOKEN: 'abc123' } };
    put(d, { '.mcp.json': c });
    const r = mcp(d, ['--check']);
    assert.equal(r.code, 1);
    assert.match(r.err, /"playwright" differs from \.ai\/mcp\.lock\.json/);
    assert.match(r.err, /inline secret in env\.API_TOKEN/);
    assert.match(r.out, /"mine" \(yours\) uses @latest/);
  });
  it('--check accepts ${VAR} expansion for secrets and skips when nothing is configured', () => {
    const d = project(WEB);
    assert.match(mcp(d, ['--check']).out, /SKIP/);
    put(d, { '.mcp.json': { mcpServers: { x: { type: 'stdio', command: 'x', args: [], env: { API_TOKEN: '${API_TOKEN}' } } } } });
    assert.equal(mcp(d, ['--check']).code, 0);
  });
  it('--verify tests every locked server', () => {
    const d = project(WEB);
    mcp(d, ['--apply']);
    assert.equal(mcp(d, ['--verify']).code, 0);
    assert.equal(mcp(d, ['--verify'], npxFail.env).code, 1);
  });
});

describe('setup-mcp discover + local-cli + monorepo', () => {
  it('--discover lists unvetted registry candidates and filters unrelated ones', () => {
    const d = project(WEB);
    const r = mcp(d, ['--discover', 'zod']);
    assert.match(r.out, /UNVETTED/);
    assert.match(r.out, /zod-helper-mcp/);
    assert.match(r.out, /npm:@example\/zod-mcp@1\.2\.0/);
    assert.doesNotMatch(r.out, /unrelated/);
  });
  it('local-cli servers (Angular) run the project CLI with no network', () => {
    const d = project({ 'package.json': { name: 'ng', dependencies: { '@angular/core': '20.1.0' }, devDependencies: { '@angular/cli': '20.1.4' } }, 'angular.json': '{}', 'node_modules/.bin/ng': '', 'node_modules/@angular/cli/package.json': { name: '@angular/cli', version: '20.1.4' } });
    const r = mcp(d, ['--apply', '--no-verify', '--exclude', 'nextjs-devtools,context7,playwright'], { AI_NPM_REGISTRY: 'http://127.0.0.1:1' });
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(json(d, '.mcp.json').mcpServers['angular-cli'].args, ['ng', 'mcp', '--read-only']);
    assert.equal(json(d, '.ai/mcp.lock.json').servers['angular-cli'].version, '20.1.4');
  });
  it('monorepo: applicability uses every workspace; a workspace-only CLI gets guidance instead of a broken config', () => {
    const d = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] },
      'apps/admin/package.json': { name: 'admin', dependencies: { '@angular/core': '20.1.0' }, devDependencies: { '@angular/cli': '20.1.4' } },
      'apps/admin/angular.json': '{}', 'apps/admin/node_modules/.bin/ng': '',
    });
    const r = mcp(d, ['--exclude', 'nextjs-devtools,context7,playwright'], { AI_NPM_REGISTRY: 'http://127.0.0.1:1' });
    assert.match(r.out, /angular-cli/);
    assert.match(r.out, /only installed in apps\/admin/);
    assert.match(r.out, /mcp-catalog\.local\.json/);
  });
});
