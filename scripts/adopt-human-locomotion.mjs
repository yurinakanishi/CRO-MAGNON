import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = process.argv[2] || 'revision-10',
  base = `output/player-gaits/${revision}`;
const keys = [
  'cro-magnon-woman',
  'cro-magnon-hunter',
  'neanderthal-woman',
  'neanderthal-hunter',
  'cat-kunoichi',
];
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const write = (p, x) => writeFile(p, JSON.stringify(x, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json(`${base}/human-validation.json`),
  review = await json(`output/playwright/human-joints/${revision}/report.json`);
assert.equal(validation.status, 'passed');
assert.equal(validation.results.length, 5);
assert.equal(review.records.length, 5);
assert.deepEqual(review.errors, []);
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json'),
  prepared = [];
for (const key of keys) {
  const a = await json(`${base}/${key}/asset.json`),
    current = await json(`public/models/${key}/asset.json`);
  assert.ok(
    [a.humanLocomotion.sourceSha256, a.sha256].includes(current.sha256),
    key + ' concurrently changed',
  );
  assert.equal(hash(await readFile(`${base}/${key}/model.glb`)), a.sha256);
  assert.equal(validation.results.find((r) => r.key === key).sha256, a.sha256);
  assert.equal(review.records.find((r) => r.key === key).sha256, a.sha256);
  assert.deepEqual(a.spearThrust, current.spearThrust);
  a.url = `/models/${key}/model-human-r${revision.slice(-2)}.glb`;
  a.humanLocomotion.status = 'adopted';
  a.humanLocomotion.previousVisualReview = a.provenance.visualReview;
  a.playerGaits.supersededBy = 'humanLocomotion';
  a.playerRun.supersededBy = 'humanLocomotion';
  a.provenance.visualReview = `assets/human-locomotion/reviews/${key}-r${revision.slice(-2)}.json`;
  prepared.push({ key, a });
}
await mkdir('assets/human-locomotion/reviews', { recursive: true });
for (const { key, a } of prepared) {
  try {
    await copyFile(`${base}/${key}/model.glb`, 'public' + a.url, 1);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile('public' + a.url)), a.sha256);
  }
  await write(a.provenance.visualReview, {
    decision: 'adopt',
    at: new Date().toISOString(),
    key,
    revision,
    sha256: a.sha256,
    source: a.humanLocomotion.sourceDelivery,
    sourceSha256: a.humanLocomotion.sourceSha256,
    modifiedClips: ['Walk_Loop', 'Run_Loop'],
    motionSources: [
      'https://mocap.cs.cmu.edu/subjects/35/35_01.amc',
      'https://mocap.cs.cmu.edu/subjects/09/09_01.amc',
    ],
    preserved:
      'Original binary prefix, nodes, mesh, skin weights, bind transforms, UV, materials, images, all other animation clips and the two-handed spear attack.',
    measurement: 'assets/human-locomotion/validation.json',
    evidence: `output/playwright/human-joints/${revision}/`,
    review: 'assets/human-locomotion/README.md',
  });
  await write(`public/models/${key}/asset.json`, a);
  const i = world.assets.findIndex((v) => v.modelKey === key);
  if (i >= 0) world.assets[i] = a;
  const spec = catalog.assets.find((v) => v.key === key);
  if (spec)
    Object.assign(spec, {
      sha256: a.sha256,
      delivery: a.url,
      gameQA: 'assets/human-locomotion/README.md',
    });
}
await write('public/models/world-assets.json', world);
await write('assets/world-models.json', catalog);
await write('assets/human-locomotion/validation.json', validation);
await write('assets/human-locomotion/adoption.json', {
  at: new Date().toISOString(),
  revision,
  records: prepared.map(({ key, a }) => ({
    key,
    url: a.url,
    sha256: a.sha256,
    bytes: a.bytes,
    source: a.humanLocomotion.sourceDelivery,
  })),
});
console.log('Adopted human walk/run:', revision);
