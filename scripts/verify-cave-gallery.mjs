import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CAVE_MOTIFS, CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const world = JSON.parse(await readFile('public/models/world-assets.json'));
assert.deepEqual(
  world.assets.find((a) => a.modelKey === 'camp-cave'),
  asset,
);
for (const r of [
  asset.pigment,
  asset.characterPigment,
  asset.rockSurface,
  asset.pigment.previous,
]) {
  assert.equal(hash(await readFile(`public${r.url}`)), r.sha256);
  assert.equal(hash(await readFile(r.source)), r.sha256);
}
assert.equal(hash(await readFile(`public${asset.url}`)), asset.sha256);
assert.equal(CAVE_MURALS.length, 15);
const animals = ['redHorse', 'ochreHorse', 'mammoth', 'bison', 'deer'];
for (const wall of ['east', 'west'])
  assert.deepEqual(
    CAVE_MURALS.filter((m) => m.wall === wall && animals.includes(m.motif))
      .map((m) => m.motif)
      .sort(),
    [...animals].sort(),
  );
const cats = CAVE_MURALS.filter((m) => m.motif === 'cat');
const creatures = CAVE_MURALS.filter((m) => m.motif === 'creature524');
assert.equal(cats.length, 0);
assert.equal('cat' in CAVE_MOTIFS, false);
assert.equal(creatures.length, 1);
assert.equal(creatures[0].wall, 'west');
assert.ok(CAVE_MURALS.every((m) => m.centre <= -13));
const coverage = JSON.parse(
  await readFile(
    `assets/camp-cave/qa/gallery-pigment-coverage-r${asset.galleryRevision ?? asset.revision}.json`,
  ),
);
const length = JSON.parse(await readFile(`assets/camp-cave/qa/length-r${asset.revision}.json`));
assert.equal(length.measurements[1].sha256, asset.sha256);
assert.ok(length.ratio > 1.95 && length.ratio < 2.15);
assert.equal(coverage.atlasSha256, asset.pigment.sha256);
assert.equal(coverage.characterSha256, asset.characterPigment.sha256);
assert.equal(coverage.totalRejected, 0);
assert.ok(coverage.placements.every((p) => p.paintedSamples > 30));
assert.equal(coverage.placements.length, CAVE_MURALS.length);
for (const [index, mural] of CAVE_MURALS.entries()) {
  assert.equal(coverage.placements[index].motif, mural.motif);
  assert.equal(coverage.placements[index].wall, mural.wall);
  assert.equal(coverage.placements[index].centre, mural.centre);
}
const qaPath = asset.gameQA;
const qa = JSON.parse(await readFile(qaPath));
assert.equal(qa.cave.sha256, asset.sha256);
assert.equal(qa.cave.previewOverride, false);
assert.deepEqual(qa.errors, []);
assert.ok(
  qa.checks.includes(
    'continuous keyboard walk from the original outdoor camp through the visible mouth',
  ),
);
assert.ok(qa.checks.includes('two renderers and three network peers share the cave fire'));
assert.ok(qa.checks.includes('gallery reload and real E extinguishing pass'));
assert.ok(
  qa.checks.includes('cat motif and projection are completely removed from the active gallery'),
);
assert.ok(qa.checks.includes('painted 524 is half the mammoth height within two percent'));
assert.deepEqual(qa.gallery.layout, CAVE_MURALS);
assert.ok(
  qa.checks.includes(
    'the east animal row closes the former cat slot without overlap or a large blank gap',
  ),
);
assert.equal(qa.gallery.scale.targetHeightRatio, 0.5);
assert.ok(qa.gallery.scale.relativeError < 0.02);
assert.ok(
  qa.checks.includes('the rear chamber can be crossed in both directions at full standing height'),
);
const room = JSON.parse(await readFile(`assets/camp-cave/qa/room-r${asset.revision}.json`));
assert.equal(room.sha256, asset.sha256);
assert.ok(room.minWidth > 10.5 && room.minHeadroom > 4.5);
for (const label of [
  'entrance-from-camp',
  'entrance-approach-4',
  'entrance-traverse-6',
  'gallery-reflowed-wall-lit',
  'gallery-524-lit',
  'gallery-524-close',
  'gallery-east-13',
  'gallery-west-23',
  'gallery-east-31.5',
  'gallery-blind-end',
  'gallery-spacious-back',
  'gallery-rock-close',
  'gallery-entrance',
  'gallery-reload',
])
  assert.ok(qa.samples.some((s) => s.label === label));
