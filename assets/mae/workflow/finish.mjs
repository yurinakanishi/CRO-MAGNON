import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const out = process.argv[2];
assert.ok(out?.startsWith('output/playwright/mae/'));
const game = await json(out + '/result.json');
assert.equal(game.passed, true);
assert.deepEqual(game.errors, []);
const numeric = await json(
  'output/model-generation/models/mae/work/rig/revision-01/qa/numeric.json',
);
assert.equal(numeric.numericPass, true);
const images = await json('output/model-generation/models/mae/work/rig/revision-01/qa/images.json');
assert.equal(images.passed, true);
const tests = await readFile('output/model-generation/models/mae/qa/tests-final.log', 'utf8');
assert.match(tests, /pass 873/);
assert.match(tests, /fail 0/);
for (const old of await json('assets/mae/existing-assets-before.json'))
  assert.equal(sha(await readFile('public' + old.url)), old.sha256);
const frames = await json(out + '/frames.json'),
  actors = frames.filter((r) => r.character);
assert.equal(actors.length, 9);
assert.ok(actors.every((r) => r.maxHandGap < 0.045 && r.contactSamples > 5));
game.actors = actors.map((r) => ({
  character: r.character,
  maxHandGap: r.maxHandGap,
  contactSamples: r.contactSamples,
  observedFrameRate: (r.frames.length - 1) / ((r.frames.at(-1).at - r.frames[0].at) / 1000),
}));
game.frameRateLimit =
  'Short captured petting intervals with two Chrome views; not a sustained FPS benchmark.';
await save('assets/mae/game-qa.json', game);
const asset = await json('public/models/mae/asset.json');
assert.equal(asset.sha256, numeric.sha256);
const review = await json('assets/mae/visual-review-r01.json');
review.decision = 'adopt';
review.limits = [
  'Single reference image: hidden surfaces are inferred.',
  'Physical phone/controller, long sessions and sustained FPS are not verified.',
];
review.gameQa = 'assets/mae/game-qa.json';
review.numericQa = 'output/model-generation/models/mae/work/rig/revision-01/qa/numeric.json';
review.embeddedSourceAlbedo = images;
review.existingWorldModelsUnchanged = 85;
await save('assets/mae/adoption-review.json', review);
asset.status = 'integrated-reviewed-prototype';
asset.provenance.visualReview = 'assets/mae/adoption-review.json';
await save('public/models/mae/asset.json', asset);
const world = await json('public/models/world-assets.json');
world.assets[world.assets.findIndex((a) => a.modelKey === 'mae')] = asset;
await save('public/models/world-assets.json', world);
const catalog = await json('assets/world-models.json');
catalog.assets.find((a) => a.key === 'mae').status = asset.status;
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({
    adopted: true,
    sha256: asset.sha256,
    checks: game.checks.length,
    actors: actors.length,
    out,
  }),
);
