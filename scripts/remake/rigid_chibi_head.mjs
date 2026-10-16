// The rigid large head of the adopted chibi cast (assets/face-rigidity/README.md, 2026-10-15) for a new
// candidate before its adoption: the whole HeadSurface follows the Head bone and the weights blend into
// the authored ones between the Chest bone and the head surface's lowest point, on every primitive alike
// (scripts/face-remake/stabilize-chibi-heads.mjs stabilizeHeadWeights: only JOINTS_0 and WEIGHTS_0 change).
// Then measures it as tests/character-face-rigidity.test.mjs does (all clips, gait crossfades, seams).
//
//   node scripts/remake/rigid_chibi_head.mjs <model.glb> <asset.json> <out.glb>   (writes <out>.json too)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { loadMotion, unpack } from '../motion-glb.mjs';
import { stabilizeHeadWeights } from '../face-remake/stabilize-chibi-heads.mjs';
import { measureChibiHead } from '../face-remake/measure-chibi-heads.mjs';

const [glbPath, assetPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: rigid_chibi_head.mjs <model.glb> <asset.json> <out.glb>');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(glbPath);
const asset = JSON.parse(await readFile(assetPath, 'utf8'));
const g = await loadMotion(source);
const low = g.scene.getObjectByName('Chest').getWorldPosition(new T.Vector3()).y;
const { doc } = unpack(source);
const headMaterial = doc.materials.findIndex((m) => m.name === 'HeadSurface');
const headPrimitives = doc.meshes.flatMap((m) =>
  m.primitives.filter((p) => p.material === headMaterial),
);
assert.ok(headPrimitives.length, 'authored head surface');
const high = Math.min(...headPrimitives.map((p) => doc.accessors[p.attributes.POSITION].min[1]));
const { bytes, changed } = stabilizeHeadWeights(source, low, high);
await writeFile(outPath, bytes, { flag: 'wx' });
const before = await measureChibiHead(source, {
  ...asset,
  sha256: hash(source),
  bytes: source.length,
});
const after = await measureChibiHead(bytes, { ...asset, sha256: hash(bytes), bytes: bytes.length });
const summary = (m) => ({
  vertices: m.vertices,
  clips: m.clips.length,
  maxDeviationM: m.maxDeviationM,
  maxCrossfadeDeviationM: m.maxCrossfadeDeviationM,
  maxSeamGapM: m.maxSeamGapM,
});
const report = {
  script: 'scripts/remake/rigid_chibi_head.mjs',
  source: { path: glbPath, sha256: hash(source), bytes: source.length },
  output: { path: outPath, sha256: hash(bytes), bytes: bytes.length },
  low,
  high,
  changed,
  sourcePreservedExceptSkinWeights: true,
  before: summary(before),
  after: summary(after),
};
await writeFile(outPath.replace(/\.glb$/, '.json'), JSON.stringify(report, null, 2) + '\n');
assert.ok(
  after.maxDeviationM < 0.00002 &&
    after.maxCrossfadeDeviationM < 0.00002 &&
    after.maxSeamGapM < 0.00002,
);
console.log(
  'RIGID_HEAD_DONE',
  JSON.stringify({ low, high, before: report.before, after: report.after }),
);
