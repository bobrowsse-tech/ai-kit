#!/usr/bin/env node
// Copy core assets into this package so `npm pack` / local CLI runs are self-contained.
// Workspace deps are not included in the published tarball; vendor/core is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.resolve(CLI, '../core');
const REPO = path.resolve(CLI, '../..');

function cpDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
  fs.copyFileSync(path.join(REPO, f), path.join(CLI, f));
}

fs.copyFileSync(path.join(CORE, 'kit.json'), path.join(CLI, 'kit.json'));
cpDir(path.join(CORE, 'template'), path.join(CLI, 'template'));

const vendor = path.join(CLI, 'vendor', 'core');
fs.rmSync(path.join(CLI, 'vendor'), { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });
for (const f of ['package.json', 'index.mjs', 'assets.mjs', 'install-engine.mjs', 'check-docs.mjs']) {
  fs.copyFileSync(path.join(CORE, f), path.join(vendor, f));
}

console.error('staged packages/cli (kit.json, template/, vendor/core/, README/CHANGELOG/LICENSE)');
