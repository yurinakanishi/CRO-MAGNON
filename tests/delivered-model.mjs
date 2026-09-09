import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Pose tests must exercise the manifest-selected revision served to players.
export async function deliveredModel(key) {
  const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  assert.ok(asset.url.startsWith(`/models/${key}/`) && asset.url.endsWith('.glb'));
  const file = path.resolve(`public${asset.url}`);
  assert.equal(path.dirname(file), path.resolve(`public/models/${key}`));
  return file;
}
