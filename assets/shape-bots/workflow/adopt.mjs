// Final promotion requires the new game report, layout check and manual visual finding.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const [gamePath, layoutPath, finding, flightPath] = process.argv.slice(2);
assert.ok(
  gamePath?.startsWith('output/playwright/shape-bots/') &&
    layoutPath?.startsWith('output/playwright/shape-bots/'),
);
assert.ok(finding?.length > 20);
assert.ok(flightPath?.startsWith('output/playwright/shape-bots/'));
const flight = await read(`${flightPath}/result.json`);
assert.equal(flight.passed, true);
assert.deepEqual(flight.errors, []);
assert.deepEqual(
  flight.records.map((record) => record.kind),
  ['beret', 'frog', 'triangle', 'heart'],
);
const game = await read(`${gamePath}/result.json`),
  layout = await read(`${layoutPath}/result.json`);
for (const report of [game, layout]) {
  assert.equal(report.passed, true);
  assert.deepEqual(report.errors, []);
}
assert.ok(game.checks.length >= 11);
assert.equal(layout.views.length, 3);
assert.ok(
  layout.views.every((view) => view.buttons.length === 11 && view.buttons.every((b) => b.hit)),
);
const revisions = await read('assets/shape-bots/revisions.json');
const catalog = await read('assets/world-models.json'),
  world = await read('public/models/world-assets.json');
const records = [];
for (const [kind, revision] of Object.entries(revisions)) {
  const key = `orb-bot-${kind}`,
    assetPath = `public/models/${key}/asset.json`;
  const asset = await read(assetPath),
    reviewPath = `assets/shape-bots/reviews/${kind}-r${revision}.json`;
  const review = await read(reviewPath);
  assert.equal(review.decision, 'visual-approved-for-game-qa');
  assert.equal(review.sha256, asset.sha256);
  for (const entry of [asset, ...asset.lods, asset.portrait])
    assert.equal(hash(await readFile(`public${entry.url}`)), entry.sha256);
  Object.assign(review, {
    decision: 'adopt',
    gameIntegrationVerified: true,
    gameQA: gamePath,
    layoutQA: layoutPath,
    rearCameraFlightQA: flightPath,
    gameVisualReview: finding,
  });
  Object.assign(asset, { status: 'integrated-reviewed-prototype', gameQA: gamePath });
  catalog.assets.find((s) => s.key === key).status = asset.status;
  world.assets[world.assets.findIndex((s) => s.modelKey === key)] = asset;
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
const before = await read('assets/shape-bots/request.json');
for (const entry of before.existingAssets)
  assert.equal(hash(await readFile(`public${entry.url}`)), entry.sha256);
await save('assets/world-models.json', catalog);
await save('public/models/world-assets.json', world);
await save('assets/shape-bots/adoption.json', {
  decision: 'adopt',
  candidate: 1,
  models: records,
  gameQA: gamePath,
  layoutQA: layoutPath,
  rearCameraFlightQA: flightPath,
  finding,
  checks: game.checks,
  priorExactAssetsPreserved: before.existingAssets.length,
});
console.log(JSON.stringify(records));
