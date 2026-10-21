#!/usr/bin/env node
// Shared agent guardrails — one policy, per-agent protocol adapters.
//   pre-tool  Claude Code PreToolUse (exit 2 = deny; ask JSON; empty allow)
//   cursor    Cursor hooks (always emit {permission}; required with failClosed)
//   codex     Codex PreToolUse (Claude-like hookSpecificOutput / exit 2)
//   copilot   Copilot / VS Code Agent preToolUse (permissionDecision JSON)
//   gemini    Gemini CLI BeforeTool ({decision, reason} / exit 2)
//   stop      Refresh functionality-index.md + .agents/skills mirror
// Registered in .claude/settings.json, .cursor/hooks.json, .codex/hooks.json,
// .github/hooks/ai-kit.json, and .gemini/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MODES = new Set(['pre-tool', 'cursor', 'codex', 'copilot', 'gemini', 'stop']);
const mode = process.argv[2];
if (!MODES.has(mode)) {
  console.error('usage: hook.mjs pre-tool|cursor|codex|copilot|gemini|stop');
  process.exit(2);
}

let input = {};
if (mode !== 'stop') {
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch {
    if (mode === 'cursor') console.log(JSON.stringify({ permission: 'allow' }));
    else if (mode === 'copilot') console.log(JSON.stringify({ permissionDecision: 'allow' }));
    else if (mode === 'gemini') console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }
}

const rootHint = process.env.CLAUDE_PROJECT_DIR
  || process.env.GEMINI_PROJECT_DIR
  || (input.cwd && fs.existsSync(input.cwd) ? input.cwd : null)
  || (Array.isArray(input.workspace_roots) && input.workspace_roots[0])
  || null;
if (rootHint) {
  try { process.chdir(rootHint); } catch { /* keep cwd */ }
}

const { ROOT, loadConfig } = await import('./lib.mjs');
const cfg = loadConfig().guard;

// ---- shared helpers ----
// Separators: accept / and \ so Windows absolute paths match even before norm().
const ENV_FILE = /(^|[\\/])\.env(\.[^\\/]+)?$/i;
const ENV_SAFE = /\.(example|sample|template|dist)$/i;
const isEnvFile = (p) => ENV_FILE.test(String(p)) && !ENV_SAFE.test(String(p));
const SECRET_PATH = [
  /(^|[\\/])secrets?[\\/]/i,
  /\.(pem|p12|pfx)$/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|[\\/])\.aws[\\/]credentials$/i,
];
/** Slash-normalize; fold drive letter so Windows short-name / case mismatches still match. */
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/^([a-zA-Z]):/, (_, d) => `${d.toUpperCase()}:`);
const sensitive = (p) => {
  const n = norm(p);
  return isEnvFile(n) || isEnvFile(path.posix.basename(n)) || SECRET_PATH.some((r) => r.test(n));
};
/**
 * Project-relative path for policy checks. On Windows, path.relative(ROOT, abs) can escape when
 * cwd uses an 8.3 short path and the tool passes a long path (or drive-letter case differs).
 * Fall back to the absolute normalized form so .env / secrets/ still match.
 */
const rel = (p) => {
  const raw = String(p);
  if (!path.isAbsolute(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return norm(path.normalize(raw));
  const abs = path.resolve(raw);
  let r = path.relative(path.resolve(ROOT), abs);
  r = norm(r);
  if (!r || r === '.' || r.startsWith('../') || /^[A-Za-z]:/.test(r)) return norm(abs);
  return r;
};
/** True when any path form (relative, absolute, basename) is a secrets path. Always norms first. */
const sensitiveAny = (p) => sensitive(rel(p)) || sensitive(p);

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
    if (READERS.has(t[0]) && t.slice(1).some((x) => !x.startsWith('-') && sensitiveAny(x))) return 'reading secret files (.env, keys, secrets/) is not allowed; ask the user for the specific value you need';
    if (COPIERS.has(t[0]) && t.slice(1, -1).some((x) => !x.startsWith('-') && sensitiveAny(x))) return 'copying secret files is not allowed';
  }
  return null;
}

