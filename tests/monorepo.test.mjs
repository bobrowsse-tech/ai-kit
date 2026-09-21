import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ai, project, put, read } from './helpers.mjs';

const stack = (d) => JSON.parse(read(d, '.ai/stack.json'));
const web = { name: '@m/web', dependencies: { next: '15.0.0', react: '19.0.0' }, scripts: { dev: 'next dev', test: 'vitest' } };
const admin = { name: '@m/admin', dependencies: { '@angular/core': '20.1.0' }, devDependencies: { '@angular/cli': '20.1.4' } };
const ui = { name: '@m/ui', dependencies: { react: '19.0.0', '@m/web': 'workspace:*' } };

describe('workspace detection', () => {
  it('npm workspaces: per-package frameworks, usedIn, and a workspace list', () => {
    const d = project({ 'package.json': { name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] }, 'apps/web/package.json': web, 'apps/admin/package.json': admin, 'apps/admin/angular.json': '{}', 'packages/ui/package.json': ui });
    const r = ai(d, 'detect-stack.mjs', ['--skills']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /monorepo: 3 workspace packages/);
    const s = stack(d);
    assert.deepEqual(s.workspaces.map((w) => [w.path, w.frameworks]), [['apps/admin', ['angular']], ['apps/web', ['nextjs', 'react']], ['packages/ui', ['react']]]);
    assert.deepEqual(s.frameworks.find((f) => f.id === 'react').usedIn, ['apps/web', 'packages/ui']);
    assert.match(read(d, '.claude/skills/stack-react/SKILL.md'), /Used in: apps\/web, packages\/ui/);
    assert.deepEqual(s.workspaces.find((w) => w.path === 'apps/web').scripts, { dev: 'next dev', test: 'vitest' });
  });
  it('pnpm-workspace.yaml, negations, and ** patterns', () => {
    const d = project({
      'package.json': { name: 'mono', private: true },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'libs/**'\n  - '!apps/legacy'\ncatalog:\n  - notaworkspace\n",
      'apps/web/package.json': web, 'apps/legacy/package.json': { name: 'legacy' },
      'libs/a/b/package.json': { name: 'deep', dependencies: { vue: '3.5.0' } },
    });
    ai(d, 'detect-stack.mjs');
    assert.deepEqual(stack(d).workspaces.map((w) => w.path), ['apps/web', 'libs/a/b']);
  });
  it('uv workspaces (pyproject members)', () => {
    const d = project({ 'pyproject.toml': '[tool.uv.workspace]\nmembers = ["services/*"]\n', 'services/api/pyproject.toml': '[project]\nname="api"\ndependencies=["fastapi==0.115.0"]\n' });
    ai(d, 'detect-stack.mjs');
    const s = stack(d);
    assert.deepEqual(s.workspaces.map((w) => [w.path, w.frameworks]), [['services/api', ['fastapi']]]);
  });
  it('single-package repos have no workspaces block', () => {
    const d = project({ 'package.json': { name: 'solo', dependencies: { react: '19.0.0' } } });
    ai(d, 'detect-stack.mjs');
    assert.equal(stack(d).workspaces, undefined);
  });
});

describe('monorepo checks', () => {
  it('pins are enforced in every workspace package.json', () => {
    const d = project({});
    put(d, { 'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] }, 'apps/web/package.json': { name: 'web', dependencies: { next: '^15.0.0' } }, 'apps/ok/package.json': { name: 'ok', dependencies: { react: '19.0.0' } } });
    const r = ai(d, 'check-pins.mjs');
    assert.equal(r.code, 1);
    assert.match(r.err, /apps\/web\/package\.json dependencies: next@\^15\.0\.0/);
    assert.doesNotMatch(r.err, /apps\/ok/);
  });
  it('the index covers apps/ and packages/', () => {
    const d = project({ 'apps/web/src/greet.ts': '/** Greets. */\nexport function greet() {}\n', 'packages/ui/src/button.tsx': '/** Button. */\nexport const Button = () => null;\n' });
    ai(d, 'build-index.mjs');
    const idx = read(d, 'docs/functionality-index.md');
    assert.match(idx, /### apps\/web\/src\/greet\.ts/);
    assert.match(idx, /### packages\/ui\/src\/button\.tsx/);
  });
  it('coverage is checked per workspace package', () => {
    const d = project({ '.ai/config.json': { coverage: 'error' } });
    put(d, { 'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] }, 'apps/web/package.json': { name: 'web', devDependencies: { vitest: '2.0.0' } } });
    const r = ai(d, 'check-coverage.mjs');
    assert.equal(r.code, 1);
    assert.match(r.err, /vitest in apps\/web/);
    put(d, { 'apps/web/vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 80 } } } }' });
    assert.equal(ai(d, 'check-coverage.mjs').code, 0);
  });
});
