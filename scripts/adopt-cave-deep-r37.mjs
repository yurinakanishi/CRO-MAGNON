// Adopt the deepened cave and its ninth procession (2026-10-14, user request: deepen the cave
// and paint @daredaro_F there). Geometry r28-deep is Codex's remap of the retained TRELLIS shell
// (assets/camp-cave/workflow/deepen-gallery.mjs); gallery r37 adds the Codex image_gen painting
// on the new east-wall bay. The earlier GLB and images stay where they are.
// node scripts/adopt-cave-deep-r37.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const sizeOf = async (path) => {
  const { width, height } = await sharp(path).metadata();
  return { width, height };
};
const fileRecord = async (path) => {
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: hash(bytes), image: await sizeOf(path) };
};
const REVISION = '37',
  GEOMETRY = '28-deep';
const assetPath = 'public/models/camp-cave/asset.json';
const asset = JSON.parse(await readFile(assetPath, 'utf8'));
if (asset.galleryRevision !== REVISION)
  await save(`assets/camp-cave/archive-mural-r${REVISION}.json`, asset);

// Geometry: the candidate Codex wrote, adopted byte for byte under a new name.
const report = JSON.parse(
  await readFile('assets/camp-cave/work/deepen/r28-deep/report.json', 'utf8'),
);
const glbUrl = '/models/camp-cave/model-r28-deep.glb';
const glb = await readFile('public' + glbUrl);
assert.equal(hash(glb), report.sha256, 'adopted GLB is the reviewed candidate');
assert.equal(
  hash(await readFile('assets/camp-cave/work/deepen/r28-deep/model.glb')),
  report.sha256,
);
assert.equal(report.triangles, asset.triangles, 'same topology');
Object.assign(asset, {
  url: glbUrl,
  sha256: report.sha256,
  bytes: glb.length,
  revision: GEOMETRY,
});
asset.placement = { ...asset.placement, min: report.min, max: report.max };
asset.provenance.refinementWorkflow = 'assets/camp-cave/workflow/deepen-gallery.mjs';
asset.provenance.refinementHistory = [
  'assets/camp-cave/workflow/refine-spring.mjs (r27-rounded)',
  'assets/camp-cave/workflow/deepen-gallery.mjs (r28-deep, from model-r27-rounded.glb)',
];
// The runtime optimization stays immutable history: prove the revision against it.
const r27 = JSON.parse(
  await readFile('assets/camp-cave/qa/source-revision-r27-rounded.json', 'utf8'),
);
const reviewPath = `assets/camp-cave/qa/adoption-r${GEOMETRY}.json`;
await access(reviewPath);
const proof = {
  schema: 'cro-magnon/source-model-revision@1',
  modelKey: 'camp-cave',
  decision: 'adopt',
  previous: r27.previous,
  files: [{ url: glbUrl, sha256: report.sha256, bytes: glb.length }],
  review: { path: reviewPath, sha256: hash(await readFile(reviewPath)) },
};
const proofPath = `assets/camp-cave/qa/source-revision-r${GEOMETRY}.json`;
await save(proofPath, proof);
asset.sourceRevision = {
  record: proofPath,
  sha256: hash(Buffer.from(JSON.stringify(proof, null, 2) + '\n')),
};

