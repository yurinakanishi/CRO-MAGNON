// Validate the current mural against its source, real wall and CUA game evidence.
// Historical r29 observations remain in assets/camp-cave/qa/gallery-r29.json.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CAVE_MURALS, caveMuralHeight } from '../dist/src/cave-gallery-layout.js';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const asset = await json('public/models/camp-cave/asset.json');
const world = await json('public/models/world-assets.json');
const previous = await json('assets/camp-cave/qa/gallery-r29.json');
assert.equal(asset.galleryRevision, '30');
assert.deepEqual(
  world.assets.find((a) => a.modelKey === 'camp-cave'),
  asset,
);
assert.equal(asset.sha256, '65dde1aa7311b88c159d524d93af82a770dac77e48ee1f35356e3000cad8a15f');
assert.equal(hash(await readFile(`public${asset.url}`)), asset.sha256);
const pigments = [asset.pigment, asset.characterPigment, asset.rockSurface, asset.rimoPigment];
for (const r of [...pigments, asset.pigment.previous]) {
  assert.equal(hash(await readFile(`public${r.url}`)), r.sha256);
  assert.equal(hash(await readFile(r.source)), r.sha256);
}
assert.equal(
  hash(await readFile(asset.rimoPigment.reference.path)),
  asset.rimoPigment.reference.sha256,
);
assert.equal(CAVE_MURALS.length, 14);
const rimo = CAVE_MURALS.find((m) => m.motif === 'rimoFrieze');
const figure = CAVE_MURALS.find((m) => m.motif === 'creature524');
assert.equal(rimo.wall, 'east');
assert.equal(figure.wall, 'west');
assert.equal(rimo.centre, figure.centre);
assert.equal(rimo.width, 7.5);
assert.equal(caveMuralHeight(rimo), 2.5);
assert.deepEqual(
  CAVE_MURALS.filter((m) => m.motif !== 'rimoFrieze'),
  previous.layout.filter((m) => !(m.wall === 'east' && ['mammoth', 'bison'].includes(m.motif))),
);

const coverage = await json('assets/camp-cave/qa/gallery-pigment-coverage-r30.json');
assert.equal(coverage.atlasSha256, asset.pigment.sha256);
assert.equal(coverage.characterSha256, asset.characterPigment.sha256);
assert.equal(coverage.rimoSha256, asset.rimoPigment.sha256);
assert.equal(coverage.totalRejected, 0);
assert.equal(coverage.placements.length, CAVE_MURALS.length);
assert.ok(coverage.placements.every((p) => p.paintedSamples > 30));
assert.ok(coverage.placements.find((p) => p.motif === 'rimoFrieze').paintedSamples >= 1200);
for (const [i, mural] of CAVE_MURALS.entries())
  for (const field of ['motif', 'wall', 'centre'])
    assert.equal(coverage.placements[i][field], mural[field]);
const room = await json(`assets/camp-cave/qa/room-r${asset.revision}.json`);
assert.equal(room.sha256, asset.sha256);
assert.ok(room.minWidth > 10.5 && room.minHeadroom > 4.5);

const qa = await json(asset.gameQA);
assert.equal(qa.cave.sha256, asset.sha256);
assert.equal(qa.rimoSha256, asset.rimoPigment.sha256);
assert.equal(qa.fixture.isolatedMemoryOnly, true);
assert.equal(qa.fixture.geometryOrLightingOverride, false);
assert.equal(qa.fixture.observationCamera, true);
assert.deepEqual(qa.errors, []);
assert.equal(qa.renderers.length, 2);
assert.equal(new Set(qa.renderers.map((r) => r.tabId)).size, 2);
assert.equal(qa.reloadVerified, true);
assert.deepEqual(qa.gallery.layout, CAVE_MURALS);
assert.deepEqual(qa.samples, await json('output/cave-rimo-r30/captures.json'));
for (const view of ['east', 'east-close', 'west', 'both', 'normal'])
  assert.ok(qa.samples.some((s) => s.view === view && s.fire && s.rimoLoaded && s.caveVisible));
for (const fire of [true, false]) {
  const synced = qa.samples.filter(
    (s) =>
      s.fire === fire &&
      s.players === 5 &&
      s.peers.length === 3 &&
      s.peers.every((p) => p.fire === fire && p.players === 5),
  );
  assert.ok(synced.length >= 2, `Missing two-renderer fire=${fire} captures`);
  assert.ok(new Set(synced.map((s) => s.viewport.join('x'))).size >= 2);
}
for (const sample of qa.samples) {
  assert.equal(hash(await readFile(sample.file)), sample.sha256);
  assert.equal(new URL(sample.rimoTexture).pathname, asset.rimoPigment.url);
}

const base = process.argv[2] ?? qa.server;
const files = [
  [asset.url, `public${asset.url}`],
  ...pigments.map((p) => [p.url, `public${p.url}`]),
  ['/models/camp-cave/asset.json', 'public/models/camp-cave/asset.json'],
  ['/models/world-assets.json', 'public/models/world-assets.json'],
  ...['cave-materials', 'cave-rock-shader', 'cave-gallery-layout', 'world-landmarks'].map((n) => [
    `/src/${n}.js`,
    `dist/src/${n}.js`,
  ]),
  ...['camp-cave-layout', 'camp-cave-surface-data', 'camp-cave-surface'].map((n) => [
    `/shared/${n}.mjs`,
    `dist/shared/${n}.mjs`,
  ]),
];
const delivery = [];
for (const [url, path] of files) {
  const response = await fetch(new URL(url, base));
  assert.equal(response.status, 200, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), hash(await readFile(path)), url);
  delivery.push({ url, bytes: bytes.length, sha256: hash(bytes) });
}
const report = {
  date: new Date().toISOString(),
  decision: 'adopt',
  galleryRevision: '30',
  geometryRevision: asset.revision,
  sha256: asset.sha256,
  rimoPigment: asset.rimoPigment,
  characterPigment: asset.characterPigment,
  layout: CAVE_MURALS,
  coverage,
  chamber: { minWidth: room.minWidth, minHeadroom: room.minHeadroom, unchanged: true },
  review: [
    'The original waving gray-white kitten reference supplies the face, raised paw, white chest and curved dark tail.',
    'Two wild horses, an aurochs and a stag share one transparent worn mineral-pigment painting with Rimo.',
    'The frieze is projected onto the original limestone triangles opposite the unchanged 524, with no added planes.',
    'Near, whole-wall, opposing-wall, both-wall and normal-camera views were inspected in the actual game.',
    'Real E extinguishing and lighting were observed across two browser renderers and three protocol peers. A browser reload and rejoin loaded the same pigment.',
  ],
  sources: 'docs/rimo-cave-mural-2026-10-02.md',
  gameQA: asset.gameQA,
  checks: qa.checks,
  errors: qa.errors,
  sampleCount: qa.samples.length,
  delivery,
  fixture: qa.fixture,
  unverified: qa.unverified,
};
await writeFile(asset.rimoPigment.review, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: 'passed',
    placements: CAVE_MURALS.length,
    paintedSamples: coverage.totalPaintedSamples,
    clipped: coverage.totalRejected,
    captures: qa.samples.length,
    deliveryFiles: delivery.length,
    errors: qa.errors,
  }),
);
