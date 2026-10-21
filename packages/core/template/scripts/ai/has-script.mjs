#!/usr/bin/env node
// Exit 0 if package.json defines the given npm script (used by CI to skip missing steps).
import fs from 'node:fs';
try {
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  process.exit(p.scripts && p.scripts[process.argv[2]] ? 0 : 1);
} catch { process.exit(1); }
