import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const world = JSON.parse(await readFile('public/models/world-assets.json'));
assert.deepEqual(
  world.assets.find((a) => a.modelKey === 'camp-cave'),
  asset,
);
for (const r of [asset.pigment, asset.rockSurface, asset.pigment.previous]) {
  assert.equal(hash(await readFile(`public${r.url}`)), r.sha256);
  assert.equal(hash(await readFile(r.source)), r.sha256);
}
assert.equal(hash(await readFile(`public${asset.url}`)), asset.sha256);
assert.equal(CAVE_MURALS.length, 14);
const cats = CAVE_MURALS.filter((m) => m.motif === 'cat');
const creatures = CAVE_MURALS.filter((m) => m.motif === 'creature524');
assert.equal(cats.length, 1);
assert.equal(creatures.length, 1);
assert.equal(cats[0].wall, 'east');
assert.equal(creatures[0].wall, 'west');
assert.ok(Math.abs(cats[0].centre - creatures[0].centre) < 0.2);
const coverage = JSON.parse(
  await readFile('assets/camp-cave/qa/gallery-pigment-coverage-r05.json'),
);
assert.equal(coverage.atlasSha256, asset.pigment.sha256);
assert.equal(coverage.totalRejected, 0);
assert.ok(coverage.placements.every((p) => p.paintedSamples > 30));
const qaPath = 'output/playwright/camp-cave/game-gallery-r05-final/summary.json';
const qa = JSON.parse(await readFile(qaPath));
assert.deepEqual(qa.errors, []);
assert.ok(qa.checks.includes('two renderers and three network peers share the cave fire'));
assert.ok(qa.checks.includes('gallery reload and real E extinguishing pass'));
for (const label of [
  'gallery-cat-lit',
  'gallery-524-lit',
  'gallery-east-115',
  'gallery-west-120',
  'gallery-blind-end',
  'gallery-rock-close',
])
  assert.ok(qa.samples.some((s) => s.label === label));
const files = [
  [asset.pigment.url, `public${asset.pigment.url}`],
  [asset.rockSurface.url, `public${asset.rockSurface.url}`],
  ['/models/camp-cave/asset.json', 'public/models/camp-cave/asset.json'],
  ['/models/world-assets.json', 'public/models/world-assets.json'],
  ...['cave-materials', 'cave-rock-shader', 'cave-gallery-layout', 'world-landmarks'].map((n) => [
    `/src/${n}.js`,
    `dist/src/${n}.js`,
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
  generator: 'Built-in imagegen',
  pigments: asset.pigment,
  rockSurface: asset.rockSurface,
  layout: CAVE_MURALS,
  coverage,
  review: [
    'Fourteen independent placements; cat and 524 occur once each on opposite side walls.',
    'Horses, mammoth, bison, deer, hands and signs extend from the entrance region to the blind end.',
    'Limestone colour, pores, bedding and mineral patches remain visible across walls, ceiling and floor.',
    'The initial excessive relief was rejected; filtered, attenuated relief removes the black sparkling grain.',
    'Generated PNGs are copied unchanged; atlas rectangles select whole motifs at render time.',
    'The r07 cave mesh, walk surface, entrance and outdoor camp are unchanged.',
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
    '14 cave/fire/terrain/render tests',
  ],
  delivery,
  performanceClaim:
    'No performance improvement claim; QA includes two simultaneous renderers and initial loading samples.',
};
await writeFile(asset.pigment.review, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: 'passed',
    placements: 14,
    paintedSamples: coverage.totalPaintedSamples,
    clipped: coverage.totalRejected,
    screenshots: report.screenshotCount,
    checks: qa.checks.length,
    deliveryFiles: delivery.length,
    errors: qa.errors,
  }),
);
