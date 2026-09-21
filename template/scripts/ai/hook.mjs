#!/usr/bin/env node
// Claude Code hook dispatcher: deterministic guardrails the model cannot talk its way past.
//   pre-tool  PreToolUse: blocks secret access/leaks, destructive commands, lockfile hand-edits;
//             asks the user before the agent edits its own guardrail files
//   stop      Stop: refreshes docs/functionality-index.md and the .agents/skills mirror after each turn
// Exit 2 blocks (stderr goes to the model). Exit 0 with a permissionDecision "ask" JSON prompts the user.
// Registered in .claude/settings.json. Other agents rely on AGENTS.md + CI (they have no equivalent hook API here).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.env.CLAUDE_PROJECT_DIR) process.chdir(process.env.CLAUDE_PROJECT_DIR);
const { ROOT, loadConfig } = await import('./lib.mjs');

const mode = process.argv[2];
const cfg = loadConfig().guard;
const deny = (msg) => { console.error(`[ai-kit guard] Blocked: ${msg}`); process.exit(2); };
const ask = (reason) => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `[ai-kit guard] ${reason}` } }));
  process.exit(0);
};

if (mode === 'stop') {
  const run = (script) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/ai', script)], { cwd: ROOT, stdio: 'ignore', timeout: 60000 });
  if (fs.existsSync(path.join(ROOT, 'docs/functionality-index.md'))) run('build-index.mjs');
  if (fs.existsSync(path.join(ROOT, '.claude/skills'))) run('sync-agents.mjs');
  process.exit(0);
}
if (mode !== 'pre-tool') { console.error('usage: hook.mjs pre-tool|stop'); process.exit(2); }

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const tool = input.tool_name || '';
const ti = input.tool_input || {};

// ---- helpers ----
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_SAFE = /\.(example|sample|template|dist)$/;
const isEnvFile = (p) => ENV_FILE.test(p) && !ENV_SAFE.test(p);
const SECRET_PATH = [/(^|\/)secrets?\//, /\.(pem|p12|pfx)$/, /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, /(^|\/)\.aws\/credentials$/];
const sensitive = (p) => isEnvFile(p) || SECRET_PATH.some((r) => r.test(p));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
const rel = (p) => norm(path.isAbsolute(p) ? path.relative(ROOT, p) : path.normalize(p));

const SECRETS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bsk_live_[0-9a-zA-Z]{16,}\b/, 'Stripe live key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{20,}["']/i, 'hard-coded credential'],
];
const scanSecrets = (text) => { for (const [re, kind] of SECRETS) if (re.test(text)) return kind; return null; };

const tokens = (c) => (c.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'type', 'bat', 'xxd', 'strings', 'nl', 'tac', 'od', 'base64', 'sed', 'awk']);
const COPIERS = new Set(['cp', 'scp', 'rsync', 'mv']);
const DANGEROUS_TARGETS = new Set(['/', '~', '~/', '$HOME', '/*', '.', './', '..', '../', '*']);

function checkBash(cmd) {
  if (/\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|dash|python3?|node|perl|ruby)\b/.test(cmd)) return 'piping a download into a shell is not allowed; download, review, then run';
  for (const m of cmd.matchAll(/>>?\s*['"]?([^\s'"|;&]+)/g)) if (isEnvFile(norm(m[1]))) return 'writing .env files from a command is not allowed; ask the user to create it';
  const kind = scanSecrets(cmd);
  if (kind) return `the command contains what looks like a ${kind}; use an environment variable instead`;
  for (const sub of cmd.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean)) {
    const t = tokens(sub);
    if (t[0] === 'sudo') return 'sudo is not allowed';
    const flags = t.filter((x) => x.startsWith('-'));
    const args = t.slice(1).filter((x) => !x.startsWith('-'));
    if (t[0] === 'rm' && flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive') && args.some((a) => DANGEROUS_TARGETS.has(a) || /^\/(usr|etc|var|bin|lib|home|root)\b/.test(a))) return 'recursive delete of a root, home, or wildcard target';
    if (t[0] === 'git' && t.includes('push') && (t.includes('--force') || flags.some((f) => /^-[a-zA-Z]*f/.test(f) && !f.startsWith('--')))) return 'force push is not allowed (use a normal push or --force-with-lease after asking the user)';
    if (t[0] === 'chmod' && flags.includes('-R') && args.includes('777')) return 'chmod -R 777 is not allowed';
    if (READERS.has(t[0]) && t.slice(1).some((x) => !x.startsWith('-') && sensitive(norm(x)))) return 'reading secret files (.env, keys, secrets/) is not allowed; ask the user for the specific value you need';
    if (COPIERS.has(t[0]) && t.slice(1, -1).some((x) => !x.startsWith('-') && sensitive(norm(x)))) return 'copying secret files is not allowed';
  }
  return null;
}

// ---- pre-tool ----
if (tool === 'Bash') {
  const why = checkBash(String(ti.command || ''));
  if (why) deny(why);
  process.exit(0);
}

const filePath = ti.file_path || ti.notebook_path;
if (filePath) {
  const r = rel(String(filePath));
  const writing = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool);
  if (sensitive(r)) deny(`${r} is a secrets file. Ask the user for the specific value or use an environment variable reference.`);
  if (writing) {
    if (/(^|\/)\.git\//.test(r)) deny('editing .git internals is not allowed');
    if (cfg.lockfiles.includes(path.posix.basename(r))) deny(`${path.posix.basename(r)} is authoritative; change dependencies with the package manager (after user approval), never by hand`);
    const texts = [ti.content, ti.new_string, ti.new_source, ...((ti.edits || []).map((e) => e.new_string))].filter((x) => typeof x === 'string');
    if (!cfg.allowSecretsIn.some((a) => r.includes(a))) {
      const kind = texts.map(scanSecrets).find(Boolean);
      if (kind) deny(`the change contains what looks like a ${kind}. Use an environment variable (.env, gitignored) and add the key name to .env.example.`);
    }
    if (cfg.guardrailFiles.some((g) => (g.endsWith('/') ? r.startsWith(g) : r === g))) ask(`${r} is a guardrail file (permissions, hooks, or CI). Confirm the change is intended.`);
  }
}
process.exit(0);
