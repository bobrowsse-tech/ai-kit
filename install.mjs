#!/usr/bin/env node
// Install or update the AI kit in a project (new or existing).
//   node install.mjs [target-dir]                 install (target defaults to .)
//   node install.mjs [target-dir] --update        refresh kit-owned files, keep everything you customized
//   node install.mjs [target-dir] --dry-run       show what would happen, change nothing
//   node install.mjs [target-dir] --force         also overwrite kit-owned files you modified (use when upgrading
//                                                 from a pre-1.1 install that has no .ai/kit.json)
//   node install.mjs [target-dir] --reset-seeds   DANGEROUS: also overwrite docs/config/CODEOWNERS with kit defaults
//   node install.mjs [target-dir] --no-post       skip the follow-up steps (stack detection, index, skills mirror, hooks, MCP plan)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(KIT_DIR, 'template');
const kit = JSON.parse(fs.readFileSync(path.join(KIT_DIR, 'kit.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const TARGET = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const UPDATE = flag('--update'), DRY = flag('--dry-run'), FORCE = flag('--force'), RESET = flag('--reset-seeds'), NO_POST = flag('--no-post');
if (!fs.existsSync(TARGET) || !fs.statSync(TARGET).isDirectory()) { console.error(`Target directory not found: ${TARGET}`); process.exit(1); }

const RECORD = '.ai/kit.json';
const abs = (rel) => path.join(TARGET, rel);
const readBuf = (p) => fs.readFileSync(p);
const sha = (buf) => crypto.createHash('sha256').update(buf.toString('latin1').replace(/\r\n/g, '\n')).digest('hex');
const write = (rel, data) => {
  if (DRY) return;
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), data);
};
const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const ruleFor = (rel) => kit.rules.find((r) => r.path === rel || (r.prefix && rel.startsWith(r.prefix))) || { class: 'seed' };
const isPython = ['pyproject.toml', 'setup.py', 'requirements.txt'].some((f) => fs.existsSync(abs(f)));

let rec = { kitVersion: null, files: {}, settings: {} };
try { rec = { ...rec, ...JSON.parse(fs.readFileSync(abs(RECORD), 'utf8')) }; } catch { /* first install */ }
const firstInstall = !rec.kitVersion;
if (UPDATE && firstInstall) { console.error('No .ai/kit.json found: this project has no recorded kit install. Run without --update (add --force to adopt a pre-1.1 install).'); process.exit(1); }

const log = { created: [], updated: [], unchanged: [], conflicts: [], keptSeeds: [], merges: [], obsolete: [] };

// ---- settings.json: additive merge; kit-managed entries that were later dropped are removed ----
const managedOf = (s) => Object.fromEntries(['allow', 'ask', 'deny'].map((k) => [k, (s.permissions && s.permissions[k]) || []]));
/** Support legacy flat rec.settings (Claude-only) and per-file maps used once Gemini json-merge shipped. */
function prevManaged(rec, rel) {
  const s = rec.settings || {};
  if (Array.isArray(s.allow) || Array.isArray(s.ask) || Array.isArray(s.deny)) {
    return rel === '.claude/settings.json' ? { allow: s.allow || [], ask: s.ask || [], deny: s.deny || [] } : { allow: [], ask: [], deny: [] };
  }
  return s[rel] || { allow: [], ask: [], deny: [] };
}
function storeManaged(rec, rel, managed) {
  let s = rec.settings || {};
  if (Array.isArray(s.allow) || Array.isArray(s.ask) || Array.isArray(s.deny)) {
    s = { '.claude/settings.json': { allow: s.allow || [], ask: s.ask || [], deny: s.deny || [] } };
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  s[rel] = managed;
  rec.settings = s;
}
function mergeSettings(dst, src, prev) {
  const out = JSON.parse(JSON.stringify(dst));
  out.permissions = out.permissions || {};
  for (const k of ['allow', 'ask', 'deny']) {
    const next = (src.permissions && src.permissions[k]) || [];
    const kept = (out.permissions[k] || []).filter((x) => !((prev[k] || []).includes(x)) || next.includes(x));
    out.permissions[k] = [...kept, ...next.filter((x) => !kept.includes(x))];
  }
  for (const [event, groups] of Object.entries(src.hooks || {})) {
    out.hooks = out.hooks || {};
    const cur = (out.hooks[event] || []).filter((g) => !JSON.stringify(g).includes('scripts/ai/hook.mjs'));
    out.hooks[event] = [...cur, ...groups];
  }
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

const files = walk(TEMPLATE).sort();
for (const rel of files) {
  const rule = ruleFor(rel);
  if (rule.when === 'python' && !isPython) continue;
  const srcBuf = readBuf(path.join(TEMPLATE, rel));
  const exists = fs.existsSync(abs(rel));
  const cur = exists ? sha(readBuf(abs(rel))) : null;
  const nw = sha(srcBuf);
  const prev = rec.files[rel];

  if (rule.class === 'seed') {
    if (!exists || RESET) { write(rel, srcBuf); log.created.push(rel); } else log.keptSeeds.push(rel);
    continue;
  }
  if (rule.class === 'json-merge') {
    const src = JSON.parse(srcBuf.toString('utf8'));
    let dst = null;
    if (exists) { try { dst = JSON.parse(readBuf(abs(rel)).toString('utf8')); } catch { write(`${rel}.kit-new`, srcBuf); log.conflicts.push(`${rel} (not valid JSON; kit version saved as ${rel}.kit-new)`); continue; } }
    if (!dst) { write(rel, JSON.stringify(src, null, 2) + '\n'); log.created.push(rel); } else {
      const merged = mergeSettings(dst, src, prevManaged(rec, rel));
      if (JSON.stringify(merged) !== JSON.stringify(dst)) { write(rel, JSON.stringify(merged, null, 2) + '\n'); log.merges.push(rel); } else log.unchanged.push(rel);
    }
    storeManaged(rec, rel, managedOf(src));
    continue;
  }
  // owned and merge-doc share the same safety logic; merge-doc conflicts go to AGENTS.kit.md
  const sideFile = rule.class === 'merge-doc' ? rel.replace(/\.md$/, '.kit.md') : `${rel}.kit-new`;
  if (cur === null) { write(rel, srcBuf); log.created.push(rel); rec.files[rel] = nw; }
  else if (cur === nw) { log.unchanged.push(rel); rec.files[rel] = nw; }
  else if ((prev && cur === prev) || FORCE) { write(rel, srcBuf); log.updated.push(rel); rec.files[rel] = nw; }
  else { write(sideFile, srcBuf); log.conflicts.push(`${rel} (differs from the kit; kit version saved as ${sideFile})`); }
}
for (const rel of Object.keys(rec.files)) if (!files.includes(rel)) log.obsolete.push(rel);

// ---- .gitattributes: shell scripts and hooks must stay LF (Windows autocrlf would break `#!/usr/bin/env sh\r`) ----
const GA_BEGIN = '# BEGIN ai-kit line endings';
const GA_BLOCK = `${GA_BEGIN}\nscripts/ai/** text eol=lf\n.githooks/* text eol=lf\n.husky/* text eol=lf\n*.sh text eol=lf\n# END ai-kit line endings\n`;
{
  const cur = fs.existsSync(abs('.gitattributes')) ? fs.readFileSync(abs('.gitattributes'), 'utf8') : '';
  if (!cur.includes(GA_BEGIN)) { write('.gitattributes', cur ? `${cur.replace(/\s*$/, '\n')}\n${GA_BLOCK}` : GA_BLOCK); log.merges.push('.gitattributes (line-ending rules for scripts and hooks)'); }
}

// ---- CI: inject Pre-Ship Security Scan into ai-guardrails.yml if missing (never overwrites the rest of the file) ----
const WF = '.github/workflows/ai-guardrails.yml';
const PRESHIP_BEGIN = '# BEGIN ai-kit pre-ship security';
const PRESHIP_BLOCK = `      ${PRESHIP_BEGIN}
      - name: Pre-Ship Security Scan
        run: node scripts/ai/preship-check.mjs
      # END ai-kit pre-ship security
`;
{
  if (fs.existsSync(abs(WF))) {
    const cur = fs.readFileSync(abs(WF), 'utf8');
    if (!cur.includes('preship-check.mjs') && !cur.includes(PRESHIP_BEGIN)) {
      let next = null;
      const afterAuth = /(- name: Auth Paths Have Code Owners\n(?:.*\n)*?        run: node scripts\/ai\/check-auth-review\.mjs\n)/;
      if (afterAuth.test(cur)) next = cur.replace(afterAuth, `$1\n${PRESHIP_BLOCK}`);
      else {
        const beforeDupes = /(- name: Duplicate Code Report\n)/;
        if (beforeDupes.test(cur)) next = cur.replace(beforeDupes, `${PRESHIP_BLOCK}\n$1`);
        else {
          const beforeSecurityJob = /(\n  security-and-dependency-audit:\n)/;
          if (beforeSecurityJob.test(cur)) next = cur.replace(beforeSecurityJob, `\n${PRESHIP_BLOCK}$1`);
        }
      }
      if (next && next !== cur) {
        write(WF, next);
        log.merges.push(`${WF} (pre-ship security scan step; rest of workflow untouched)`);
      }
    }
  }
}

// ---- post steps ----
const notes = [];
if (!DRY) {
  for (const rel of files) if (/\.(sh|mjs)$/.test(rel) || rel === '.githooks/pre-commit' || rel === '.husky/pre-commit') { try { fs.chmodSync(abs(rel), 0o755); } catch { /* fs without modes */ } }
  // Legacy repos: default to pins "warn" so the first CI run does not fail on existing ^/~ ranges.
  if (log.created.includes('.ai/config.json')) {
    const r = spawnSync(process.execPath, ['scripts/ai/check-pins.mjs'], { cwd: TARGET, encoding: 'utf8' });
    if (r.status === 1) {
      const c = JSON.parse(fs.readFileSync(abs('.ai/config.json'), 'utf8'));
      c.pins = 'warn';
      fs.writeFileSync(abs('.ai/config.json'), JSON.stringify(c, null, 2) + '\n');
      notes.push('Existing unpinned dependencies found: set "pins": "warn" in .ai/config.json. Pin them, then switch it to "error".');
    }
  }
  rec.kitVersion = kit.version;
  fs.mkdirSync(path.dirname(abs(RECORD)), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(rec.files).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(abs(RECORD), JSON.stringify({ kitVersion: kit.version, files: sorted, settings: rec.settings }, null, 2) + '\n');
}

const section = (title, list) => { if (list.length) { console.log(`${title} (${list.length}):`); list.forEach((x) => console.log(`  - ${x}`)); } };
console.log(`${DRY ? '[dry run] ' : ''}AI kit ${kit.version} ${UPDATE ? 'update' : 'install'} -> ${TARGET}${rec.kitVersion && !firstInstall && !DRY ? '' : ''}`);
section('created', log.created);
section('updated', log.updated);
section('settings merged', log.merges);
section('CONFLICTS (you modified these; review the side file)', log.conflicts);
section('obsolete kit files (no longer shipped; delete if unused)', log.obsolete);
console.log(`unchanged: ${log.unchanged.length}, kept your customized seed files: ${log.keptSeeds.length}`);
notes.forEach((n) => console.log(`[NOTE] ${n}`));
if (firstInstall && !FORCE && log.conflicts.some((c) => c.startsWith('scripts/ai/'))) console.log('[NOTE] No .ai/kit.json existed but kit files differ: this looks like a pre-1.1 install. Re-run with --force to adopt (docs/config are never overwritten).');
if (DRY || NO_POST) process.exit(0);

const step = (script, extra = []) => spawnSync(process.execPath, [`scripts/ai/${script}`, ...extra], { cwd: TARGET, stdio: 'inherit' });
console.log('');
if (firstInstall) step('detect-stack.mjs', ['--skills']);
step('build-index.mjs');
step('sync-agents.mjs');
step('setup-hooks.mjs');
if (firstInstall) {
  console.log('\nMCP plan (dry run, nothing is written; needs network to resolve current versions):');
  step('setup-mcp.mjs');
  console.log(`
Next steps
  1. MCP servers: review the plan above, then  node scripts/ai/setup-mcp.mjs --apply
  2. Hooks: git hooks use .githooks (no dependencies). Husky and pre-commit.com are supported; see README.
     Add to package.json scripts so every clone is wired:  "prepare": "node scripts/ai/setup-hooks.mjs"
  3. CODEOWNERS: replace the example owners in .github/CODEOWNERS and enable "Require review from Code Owners".
  4. Tell your agent: "Read AGENTS.md and run the project-bootstrap skill."
  5. Before first deploy: "Run the pre-ship-security skill and go through docs/security-checklist.md."
  6. Commit AGENTS.md, CLAUDE.md, docs/, .ai/, .claude/, .agents/, scripts/ai/, .github/, .githooks/, .mcp.json.`);
} else {
  console.log('\nUpdate finished. Review CONFLICTS (if any), then commit.');
}
