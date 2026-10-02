// Promote the exact reviewed set only after a successful real-browser game run.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BOT_KINDS } from '../../../dist/shared/orb-bots.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gamePath = process.argv[2],
  finding = process.argv[3];
assert.ok(gamePath?.startsWith('output/playwright/orb-bots/') && finding?.length > 20);
const game = await read(`${gamePath}/result.json`);
assert.equal(game.passed, true);
assert.deepEqual(game.errors, []);
const catalog = await read('assets/world-models.json');
const world = await read('public/models/world-assets.json');
const records = [];
const revisions = await read('assets/orb-bots/revisions.json');
for (const colour of BOT_KINDS) {
  const revision = revisions[colour];
  const key = `orb-bot-${colour}`,
    assetPath = `public/models/${key}/asset.json`;
  const asset = await read(assetPath),
    reviewPath = `assets/orb-bots/reviews/${colour}-r${revision}.json`;
  const review = await read(reviewPath);
  assert.equal(asset.sha256, review.sha256);
  for (const entry of [asset, ...asset.lods])
    assert.equal(hash(await readFile(`public${entry.url}`)), entry.sha256);
  assert.ok(['visual-approved-for-game-qa', 'adopt'].includes(review.decision));
  review.decision = 'adopt';
  review.gameIntegrationVerified = true;
  review.gameQA = gamePath;
  review.gameVisualReview = finding;
  asset.status = 'integrated-reviewed-prototype';
  asset.gameQA = gamePath;
  asset.notes.push(
    'Two Chrome renderers and three protocol peers verified shared throws and return. Physical controller, physical mobile device and sustained FPS remain unverified.',
  );
  catalog.assets.find((a) => a.key === key).status = asset.status;
  world.assets[world.assets.findIndex((a) => a.modelKey === key)] = asset;
  await save(reviewPath, review);
  await save(assetPath, asset);
  records.push({
    key,
    revision,
    sha256: asset.sha256,
    triangles: asset.triangles,
    lodTriangles: asset.lods[0].triangles,
  });
}
await save('assets/world-models.json', catalog);
await save('public/models/world-assets.json', world);
await save('assets/orb-bots/adoption.json', {
  decision: 'adopt',
  candidate: 1,
  revisions,
  models: records,
  gameQA: gamePath,
  gameVisualReview: finding,
  checks: game.checks,
});
console.log(JSON.stringify(records));
