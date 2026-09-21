import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ai, exists, posix, project, put, read, sh } from './helpers.mjs';

const TS = {
  'src/utils/format.ts': `/** Formats a date for UI display. */\nexport function formatDate(d: Date, locale = 'en-US'): string { return d.toLocaleDateString(locale); }\n// Formats money as a currency string\nexport const formatMoney = (a: number, c: string) => String(a) + c;\nexport type Money = { amount: number };\n`,
  'src/hooks/useAuth.ts': `export function useAuth() { return null; }\n`,
  'src/components/Button.tsx': `/** Primary button. */\nexport const Button = ({ label }: { label: string }) => <button>{label}</button>;\n`,
  'api/service.py': `def fetch_user(user_id: int):\n    """Fetch a user record by id."""\n    return {}\n\n# Repository for user rows\nclass UserRepo:\n    pass\n\ndef _private():\n    pass\n`,
};

describe('index + find', () => {
  const d = project(TS);
  it('extracts JS/TS and Python symbols with kinds and descriptions', () => {
    const r = ai(d, 'build-index.mjs');
    assert.equal(r.code, 0, r.all);
    const idx = read(d, 'docs/functionality-index.md');
    assert.match(idx, /fn `formatDate\(d: Date, locale = 'en-US'\)` — Formats a date for UI display\./);
    assert.match(idx, /fn `formatMoney\(a: number, c: string\)` — Formats money as a currency string/);
    assert.match(idx, /type `Money`/);
    assert.match(idx, /hook `useAuth\(\)`/);
    assert.match(idx, /component `Button\(/);
    assert.match(idx, /fn `fetch_user\(user_id: int\)` — Fetch a user record by id\./);
    assert.match(idx, /class `UserRepo` — Repository for user rows/);
    assert.doesNotMatch(idx, /_private/);
  });
  it('--check passes when fresh, fails when stale, ignores CRLF', () => {
    assert.equal(ai(d, 'build-index.mjs', ['--check']).code, 0);
    const p = path.join(d, 'docs/functionality-index.md');
    const orig = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, orig.replace(/\n/g, '\r\n'));
    assert.equal(ai(d, 'build-index.mjs', ['--check']).code, 0, 'CRLF must not make the check fail');
    fs.writeFileSync(p, orig);
    fs.appendFileSync(path.join(d, 'src/utils/format.ts'), 'export const extra = 1;\n');
    assert.equal(ai(d, 'build-index.mjs', ['--check']).code, 1);
  });
  it('find ranks name/description matches and drops path-only noise', () => {
    ai(d, 'build-index.mjs');
    const r = ai(d, 'find.mjs', ['format', 'date']);
    assert.match(r.out, /formatDate/);
    assert.doesNotMatch(r.out, /type `Money`|useAuth/);
    assert.match(ai(d, 'find.mjs', ['zzzqqq']).out, /No existing symbol matches/);
    assert.equal(ai(d, 'find.mjs').code, 2);
  });
  it('never rewrites the index file when nothing changed', () => {
    ai(d, 'build-index.mjs');
    const p = path.join(d, 'docs/functionality-index.md');
    const before = fs.statSync(p).mtimeMs;
    ai(d, 'build-index.mjs');
    assert.equal(fs.statSync(p).mtimeMs, before);
  });
});

describe('dupes', () => {
  const block = Array.from({ length: 9 }, (_, i) => `  const value${i} = compute(input${i}, options.flag${i}, 'constant-${i}');`).join('\n');
  it('reports copy-pasted blocks and can gate with --fail-over', () => {
    const d = project({ 'src/a.js': `export function a(x) {\n${block}\n}\n`, 'src/b.js': `export function b(x) {\n${block}\n}\n` });
    const r = ai(d, 'dupes.mjs');
    assert.match(r.out, /1 duplicated file pair/);
    assert.match(r.out, /src\/a\.js:\d+\s+<->\s+src\/b\.js:\d+/);
    assert.equal(ai(d, 'dupes.mjs', ['--fail-over', '0']).code, 1);
  });
  it('finds nothing in distinct code', () => {
    const d = project({ 'src/a.js': 'export const a = 1;\n' });
    assert.match(ai(d, 'dupes.mjs').out, /No duplicated blocks/);
  });
});

describe('pins', () => {
  it('fails on ranges, passes on exact, warns in warn mode, covers requirements*.txt', () => {
    const d = project({});
    put(d, { 'package.json': { name: 'x', dependencies: { a: '^1.0.0', b: '2.0.0', c: 'workspace:*' } } });
    assert.equal(ai(d, 'check-pins.mjs').code, 1);
    put(d, { 'package.json': { name: 'x', dependencies: { a: '1.0.0' } } });
    assert.equal(ai(d, 'check-pins.mjs').code, 0);
    put(d, { 'requirements.txt': 'fastapi==0.115.0\nrequests>=2\n-r other.txt\n# c\nflask\n' });
    const r = ai(d, 'check-pins.mjs');
    assert.equal(r.code, 1);
    assert.match(r.err, /requirements\.txt:2: requests>=2/);
    assert.match(r.err, /requirements\.txt:5: flask/);
    put(d, { '.ai/config.json': { pins: 'warn' } });
    assert.equal(ai(d, 'check-pins.mjs').code, 0);
  });
});

describe('remember + check-docs + has-script', () => {
  it('records once, into the right section', () => {
    const d = project({});
    assert.match(ai(d, 'remember.mjs', ['gotcha', 'Use the shared db client']).out, /Recorded under "Gotchas"/);
    assert.match(ai(d, 'remember.mjs', ['gotcha', 'Use the shared db client']).out, /Already recorded/);
    assert.equal(ai(d, 'remember.mjs', ['bogus', 'x']).code, 2);
    const m = read(d, 'docs/memory.md');
    assert.ok(m.indexOf('## Gotchas') < m.indexOf('Use the shared db client') && m.indexOf('Use the shared db client') < m.indexOf('## Decisions'));
  });
  it('check-docs: passes with stubs (warns on TODO), fails when a doc is missing or empty', () => {
    const d = project({});
    const ok = ai(d, 'check-docs.mjs');
    assert.equal(ok.code, 0);
    assert.match(ok.all, /TODO placeholders/);
    fs.rmSync(path.join(d, 'docs/schema.md'));
    fs.writeFileSync(path.join(d, 'docs/tasks.md'), '');
    const bad = ai(d, 'check-docs.mjs');
    assert.equal(bad.code, 1);
    assert.match(bad.all, /docs\/schema\.md/);
    assert.match(bad.all, /docs\/tasks\.md/);
  });
  it('has-script reflects package.json scripts', () => {
    const d = project({ 'package.json': { name: 'x', scripts: { lint: 'eslint .' } } });
    assert.equal(ai(d, 'has-script.mjs', ['lint']).code, 0);
    assert.equal(ai(d, 'has-script.mjs', ['test']).code, 1);
  });
});

describe('coverage threshold check', () => {
  it('flags missing thresholds per tool and accepts configured ones', () => {
    const d = project({ 'package.json': { name: 'x', devDependencies: { vitest: '2.0.0', jest: '29.0.0' } } });
    const r = ai(d, 'check-coverage.mjs');
    assert.equal(r.code, 0, 'default mode is warn');
    assert.match(r.err, /no coverage threshold for vitest/);
    assert.match(r.err, /no coverage threshold for jest/);
    put(d, { '.ai/config.json': { coverage: 'error' } });
    assert.equal(ai(d, 'check-coverage.mjs').code, 1);
    put(d, { 'vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 80 } } } }', 'package.json': { name: 'x', devDependencies: { vitest: '2.0.0', jest: '29.0.0' }, jest: { coverageThreshold: { global: { lines: 80 } } } } });
    const ok = ai(d, 'check-coverage.mjs');
    assert.equal(ok.code, 0, ok.all);
    assert.match(ok.out, /vitest/);
  });
  it('checks pytest fail_under and skips when no test tool exists', () => {
    const d = project({ 'pyproject.toml': '[project]\ndependencies = ["pytest==8.0.0"]\n', '.ai/config.json': { coverage: 'error' } });
    assert.equal(ai(d, 'check-coverage.mjs').code, 1);
    put(d, { 'pyproject.toml': '[project]\ndependencies = ["pytest==8.0.0"]\n[tool.coverage.report]\nfail_under = 85\n' });
    assert.equal(ai(d, 'check-coverage.mjs').code, 0);
    const empty = project({});
    assert.match(ai(empty, 'check-coverage.mjs').out, /SKIP/);
  });
});

describe('auth review (CODEOWNERS)', () => {
  const files = { 'src/auth/login.ts': '', 'src/utils/session.service.ts': '', 'src/utils/token-store.ts': '', 'src/authors/list.ts': '', 'src/utils/tokenizer.ts': '' };
  it('finds auth paths without false positives and enforces owners in error mode', { skip: !posix }, () => {
    const d = project(files, { git: true });
    sh(d, 'git add -A');
    let r = ai(d, 'check-auth-review.mjs');
    assert.equal(r.code, 0, 'warn by default');
    assert.match(r.err, /3 auth-related file\(s\) have no CODEOWNERS owner/);
    put(d, { '.ai/config.json': { authReview: 'error' }, '.github/CODEOWNERS': '/src/auth/ @org/security\n' });
    sh(d, 'git add -A');
    r = ai(d, 'check-auth-review.mjs');
    assert.equal(r.code, 1);
    assert.match(r.err, /\/src\/utils\//);
    put(d, { '.github/CODEOWNERS': '/src/auth/ @org/security\n/src/**/session* @org/security\n/src/**/token* @org/security\n' });
    sh(d, 'git add -A');
    r = ai(d, 'check-auth-review.mjs');
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /3 auth-related files all have CODEOWNERS owners/);
  });
  it('a later rule without owners removes ownership', { skip: !posix }, () => {
    const d = project({ 'src/auth/x.ts': '', '.ai/config.json': { authReview: 'error' }, '.github/CODEOWNERS': '/src/auth/ @org/security\n/src/auth/x.ts\n' }, { git: true });
    sh(d, 'git add -A');
    assert.equal(ai(d, 'check-auth-review.mjs').code, 1);
  });
});

describe('agent skills mirror (.agents/skills)', () => {
  const skill = (n) => `---\nname: ${n}\ndescription: test skill\n---\nbody\n`;
  it('mirrors, detects stale/missing/obsolete, and never touches user-owned skills', () => {
    const d = project({ '.agents/skills/mine/SKILL.md': skill('mine') });
    let r = ai(d, 'sync-agents.mjs');
    assert.equal(r.code, 0, r.all);
    assert.ok(exists(d, '.agents/skills/reuse-first/SKILL.md'));
    assert.equal(ai(d, 'sync-agents.mjs', ['--check']).code, 0);
    put(d, { '.claude/skills/reuse-first/SKILL.md': skill('reuse-first') + 'changed\n' });
    assert.match(ai(d, 'sync-agents.mjs', ['--check']).err, /stale \.agents\/skills\/reuse-first/);
    ai(d, 'sync-agents.mjs');
    assert.match(read(d, '.agents/skills/reuse-first/SKILL.md'), /changed/);
    put(d, { '.claude/skills/mine/SKILL.md': skill('mine') + 'from-claude\n' });
    ai(d, 'sync-agents.mjs');
    assert.doesNotMatch(read(d, '.agents/skills/mine/SKILL.md'), /from-claude/, 'user-owned skill untouched');
    fs.rmSync(path.join(d, '.claude/skills/mcp-tools'), { recursive: true });
    assert.match(ai(d, 'sync-agents.mjs', ['--check']).err, /obsolete \.agents\/skills\/mcp-tools/);
    ai(d, 'sync-agents.mjs');
    assert.ok(!exists(d, '.agents/skills/mcp-tools'));
  });
  it('--symlink mode links to the source', { skip: !posix }, () => {
    const d = project({});
    ai(d, 'sync-agents.mjs', ['--symlink']);
    assert.ok(fs.lstatSync(path.join(d, '.agents/skills/reuse-first')).isSymbolicLink());
    assert.equal(ai(d, 'sync-agents.mjs', ['--check']).code, 0);
  });
});

describe('pre-commit + hook wiring', () => {
  it('pre-commit.mjs passes on a healthy project and fails when a check fails (no bash needed)', () => {
    const d = project(TS);
    ai(d, 'build-index.mjs');
    ai(d, 'sync-agents.mjs');
    assert.equal(ai(d, 'pre-commit.mjs').code, 0);
    fs.appendFileSync(path.join(d, 'src/utils/format.ts'), 'export const more = 1;\n');
    assert.equal(ai(d, 'pre-commit.mjs').code, 1);
  });
  it('the old bash entry points still work as shims', { skip: !posix }, () => {
    const d = project(TS);
    ai(d, 'build-index.mjs'); ai(d, 'sync-agents.mjs');
    assert.equal(sh(d, 'bash scripts/ai/check-docs.sh').code, 0);
    assert.equal(sh(d, 'bash scripts/ai/pre-commit.sh').code, 0);
  });
  it('the git hook wrapper skips with a warning (exit 0) when Node is missing', { skip: !posix }, () => {
    const d = project({});
    const empty = fs.mkdtempSync(path.join(d, 'nopath-'));
    const r = spawnSync('/bin/sh', ['.githooks/pre-commit'], { cwd: d, encoding: 'utf8', env: { PATH: empty } });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Node\.js \(>=18\) not found/);
  });
  it('setup-hooks points git at .githooks, leaves husky and other managers alone', () => {
    const d = project({}, { git: true });
    assert.match(ai(d, 'setup-hooks.mjs').out, /now use \.githooks/);
    assert.equal(sh(d, 'git config core.hooksPath').out.trim(), '.githooks');
    sh(d, 'git config core.hooksPath .husky/_');
    assert.match(ai(d, 'setup-hooks.mjs').out, /husky manages hooks/);
    assert.equal(sh(d, 'git config core.hooksPath').out.trim(), '.husky/_');
    sh(d, 'git config core.hooksPath custom-hooks');
    assert.match(ai(d, 'setup-hooks.mjs').out, /another hook manager/);
    assert.equal(sh(d, 'git config core.hooksPath').out.trim(), 'custom-hooks');
    const nogit = project({});
    assert.match(ai(nogit, 'setup-hooks.mjs').out, /not a git repository/);
  });
  it('the git pre-commit hook blocks a commit that breaks the index', () => {
    const d = project(TS, { git: true });
    ai(d, 'build-index.mjs'); ai(d, 'sync-agents.mjs'); ai(d, 'setup-hooks.mjs');
    sh(d, 'git add -A');
    const ok = sh(d, 'git -c user.email=a@b.c -c user.name=t commit -qm first');
    assert.equal(ok.code, 0, ok.all);
    fs.appendFileSync(path.join(d, 'src/utils/format.ts'), 'export const more = 1;\n');
    sh(d, 'git add -A');
    const bad = sh(d, 'git -c user.email=a@b.c -c user.name=t commit -qm second');
    assert.notEqual(bad.code, 0);
    assert.match(bad.all, /functionality-index\.md is stale/);
  });
});
