import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KIT } from './helpers.mjs';

const FILES = ['template/.github/workflows/ai-guardrails.yml', '.github/workflows/kit-ci.yml'].map((f) => path.join(KIT, f));
const text = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(KIT, f).split(path.sep).join('/');

// Node has no YAML parser, so these are cheap textual guards. Real linting is actionlint (below and in kit CI).
describe('workflow hygiene (no YAML parser needed)', () => {
  for (const f of FILES) {
    describe(rel(f), () => {
      const t = text(f);
      it('has no tabs and balanced ${{ }} expressions on every line', () => {
        assert.ok(!t.includes('\t'));
        t.split('\n').forEach((line, i) => assert.equal((line.match(/\$\{\{/g) || []).length, (line.match(/\}\}/g) || []).length, `line ${i + 1}: ${line}`));
      });
      it('pins every action to a version tag or SHA', () => {
        for (const m of t.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) assert.match(m[1], /@[\w.-]+$/, m[1]);
      });
      it('declares least-privilege permissions and never uses pull_request_target', () => {
        assert.match(t, /^permissions:\n\s+contents: read/m);
        assert.doesNotMatch(t, /pull_request_target/);
      });
      it('every job declares runs-on', () => {
        const jobs = t.split(/^jobs:\n/m)[1] || '';
        const ids = [...jobs.matchAll(/^  ([\w-]+):\n/gm)].map((m) => m[1]);
        assert.ok(ids.length > 0);
        for (const id of ids) {
          const body = jobs.split(new RegExp(`^  ${id}:\\n`, 'm'))[1].split(/^  [\w-]+:\n/m)[0];
          assert.match(body, /^    runs-on:/m, `job ${id}`);
        }
      });
      it('shell run blocks use the shellcheck directive syntax correctly (directive alone on its line)', () => {
        for (const m of t.matchAll(/^\s*# shellcheck (.*)$/gm)) assert.match(m[1], /^disable=SC\d+(,SC\d+)*$/, m[0]);
      });
    });
  }
});

const has = spawnSync('actionlint', ['-version'], { encoding: 'utf8' }).status === 0;
describe('actionlint (runs when the binary is on PATH; always runs in kit CI)', { skip: !has && 'actionlint is not installed' }, () => {
  it('reports no problems in the shipped workflows', () => {
    const r = spawnSync('actionlint', FILES, { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
