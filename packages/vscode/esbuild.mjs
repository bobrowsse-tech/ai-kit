#!/usr/bin/env node
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const coreRoot = path.resolve(here, '../core');
const assetsOut = path.join(here, 'dist/assets');

function copyAssets() {
  fs.rmSync(assetsOut, { recursive: true, force: true });
  fs.mkdirSync(assetsOut, { recursive: true });
  fs.copyFileSync(path.join(coreRoot, 'kit.json'), path.join(assetsOut, 'kit.json'));
  fs.cpSync(path.join(coreRoot, 'template'), path.join(assetsOut, 'template'), { recursive: true });
}

copyAssets();

const ctx = await esbuild.context({
  entryPoints: [path.join(here, 'src/extension.mjs')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: path.join(here, 'dist/extension.js'),
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  // CJS output has no import.meta; point asset fallbacks at the bundle file.
  banner: {
    js: 'var __meta_url=require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__meta_url',
  },
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
