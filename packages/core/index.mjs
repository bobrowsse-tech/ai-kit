// Shared core for CLI and the VS Code extension. No console / process.exit.
export { getAssetPath, loadKitManifest, setAssetRoot, CORE_DIR } from './assets.mjs';
export { installKit } from './install-engine.mjs';
export { checkDocs, REQUIRED_DOCS } from './check-docs.mjs';
