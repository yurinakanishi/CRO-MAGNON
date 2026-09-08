import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalog = await json('assets/world-models.json');
const world = await json('public/models/world-assets.json');
const oldWorld = JSON.parse(
  execFileSync('git', ['show', 'HEAD:public/models/world-assets.json'], { encoding: 'utf8' }),
);
const files = [],
  newKeys = ['cockle-shell', 'shell-midden', 'wooden-spear', 'obsidian-spear', 'obsidian-blade'];
const specs = [...catalog.assets];
for (const { key } of CHARACTER_MODELS)
  if (!specs.some((s) => s.key === key)) {
    const asset = await json(`public/models/${key}/asset.json`);
    specs.push({ key, sha256: asset.sha256 });
  }
for (const spec of specs) {
  const asset = await json(`public/models/${spec.key}/asset.json`);
  assert.equal(asset.sha256, spec.sha256, spec.key);
  // The aggregated JSON catalog normalizes the source's -0 coordinates to 0.
  if (!CHARACTER_MODELS.some((c) => c.key === spec.key))
    assert.deepEqual(
      world.assets.find((a) => a.modelKey === spec.key),
      JSON.parse(JSON.stringify(asset)),
    );
  for (const item of [asset, ...(asset.lods || [])]) {
    const b = await readFile('public' + item.url);
    assert.equal(hash(b), item.sha256, item.url);
    assert.equal(b.length, item.bytes);
    assert.equal(b.readUInt32LE(0), 0x46546c67);
    assert.equal(b.readUInt32LE(8), b.length);
    const gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
    assert.ok(gltf.meshes.length);
    if (newKeys.includes(spec.key)) assert.equal(gltf.skins?.length || 0, 0);
    files.push({ url: item.url, sha256: hash(b), bytes: b.length });
  }
  if (newKeys.includes(spec.key)) {
    const model = await json(`assets/coastal-craft/models/${spec.key}/model.json`);
    assert.equal(hash(await readFile(model.candidateFile)), asset.sha256);
    assert.equal(
      hash(await readFile(`assets/coastal-craft/models/${spec.key}/geometry/accepted.glb`)),
      asset.sha256,
    );
  }
}
for (const old of oldWorld.assets)
  for (const item of [old, ...(old.lods || [])]) {
    assert.equal(
      files.find((f) => f.url === item.url)?.sha256,
      item.sha256,
      'Original asset preserved: ' + item.url,
    );
  }
const oldSpecs = JSON.parse(
  execFileSync('git', ['show', 'HEAD:assets/world-models.json'], { encoding: 'utf8' }),
);
for (const spec of oldSpecs.assets)
  assert.equal(catalog.assets.find((a) => a.key === spec.key)?.sha256, spec.sha256);
for (const { key } of CHARACTER_MODELS) {
  const old = JSON.parse(
    execFileSync('git', ['show', `HEAD:public/models/${key}/asset.json`], { encoding: 'utf8' }),
  );
  assert.equal(specs.find((s) => s.key === key).sha256, old.sha256);
}
const report = {
  status: 'passed',
  at: new Date().toISOString(),
  models: specs.length,
  deliveredGLBs: files.length,
  newGLBs: newKeys.length,
  originalModelsPreserved: specs.length - newKeys.length,
  files,
  limitation:
    'Delivery and current candidate validation, including active playable models outside the production catalog. This does not reconstruct missing historical source/review files.',
};
await writeFile('assets/coastal-craft/delivery-qa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, files: undefined }));