/** @returns {{ decision: 'allow'|'deny'|'ask', reason?: string }} */
function evaluateFile(filePath, { writing, texts = [] } = {}) {
  if (!filePath) return { decision: 'allow' };
  const raw = String(filePath);
  const r = rel(raw);
  if (sensitiveAny(raw)) {
    const label = sensitive(r) || isEnvFile(path.posix.basename(r)) ? r : path.posix.basename(norm(raw));
    return { decision: 'deny', reason: `${label} is a secrets file. Ask the user for the specific value or use an environment variable reference.` };
  }
  if (!writing) return { decision: 'allow' };
  if (/(^|[\\/])\.git([\\/]|$)/i.test(r) || /(^|[\\/])\.git([\\/]|$)/i.test(norm(raw))) {
    return { decision: 'deny', reason: 'editing .git internals is not allowed' };
  }
  const base = path.posix.basename(r.includes('/') || r.includes(':') ? r : norm(raw));
  if (cfg.lockfiles.includes(base) || cfg.lockfiles.includes(path.posix.basename(norm(raw)))) {
    return { decision: 'deny', reason: `${base} is authoritative; change dependencies with the package manager (after user approval), never by hand` };
  }
  if (!cfg.allowSecretsIn.some((a) => r.includes(a) || norm(raw).includes(a))) {
    const kind = texts.map(scanSecrets).find(Boolean);
    if (kind) return { decision: 'deny', reason: `the change contains what looks like a ${kind}. Use an environment variable (.env, gitignored) and add the key name to .env.example.` };
  }
  if (cfg.guardrailFiles.some((g) => {
    if (g.endsWith('/')) return r.startsWith(g) || norm(raw).includes(`/${g}`);
    return r === g || norm(raw).endsWith(`/${g}`) || path.posix.basename(norm(raw)) === path.posix.basename(g);
  })) {
    return { decision: 'ask', reason: `${r} is a guardrail file (permissions, hooks, or CI). Confirm the change is intended.` };
  }
  return { decision: 'allow' };
}

function toolTexts(ti) {
  return [ti.content, ti.contents, ti.new_string, ti.new_source, ti.old_string, ...((ti.edits || []).map((e) => e.new_string))]
    .filter((x) => typeof x === 'string');
}

function toolPath(ti) {
  return ti.file_path || ti.path || ti.absolute_path || ti.notebook_path || ti.target_file || null;
}

function shellCommand(ti) {
  if (typeof ti.command === 'string') return ti.command;
  if (Array.isArray(ti.command)) return ti.command.join(' ');
  if (typeof ti.cmd === 'string') return ti.cmd;
  return '';
}

function parseApplyPatchPaths(patch) {
  const paths = [];
  for (const m of String(patch).matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm)) paths.push(m[1].trim());
  for (const m of String(patch).matchAll(/^diff --git a\/(.+?) b\//gm)) paths.push(m[1].trim());
  return paths;
}

/** Normalize any agent tool call into a shared decision. */
function evaluateToolUse(toolName, tiRaw) {
  let ti = tiRaw || {};
  if (typeof ti === 'string') {
    try { ti = JSON.parse(ti); } catch { ti = { command: ti }; }
  }
  const tool = String(toolName || '');

  if (/^(Bash|Shell|bash|shell|powershell|run_shell_command)$/i.test(tool)) {
    const why = checkBash(shellCommand(ti));
    if (why) return { decision: 'deny', reason: why };
    return { decision: 'allow' };
  }

  if (/^apply_patch$/i.test(tool)) {
    const patch = shellCommand(ti) || String(ti.patch || '');
    const kind = scanSecrets(patch);
    if (kind) return { decision: 'deny', reason: `the change contains what looks like a ${kind}. Use an environment variable (.env, gitignored) and add the key name to .env.example.` };
    for (const p of parseApplyPatchPaths(patch)) {
      const r = evaluateFile(p, { writing: true, texts: [patch] });
      if (r.decision !== 'allow') return r;
    }
    return { decision: 'allow' };
  }

  if (/^(Read|view|read_file|Grep|grep|rg|Glob|glob|list_directory)$/i.test(tool)) {
    const p = toolPath(ti) || ti.pattern || '';
    // Evaluate any path-like string, including Windows backslashes and drive letters.
    if (typeof p === 'string' && (p.includes('/') || p.includes('\\') || p.startsWith('.') || /^[A-Za-z]:/.test(p))) {
      return evaluateFile(p, { writing: false });
    }
    return { decision: 'allow' };
  }

  if (/^(Write|Edit|MultiEdit|NotebookEdit|StrReplace|Delete|ApplyPatch|create|write_file|replace|str_replace_editor)$/i.test(tool)
    || /write|edit|delete|patch|strreplace|replace/i.test(tool)) {
    return evaluateFile(toolPath(ti), { writing: true, texts: toolTexts(ti) });
  }

  // Unknown tool: allow (do not block MCP etc. by default).
  return { decision: 'allow' };
}

function runStop() {
  const run = (script) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/ai', script)], { cwd: ROOT, stdio: 'ignore', timeout: 60000 });
  if (fs.existsSync(path.join(ROOT, 'docs/functionality-index.md'))) run('build-index.mjs');
  if (fs.existsSync(path.join(ROOT, '.claude/skills'))) run('sync-agents.mjs');
  // Emit empty JSON so Gemini (and similar) do not warn on empty stdout.
  console.log('{}');
  process.exit(0);
}

if (mode === 'stop') runStop();

// ---- Claude Code ----
if (mode === 'pre-tool') {
  const deny = (msg) => { console.error(`[ai-kit guard] Blocked: ${msg}`); process.exit(2); };
  const ask = (reason) => {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `[ai-kit guard] ${reason}` } }));
    process.exit(0);
  };
  const result = evaluateToolUse(input.tool_name, input.tool_input);
  if (result.decision === 'deny') deny(result.reason);
  if (result.decision === 'ask') ask(result.reason);
  process.exit(0);
}

