// 2026-09-13: adopt the single-tail mammoth (model-motion-r05.glb, built by
// scripts/fix-mammoth-tail.mjs) as the served delivery. The r04 file, its
// review and every earlier GLB stay in place; only the manifest, the world
// manifest copy and the catalogue move to the new bytes.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { foldStrands } from './fix-mammoth-tail.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function atomicJSON(file, data) {
  await writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await rename(file + '.tmp', file);
}
const key = 'woolly-mammoth',
  previous = `public/models/${key}/model-motion-r04.glb`,
  delivery = `public/models/${key}/model-motion-r05.glb`,
  reviewFile = 'assets/creature-motion/models/woolly-mammoth-tail-review.json';
const source = await readFile(previous),
  bytes = await readFile(delivery),
  rebuilt = foldStrands(source);
assert.equal(hash(bytes), hash(rebuilt.bytes), 'served r05 must be exactly the rebuilt bytes');
const asset = await json(`public/models/${key}/asset.json`);
assert.equal(hash(source), 'f54643731a621d903728ea29bf0b713cd930536122c9aeb70f60a4d05c9a28f7');
asset.url = `/models/${key}/model-motion-r05.glb`;
asset.sha256 = hash(bytes);
asset.bytes = bytes.length;
asset.notes = [
  ...asset.notes.filter((note) => !note.startsWith('Tail revision 05')),
  `Tail revision 05 (2026-09-13): the two thin fur strands hanging from either side of the rump read as extra tails; their ${rebuilt.strand} vertices are collapsed onto the rump vertices they hang from (zero-area slivers, nothing drawn) so only the bone-driven central tail remains. Original binary kept as a byte-for-byte prefix; only the POSITION and NORMAL accessors point at appended buffer views. Indices, UVs, skin, rig and all clips unchanged.`,
];
asset.provenance.visualReview = reviewFile;
asset.provenance.previousMotionDeliverySha256 = hash(source);
asset.provenance.tailRepair = {
  revision: 'revision-05',
  builder: 'scripts/fix-mammoth-tail.mjs',
  claudeUsed: true,
  foldedVertices: rebuilt.strand,
  sourceSha256: hash(source),
};
asset.motionReview.delivery = 'model-motion-r05.glb';
await atomicJSON(`public/models/${key}/asset.json`, asset);
const world = await json('public/models/world-assets.json');
world.assets[world.assets.findIndex((a) => a.modelKey === key)] = asset;
await atomicJSON('public/models/world-assets.json', world);
const catalog = await json('assets/world-models.json');
const spec = catalog.assets.find((a) => a.key === key);
spec.sha256 = asset.sha256;
spec.delivery = asset.url;
await atomicJSON('assets/world-models.json', catalog);
await atomicJSON(reviewFile, {
  decision: 'adopt',
  at: new Date().toISOString(),
  key,
  revision: 'revision-05',
  sha256: asset.sha256,
  sourceSha256: hash(source),
  sourceKind:
    'Delivered motion revision 04 GLB; the side fur strands collapsed onto the rump vertices they hang from.',
  modifiedAccessors: ['POSITION', 'NORMAL'],
  preserved:
    'Original binary prefix, indices, UVs, skin weights, bones, materials, textures and all five clips.',
  evidence: 'output/blender/mammoth-tail-r05/',
  reviewedBy:
    'Claude (headless Blender renders of rest pose and Walk_Loop, then the real game page)',
  scope:
    'Single central tail from the rear, side and three-quarter views at 8-9 m; hind legs, rump and tail motion in Walk_Loop, Run_Loop and Death unchanged. The hollow between the fur masses at the tail base, previously hidden behind the strands, is original TRELLIS geometry and still reads as dark facets at close range.',
});
console.log(
  JSON.stringify({ key, url: asset.url, sha256: asset.sha256, bytes: asset.bytes }, null, 2),
);
