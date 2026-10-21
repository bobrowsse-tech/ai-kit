// Shared helpers for scripts/ai/*. Zero dependencies (Node >= 18).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();

const DEFAULTS = {
  roots: ['src', 'app', 'lib', 'packages', 'apps', 'services', 'server', 'api', 'components'],
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'],
  ignore: [
    'node_modules', 'dist', 'build', '.next', 'coverage', '.git', '__pycache__', '.venv', 'venv',
    '.claude', '.ai', 'docs', 'scripts/ai', '__tests__', 'tests', 'test',
    '*.test.*', '*.spec.*', '*.d.ts', '*.stories.*',
  ],
  // Exported names that legitimately repeat across files (not flagged as possible duplicates).
  ignoreNames: ['Props', 'Params', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    'metadata', 'config', 'generateMetadata', 'dynamic', 'revalidate'],
  indexFile: 'docs/functionality-index.md',
  dupes: { minLines: 8, maxReport: 20 },
  pins: 'error', // 'error' | 'warn' | 'off' (exact-version rule for package.json / requirements*.txt)
  mcp: { clients: ['claude'], minAgeDays: 3 }, // clients: claude | vscode | cursor
  coverage: 'warn', // 'error' | 'warn' | 'off': a coverage threshold must be configured in the test tool
  authReview: 'warn', // 'error' | 'warn' | 'off': auth-related paths must be covered by CODEOWNERS
  preship: 'warn', // 'error' | 'warn' | 'off': scripts/ai/preship-check.mjs (static pre-ship security scan)
  guard: { // Shared multi-agent guard (scripts/ai/hook.mjs)
    lockfiles: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'uv.lock', 'poetry.lock', 'Cargo.lock'],
    guardrailFiles: [
      '.claude/settings.json',
      '.cursor/hooks.json',
      '.codex/hooks.json',
      '.github/hooks/ai-kit.json',
      '.gemini/settings.json',
      'scripts/ai/hook.mjs',
      '.githooks/',
      '.husky/',
      '.github/workflows/ai-guardrails.yml',
    ],
    allowSecretsIn: ['.example', '.sample', '.template', 'fixtures/', '__fixtures__/', 'docs/'],
  },
};

export function loadConfig() {
  let user = {};
  const p = path.join(ROOT, '.ai/config.json');
  if (fs.existsSync(p)) {
    try { user = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`[WARN] .ai/config.json is not valid JSON (${e.message}); using defaults.`); }
  }
  return {
    ...DEFAULTS,
    ...user,
    dupes: { ...DEFAULTS.dupes, ...(user.dupes || {}) },
    mcp: { ...DEFAULTS.mcp, ...(user.mcp || {}) },
    guard: { ...DEFAULTS.guard, ...(user.guard || {}) },
  };
}

function isIgnored(rel, name, ignore) {
  const segs = rel.split('/');
  return ignore.some((p) => {
    if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(name);
    }
    if (p.includes('/')) return rel === p || rel.startsWith(p + '/');
    return segs.includes(p);
  });
}

export function listSourceFiles(cfg = loadConfig()) {
  const isDir = (r) => fs.existsSync(path.join(ROOT, r)) && fs.statSync(path.join(ROOT, r)).isDirectory();
  const existing = cfg.roots.filter(isDir);
  const starts = existing.length ? existing : ['.'];
  const out = new Set();
  const visit = (rel) => {
    for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = rel === '.' ? ent.name : `${rel}/${ent.name}`;
      if (isIgnored(child, ent.name, cfg.ignore)) continue;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile() && cfg.extensions.includes(path.extname(ent.name))) out.add(child);
    }
  };
  starts.forEach(visit);
  return [...out].sort();
}

const clip = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const NOISE = /^(eslint|prettier|@ts-|ts-|istanbul|c8|biome|noqa|type:|pylint)/i;

function docAbove(lines, i) {
  let j = i - 1;
  while (j >= 0 && /^\s*@/.test(lines[j])) j--; // decorators
  if (j < 0) return '';
  const l = lines[j].trim();
  if (l.endsWith('*/')) {
    let k = j;
    while (k >= 0 && !lines[k].includes('/**')) { k--; if (j - k > 30) return ''; }
    if (k < 0) return '';
    for (let m = k; m <= j; m++) {
      const t = lines[m].replace(/^\s*\/\*\*+/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*+/, '').trim();
      if (t && !t.startsWith('@')) return clip(t);
    }
    return '';
  }
  if (l.startsWith('//')) {
    const t = l.replace(/^\/\/+\s*/, '');
    return NOISE.test(t) ? '' : clip(t);
  }
  return '';
}

