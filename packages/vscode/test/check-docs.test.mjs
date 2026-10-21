import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocs, REQUIRED_DOCS, installKit, setAssetRoot } from '@bobrowsse-tech/ai-kit-core';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core');
const templateScript = fs.readFileSync(path.join(core, 'template/scripts/ai/check-docs.mjs'), 'utf8');

describe('checkDocs', () => {
  it('REQUIRED_DOCS stays aligned with the shipped check-docs.mjs list', () => {
    const m = templateScript.match(/const REQUIRED = \[([^\]]+)\]/);
    assert.ok(m, 'template check-docs.mjs should define REQUIRED');
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual(
      names.map((n) => `docs/${n}.md`),
      REQUIRED_DOCS,
    );
    assert.equal(REQUIRED_DOCS.length, 12);
  });

  it('reports missing docs on an empty folder', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aikit-docs-'));
    const r = checkDocs(d);
    assert.equal(r.ok, false);
    assert.equal(r.present, 0);
    assert.equal(r.missing.length, 12);
  });

  it('passes after a fresh kit install (seeds are non-empty stubs)', () => {
    setAssetRoot(core);
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aikit-docs-'));
    const result = installKit({ target: d, noPost: true, io: { write() {}, error() {} } });
    assert.equal(result.ok, true);
    const r = checkDocs(d);
    assert.equal(r.ok, true);
    assert.equal(r.present, 12);
    assert.ok(r.todo.length >= 0);
    setAssetRoot(null);
  });
});
