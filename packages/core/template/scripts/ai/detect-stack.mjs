#!/usr/bin/env node
// Detects the project's stack -> .ai/stack.json. With --skills, scaffolds project skills
// (.claude/skills/stack-<tech>/SKILL.md) that the agent then completes from real code
// (see the project-bootstrap skill). Never overwrites existing skills.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, projectFacts } from './lib.mjs';

const facts = projectFacts();
const { exists, pkg, deps, pyHas } = facts;

const TECH = [
  { id: 'nextjs', label: 'Next.js', dep: 'next', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    focus: ['Routing layout (app/ vs pages/) and where route handlers live', 'Server vs client component boundary and the data-fetching pattern', 'One canonical page + layout example (file paths)'] },
  { id: 'react', label: 'React', dep: 'react',
    focus: ['Component folder structure and naming', 'State management approach and shared hooks location', 'One canonical component example (file path) incl. its test'] },
  { id: 'angular', label: 'Angular', dep: '@angular/core', files: ['angular.json'],
    focus: ['Workspace layout (angular.json projects, apps vs libs) and standalone vs NgModule usage', 'State/signals and dependency-injection patterns in use', 'One canonical component + service + test example (file paths)'] },
  { id: 'vue', label: 'Vue', dep: 'vue',
    focus: ['Component style (Composition API vs Options) and folder structure', 'State management (Pinia?) and composables location', 'One canonical component example (file path) incl. its test'] },
  { id: 'svelte', label: 'Svelte', dep: 'svelte',
    focus: ['Component and store conventions (runes vs stores)', 'Routing/data-loading pattern (SvelteKit?)', 'One canonical component example (file path)'] },
  { id: 'vite', label: 'Vite', dep: 'vite', files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    focus: ['Aliases and env handling in vite.config', 'Build/preview commands and output dir'] },
  { id: 'express', label: 'Express', dep: 'express',
    focus: ['Router/middleware layout', 'Validation and error-handling pattern', 'One canonical route + handler example'] },
  { id: 'nestjs', label: 'NestJS', dep: '@nestjs/core', files: ['nest-cli.json'],
    focus: ['Module boundaries and provider conventions', 'DTO/validation pattern', 'One canonical module example'] },
  { id: 'fastify', label: 'Fastify', dep: 'fastify',
    focus: ['Plugin/route registration pattern', 'Schema validation approach'] },
  { id: 'prisma', label: 'Prisma', dep: '@prisma/client', files: ['prisma/schema.prisma'],
    focus: ['Schema location and migration workflow', 'Client singleton location', 'Mirror every model change in docs/schema.md'] },
  { id: 'drizzle', label: 'Drizzle ORM', dep: 'drizzle-orm', files: ['drizzle.config.ts', 'drizzle.config.js'],
    focus: ['Schema location and migration workflow', 'DB client location', 'Mirror every model change in docs/schema.md'] },
  { id: 'tailwind', label: 'Tailwind CSS', dep: 'tailwindcss', files: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'],
    focus: ['Tokens/theme source of truth (link docs/design.md)', 'Class-composition helper (cn/clsx) location', 'Forbidden patterns (arbitrary values, inline styles)'] },
  { id: 'vitest', label: 'Vitest', dep: 'vitest', focus: ['Test file placement/naming', 'Shared fixtures and mocks locations'] },
  { id: 'jest', label: 'Jest', dep: 'jest', focus: ['Test file placement/naming', 'Shared fixtures and mocks locations'] },
  { id: 'playwright', label: 'Playwright', dep: '@playwright/test', focus: ['E2E folder layout and page-object pattern', 'How to run against local env'] },
  { id: 'fastapi', label: 'FastAPI', py: 'fastapi', focus: ['Router/dependency layout', 'Pydantic schema location (mirror in docs/schema.md)', 'One canonical endpoint example'] },
  { id: 'django', label: 'Django', py: 'django', focus: ['App layout and settings split', 'Model/migration workflow', 'One canonical view/serializer example'] },
  { id: 'flask', label: 'Flask', py: 'flask', focus: ['Blueprint layout', 'Config and extension setup'] },
  { id: 'sqlalchemy', label: 'SQLAlchemy', py: 'sqlalchemy', focus: ['Model location and session handling', 'Migration workflow (alembic?)'] },
  { id: 'pytest', label: 'pytest', py: 'pytest', focus: ['Test layout and fixtures (conftest) locations'] },
];

