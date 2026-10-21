import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssetPath, setAssetRoot, loadKitManifest } from '@bobrowsse-tech/ai-kit-core';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core');

describe('setAssetRoot for extension bundling', () => {
  it('resolves kit.json from the override directory', () => {
    setAssetRoot(core);
    assert.equal(getAssetPath('kit.json'), path.join(core, 'kit.json'));
    assert.ok(fs.existsSync(getAssetPath('template', 'AGENTS.md')));
    assert.match(loadKitManifest().version, /^\d+\.\d+\.\d+/);
    setAssetRoot(null);
  });
});
