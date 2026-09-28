import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT, exists, install, kitCopy, node, posix, put, read, sh, tmp } from './helpers.mjs';

const json = (d, rel) => JSON.parse(read(d, rel));
const fresh = (map = {}) => { const d = tmp(); put(d, map); const r = install(d); assert.equal(r.code, 0, r.all); return d; };
/** A copy of the kit that pretends to be version 1.6.0 after `edit(kitDir)` ran. */
function newKit(edit) {
  const k = kitCopy();
  const kj = JSON.parse(fs.readFileSync(path.join(k, 'kit.json'), 'utf8'));
  kj.version = '1.6.0';
  fs.writeFileSync(path.join(k, 'kit.json'), JSON.stringify(kj, null, 2));
  edit(path.join(k, 'template'), k);
  return k;
}
const tpl = (t, rel) => path.join(t, rel);

describe('fresh install', () => {
  it('creates kit files, records hashes, and installs docs as seeds', () => {
    const d = fresh();
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'docs/memory.md', 'scripts/ai/hook.mjs', '.claude/settings.json', '.cursor/hooks.json', '.codex/hooks.json', '.github/hooks/ai-kit.json', '.gemini/settings.json', '.github/CODEOWNERS', '.githooks/pre-commit', '.ai/config.json']) assert.ok(exists(d, f), f);
    const rec = json(d, '.ai/kit.json');
    assert.equal(rec.kitVersion, JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')).version);
    assert.match(rec.files['scripts/ai/lib.mjs'], /^[0-9a-f]{64}$/);
    assert.ok(!('docs/index.md' in rec.files), 'seeds are not tracked');
    assert.ok(!exists(d, '.pre-commit-config.yaml'), 'python-only file is skipped for non-python projects');
    if (posix) assert.ok(fs.statSync(path.join(d, 'scripts/ai/find.mjs')).mode & 0o100, 'scripts are executable');
  });
  it('adds .pre-commit-config.yaml only for Python projects', () => {
    assert.ok(exists(fresh({ 'pyproject.toml': '[project]\nname="x"\n' }), '.pre-commit-config.yaml'));
  });
  it('sets pins to warn when the repo already has unpinned dependencies', () => {
    const d = fresh({ 'package.json': { name: 'x', dependencies: { a: '^1.0.0' } } });
    assert.equal(json(d, '.ai/config.json').pins, 'warn');
    assert.equal(json(fresh({ 'package.json': { name: 'x', dependencies: { a: '1.0.0' } } }), '.ai/config.json').pins, 'error');
  });
  it('keeps an existing, different AGENTS.md and saves the kit version next to it', () => {
    const d = fresh({ 'AGENTS.md': '# mine\n' });
    assert.equal(read(d, 'AGENTS.md'), '# mine\n');
    assert.match(read(d, 'AGENTS.kit.md'), /AI Development Rules/);
  });
  it('re-running is a no-op and never touches your customized seeds', () => {
    const d = fresh();
    put(d, { 'docs/index.md': '# mine\n', '.ai/config.json': { pins: 'warn', custom: true } });
    const r = install(d);
    assert.match(r.out, /created|unchanged/);
    assert.equal(read(d, 'docs/index.md'), '# mine\n');
    assert.equal(json(d, '.ai/config.json').custom, true);
    assert.doesNotMatch(r.out, /CONFLICTS/);
  });
  it('--dry-run changes nothing', () => {
    const d = tmp();
    const r = install(d, ['--dry-run']);
    assert.match(r.out, /\[dry run\]/);
    assert.deepEqual(fs.readdirSync(d), []);
  });
});

describe('line endings', () => {
  it('adds LF rules for scripts/hooks to .gitattributes once, keeping existing content', () => {
    const d = tmp();
    put(d, { '.gitattributes': '* text=auto\n*.png binary\n' });
    install(d);
    let ga = read(d, '.gitattributes');
    assert.match(ga, /^\* text=auto\n\*\.png binary\n/);
    assert.match(ga, /scripts\/ai\/\*\* text eol=lf/);
    assert.match(ga, /\.githooks\/\* text eol=lf/);
    install(d);
    assert.equal(read(d, '.gitattributes').split('# BEGIN ai-kit line endings').length, 2, 'idempotent');
  });
});

