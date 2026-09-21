#!/usr/bin/env node
// Verifies a coverage THRESHOLD is configured for each test tool in the project (the tool enforces it when CI runs
// tests with coverage). Config: .ai/config.json "coverage": error | warn | off. Heuristic: greps tool configs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, projectFacts } from './lib.mjs';

const mode = loadConfig().coverage;
if (mode === 'off') { console.log('[SKIP] coverage check is off.'); process.exit(0); }

const facts = projectFacts();
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const list = (dir, re) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((n) => re.test(n)); } catch { return []; } };
const join = (d, n) => (d === '.' ? n : `${d}/${n}`);

const results = []; // { label, where }
const missing = [];
for (const f of facts.packages) {
  const d = f.dir;
  const cfgText = (re) => list(d, re).map((n) => read(join(d, n))).join('\n');
  const scripts = Object.values(f.pkg.scripts || {}).join('\n');
  const tag = (tool) => `${tool}${d === '.' ? '' : ` in ${d}`}`;

  if (f.deps.vitest) {
    const ok = /thresholds/.test(cfgText(/^(vitest|vite)\.(config|workspace)\./)) || /coverage\.thresholds/.test(scripts);
    (ok ? results : missing).push({ label: tag('vitest'), hint: 'set coverage.thresholds in vitest.config' });
  }
  if (f.deps.jest || f.pkg.jest) {
    const ok = Boolean(f.pkg.jest && f.pkg.jest.coverageThreshold) || /coverageThreshold/.test(cfgText(/^jest\.config\./)) || /--coverageThreshold/.test(scripts);
    (ok ? results : missing).push({ label: tag('jest'), hint: 'set coverageThreshold in the jest config' });
  }
  if (f.deps.nyc || f.deps.c8) {
    const ok = /check-coverage|checkCoverage/.test(scripts + cfgText(/^\.(nycrc|c8rc)/) + JSON.stringify(f.pkg.nyc || {}) + JSON.stringify(f.pkg.c8 || {}));
    (ok ? results : missing).push({ label: tag('nyc/c8'), hint: 'enable check-coverage with thresholds' });
  }
  if (f.pyHas('pytest')) {
    const text = ['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg', '.coveragerc'].map((n) => read(join(d, n))).join('\n');
    const ok = /fail_under|--cov-fail-under|fail-under/.test(text);
    (ok ? results : missing).push({ label: tag('pytest'), hint: 'set fail_under under [tool.coverage.report] (needs pytest-cov)' });
  }
}

if (!results.length && !missing.length) { console.log('[SKIP] no supported test tool (vitest, jest, nyc/c8, pytest) detected.'); process.exit(0); }
for (const r of results) console.log(`\x1b[0;32m[OK] coverage threshold configured for ${r.label}.\x1b[0m`);
if (!missing.length) process.exit(0);
const tagText = mode === 'warn' ? '\x1b[0;33m[WARN]' : '\x1b[0;31m[ERROR]';
for (const m of missing) console.error(`${tagText} no coverage threshold for ${m.label}: ${m.hint}.\x1b[0m`);
process.exit(mode === 'warn' ? 0 : 1);
