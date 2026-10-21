#!/usr/bin/env node
// CLI entry for @bobrowsse-tech/ai-kit — argv + printing + exit codes only.
// Prefer vendored core (self-contained pack); fall back to the workspace package.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorEntry = path.join(here, 'vendor/core/index.mjs');
const { installKit } = fs.existsSync(vendorEntry)
  ? await import(pathToFileURL(vendorEntry).href)
  : await import('@bobrowsse-tech/ai-kit-core');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const target = args.find((a) => !a.startsWith('--')) || '.';

const result = installKit({
  target,
  update: flag('--update'),
  dryRun: flag('--dry-run'),
  force: flag('--force'),
  resetSeeds: flag('--reset-seeds'),
  noPost: flag('--no-post'),
  io: {
    write: (line) => console.log(line),
    error: (line) => console.error(line),
  },
});

process.exit(result.exitCode);
