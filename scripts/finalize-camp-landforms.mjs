import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const revision = process.argv[2] ?? '11';
const testLog = process.argv[3] ?? 'output/camp-massif-tests-final-r11.log';
const result = await readFile(testLog, 'utf8');
const total = Number(result.match(/tests (\d+)/)?.[1]);
const passed = Number(result.match(/pass (\d+)/)?.[1]);
assert.ok(
  total > 0 && total === passed && /fail 0\b/.test(result),
  'Tests must finish before adoption',
);
const qaPath = `output/playwright/camp-cave/game-final-r${revision}/summary.json`;
const qa = JSON.parse(await readFile(qaPath));
assert.deepEqual(qa.errors, []);
assert.ok(qa.checks.includes('keyboard walk: castle gate'));
const world = JSON.parse(await readFile('public/models/world-assets.json'));
const catalog = JSON.parse(await readFile('assets/world-models.json'));
const modelRecords = [];
for (const key of ['camp-cave', 'camp-mountain']) {
  const file = `public/models/${key}/asset.json`,
    a = JSON.parse(await readFile(file));
  assert.equal(hash(await readFile(`public${a.url}`)), a.sha256);
  a.status = 'integrated-and-game-qa-passed';
  a.gameQA = qaPath;
  if (key === 'camp-cave') {
    // A geometry adoption must retain the independently revised wall painting.
    const paint = await readFile(a.pigment.source);
    assert.equal(hash(paint), a.pigment.sha256);
    assert.equal(hash(await readFile(`public${a.pigment.url}`)), a.pigment.sha256);
  }
  await save(file, a);
  world.assets[world.assets.findIndex((v) => v.modelKey === key)] = a;
  Object.assign(
    catalog.assets.find((v) => v.key === key),
    { status: a.status, gameQA: qaPath },
  );
  const review = JSON.parse(await readFile(a.provenance.visualReview));
  review.gameQA = qaPath;
  review.gameGate = 'passed';
  await save(a.provenance.visualReview, review);
  modelRecords.push({ key, url: a.url, sha256: a.sha256, triangles: a.triangles, bytes: a.bytes });
}
await save('public/models/world-assets.json', world);
await save('assets/world-models.json', catalog);
await save('assets/camp-cave/qa/game-qa.json', {
  ...qa,
  modelRecords,
  date: '2026-09-18',
  tests: { total, passed, log: testLog },
  performanceClaim:
    'No before/after performance claim; recorded samples include simultaneous validation work.',
});
console.log(
  JSON.stringify({
    models: modelRecords,
    checks: qa.checks.length,
    screenshots: qa.samples.length,
    errors: qa.errors,
  }),
);
