// Adopt a sabertooth rig revision: copy the verified GLB into public/models,
// write its manifest, and register it in both catalogs. Usage:
//   node scripts/adopt-sabertooth.mjs <revision> [browser-summary.json]
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const revision = process.argv[2],
  qaFile = process.argv[3];
assert.ok(revision, 'Pass the rig revision, e.g. 10');
const key = 'sabertooth-tiger',
  model = `output/model-generation/models/${key}`,
  folder = `${model}/work/rig/revision-${revision}`,
  destination = `assets/${key}`;
const process_ = await json(`${folder}/process.json`),
  numeric = await json(`${folder}/qa/numeric.json`),
  spec = await json(`${model}/request-spec.json`),
  reference = await json(`${model}/source/original/reference-v1.json`);
assert.equal(numeric.numericPass, true, 'numeric QA must pass before adoption');
const bytes = await readFile(`${folder}/candidate.glb`);
assert.equal(hash(bytes), process_.sha256);
assert.equal(numeric.sha256, process_.sha256);
await mkdir(`public/models/${key}`, { recursive: true });
await mkdir(destination, { recursive: true });
const url = `/models/${key}/model-r${revision}.glb`;
await writeFile(`public${url}`, bytes);
const review = {
  decision: 'adopt',
  sha256: process_.sha256,
  revision,
  reviewedAt: new Date().toISOString(),
  sheets: [
    `${folder}/qa/sheet-left-a.png`,
    `${folder}/qa/sheet-left-b.png`,
    `${folder}/qa/sheet-tq.png`,
    `${folder}/qa/sheet-front.png`,
  ],
  notes:
    revision >= '12'
      ? 'Eleven pose sheets (left, three-quarter, front) reviewed: lateral walk, rotary gallop, the new Crouch telegraph (body sunk, hindquarters gathered, tail lashing) before the pounce, the new Snarl telegraph (rocked back, head shaking, a forepaw raised) before the two-swipe claw, tucked side-step hop, side collapse death. Fur tufts and sabers stay attached; no limb tearing at the belly.'
      : 'Nine pose sheets (left, three-quarter, front) reviewed: lateral walk, rotary gallop, crouch-leap-land pounce with reaching forelegs, two-swipe claw, tucked side-step hop, side collapse death. Fur tufts and sabers stay attached; no limb tearing at the belly.',
};
await save(`${destination}/visual-review.json`, review);
const asset = {
  modelKey: key,
  name: spec.name,
  kind: 'enemy',
  candidate: 1,
  revision,
  status: qaFile ? 'integrated-and-game-qa-passed' : 'integrated-browser-qa-pending',
  url,
  sha256: process_.sha256,
  bytes: bytes.byteLength,
  triangles: process_.triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: process_.heightMetres,
  widthMetres: process_.widthMetres,
  lengthMetres: process_.lengthMetres,
  bones: process_.bones.length,
  clips: process_.clips,
  locomotion: process_.locomotion,
  placement: {
    pivot: 'ground-body-centred',
    min: [process_.boundsBlender.min[0], 0, -process_.boundsBlender.max[1]],
    max: [process_.boundsBlender.max[0], process_.boundsBlender.max[2], -process_.boundsBlender.min[1]],
  },
  lods: [],
  source: `${folder}/candidate.glb`,
  provenance: {
    provider: 'Codex CLI image_gen reference (gpt-5.6-sol, medium) and local TRELLIS-2; rig and clips by Claude Code',
    referenceGenerator: reference.generator,
    claudeUsed: true,
    referenceGenerator: reference.generator,
    referenceImage: `${model}/source/original/reference-v1.png`,
    referenceSha256: reference.sha256,
    visualReview: `${destination}/visual-review.json`,
  },
  notes: [
    'User-selected candidate 01 of three Codex image_gen references (tawny, faint stripes). Local TRELLIS-2 1024 reconstruction, source-preserving QEM to 72,892 triangles; no visible replacement geometry.',
    'Quadruped rig of 26 bones with two-bone IK planted paws and a gliding scapula; 60 fps keys. Pounce and Step bake body height only: the server moves the body horizontally.',
    ...(revision >= '12'
      ? [
          `Revision ${revision} (2026-09-12): weakened at the user's request and every strike announced. Crouch (0.8 s) precedes the pounce, whose own clip keeps a 0.2 s final dip; Snarl (0.7 s) precedes the claw combo. Surface, weights and the nine earlier clips are unchanged.`,
        ]
      : []),
  ],
};
await save(`public/models/${key}/asset.json`, asset);
const catalog = await json('public/models/world-assets.json');
const at = catalog.assets.findIndex((a) => a.modelKey === key);
if (at < 0) catalog.assets.push(asset);
else catalog.assets[at] = asset;
await save('public/models/world-assets.json', catalog);
const models = await json('assets/world-models.json');
const entry = {
  key,
  name: spec.name,
  kind: 'enemy',
  height: asset.heightMetres,
  length: asset.lengthMetres,
  status: asset.status,
  geometryResolution: 1024,
  sha256: asset.sha256,
  delivery: url,
  gameQA: `${destination}/game-qa.json`,
  subject:
    'Sabre-toothed cat enemy on the Siberian snow plain: fast pursuit, side-steps telegraphed attacks, pounces from mid range, two-swipe claw combo.',
};
const index = models.assets.findIndex((a) => a.key === key);
if (index < 0) models.assets.push(entry);
else models.assets[index] = entry;
await save('assets/world-models.json', models);
await save(`${destination}/numeric.json`, numeric);
await save(`${destination}/production.json`, {
  revision,
  sha256: asset.sha256,
  bytes: asset.bytes,
  reference,
  dense: await json(`${model}/work/trellis/selected-dense.json`),
  lowPoly: await json(`${model}/work/low-poly/revision-02/process.json`),
  rig: { ...process_, bonePlan: undefined },
});
await copyFile(`${model}/request-spec.json`, `${destination}/request-spec.json`);
if (qaFile) await save(`${destination}/game-qa.json`, await json(qaFile));
async function archive(from, to) {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    if (e.isDirectory()) await archive(`${from}/${e.name}`, `${to}/${e.name}`);
    else await copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
  }
}
await archive(`${model}/workflow/current`, `${destination}/workflow/current`);
await mkdir(`${destination}/source`, { recursive: true });
for (const name of ['prompts.json', 'prompt.txt', 'reference-v1.json', 'codex-request.txt'])
  await copyFile(`${model}/source/original/${name}`, `${destination}/source/${name}`);
for (const sheet of review.sheets)
  await copyFile(sheet, `${destination}/${sheet.split('/').pop().replace('sheet', `r${revision}-sheet`)}`);
console.log(JSON.stringify({ adopted: url, sha256: asset.sha256, bytes: asset.bytes, status: asset.status }));
