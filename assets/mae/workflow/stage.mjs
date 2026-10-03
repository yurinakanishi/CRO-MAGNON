// Adopt only the exact reviewed Candidate 1. Existing model bytes stay unchanged.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = 'output/model-generation/models/mae/work/rig/revision-01/';
const qa = 'output/model-generation/models/mae/qa/final-01/';
const bytes = await readFile(base + 'candidate.glb'),
  sha256 = hash(bytes);
const numeric = await read(base + 'qa/numeric.json'),
  rig = await read(base + 'rig.json');
const viewer = await read(qa + 'viewer-qa.json'),
  angles = await read(qa + 'motion-angles/qa.json');
const review = await read('assets/mae/visual-review-r01.json');
for (const item of [numeric, angles, review]) assert.equal(item.sha256, sha256);
assert.ok(numeric.numericPass && viewer.passed && angles.passed);
assert.equal(review.decision, 'visual-approved-for-game-qa');
const inspection = JSON.parse(
  execFileSync(process.execPath, ['scripts/inspect-glb.mjs', base + 'candidate.glb'], {
    encoding: 'utf8',
  }),
);
assert.equal(inspection.validation, 'passed');
assert.equal(inspection.animations.length, 6);
const world = await read('public/models/world-assets.json'),
  catalog = await read('assets/world-models.json');
assert.ok(!world.assets.some((a) => a.modelKey === 'mae'), 'Do not overwrite an earlier adoption');
const prior = [];
for (const a of world.assets)
  for (const entry of [a, ...(a.lods ?? [])]) {
    if (!entry.url?.endsWith('.glb')) continue;
    const actual = hash(await readFile('public' + entry.url));
    assert.equal(actual, entry.sha256, entry.url);
    prior.push({ url: entry.url, sha256: actual });
  }
await save('assets/mae/existing-assets-before.json', prior);
const destination = 'public/models/mae';
await mkdir(destination, { recursive: true });
for (const [from, to] of [
  [base + 'candidate.glb', 'model-r01.glb'],
  [base + 'lod.glb', 'lod-r01.glb'],
  ['assets/mae/source/reference-v1.png', 'portrait.png'],
]) {
  await copyFile(from, destination + '/' + to, constants.COPYFILE_EXCL);
  assert.equal(hash(await readFile(from)), hash(await readFile(destination + '/' + to)));
}
const lod = await readFile(base + 'lod.glb');
const asset = {
  modelKey: 'mae',
  name: 'mae',
  kind: 'companion',
  candidate: 1,
  revision: '01',
  status: 'candidate-game-QA',
  url: '/models/mae/model-r01.glb',
  sha256,
  bytes: bytes.length,
  triangles: inspection.triangles,
  bones: 4,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: rig.heightMetres,
  widthMetres: rig.widthMetres,
  lengthMetres: rig.lengthMetres,
  placement: { pivot: 'ground-centred', scale: 1 },
  portrait: {
    url: '/models/mae/portrait.png',
    sha256: hash(await readFile('assets/mae/source/reference-v1.png')),
  },
  clips: inspection.animations.map((c) => ({
    name: c.name,
    seconds: c.duration,
    loop: c.name.endsWith('_Loop'),
    rootMotion: 'in-place',
    fps: 60,
  })),
  locomotion: rig.locomotion,
  lods: [
    {
      url: '/models/mae/lod-r01.glb',
      sha256: hash(lod),
      bytes: lod.length,
      triangles: numeric.lod.triangles,
      distanceMetres: 9,
      purpose: 'animated-medium-lod-geometry',
    },
  ],
  provenance: {
    provider: 'Codex',
    claudeUsed: false,
    referenceGenerator: 'Built-in imagegen',
    referenceImage: 'assets/mae/source/reference-v1.png',
    referenceSha256: hash(await readFile('assets/mae/source/reference-v1.png')),
    userReference: 'assets/mae/source/mae.jpg',
    userReferenceSha256: hash(await readFile('assets/mae/source/mae.jpg')),
    reconstruction:
      'Local TRELLIS-2 v0.8.1 Vulkan / GPU 1 / 512 / seed42 / threshold cutout; measured source-preserving reduction and soft pouch rig.',
    denseSha256: rig.sourceSha256,
    sourceUvAndAlbedoPreserved: true,
    candidateFile: base + 'candidate.glb',
    visualReview: 'assets/mae/visual-review-r01.json',
  },
  notes: [
    'One continuous reconstructed pouch surface; no added visible primitive geometry, limbs or accessories.',
    'Three loops and three reactions; shared skeleton, inverse bind matrices and material with LOD. PetContact follows the actual crown.',
    'The measured LOD retains 19,868 triangles because smaller candidates distorted the source silhouette.',
  ],
};
await save(destination + '/asset.json', asset);
world.assets.push(asset);
catalog.assets.push({
  key: 'mae',
  name: 'mae',
  kind: 'companion',
  height: rig.heightMetres,
  geometryResolution: 512,
  referenceVersion: 1,
  status: asset.status,
  sha256,
  delivery: asset.url,
  subject:
    'Gray rounded soft pouch with two vertical eyes and a straight mouth, based on user mae.jpg.',
});
await save('public/models/world-assets.json', world);
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({ sha256, triangles: asset.triangles, priorModelsVerified: prior.length }),
);
