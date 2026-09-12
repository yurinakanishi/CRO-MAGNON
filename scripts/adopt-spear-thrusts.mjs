import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const revision = process.argv[2] || 'revision-02',
  base = `output/spear-thrusts/${revision}`;
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  write = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json(`${base}/validation.json`),
  review = await json(`output/playwright/spear-thrusts/${revision}/report.json`),
  catalog = await json('assets/world-models.json'),
  world = await json('public/models/world-assets.json'),
  records = [];
assert.equal(validation.results.length, 4);
assert.equal(review.records.length, 4);
assert.deepEqual(review.errors, []);
await mkdir('assets/spear-thrusts/source-manifests', { recursive: true });
for (const { key } of CHARACTER_MODELS.filter((m) => ['cro', 'nea'].includes(m.species))) {
  const asset = await json(`${base}/${key}/asset.json`),
    current = await json(`public/models/${key}/asset.json`),
    bytes = await readFile(`${base}/${key}/model.glb`);
  assert.equal(hash(bytes), asset.sha256);
  assert.equal(bytes.length, asset.bytes);
  assert.ok(
    [asset.sha256, asset.spearThrust.sourceSha256].includes(current.sha256),
    `${key} changed during review`,
  );
  assert.equal(validation.results.find((r) => r.key === key).sha256, asset.sha256);
  assert.equal(review.records.find((r) => r.key === key).sha256, asset.sha256);
  const url = `/models/${key}/model-thrust-r${revision.slice(-2)}.glb`;
  try {
    await copyFile(`${base}/${key}/model.glb`, 'public' + url, 1);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile('public' + url)), asset.sha256);
  }
  if (!current.spearThrust)
    await write(`assets/spear-thrusts/source-manifests/${key}.json`, current);
  asset.url = url;
  asset.spearThrust.status = 'adopted';
  asset.spearThrust.review = 'assets/spear-thrusts/README.md';
  await write(`public/models/${key}/asset.json`, asset);
  const i = world.assets.findIndex((a) => a.modelKey === key);
  if (i >= 0) world.assets[i] = asset;
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec)
    Object.assign(spec, {
      sha256: asset.sha256,
      delivery: url,
      gameQA: 'assets/spear-thrusts/README.md',
    });
  records.push({
    key,
    url,
    sha256: asset.sha256,
    bytes: asset.bytes,
    sourceSha256: asset.spearThrust.sourceSha256,
  });
}
await write('public/models/world-assets.json', world);
await write('assets/world-models.json', catalog);
await write('assets/spear-thrusts/adoption.json', {
  revision,
  at: new Date().toISOString(),
  records,
});
await write('assets/spear-thrusts/validation.json', validation);
console.log('Adopted four two-handed spear thrusts', revision);
