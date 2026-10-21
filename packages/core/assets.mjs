import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Optional override (VS Code extension sets this to its bundled assets dir). */
let assetRootOverride = null;

/** Point asset resolution at a directory that contains kit.json + template/. */
export function setAssetRoot(dir) {
  assetRootOverride = dir ? path.resolve(dir) : null;
}

/**
 * Resolve kit.json / template. When this package is vendored under
 * packages/cli/vendor/core for npm pack, assets live at the CLI package root
 * (same layout as the Phase 2 tarball). Otherwise they live beside this file.
 * Extension hosts call setAssetRoot() before installKit().
 */
export function getAssetPath(...parts) {
  if (assetRootOverride) return path.join(assetRootOverride, ...parts);
  const parent = path.dirname(CORE_DIR);
  if (path.basename(parent) === 'vendor') {
    const cliRoot = path.dirname(parent);
    if (fs.existsSync(path.join(cliRoot, 'kit.json'))) return path.join(cliRoot, ...parts);
  }
  return path.join(CORE_DIR, ...parts);
}

export function loadKitManifest() {
  return JSON.parse(fs.readFileSync(getAssetPath('kit.json'), 'utf8'));
}