describe('update', () => {
  it('requires a recorded install', () => {
    const r = install(tmp(), ['--update']);
    assert.equal(r.code, 1);
    assert.match(r.err, /No \.ai\/kit\.json/);
  });
  it('refreshes unmodified kit-owned files and leaves seeds alone', () => {
    const d = fresh();
    put(d, { 'docs/index.md': '# my index\n' });
    const k = newKit((t) => {
      fs.appendFileSync(tpl(t, 'scripts/ai/find.mjs'), '\n// kit 1.6.0\n');
      fs.writeFileSync(tpl(t, 'docs/index.md'), '# kit changed the seed\n');
      fs.writeFileSync(tpl(t, 'scripts/ai/brand-new.mjs'), '// new script\n');
    });
    const r = install(d, ['--update'], k);
    assert.equal(r.code, 0, r.all);
    assert.match(read(d, 'scripts/ai/find.mjs'), /kit 1.6.0/);
    assert.ok(exists(d, 'scripts/ai/brand-new.mjs'));
    assert.equal(read(d, 'docs/index.md'), '# my index\n');
    assert.equal(json(d, '.ai/kit.json').kitVersion, '1.6.0');
    assert.doesNotMatch(r.out, /CONFLICTS/);
  });
  it('never overwrites a kit file you modified: writes .kit-new and reports a conflict', () => {
    const d = fresh();
    fs.appendFileSync(path.join(d, '.github/workflows/ai-guardrails.yml'), '\n# my custom step\n');
    const k = newKit((t) => fs.appendFileSync(tpl(t, '.github/workflows/ai-guardrails.yml'), '\n# kit 1.6.0\n'));
    const r = install(d, ['--update'], k);
    assert.match(r.out, /CONFLICTS[\s\S]*ai-guardrails\.yml/);
    assert.match(read(d, '.github/workflows/ai-guardrails.yml'), /my custom step/);
    assert.doesNotMatch(read(d, '.github/workflows/ai-guardrails.yml'), /kit 1.6.0/);
    assert.match(read(d, '.github/workflows/ai-guardrails.yml.kit-new'), /kit 1.6.0/);
  });
  it('--force overwrites modified kit files but still not seeds', () => {
    const d = fresh();
    fs.appendFileSync(path.join(d, 'scripts/ai/find.mjs'), '\n// hacked\n');
    put(d, { 'docs/tasks.md': '# my tasks\n' });
    install(d, ['--update', '--force']);
    assert.doesNotMatch(read(d, 'scripts/ai/find.mjs'), /hacked/);
    assert.equal(read(d, 'docs/tasks.md'), '# my tasks\n');
  });
  it('--reset-seeds is the only way to overwrite docs', () => {
    const d = fresh();
    put(d, { 'docs/tasks.md': '# my tasks\n' });
    install(d, ['--reset-seeds']);
    assert.match(read(d, 'docs/tasks.md'), /Living backlog/);
  });
  it('AGENTS.md: updated when you never edited it, side file when you did', () => {
    const d = fresh();
    const k = newKit((t) => fs.appendFileSync(tpl(t, 'AGENTS.md'), '\n## 14. New rule\n'));
    install(d, ['--update'], k);
    assert.match(read(d, 'AGENTS.md'), /14\. New rule/);
    const e = fresh();
    fs.appendFileSync(path.join(e, 'AGENTS.md'), '\n## My own rules\n');
    const r = install(e, ['--update'], k);
    assert.match(r.out, /AGENTS\.md \(differs from the kit; kit version saved as AGENTS\.kit\.md\)/);
    assert.match(read(e, 'AGENTS.md'), /My own rules/);
    assert.match(read(e, 'AGENTS.kit.md'), /14\. New rule/);
  });
  it('reports kit files that are no longer shipped', () => {
    const d = fresh();
    const k = newKit((t) => fs.rmSync(tpl(t, 'scripts/ai/has-script.mjs')));
    const r = install(d, ['--update'], k);
    assert.match(r.out, /obsolete kit files[\s\S]*scripts\/ai\/has-script\.mjs/);
    assert.ok(exists(d, 'scripts/ai/has-script.mjs'), 'not deleted automatically');
  });
  it('--update --dry-run shows the plan and changes nothing', () => {
    const d = fresh();
    const k = newKit((t) => fs.appendFileSync(tpl(t, 'scripts/ai/find.mjs'), '\n// kit 1.6.0\n'));
    const r = install(d, ['--update', '--dry-run'], k);
    assert.match(r.out, /\[dry run\][\s\S]*updated[\s\S]*find\.mjs/);
    assert.doesNotMatch(read(d, 'scripts/ai/find.mjs'), /kit 1.6.0/);
    assert.equal(json(d, '.ai/kit.json').kitVersion, JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')).version);
  });
});

describe('upgrading a pre-1.1 install (no .ai/kit.json)', () => {
  it('reports conflicts and hints at --force; --force adopts without touching docs', () => {
    const d = fresh();
    fs.rmSync(path.join(d, '.ai/kit.json'));
    fs.appendFileSync(path.join(d, 'scripts/ai/find.mjs'), '\n// old kit version\n');
    put(d, { 'docs/index.md': '# mine\n' });
    let r = install(d);
    assert.match(r.out, /pre-1\.1 install/);
    assert.match(read(d, 'scripts/ai/find.mjs'), /old kit version/);
    r = install(d, ['--force']);
    assert.doesNotMatch(read(d, 'scripts/ai/find.mjs'), /old kit version/);
    assert.equal(read(d, 'docs/index.md'), '# mine\n');
    assert.equal(json(d, '.ai/kit.json').kitVersion, JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')).version);
  });
});

describe('settings.json merge', () => {
  it('keeps your entries, adds new kit ones, drops ones the kit stopped shipping, replaces (not duplicates) kit hooks', () => {
    const d = fresh();
    const s = json(d, '.claude/settings.json');
    s.permissions.allow.push('Bash(make test)');
    s.permissions.deny.push('Bash(dd *)');
    s.hooks.PreToolUse.push({ matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-linter' }] });
    s.model = 'my-model';
    put(d, { '.claude/settings.json': s });
    const k = newKit((t) => {
      const ks = JSON.parse(fs.readFileSync(tpl(t, '.claude/settings.json'), 'utf8'));
      ks.permissions.deny.push('Bash(mkfs *)');
      ks.permissions.ask = ks.permissions.ask.filter((x) => x !== 'Bash(wget *)');
      ks.hooks.Stop[0].hooks[0].command += ' --v2';
      fs.writeFileSync(tpl(t, '.claude/settings.json'), JSON.stringify(ks, null, 2));
    });
    const r = install(d, ['--update'], k);
    assert.match(r.out, /settings merged[\s\S]*\.claude\/settings\.json/);
    const m = json(d, '.claude/settings.json');
    assert.ok(m.permissions.allow.includes('Bash(make test)'));
    assert.ok(m.permissions.deny.includes('Bash(dd *)') && m.permissions.deny.includes('Bash(mkfs *)'));
    assert.ok(!m.permissions.ask.includes('Bash(wget *)'), 'dropped kit entry removed');
    assert.ok(m.permissions.ask.includes('Bash(curl *)'));
    assert.equal(m.model, 'my-model');
    assert.equal(m.hooks.PreToolUse.filter((g) => JSON.stringify(g).includes('hook.mjs')).length, 1);
    assert.ok(m.hooks.PreToolUse.some((g) => JSON.stringify(g).includes('my-own-linter')));
    assert.equal(m.hooks.Stop.length, 1);
    assert.match(m.hooks.Stop[0].hooks[0].command, /--v2/);
  });
  it('an invalid settings.json is left alone and the kit version is saved beside it', () => {
    const d = tmp();
    put(d, { '.claude/settings.json': '{ not json' });
    const r = install(d);
    assert.match(r.out, /not valid JSON/);
    assert.equal(read(d, '.claude/settings.json'), '{ not json');
    assert.ok(exists(d, '.claude/settings.json.kit-new'));
  });
  it('merges Gemini hooks without wiping user mcpServers', () => {
    const d = fresh();
    put(d, { '.gemini/settings.json': { theme: 'dark', mcpServers: { mine: { command: 'x', args: [] } }, hooks: { BeforeTool: [{ hooks: [{ type: 'command', command: 'my-hook' }] }] } } });
    const r = install(d);
    assert.equal(r.code, 0, r.all);
    const g = json(d, '.gemini/settings.json');
    assert.equal(g.theme, 'dark');
    assert.ok(g.mcpServers.mine);
    assert.ok(g.hooks.BeforeTool.some((x) => JSON.stringify(x).includes('my-hook')));
    assert.ok(g.hooks.BeforeTool.some((x) => JSON.stringify(x).includes('hook.mjs gemini')));
    assert.equal(g.hooks.BeforeTool.filter((x) => JSON.stringify(x).includes('hook.mjs')).length, 1);
  });
});

describe('full install (with post steps)', { skip: !posix }, () => {
  it('detects the stack, builds the index, mirrors skills, wires git hooks, and prints the MCP plan', () => {
    const d = tmp();
    sh(d, 'git init -q');
    put(d, { 'package.json': { name: 'x', dependencies: { next: '15.0.0', react: '19.0.0' } }, 'src/a.ts': '/** Adds. */\nexport function add() {}\n' });
    const r = node(d, path.join(KIT, 'install.mjs'), [d]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Detected: Next\.js, React/);
    assert.match(r.out, /Indexed 1 symbols/);
    assert.match(r.out, /Mirrored \d+ skill/);
    assert.match(r.out, /now use \.githooks/);
    assert.match(r.out, /MCP plan/);
    assert.match(r.out, /Next steps/);
    assert.ok(exists(d, '.agents/skills/reuse-first/SKILL.md') && exists(d, '.ai/stack.json'));
    assert.equal(sh(d, 'git config core.hooksPath').out.trim(), '.githooks');
  });
});

describe('pre-ship security', () => {
  it('ships the skill, checklist seed, scanner, and CI step on a fresh install', () => {
    const d = fresh();
    assert.ok(exists(d, '.claude/skills/pre-ship-security/SKILL.md'));
    assert.ok(exists(d, '.claude/skills/modern-css-workflows/SKILL.md'));
    assert.ok(exists(d, 'docs/security-checklist.md'));
    assert.ok(exists(d, 'scripts/ai/preship-check.mjs'));
    assert.match(read(d, '.github/workflows/ai-guardrails.yml'), /preship-check\.mjs/);
    assert.match(read(d, '.github/workflows/ai-guardrails.yml'), /Pre-Ship Security Scan/);
    assert.ok(!('docs/security-checklist.md' in json(d, '.ai/kit.json').files), 'checklist is a seed');
    assert.ok('.claude/skills/modern-css-workflows/SKILL.md' in json(d, '.ai/kit.json').files, 'modern-css is owned');
  });
  it('injects the CI step into a customized workflow without rewriting the rest', () => {
    const d = tmp();
    const custom = `name: mine
jobs:
  validate-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Auth Paths Have Code Owners
        run: node scripts/ai/check-auth-review.mjs
      - name: Duplicate Code Report
        run: node scripts/ai/dupes.mjs
  security-and-dependency-audit:
    runs-on: ubuntu-latest
    steps:
      - run: echo custom-kept
`;
    put(d, { '.github/workflows/ai-guardrails.yml': custom });
    const r = install(d);
    assert.equal(r.code, 0, r.all);
    const wf = read(d, '.github/workflows/ai-guardrails.yml');
    assert.match(wf, /preship-check\.mjs/);
    assert.match(wf, /custom-kept/);
    assert.match(wf, /name: mine/);
    assert.match(r.out, /pre-ship security scan step/);
    const again = install(d);
    assert.equal(read(d, '.github/workflows/ai-guardrails.yml').split('preship-check.mjs').length, 2, 'inject is idempotent');
    assert.doesNotMatch(again.out, /pre-ship security scan step/);
  });
  it('keeps a customized security-checklist.md seed on reinstall', () => {
    const d = fresh();
    put(d, { 'docs/security-checklist.md': '# mine checklist\n' });
    install(d);
    assert.equal(read(d, 'docs/security-checklist.md'), '# mine checklist\n');
  });
});
