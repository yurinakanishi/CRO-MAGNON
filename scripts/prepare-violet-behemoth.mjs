// Stage one reviewed candidate for in-game verification; adoption is recorded only after QA.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const revision = process.argv[2] || '01';
const model = 'output/model-generation/models/violet-behemoth';
const folder = `${model}/work/rig/revision-${revision}`;
const processInfo = JSON.parse(await readFile(`${folder}/process.json`, 'utf8'));
const numeric = JSON.parse(await readFile(`${folder}/qa/numeric.json`, 'utf8'));
const bytes = await readFile(`${folder}/candidate.glb`);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, processInfo.sha256);
assert.equal(sha256, numeric.sha256);
assert.equal(numeric.numericPass, true);
assert.ok(Math.abs(processInfo.lengthMetres - 6) < 0.01);
const asset = {
  modelKey: 'violet-behemoth',
  name: '紫尾の巨獣',
  kind: 'enemy',
  candidate: 1,
  revision,
  status: 'candidate-for-game-verification',
  url: `/models/violet-behemoth/model-r${revision}.glb`,
  sha256,
  bytes: bytes.length,
  triangles: processInfo.triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: processInfo.heightMetres,
  widthMetres: processInfo.widthMetres,
  lengthMetres: processInfo.lengthMetres,
  bones: processInfo.bones.length,
  clips: processInfo.clips,
  locomotion: processInfo.locomotion,
  placement: { pivot: 'ground-body-centred', ...numeric.restBounds },
  source: `${folder}/candidate.glb`,
  notes: [
    'User-supplied reference, tiny vestigial hind legs, forearm/tail propulsion. Local TRELLIS-2 reconstruction; no visible replacement geometry.',
    'Latest user correction: total length 6 m, preserving the body and extending the tail. Game verification pending.',
  ],
};
await mkdir('public/models/violet-behemoth', { recursive: true });
await copyFile(`${folder}/candidate.glb`, 'public' + asset.url);
await writeFile('public/models/violet-behemoth/asset.json', JSON.stringify(asset, null, 2) + '\n');
const catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
const previous = catalog.assets.findIndex((a) => a.modelKey === asset.modelKey);
if (previous >= 0) catalog.assets[previous] = asset;
else catalog.assets.push(asset);
await writeFile('public/models/world-assets.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(
  JSON.stringify({ revision, sha256, bytes: bytes.length, lengthMetres: asset.lengthMetres }),
);
