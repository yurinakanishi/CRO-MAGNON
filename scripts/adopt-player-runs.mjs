// Publish a reviewed Run_Loop under a new local asset URL, retaining all history.
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

const revision = process.argv[2] || 'revision-05',
  base = `output/player-gaits/${revision}`;
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const write = (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json(`${base}/run-validation.json`);
const review = await json(`output/playwright/player-gaits/${revision}/report.json`);
assert.equal(validation.results.length, 7);
assert.equal(review.records.length, 7);
assert.deepEqual(review.errors, []);
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json');
const prepared = [];
for (const { key } of CHARACTER_MODELS) {
  const asset = await json(`${base}/${key}/asset.json`),
    current = await json(`public/models/${key}/asset.json`);
  assert.ok(
    [asset.playerRun.sourceSha256, asset.sha256].includes(current.sha256),
    key + ' concurrent delivery change',
  );
  assert.equal(hash(await readFile(`${base}/${key}/model.glb`)), asset.sha256);
  assert.equal(validation.results.find((r) => r.key === key).sha256, asset.sha256);
  assert.equal(review.records.find((r) => r.key === key).revision, revision);
  assert.deepEqual(current.spearThrust, asset.spearThrust);
  asset.url = `/models/${key}/model-run-r${revision.slice(-2)}.glb`;
  asset.playerRun.status = 'adopted';
  asset.playerRun.review = 'assets/player-gaits/RUN_REPAIR.md';
  prepared.push({ key, asset });
}
for (const { key, asset } of prepared) {
  try {
    await copyFile(`${base}/${key}/model.glb`, 'public' + asset.url, 1);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile('public' + asset.url)), asset.sha256);
  }
  await write(`public/models/${key}/asset.json`, asset);
  const i = world.assets.findIndex((a) => a.modelKey === key);
  if (i >= 0) world.assets[i] = asset;
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec)
    Object.assign(spec, {
      sha256: asset.sha256,
      delivery: asset.url,
      gameQA: 'assets/player-gaits/RUN_REPAIR.md',
    });
}
await write('public/models/world-assets.json', world);
await write('assets/world-models.json', catalog);
await write('assets/player-gaits/run-validation.json', validation);
await write('assets/player-gaits/run-adoption.json', {
  revision,
  at: new Date().toISOString(),
  records: prepared.map(({ key, asset }) => ({
    key,
    url: asset.url,
    sha256: asset.sha256,
    source: asset.playerRun.sourceDelivery,
  })),
});
console.log('Adopted seven repaired running clips:', revision);
