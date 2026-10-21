// Shared docs presence check (same 12 files as template/scripts/ai/check-docs.mjs).
import fs from 'node:fs';
import path from 'node:path';

/** Required living-docs paths under a project root (relative, posix). */
export const REQUIRED_DOCS = [
  'docs/index.md',
  'docs/architecture.md',
  'docs/design.md',
  'docs/features.md',
  'docs/userjourney.md',
  'docs/agents.md',
  'docs/conventions.md',
  'docs/schema.md',
  'docs/tasks.md',
  'docs/environment.md',
  'docs/functionality-index.md',
  'docs/memory.md',
];

const TODO_RE = /^[ \t]*[-*] (\[ \] )?TODO|TODO\(agent\)/m;

/**
 * @param {string} root Absolute project directory
 * @returns {{ ok: boolean, total: number, present: number, missing: string[], empty: string[], todo: string[] }}
 */
export function checkDocs(root) {
  const missing = [];
  const empty = [];
  const todo = [];
  for (const rel of REQUIRED_DOCS) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) missing.push(rel);
    else if (fs.statSync(p).size === 0) empty.push(rel);
    else if (TODO_RE.test(fs.readFileSync(p, 'utf8'))) todo.push(rel);
  }
  const broken = missing.length + empty.length;
  return {
    ok: broken === 0,
    total: REQUIRED_DOCS.length,
    present: REQUIRED_DOCS.length - broken,
    missing,
    empty,
    todo,
  };
}
