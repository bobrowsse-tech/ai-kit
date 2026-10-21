// Phase 2 compatibility baseline: CLI exit codes, install tree, and npm pack file list.
// Regenerate trees with: UPDATE_GOLDEN=1 npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KIT, REPO, install, put, tmp } from './helpers.mjs';

const FIX = path.join(REPO, 'tests/fixtures');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const walk = (dir, rel = '') => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), child));
    else out.push(child);
  }
  return out.sort();
};

const shaFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const readLines = (name) => fs.readFileSync(path.join(FIX, name), 'utf8').trimEnd().split('\n').filter(Boolean);
const writeLines = (name, lines) => {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(path.join(FIX, name), `${lines.join('\n')}\n`);
};

const cli = (args, cwd = KIT) => {
  const r = spawnSync(process.execPath, [path.join(KIT, 'bin/ai-kit.js'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, AI_NPM_REGISTRY: 'http://127.0.0.1:1', AI_MCP_REGISTRY: 'http://127.0.0.1:1' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
};

describe('CLI golden: help and errors', () => {
  it('help exits 0 and prints usage', () => {
    for (const flag of ['help', '-h', '--help']) {
      const r = cli([flag]);
      assert.equal(r.code, 0, r.all);
      assert.match(r.out, /ai-kit install/);
      assert.match(r.out, /ai-kit update/);
    }
  });
  it('update without a recorded install exits 1', () => {
    const d = tmp();
    const r = cli(['update', d]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.all, /No \.ai\/kit\.json/);
  });
  it('install --dry-run exits 0 and writes nothing', () => {
    const d = tmp();
    const r = cli(['install', d, '--dry-run']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /\[dry run\]/);
    assert.deepEqual(fs.readdirSync(d), []);
  });
});

describe('CLI golden: install tree and content hashes', () => {
  it('fresh install --no-post matches committed tree + content digests', () => {
    const d = tmp();
    put(d, { 'package.json': { name: 'golden', dependencies: {} } });
    const r = install(d, ['--no-post']);
    assert.equal(r.code, 0, r.all);

    const tree = walk(d).filter((f) => f !== '.ai/kit.json'); // record embeds hashes; compared separately
    const digests = tree.map((rel) => `${rel}\t${shaFile(path.join(d, rel))}`);
    const rec = JSON.parse(fs.readFileSync(path.join(d, '.ai/kit.json'), 'utf8'));
    assert.equal(rec.kitVersion, JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')).version);
    assert.ok(Object.keys(rec.files).length > 10);

    if (UPDATE) {
      writeLines('cli-install-tree.txt', tree);
      writeLines('cli-install-digests.txt', digests);
    } else {
      assert.deepEqual(tree, readLines('cli-install-tree.txt'), 'install file tree drifted — re-run with UPDATE_GOLDEN=1 if intentional');
      assert.deepEqual(digests, readLines('cli-install-digests.txt'), 'install file contents drifted — re-run with UPDATE_GOLDEN=1 if intentional');
    }
  });

  it('bin install and install.mjs produce the same tree for the same target flags', () => {
    const a = tmp();
    const b = tmp();
    put(a, { 'package.json': { name: 'a' } });
    put(b, { 'package.json': { name: 'b' } });
    assert.equal(cli(['install', a, '--no-post']).code, 0);
    assert.equal(install(b, ['--no-post']).code, 0);
    const strip = (dir) => walk(dir).filter((f) => f !== '.ai/kit.json');
    assert.deepEqual(strip(a), strip(b));
  });
});

describe('npm pack baseline', () => {
  it('published file list matches tests/fixtures/npm-pack-baseline.txt', () => {
    // --ignore-scripts: staging already ran via `npm test` / `npm run stage`; avoids prepack logs on stdout.
    // Windows ships npm as npm.cmd; spawn without a shell returns status null (ENOENT).
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: KIT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    const j = JSON.parse(r.stdout);
    // Ignore vendored engine paths for the public surface check; require them to exist separately.
    const files = (j[0]?.files || []).map((f) => f.path).sort();
    const publicFiles = files.filter((f) => !f.startsWith('vendor/'));
    if (UPDATE) writeLines('npm-pack-baseline.txt', publicFiles);
    else {
      assert.deepEqual(publicFiles, readLines('npm-pack-baseline.txt'), 'npm pack public file list drifted — re-run with UPDATE_GOLDEN=1 if intentional');
    }
    assert.ok(files.some((f) => f.startsWith('vendor/core/')), 'pack must vendor core for a self-contained tarball');
    assert.ok(!files.some((f) => f.startsWith('docs/')));
  });
});