const files = [
  [asset.url, `public${asset.url}`],
  [asset.pigment.url, `public${asset.pigment.url}`],
  [asset.characterPigment.url, `public${asset.characterPigment.url}`],
  [asset.rockSurface.url, `public${asset.rockSurface.url}`],
  ['/models/camp-cave/asset.json', 'public/models/camp-cave/asset.json'],
  ['/models/world-assets.json', 'public/models/world-assets.json'],
  ...[
    'cave-materials',
    'cave-rock-shader',
    'cave-gallery-layout',
    'world-landmarks',
    'world-scenery',
    'locomotion-grounding',
  ].map((n) => [`/src/${n}.js`, `dist/src/${n}.js`]),
  ...['camp-cave-layout', 'camp-cave-surface-data', 'camp-cave-surface'].map((n) => [
    `/shared/${n}.mjs`,
    `dist/shared/${n}.mjs`,
  ]),
];
const delivery = [];
for (const [url, path] of files) {
  const response = await fetch(`http://127.0.0.1:3000${url}`);
  assert.equal(response.status, 200, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), hash(await readFile(path)), url);
  delivery.push({ url, bytes: bytes.length, sha256: hash(bytes) });
}
const report = {
  date: new Date().toISOString(),
  decision: 'adopt',
  galleryRevision: asset.galleryRevision,
  geometryRevision: asset.revision,
  generator:
    'Existing built-in imagegen pigments; projection layout edited without changing images',
  pigments: asset.pigment,
  characterPigment: asset.characterPigment,
  chamber: { minWidth: room.minWidth, minHeadroom: room.minHeadroom },
  rockSurface: asset.rockSurface,
  layout: CAVE_MURALS,
  scale: qa.gallery.scale,
  eastAnimalGaps: qa.gallery.eastAnimalGaps,
  coverage,
  length: {
    beforeMetres: length.measurements[0].lengthMetres,
    afterMetres: length.measurements[1].lengthMetres,
    ratio: length.ratio,
  },
  review: [
    'Fifteen independent placements retain the same five animal motifs on both sides. The cat remains removed. The east-wall deer and ochre horse move forward to close its old slot, with 0.7 to 1.125 m gaps between the animals and the original limestone underneath.',
    'The right-wall 524 uses 1.34 m image width and approximately 1.11 m painted height, half the neighbouring mammoth at the user-requested mural scale. The silhouette floats slightly above the animal baseline. The actual companion size is unchanged.',
    'Every painting is beyond the midpoint of the doubled chamber; horses, mammoth, bison, deer, hands and signs extend toward the broad back chamber.',
    'White calcite limestone retains pores, bedding, roughness and wall relief under the pigments. Cave fire makes the same paintings clearer.',
    'Generated PNGs are copied unchanged; atlas rectangles select whole motifs at render time.',
    'The original r07 rock mouth and apron stay in place. The deep chamber keeps its full source-derived cross-section until the short rounded corners meet a broad rear wall. The outdoor camp remains unchanged.',
    'The actual entrance arch is checked against r07, and the full approach is walked and photographed in the game with the mountain visible. Preserving only the apron bounds is insufficient.',
  ],
  gameQA: qaPath,
  checks: qa.checks,
  errors: qa.errors,
  sampleCount: qa.samples.length,
  screenshotCount: new Set(qa.samples.map((s) => s.label)).size,
  verification: [
    'TypeScript build including configured strict checks',
    'architecture boundaries',
    'changed JS syntax',
    'Prettier',
    'cave, fire, terrain continuity and LOD gait regression tests',
  ],
  delivery,
  performanceClaim:
    'No performance improvement claim; QA includes two simultaneous renderers and initial loading samples.',
};
await writeFile(asset.pigment.review, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: 'passed',
    placements: CAVE_MURALS.length,
    paintedSamples: coverage.totalPaintedSamples,
    clipped: coverage.totalRejected,
    screenshots: report.screenshotCount,
    checks: qa.checks.length,
    deliveryFiles: delivery.length,
    errors: qa.errors,
  }),
);
