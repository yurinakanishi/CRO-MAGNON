import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = await json('assets/world-models.json'), world = await json('public/models/world-assets.json');
assert.equal(world.status, 'ready');
assert.deepEqual(world.assets.map(a => a.modelKey).sort(), catalog.assets.filter(a => a.kind !== 'humanoid').map(a => a.key).sort());
const results = [];
for (const spec of catalog.assets) {
  const manifest = await json(`public/models/${spec.key}/asset.json`);
  assert.equal(manifest.modelKey, spec.key); assert.equal(manifest.provenance.claudeUsed, false);
  assert.equal(manifest.sha256, spec.sha256);
  if (spec.kind !== 'humanoid') assert.deepEqual(world.assets.find(asset => asset.modelKey === spec.key), manifest);
  const review = await json(`output/model-generation/models/${spec.key}/qa/adoption-review.json`);
  assert.equal(review.decision, 'adopt'); assert.equal(review.sha256, manifest.sha256);
  const reference = await readFile(resolve(root, manifest.provenance.referenceImage));
  assert.equal(hash(reference), manifest.provenance.referenceSha256);
  for (const record of [manifest, ...manifest.lods]) {
    assert.ok(record.url.startsWith(`/models/${spec.key}/`) && record.url.endsWith('.glb'));
    const path = resolve(root, `public${record.url}`), base = resolve(root, `public/models/${spec.key}`);
    assert.ok(!relative(base, path).startsWith(`..${sep}`));
    const bytes = await readFile(path); assert.equal(bytes.byteLength, record.bytes); assert.equal(hash(bytes), record.sha256);
    const inspection = JSON.parse(execFileSync(process.execPath, [resolve(root, 'scripts/inspect-glb.mjs'), path, ...(spec.kind === 'humanoid' ? ['--humanoid'] : [])], { encoding: 'utf8' }));
    assert.equal(inspection.validation, 'passed'); assert.equal(inspection.triangles, record.triangles);
  }
  if (spec.kind === 'humanoid' || spec.kind === 'quadruped') {
    assert.ok(manifest.locomotion.Walk_Loop.metresPerSecond > 0 && manifest.locomotion.Run_Loop.metresPerSecond > 0);
    assert.equal(manifest.clips.length, spec.kind === 'humanoid' ? 8 : 4);
  }
  if (spec.kind === 'terrain') assert.equal(manifest.placement.heightField.heights.length, manifest.placement.heightField.resolution ** 2);
  if (spec.kind === 'bridge') {
    assert.ok(Number.isFinite(manifest.placement.deckHeightMetres));
    const bounds = manifest.placement.walkBounds;
    assert.ok(Object.values(bounds).every(Number.isFinite) && bounds.minX < bounds.maxX && bounds.minZ < bounds.maxZ);
  }
  if (spec.kind === 'equipment') {
    assert.equal(manifest.placement.pivot, 'grip');
    assert.equal(manifest.placement.gripNode, 'Grip.R');
    const { gripToButtMetres, gripToTipMetres } = manifest.placement;
    assert.ok(gripToButtMetres > 0 && gripToTipMetres > 0);
    assert.ok(Math.abs(gripToButtMetres + gripToTipMetres - manifest.heightMetres) < .015);
  }
  results.push({ key: spec.key, triangles: manifest.triangles, sha256: manifest.sha256 });
}
assert.equal(hash(await readFile(resolve(root, 'public/models/cro-magnon-hunter/model.glb'))), '8f92a0086c7aa3f44d4120c48c1c2ac70672c5febdb162e4b6156f361d0fc805');
console.log(JSON.stringify({ status: 'passed', models: results.length + 1, existingCroMagnonPreserved: true, assets: results }, null, 2));