const NAME = '[A-Za-z_$][\\w$]*';
const RE = {
  fn: new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${NAME})`),
  cls: new RegExp(`^export\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+(${NAME})`),
  type: new RegExp(`^export\\s+(?:declare\\s+)?(?:const\\s+)?(?:interface|type|enum)\\s+(${NAME})`),
  cnst: new RegExp(`^export\\s+(?:const|let|var)\\s+(${NAME})\\s*(?::[^=]+)?=\\s*(.*)$`),
};

function jsKind(name, isFn, rel) {
  if (!isFn) return 'const';
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (/^[A-Z]/.test(name) && /\.[jt]sx$/.test(rel)) return 'component';
  return 'fn';
}

function extractJs(rel, text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('export')) return;
    let m;
    if ((m = line.match(RE.fn))) {
      const p = line.slice(m[0].length).match(/\(([^)]*)\)/);
      out.push({ name: m[1], kind: jsKind(m[1], true, rel), params: p ? p[1] : null, desc: docAbove(lines, i), line: i + 1 });
    } else if ((m = line.match(RE.cls))) {
      out.push({ name: m[1], kind: 'class', params: null, desc: docAbove(lines, i), line: i + 1 });
    } else if ((m = line.match(RE.type))) {
      out.push({ name: m[1], kind: 'type', params: null, desc: docAbove(lines, i), line: i + 1 });
    } else if ((m = line.match(RE.cnst))) {
      const rest = m[2];
      const arrow = rest.match(/^(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*(?::[^=]+)?=>/);
      const fnExpr = rest.match(/^(?:async\s+)?function\s*\*?\s*\w*\s*\(([^)]*)\)/);
      const wrapped = /^(?:React\.)?(?:memo|forwardRef)\(/.test(rest);
      const isFn = Boolean(arrow || fnExpr || wrapped);
      const params = arrow ? (arrow[1] ?? arrow[2]) : fnExpr ? fnExpr[1] : null;
      out.push({ name: m[1], kind: jsKind(m[1], isFn, rel), params, desc: docAbove(lines, i), line: i + 1 });
    }
  });
  return out;
}

function extractPy(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(async\s+def|def|class)\s+([A-Za-z_]\w*)/);
    if (!m || m[2].startsWith('_')) return;
    let desc = '';
    for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
      const d = lines[k].trim().match(/^[rRuU]?("""|''')\s*(.*?)(?:\1)?$/);
      if (d) { desc = clip(d[2] || (lines[k + 1] || '').trim()); break; }
    }
    if (!desc && i > 0 && lines[i - 1].trim().startsWith('#')) {
      const t = lines[i - 1].trim().replace(/^#+\s*/, '');
      desc = NOISE.test(t) ? '' : clip(t);
    }
    const p = line.match(/\(([^)]*)\)/);
    out.push({ name: m[2], kind: m[1] === 'class' ? 'class' : 'fn', params: p ? p[1] : null, desc, line: i + 1 });
  });
  return out;
}

export function extractSymbols(rel, text) {
  return rel.endsWith('.py') ? extractPy(text) : extractJs(rel, text);
}

export function formatSymbol(s) {
  const callable = ['fn', 'hook', 'component'].includes(s.kind);
  const params = s.params == null ? '…' : clip(s.params.replace(/\s+/g, ' ').trim(), 60);
  const sig = callable ? `${s.name}(${params})` : s.name;
  return `- ${s.kind} \`${sig}\`${s.desc ? ' — ' + s.desc : ''}`;
}

export function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Workspace package directories (npm/yarn/pnpm workspaces, uv workspace). Relative, posix separators. */
export function workspaces() {
  const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
  const patterns = [];
  try {
    const w = JSON.parse(read('package.json') || '{}').workspaces;
    if (Array.isArray(w)) patterns.push(...w); else if (w && Array.isArray(w.packages)) patterns.push(...w.packages);
  } catch { /* ignore */ }
  let inPackages = false;
  for (const line of read('pnpm-workspace.yaml').split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages && /^\S/.test(line) && !line.startsWith('-')) inPackages = false;
    const m = inPackages && line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
    if (m) patterns.push(m[1].trim());
  }
  const uv = read('pyproject.toml').match(/\[tool\.uv\.workspace\][^[]*?members\s*=\s*\[([^\]]*)\]/);
  if (uv) for (const m of uv[1].matchAll(/['"]([^'"]+)['"]/g)) patterns.push(m[1]);

  const isPkg = (d) => fs.existsSync(path.join(ROOT, d, 'package.json')) || fs.existsSync(path.join(ROOT, d, 'pyproject.toml'));
  const subdirs = (d) => { try { return fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')).map((e) => (d === '.' ? e.name : `${d}/${e.name}`)); } catch { return []; } };
  const deep = (d, depth) => (depth < 0 ? [] : subdirs(d).flatMap((c) => [c, ...deep(c, depth - 1)]));
  const include = new Set();
  const exclude = [];
  for (let p of patterns) {
    const neg = p.startsWith('!');
    p = p.replace(/^!/, '').replace(/^\.\//, '').replace(/\/$/, '');
    if (neg) { exclude.push(p.replace(/\/\*+$/, '')); continue; }
    if (p.includes('**')) deep(p.split('**')[0].replace(/\/$/, '') || '.', 4).filter(isPkg).forEach((d) => include.add(d));
    else if (p.endsWith('/*')) subdirs(p.slice(0, -2)).filter(isPkg).forEach((d) => include.add(d));
    else if (!p.includes('*') && isPkg(p)) include.add(p);
  }
  return [...include].filter((d) => !exclude.some((x) => d === x || d.startsWith(x + '/'))).sort();
}

/** Facts for one directory (default: the project root). */
export function factsFor(dir = '.') {
  const base = path.join(ROOT, dir);
  const exists = (p) => fs.existsSync(path.join(base, p));
  const read = (p) => { try { return fs.readFileSync(path.join(base, p), 'utf8'); } catch { return ''; } };
  const pkg = (() => { try { return JSON.parse(read('package.json')); } catch { return {}; } })();
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const py = (read('pyproject.toml') + '\n' + read('requirements.txt')).toLowerCase();
  const pyHas = (n) => new RegExp(`(^|[^a-z0-9_-])${n}([^a-z0-9_-]|$)`, 'm').test(py);
  return { dir, exists, read, pkg, deps, pyHas };
}

/** Facts about the whole project: the root plus every workspace package (union of deps). */
export function projectFacts() {
  const all = ['.', ...workspaces()].map(factsFor);
  return {
    ...all[0],
    packages: all,
    deps: Object.assign({}, ...all.map((f) => f.deps).reverse()), // root wins on conflicts
    exists: (p) => all.some((f) => f.exists(p)),
    pyHas: (n) => all.some((f) => f.pyHas(n)),
  };
}
