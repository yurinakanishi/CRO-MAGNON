import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json('output/downed-motion/validation.json');
assert.equal(validation.results.length, 7);
await mkdir('assets/downed-motion', { recursive: true });
await mkdir('assets/downed-motion/source-manifests', { recursive: true });
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json');
const atomic = async (f, v) => {
  await writeFile(f + '.tmp', JSON.stringify(v, null, 2) + '\n');
  await rename(f + '.tmp', f);
};
const records = [];
for (const result of validation.results) {
  const { key } = result,
    folder = `output/downed-motion/${key}`;
  const asset = await json(`${folder}/asset.json`),
    old = await json(`public/models/${key}/asset.json`),
    bytes = await readFile(`${folder}/model-downed-r01.glb`);
  await copyFile(
    `${folder}/source-asset.json`,
    `assets/downed-motion/source-manifests/${key}.json`,
  );
  assert.ok([asset.downedMotion.sourceSha256, asset.sha256].includes(old.sha256));
  assert.equal(hash(bytes), asset.sha256);
  assert.equal(result.sha256, asset.sha256);
  assert.equal(
    hash(await readFile('public' + asset.downedMotion.sourceUrl)),
    asset.downedMotion.sourceSha256,
  );
  await copyFile(`${folder}/model-downed-r01.glb`, 'public' + asset.url);
  await atomic(`public/models/${key}/asset.json`, asset);
  const i = world.assets.findIndex((a) => a.modelKey === key);
  if (i >= 0) world.assets[i] = asset;
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec) Object.assign(spec, { sha256: asset.sha256, delivery: asset.url });
  records.push({
    key,
    url: asset.url,
    sha256: asset.sha256,
    sourceUrl: asset.downedMotion.sourceUrl,
    sourceSha256: asset.downedMotion.sourceSha256,
    bytes: bytes.length,
  });
}
await atomic('public/models/world-assets.json', world);
await atomic('assets/world-models.json', catalog);
await atomic('assets/downed-motion/adoption.json', { at: new Date().toISOString(), records });
await copyFile('output/downed-motion/validation.json', 'assets/downed-motion/validation.json');
console.log('Adopted 7 Downed clips; all original GLBs preserved.');
