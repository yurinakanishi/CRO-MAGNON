import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MODEL_BOUNDS } from '../dist/shared/model-bounds.mjs';
import { MEASURED_KEYS, measureModelBounds } from '../scripts/measure-collision-bounds.mjs';

// shared/model-bounds.mts is generated. After a measured model's delivery (its asset.json url)
// or the measurement changes, run `node scripts/measure-collision-bounds.mjs`.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('collision bounds name the GLB each asset.json and the world catalog deliver', async () => {
  assert.deepEqual(Object.keys(MODEL_BOUNDS), MEASURED_KEYS);
  const catalog = await json('public/models/world-assets.json');
  for (const key of MEASURED_KEYS) {
    const asset = await json(`public/models/${key}/asset.json`),
      listed = catalog.assets.find((entry) => entry.modelKey === key);
    assert.equal(MODEL_BOUNDS[key].sha256, asset.sha256, `${key} bounds were measured elsewhere`);
    assert.equal(sha256(await readFile(`public${asset.url}`)), asset.sha256, asset.url);
    assert.deepEqual([listed?.url, listed?.sha256], [asset.url, asset.sha256], key);
  }
});

test('every collision bound is the measurement of its delivered GLB', async () => {
  for (const key of MEASURED_KEYS)
    assert.deepEqual(MODEL_BOUNDS[key], await measureModelBounds(key), key);
});
