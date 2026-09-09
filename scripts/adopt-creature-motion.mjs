// Explicit adoption of the visually reviewed revision. Existing GLB URLs remain valid.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, readdir, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { MOTION_KEYS } from './motion-glb.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const revision = 'revision-04',
  base = `output/creature-motion/${revision}`;
const reviewed = await json(`${base}/validation.json`);
assert.equal(reviewed.results.length, 8);
assert.equal(
  (
    await json(
      `output/playwright/creature-motion-20260909/exact-glb/${revision}/capture-report.json`,
    )
  ).records.length,
  8,
);
assert.equal(
  (
    await json(
      `output/playwright/creature-motion-20260909/exact-glb/${revision}/runtime-capture-report.json`,
    )
  ).records.length,
  6,
);
await mkdir('assets/creature-motion/models', { recursive: true });
async function atomicJSON(file, data) {
  await writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await rename(file + '.tmp', file);
}
const originalFiles = [];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.endsWith('.glb') && entry.name !== 'model-motion-r04.glb')
      originalFiles.push({ file, sha256: hash(await readFile(file)) });
  }
}
await scan('public/models');
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json');
for (const key of MOTION_KEYS) {
  const current = await json(`public/models/${key}/asset.json`),
    asset = await json(`${base}/${key}/asset.json`);
  assert.ok(
    [asset.motionReview.sourceSha256, asset.sha256].includes(current.sha256),
    `${key}: delivery changed since review`,
  );
  const bytes = await readFile(`${base}/${key}/model.glb`);
  assert.equal(hash(bytes), asset.sha256);
  const filename = `public/models/${key}/model-motion-r04.glb`;
  try {
    await copyFile(`${base}/${key}/model.glb`, filename, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(hash(await readFile(filename)), asset.sha256);
  }
  asset.url = `/models/${key}/model-motion-r04.glb`;
  const reviewPath = `assets/creature-motion/models/${key}-review.json`;
  asset.provenance.previousMotionVisualReview = asset.provenance.visualReview;
  asset.provenance.candidateFile = `${base}/${key}/model.glb`;
  asset.provenance.visualReview = reviewPath;
  Object.assign(asset.motionReview, {
    status: 'adopted',
    sourceDelivery: `output/creature-motion/baseline/${key}/model.glb`,
    review: reviewPath,
  });
  await atomicJSON(reviewPath, {
    decision: 'adopt',
    at: new Date().toISOString(),
    key,
    revision,
    sha256: asset.sha256,
    sourceSha256: asset.motionReview.sourceSha256,
    sourceKind:
      'Previously delivered TRELLIS-derived GLB; original generation workspace unavailable on this host.',
    modifiedClips: ['Walk_Loop', 'Run_Loop'],
    preserved:
      'Original binary prefix, meshes, skins, bones, UVs, materials, textures and all other clips.',
    evidence: `output/playwright/creature-motion-20260909/exact-glb/${revision}/${key}-angle.png`,
    measurement: `${base}/validation.json`,
    skinMeasurement: `${base}/skin-validation.json`,
    scope:
      'All embedded clips sampled in four views and video; six player skins additionally checked with runtime Jump/Ride/Boat poses. Detailed review and limitations: assets/creature-motion/README.md.',
  });
  await atomicJSON(`public/models/${key}/asset.json`, asset);
  const index = world.assets.findIndex((a) => a.modelKey === key);
  if (index >= 0) world.assets[index] = asset;
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec) Object.assign(spec, { sha256: asset.sha256, delivery: asset.url, gameQA: reviewPath });
}
await atomicJSON('public/models/world-assets.json', world);
await atomicJSON('assets/world-models.json', catalog);
for (const record of originalFiles) assert.equal(hash(await readFile(record.file)), record.sha256);
await atomicJSON('assets/creature-motion/adoption.json', {
  at: new Date().toISOString(),
  revision,
  models: MOTION_KEYS,
  originalFiles,
  newRevisionFiles: 8,
  serverRestart: false,
});
console.log(
  `Adopted ${MOTION_KEYS.length} motion revisions; ${originalFiles.length} existing GLBs remain byte-identical.`,
);
