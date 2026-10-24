// Record a reviewed artwork revision after the isolated browser and wall-alpha
// checks. Does not publish, change a model or overwrite an earlier art revision.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtimeTextureRecords } from './environment-assets.mjs';
import { textureRevisionFiles } from './source-texture-revision.mjs';
import { CAVE_MURALS, caveMuralImages } from '../dist/src/cave-gallery-layout.js';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const assetPath = 'public/models/camp-cave/asset.json',
  worldPath = 'public/models/world-assets.json';
const assetText = await readFile(assetPath, 'utf8'),
  worldText = await readFile(worldPath, 'utf8');
const asset = JSON.parse(assetText),
  world = JSON.parse(worldText);
const reportPath = process.argv[2];
assert(reportPath?.startsWith('output/'), 'supply a saved isolated Chrome report');
const revision = asset.galleryRevision,
  recipePath = asset.muralComposition.recipe,
  artRoot = recipePath.slice(0, recipePath.lastIndexOf('/'));
const report = await json(reportPath),
  coveragePath = `${artRoot}/qa/coverage.json`,
  coverage = await json(coveragePath);
const recipe = await json(recipePath),
  identityPath = recipe.identityReview;
let identity;
if (identityPath) {
  assert(identityPath.startsWith(`${artRoot}/qa/`), 'identity review belongs to this art revision');
  identity = await json(identityPath);
  assert.deepEqual(
    identity.subjects.map((s) => s.id).sort(),
    CAVE_MURALS.filter((m) => m.kind === 'character')
      .map((m) => m.subject)
      .sort(),
    'every character needs an identity comparison',
  );
  for (const s of identity.subjects) {
    assert.equal(
      hash(await readFile(s.reference.path)),
      s.reference.sha256,
      'identity reference changed',
    );
    assert(
      s.delivery && s.reviewedInGame,
      `${s.id}: identity has not been reviewed in the actual cave`,
    );
    const mural = CAVE_MURALS.find((m) => m.subject === s.id && m.kind === 'character'),
      images = caveMuralImages(asset),
      image =
        images.extras[mural.motif] ??
        (mural.motif === 'creature524' ? images.characterPigment : images.rimoPigment);
    assert.deepEqual(
      s.delivery,
      { url: image.url, sha256: image.sha256, rect: mural.rect },
      `${s.id}: identity review refers to different delivered pixels`,
    );
  }
}
assert.equal(report.status, 'passed');
assert.deepEqual(report.errors, []);
assert.deepEqual(report.forbidden, []);
assert.equal(report.cases.length, 2);
assert(report.cases.every((c) => c.waitingAndLive));
assert.deepEqual(report.murals, CAVE_MURALS);
assert.equal(report.geometry.sha256, asset.sha256);
const { extras, ...main } = caveMuralImages(asset);
assert.deepEqual(
  textureRevisionFiles(report.textures),
  textureRevisionFiles([...Object.values(main), ...Object.values(extras)]),
  'browser checked a different artwork revision',
);
assert.equal(coverage.totalRejected, 0);
assert(coverage.totalPainted > 8000);
assert.equal(coverage.placements.length, CAVE_MURALS.length);
const textures = textureRevisionFiles(runtimeTextureRecords(asset));
for (const t of textures) {
  const bytes = await readFile(`public${t.url}`);
  assert.equal(hash(bytes), t.sha256);
  if (t.bytes !== undefined) assert.equal(bytes.length, t.bytes);
}
const previousAdoption = asset.pigment.provenance.runtimeOptimization.adoption;
const plan = await json(`assets/runtime-adoption/${previousAdoption}/plan.json`);
const replaced = Object.values(plan.graph.textures)
  .filter((t) => t.owner === 'camp-cave' && !textures.some((f) => f.url === t.url))
  .map(({ url, sha256, bytes, manifestEntry }) => ({ url, sha256, bytes, manifestEntry }))
  .sort((a, b) => a.url.localeCompare(b.url));
assert(replaced.length > 0, 'no optimized paintings were superseded');
const evidence = [];
for (const file of [
  reportPath,
  coveragePath,
  recipePath,
  'shared/cave-mural-art.mts',
  'src/cave-gallery-layout.ts',
  'src/cave-materials.ts',
  ...(identityPath ? [identityPath] : []),
]) {
  const bytes = await readFile(file);
  evidence.push({ path: file, sha256: hash(bytes), bytes: bytes.length });
}
const review = {
  decision: 'adopt',
  modelKey: 'camp-cave',
  galleryRevision: revision,
  sha256: asset.sha256,
  textures,
  evidence,
  review: [
    `All ${CAVE_MURALS.filter((m) => m.kind === 'character').length} characters present as independently measured pigment cutouts. No group frame sets scale.`,
    'Humanoid head-crown to foot = 1.4 painted m; hats and ears keep their extra height. Species and small companions use fixed shared heights.',
    'Both continuous walls, native entry/walking, ten 11.5 m orthographic views and PC/mobile-emulated waiting/live views inspected.',
    `${CAVE_MURALS.length} placements; ${coverage.totalPainted} painted samples on the accepted wall, zero rejected.`,
    'Old GLB, paintings, source images and optimization records retained.',
    ...(identity
      ? [
          `Identity compared for all ${identity.subjects.length} characters; ${identity.subjects.filter((s) => s.decision === 'repair').length} targeted repairs${identity.subjects.some((s) => s.decision === 'new') ? `, ${identity.subjects.filter((s) => s.decision === 'new').length} new from approved references` : ''}${identity.subjects.some((s) => s.decision === 'redraw') ? `, ${identity.subjects.filter((s) => s.decision === 'redraw').length} redrawn at the user's request` : ''} and ${identity.subjects.filter((s) => s.decision === 'retain').length} existing source images retained. Poses reviewed against their before cutouts; detached parts preserved in isolated sources.`,
        ]
      : []),
  ],
  unverified: [
    'Physical phones, Safari, gamepads and multiplayer; no performance benchmark or publication.',
  ],
  checkedAt: new Date().toISOString(),
};
const reviewPath = `assets/camp-cave/qa/adoption-murals-r${revision}.json`,
  reviewBytes = JSON.stringify(review, null, 2) + '\n';
const proof = {
  schema: 'cro-magnon/source-texture-revision@1',
  modelKey: 'camp-cave',
  decision: 'adopt',
  previous: { adoption: previousAdoption, replaced },
  files: textures,
  review: { path: reviewPath, sha256: hash(reviewBytes) },
};
const proofPath = `assets/camp-cave/qa/source-texture-revision-r${revision}.json`,
  proofBytes = JSON.stringify(proof, null, 2) + '\n';
asset.textureRevision = { record: proofPath, sha256: hash(proofBytes) };
asset.gameQA = reportPath;
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
assert.equal(await readFile(assetPath, 'utf8'), assetText, 'cave changed during review');
assert.equal(await readFile(worldPath, 'utf8'), worldText, 'world catalog changed during review');
await writeFile(reviewPath, reviewBytes, { flag: 'wx' });
await writeFile(proofPath, proofBytes, { flag: 'wx' });
await writeFile(assetPath, JSON.stringify(asset, null, 2) + '\n');
await writeFile(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(
  JSON.stringify({
    decision: 'adopt',
    revision,
    atlases: 10,
    replacedAdoptedAtlases: replaced.length,
    proof: asset.textureRevision,
  }),
);
