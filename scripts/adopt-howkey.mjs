import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { loadMotion } from './motion-glb.mjs';

const key = 'howkey-scientist',
  revision = process.argv[2] || '03';
assert.match(revision, /^\d{2}$/);
const model = `output/model-generation/models/${key}`;
const folder = `${model}/work/final/revision-${revision}/${key}`;
const source = `${folder}/model-downed-r01.glb`;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, o) => writeFile(p, JSON.stringify(o, null, 2) + '\n');
const review = await json('assets/howkey-scientist/adoption.json');
const bytes = await readFile(source),
  sha256 = hash(bytes);
assert.equal(review.sha256, sha256);
assert.equal(review.decision, 'adopt');
assert.equal(review.visualGate, 'passed');
assert.equal(review.browserGate, 'passed');
const numeric = await json(`${folder}/qa/numeric.json`);
assert.equal(numeric.sha256, sha256);
assert.equal(numeric.numericPass, true);
const sourceAsset = await json(`${folder}/asset.json`);
assert.equal(sourceAsset.sha256, sha256);
const inspection = JSON.parse(
  execFileSync(process.execPath, ['scripts/inspect-glb.mjs', source, '--humanoid', '--hunting'], {
    encoding: 'utf8',
  }),
);
assert.equal(inspection.validation, 'passed');
assert.equal(inspection.animations.length, 10);
const g = await loadMotion(source),
  bounds = new THREE.Box3().setFromObject(g.scene, true);
const size = bounds.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y - 1.55) < 0.005);
assert.ok(Math.abs(bounds.min.y) < 0.005);
const dest = `public/models/${key}`;
await mkdir(dest, { recursive: true });
async function retain(from, to) {
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  assert.equal(hash(await readFile(from)), hash(await readFile(to)));
}
await retain(source, `${dest}/model-r${revision}.glb`);
await retain(`${model}/qa/final-${revision}/portrait.png`, `${dest}/portrait.png`);
const referenceImage = 'assets/howkey-scientist/source/reference-v2.png';
const manifest = {
  modelKey: key,
  name: 'Howkey 科学使い',
  kind: 'humanoid',
  candidate: 1,
  revision,
  status: 'reviewed-prototype',
  species: 'howkey',
  gender: 'female',
  url: `/models/${key}/model-r${revision}.glb`,
  sha256,
  bytes: bytes.length,
  triangles: inspection.triangles,
  bones: inspection.skins[0].joints,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: size.y,
  widthMetres: size.x,
  placement: { pivot: 'ground-centred', min: bounds.min.toArray(), max: bounds.max.toArray() },
  clips: inspection.animations.map((a) => ({
    name: a.name,
    seconds: a.duration,
    loop: a.name.endsWith('_Loop'),
  })),
  locomotion: sourceAsset.locomotion,
  humanLocomotion: { ...sourceAsset.humanLocomotion, status: 'reviewed' },
  downedMotion: sourceAsset.downedMotion,
  lods: [],
  provenance: {
    provider: 'Codex',
    claudeUsed: false,
    referenceGenerator: 'Built-in imagegen',
    referenceImage,
    referenceSha256: hash(await readFile(referenceImage)),
    reconstruction:
      'Local TRELLIS-2 v0.8.1; retained dense geometry, source-preserving reduction and 28-joint skin.',
    candidateFile: source,
    visualReview: 'assets/howkey-scientist/adoption.json',
  },
  notes: review.notes,
};
await save(`${dest}/asset.json`, manifest);
const catalog = await json('assets/world-models.json');
assert.ok(
  !catalog.assets.some((a) => a.key === key),
  'Howkey already adopted; use an explicit revision update',
);
catalog.assets.push({
  key,
  name: manifest.name,
  kind: 'humanoid',
  height: size.y,
  geometryResolution: 1024,
  referenceVersion: 2,
  status: 'adopted-awaiting-game-QA',
  sha256,
  delivery: manifest.url,
  subject:
    'Adult anime scientist, sage bob with cream tips, round glasses, blue grey eyes, white lab coat, charcoal suit and red badge.',
});
await save('assets/world-models.json', catalog);
await save(`${model}/qa/delivery-inspection.json`, inspection);
await save(`${model}/qa/delivery-manifest.json`, manifest);
console.log(JSON.stringify({ key, sha256, triangles: manifest.triangles, bytes: bytes.length }));
