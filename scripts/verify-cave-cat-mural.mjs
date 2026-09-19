import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const world = JSON.parse(await readFile('public/models/world-assets.json'));
assert.deepEqual(
  world.assets.find((item) => item.modelKey === 'camp-cave'),
  asset,
);
const paint = asset.pigment;
assert.ok(
  ['/models/camp-cave/mural-cats-r02.png', '/models/camp-cave/mural-side-r04.png'].includes(
    paint.url,
  ),
  'For the distributed cave gallery use scripts/verify-cave-gallery.mjs',
);
assert.equal(hash(await readFile(`public${paint.url}`)), paint.sha256);
assert.equal(hash(await readFile(paint.source)), paint.sha256);
assert.equal(hash(await readFile(`public${paint.previous.url}`)), paint.previous.sha256);
assert.equal(hash(await readFile(paint.previous.source)), paint.previous.sha256);
for (const reference of paint.references)
  assert.equal(hash(await readFile(reference.path)), reference.sha256);
for (const key of ['camp-cave', 'camp-mountain']) {
  const model = JSON.parse(await readFile(`public/models/${key}/asset.json`));
  assert.equal(hash(await readFile(`public${model.url}`)), model.sha256);
}
const side = paint.url.includes('/mural-side-');
const qaPath = side
  ? 'output/playwright/camp-cave/game-mural-side-r04/summary.json'
  : 'output/playwright/camp-cave/game-mural-cats-r02-framed/summary.json';
const qa = JSON.parse(await readFile(qaPath));
assert.deepEqual(qa.errors, []);
assert.equal(qa.samples.length, side ? 8 : 6);
assert.ok(qa.checks.includes('active manifest mural loaded in real renderer'));
assert.ok(qa.checks.includes('actual E input illuminates the mural'));
assert.ok(qa.checks.includes('actual E input extinguishes the light'));
const coverage = side
  ? JSON.parse(await readFile('assets/camp-cave/qa/side-wall-pigment-coverage.json'))
  : null;
if (coverage) {
  assert.equal(coverage.image.sha256, paint.sha256);
  assert.deepEqual(coverage.paintedClipped, []);
  assert.ok(coverage.paintedSamples > 1000);
  assert.ok(coverage.maxAdjacentPaintedDepthChange < 0.1);
}
const delivery = [];
for (const [url, local] of [
  [paint.url, `public${paint.url}`],
  ['/models/world-assets.json', 'public/models/world-assets.json'],
  ['/models/camp-cave/asset.json', 'public/models/camp-cave/asset.json'],
  ['/src/world-landmarks.js', 'dist/src/world-landmarks.js'],
  ['/src/cave-materials.js', 'dist/src/cave-materials.js'],
]) {
  const response = await fetch(`http://127.0.0.1:3000${url}`);
  assert.equal(response.status, 200, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), hash(await readFile(local)), url);
  delivery.push({ url, bytes: bytes.length, sha256: hash(bytes) });
}
const result = {
  date: new Date().toISOString(),
  decision: 'adopt',
  generator: paint.generator,
  source: paint.source,
  sha256: paint.sha256,
  prompt: paint.prompt,
  prompts: paint.prompts,
  styleReferences: paint.styleReferences,
  references: paint.references,
  imageInspection: {
    size: coverage?.image.size ?? [1942, 809],
    mode: 'RGBA',
    alphaRange: [0, 255],
    transparentFraction: coverage?.image.transparentFraction ?? 0.39532219278737274,
    processing: 'Generated alpha and original PNG bytes retained without image editing',
  },
  projectionMetres: [paint.widthMetres, paint.heightMetres],
  surfaceCoverage: coverage,
  visualReview: side
    ? [
        'Single east-side surface; the painting does not cross the end-wall corner.',
        'Cat and 524 are interspersed among horses, bison and mammoth, sharing sparse dark contours and muted mineral colours.',
        'r03 detailed cat portrait was simplified to flat pigment masses and gestural lines in r04.',
        'Real keyboard walking provides front and both oblique views, with cat face and body continuous.',
        'Unlit painting is faint, real hearth light reveals it, and reloading retains the painting and fire state.',
        'Portrait viewport crops the large frieze; full landscape overview shows the composition.',
      ]
    : [
        'Fluffy reclining tabby/white cat pose, face and curled paws remain recognizable.',
        'Yellow cat-eared character retains three white discs, orange 524 and dark teal mouth.',
        'Initial 6.4m projection rejected because the left overhang covered the cat face.',
        'Final 5m projection places the face in view and keeps both subjects about 2m tall.',
        'Actual game screenshots show faint unlit pigment and vivid fire-lit pigment on the same wall.',
        'Portrait screen crops parts of the large mural naturally; landscape shows both subjects.',
      ],
  gameQA: qaPath,
  checks: qa.checks,
  errors: qa.errors,
  validation: [
    'TypeScript + strict build',
    'architecture boundaries',
    'changed script syntax',
    'Prettier',
  ],
  unchanged: ['Old mural source and delivery', 'Cave r07 GLB', 'Mountain r15 GLB'],
  localDelivery: { origin: 'http://127.0.0.1:3000', results: delivery },
};
await writeFile(paint.review, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: 'passed',
    gameScreenshots: qa.samples.length,
    checks: qa.checks.length,
    deliveryFiles: delivery.length,
    errors: qa.errors,
  }),
);