const matches = (t, f) => Boolean((t.dep && f.deps[t.dep]) || (t.files || []).some(f.exists) || (t.py && f.pyHas(t.py)));
const detected = TECH.filter((t) => facts.packages.some((f) => matches(t, f)));
const usedIn = (t) => facts.packages.filter((f) => matches(t, f)).map((f) => f.dir);
const isMonorepo = facts.packages.length > 1;

const languages = [];
if (exists('tsconfig.json') || deps.typescript) languages.push('typescript');
if (exists('package.json')) languages.push('javascript');
if (exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py')) languages.push('python');
if (exists('go.mod')) languages.push('go (detected only; index/dupes scripts do not parse it)');
if (exists('Cargo.toml')) languages.push('rust (detected only; index/dupes scripts do not parse it)');

let packageManager = 'unknown';
if (exists('pnpm-lock.yaml')) packageManager = 'pnpm';
else if (exists('yarn.lock')) packageManager = 'yarn';
else if (exists('bun.lock') || exists('bun.lockb')) packageManager = 'bun';
else if (exists('package-lock.json')) packageManager = 'npm';
else if (exists('uv.lock')) packageManager = 'uv';
else if (exists('package.json')) packageManager = 'npm (NO LOCKFILE - commit one)';

const scripts = {};
for (const k of ['dev', 'start', 'build', 'test', 'lint', 'typecheck', 'format']) {
  if (pkg.scripts && pkg.scripts[k]) scripts[k] = pkg.scripts[k];
}

const cfg = loadConfig();
const stack = {
  languages,
  packageManager,
  frameworks: detected.map((t) => ({ id: t.id, label: t.label, version: (t.dep && deps[t.dep]) || null, ...(isMonorepo ? { usedIn: usedIn(t) } : {}) })),
  scripts,
  roots: cfg.roots.filter((r) => exists(r)),
  ...(isMonorepo ? {
    workspaces: facts.packages.filter((f) => f.dir !== '.').map((f) => ({
      path: f.dir,
      name: f.pkg.name || null,
      frameworks: TECH.filter((t) => matches(t, f)).map((t) => t.id),
      scripts: Object.fromEntries(['dev', 'build', 'test', 'lint'].filter((k) => f.pkg.scripts && f.pkg.scripts[k]).map((k) => [k, f.pkg.scripts[k]])),
    })),
  } : {}),
};
fs.mkdirSync(path.join(ROOT, '.ai'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.ai/stack.json'), JSON.stringify(stack, null, 2) + '\n');
console.log(`Detected: ${stack.frameworks.map((f) => f.label).join(', ') || 'no known frameworks'} | ${languages.join(', ') || 'no languages'} | pm: ${packageManager}${isMonorepo ? ` | monorepo: ${facts.packages.length - 1} workspace packages` : ''}`);
console.log('Wrote .ai/stack.json');

if (process.argv.includes('--skills')) {
  const cmds = Object.entries(scripts).map(([k, v]) => `\`${k}\` -> ${v}`).join('; ') || 'see package.json / environment.md';
  for (const t of detected) {
    const dir = path.join(ROOT, `.claude/skills/stack-${t.id}`);
    const file = path.join(dir, 'SKILL.md');
    if (fs.existsSync(file)) { console.log(`skip (exists): .claude/skills/stack-${t.id}`); continue; }
    const version = (t.dep && deps[t.dep]) || 'version: see lockfile';
    const body = [
      '---',
      `name: stack-${t.id}`,
      `description: How ${t.label} is used in THIS project (conventions, canonical examples, pitfalls). Use when creating or editing ${t.label} code, config, or tests here.`,
      '---',
      '',
      `# ${t.label} in this project`,
      '',
      '<!-- TODO(agent): scaffolded by scripts/ai/detect-stack.mjs. Replace every TODO with facts read from real code and cite file paths. Delete this comment when done. Keep under ~80 lines. -->',
      '',
      '## Detected',
      `- ${t.label} (${version}); package manager: ${packageManager}`,
      ...(isMonorepo ? [`- Used in: ${usedIn(t).map((d) => (d === '.' ? '(root)' : d)).join(', ')}`] : []),
      `- Commands: ${cmds}`,
      '',
      '## Project patterns',
      ...t.focus.map((f) => `- TODO: ${f}`),
      '',
      '## Rules',
      '- Reuse first: run `node scripts/ai/find.mjs <keywords>` before creating anything new (AGENTS.md section 3).',
      `- Verify ${t.label} APIs against current official docs before using them (AGENTS.md section 5).`,
      '- Record repeat mistakes: `node scripts/ai/remember.mjs gotcha "<text>"`.',
      '',
    ].join('\n');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, body);
    console.log(`scaffolded: .claude/skills/stack-${t.id}/SKILL.md`);
  }
}