// ---- Cursor ----
if (mode === 'cursor') {
  const out = (permission, reason) => {
    const msg = reason ? `[ai-kit guard] ${reason}` : undefined;
    const body = { permission };
    if (permission !== 'allow' && msg) { body.user_message = msg; body.agent_message = msg; }
    console.log(JSON.stringify(body));
    process.exit(0);
  };
  const event = input.hook_event_name || '';
  if (event === 'beforeShellExecution') {
    const why = checkBash(String(input.command || ''));
    if (why) out('deny', why);
    out('allow');
  }
  if (event === 'beforeReadFile' || event === 'beforeTabFileRead') {
    const result = evaluateFile(input.file_path || '', { writing: false });
    if (result.decision === 'deny') out('deny', result.reason);
    out('allow');
  }
  if (event === 'preToolUse') {
    const tool = input.tool_name || '';
    if (tool === 'Shell' || tool === 'Bash' || tool === 'Read' || tool === 'Grep') out('allow');
    const result = evaluateToolUse(tool, input.tool_input);
    out(result.decision, result.reason);
  }
  out('allow');
}

// ---- Codex (Claude-like PreToolUse) ----
if (mode === 'codex') {
  const event = input.hook_event_name || 'PreToolUse';
  if (event === 'Stop' || event === 'stop') runStop();
  const deny = (msg) => {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[ai-kit guard] ${msg}` } }));
    process.exit(0);
  };
  const ask = (reason) => {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `[ai-kit guard] ${reason}` } }));
    process.exit(0);
  };
  const result = evaluateToolUse(input.tool_name, input.tool_input);
  if (result.decision === 'deny') deny(result.reason);
  if (result.decision === 'ask') ask(result.reason);
  process.exit(0);
}

// ---- Copilot / VS Code Agent ----
if (mode === 'copilot') {
  const event = input.hook_event_name || input.eventName || '';
  if (/^stop$/i.test(event) || event === 'agentStop') runStop();
  const tool = input.tool_name || input.toolName || '';
  const ti = input.tool_input || input.toolArgs || {};
  const result = evaluateToolUse(tool, ti);
  const decision = result.decision === 'ask' ? 'ask' : result.decision;
  const body = { permissionDecision: decision };
  if (decision !== 'allow' && result.reason) body.permissionDecisionReason = `[ai-kit guard] ${result.reason}`;
  // Also emit Claude-shaped output for PascalCase PreToolUse / VS Code Agent hooks.
  if (decision !== 'allow') {
    body.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: body.permissionDecisionReason,
    };
  }
  console.log(JSON.stringify(body));
  process.exit(0);
}

// ---- Gemini CLI ----
if (mode === 'gemini') {
  const event = input.hook_event_name || '';
  if (event === 'AfterAgent' || event === 'SessionEnd') runStop();
  const result = evaluateToolUse(input.tool_name, input.tool_input);
  if (result.decision === 'deny') {
    console.log(JSON.stringify({ decision: 'deny', reason: `[ai-kit guard] ${result.reason}` }));
    process.exit(0);
  }
  if (result.decision === 'ask') {
    // Gemini BeforeTool has no ask — deny with a clear reason so the agent stops.
    console.log(JSON.stringify({ decision: 'deny', reason: `[ai-kit guard] ${result.reason} (confirm with a human before editing guardrail files)` }));
    process.exit(0);
  }
  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}