// The ninth procession: the game serves the whole-image resize of the unmodified Codex painting
// to 1024 px (new assets stay at or under 1024 px), so its rectangle is measured in 1024x341.
// It is not part of the runtime optimization: like every frieze before its adoption, the record
// serves its own original, kept byte for byte as `source`; `generated` is the painting itself.
const muralUrl = '/models/camp-cave/daredaro-lascaux-r37.png';
const served = await readFile('public' + muralUrl);
assert.equal(served[25], 6, 'RGBA');
const generated = await fileRecord('assets/camp-cave/source/daredaro-lascaux-r37.png');
const sourceCopy = 'assets/camp-cave/source/daredaro-lascaux-r37-1024.png';
await copyFile('public' + muralUrl, sourceCopy);
assert.equal(hash(await readFile(sourceCopy)), hash(served));
const references = await Promise.all(
  [
    'assets/camp-cave/source/daredaro-reference-user.png',
    'public/models/camp-cave/mae-kohaku-lascaux-r31.png',
  ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
);
const image = await sizeOf('public' + muralUrl);
asset.mascotPigments.daredaroFrieze = {
  url: muralUrl,
  subjects: ['daredaro'],
  source: sourceCopy,
  sha256: hash(served),
  bytes: served.length,
  image,
  generator: 'Codex CLI 0.162.0-alpha.17.2 built-in image_gen (gpt-5.6-sol, reasoning medium)',
  prompt: 'assets/camp-cave/daredaro-lascaux-prompt-r37.txt',
  animals: ['woolly rhinoceros', 'reindeer', 'ibex'],
  references,
  application: `Gallery r${REVISION}: 7.5 m wide east-wall procession on the bay the deepened gallery added (local Z -37.0, Y 1.4, strength 0.84), projected onto the retained limestone triangles. Individual characters can be exchanged for matching animal pigment through the offline modular-r${REVISION} recipe.`,
  review: `assets/camp-cave/qa/gallery-surfaces-r${REVISION}.json`,
  generated: {
    ...generated,
    resize: 'whole image, Lanczos-3, 2172x724 to 1024x341 (sharp)',
  },
};
// Like every painted person, @daredaro_F can be exchanged for animal pigment: the r36 recipe's
// eight panels unchanged, and the new one with its Codex animal layer and hand-placed slot
// (1024x341 pixel space).
const r36 = JSON.parse(await readFile('assets/camp-cave/modular-r36/recipe.json', 'utf8'));
const recipe = structuredClone(r36);
recipe.generator = `${r36.generator}; r${REVISION} panel: Codex CLI 0.162.0-alpha.17.2 built-in image_gen (gpt-5.6-sol)`;
recipe.panels.daredaroFrieze = {
  entry: 'mascotPigments.daredaroFrieze',
  original: structuredClone(asset.mascotPigments.daredaroFrieze),
  source: await fileRecord(
    `assets/camp-cave/modular-r${REVISION}/daredaroFrieze-animals-source.png`,
  ),
  animals: await fileRecord(`assets/camp-cave/modular-r${REVISION}/daredaroFrieze-animals.png`),
  slots: [
    {
      character: 'daredaro',
      feather: 4,
      polygon: [
        [390, 60],
        [560, 60],
        [560, 332],
        [390, 332],
      ],
      characterPolygon: [
        [418, 66],
        [527, 66],
        [550, 108],
        [549, 196],
        [522, 210],
        [527, 320],
        [436, 320],
        [440, 210],
        [398, 192],
        [396, 110],
      ],
    },
  ],
};
await save(`assets/camp-cave/modular-r${REVISION}/recipe.json`, recipe);
asset.galleryRevision = REVISION;
asset.muralComposition = {
  ...asset.muralComposition,
  recipe: `assets/camp-cave/modular-r${REVISION}/recipe.json`,
  characters: 23,
};
asset.notes = asset.notes.filter(
  (n) => !n.startsWith('Geometry r28') && !n.startsWith(`Gallery r${REVISION}`),
);
asset.notes.unshift(
  `Geometry r28-deep (user request 2026-10-14) remaps the same retained TRELLIS shell: the mouth and apron unchanged, the gallery uniformly lengthened by 7.9 m (x1.287) and the rounded rear chamber with its spring basin moved back 7.9 m along the bend, so one more 7.5 m procession fits on each wall. Topology, UVs and the embedded 1024 px textures are unchanged; model-r27-rounded.glb is kept.`,
  `Gallery r${REVISION} paints @daredaro_F, a silver-haired gentleman whose eyes are hidden behind a bar, among a woolly rhinoceros, a reindeer and an ibex on the new east-wall bay; the upper animal register continues over the new bay on both walls.`,
);
await save(assetPath, asset);
const worldPath = 'public/models/world-assets.json';
const world = JSON.parse(await readFile(worldPath, 'utf8'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save(worldPath, world);
const catalogPath = 'assets/world-models.json';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
Object.assign(
  catalog.assets.find((a) => a.key === 'camp-cave'),
  { sha256: report.sha256, delivery: glbUrl, revision: GEOMETRY, galleryRevision: REVISION },
);
await save(catalogPath, catalog);
console.log(
  JSON.stringify({
    geometry: { url: glbUrl, sha256: report.sha256 },
    mural: asset.mascotPigments.daredaroFrieze.sha256,
    sourceRevision: asset.sourceRevision,
  }),
);
