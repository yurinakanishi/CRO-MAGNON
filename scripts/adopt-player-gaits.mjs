// Adopt reviewed animation buffers under a new URL; keep every old GLB intact.
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const revision = process.argv[2] || 'revision-02',
  base = `output/player-gaits/${revision}`;
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json(`${base}/validation.json`),
  captures = await json(`output/playwright/player-gaits/${revision}/report.json`);
assert.equal(validation.results.length, 7);
assert.equal(captures.records.length, 7);
assert.deepEqual(captures.errors, []);
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json'),
  records = [];
await mkdir('assets/player-gaits/source-manifests', { recursive: true });
const write = async (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n');
for (const { key } of CHARACTER_MODELS) {
  const asset = await json(`${base}/${key}/asset.json`),
    current = await json(`public/models/${key}/asset.json`),
    bytes = await readFile(`${base}/${key}/model.glb`);
  assert.equal(hash(bytes), asset.sha256);
  assert.ok(
    [asset.playerGaits.sourceSha256, asset.sha256].includes(current.sha256),
    `${key}: delivery changed during review`,
  );
  assert.equal(validation.results.find((r) => r.key === key).sha256, asset.sha256);
  assert.equal(captures.records.find((r) => r.key === key).revision, revision);
  const url = `/models/${key}/model-gaits-r${revision.slice(-2)}.glb`;
  try {
    await copyFile(`${base}/${key}/model.glb`, 'public' + url, constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile('public' + url)), asset.sha256);
  }
  if (!current.playerGaits)
    await write(`assets/player-gaits/source-manifests/${key}.json`, current);
  asset.url = url;
  asset.playerGaits.status = 'adopted';
  asset.playerGaits.review = 'assets/player-gaits/README.md';
  asset.playerGaits.sourceDelivery = (
    await json(`assets/player-gaits/source-manifests/${key}.json`)
  ).url;
  asset.playerGaits.author = 'Codex';
  await write(`public/models/${key}/asset.json`, asset);
  const i = world.assets.findIndex((a) => a.modelKey === key);
  if (i >= 0) world.assets[i] = asset;
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec)
    Object.assign(spec, {
      sha256: asset.sha256,
      delivery: asset.url,
      gameQA: 'assets/player-gaits/README.md',
    });
  records.push({
    key,
    url,
    sha256: asset.sha256,
    sourceSha256: asset.playerGaits.sourceSha256,
    bytes: asset.bytes,
  });
}
await write('public/models/world-assets.json', world);
await write('assets/world-models.json', catalog);
await write('assets/player-gaits/adoption.json', {
  revision,
  at: new Date().toISOString(),
  records,
});
await write('assets/player-gaits/validation.json', validation);
console.log('Adopted seven distinct player walk/run pairs: ' + revision);
