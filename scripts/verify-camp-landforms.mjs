// Separate delivery verification from unavailable historical production archives.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const world = JSON.parse(await readFile('public/models/world-assets.json'));
const baseline = JSON.parse(
  execFileSync('git', ['show', 'HEAD:public/models/world-assets.json'], { encoding: 'utf8' }),
);
for (const old of baseline.assets)
  assert.deepEqual(
    world.assets.find((a) => a.modelKey === old.modelKey),
    old,
    `${old.modelKey} was changed`,
  );
const catalog = JSON.parse(await readFile('assets/world-models.json'));
const specs = [...catalog.assets];
if (!specs.some((s) => s.key === 'cro-magnon-hunter')) specs.push({ key: 'cro-magnon-hunter' });
const results = [];
for (const { key } of specs) {
  const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
  for (const record of [asset, ...(asset.lods ?? [])]) {
    const bytes = await readFile(`public${record.url}`);
    assert.equal(bytes.length, record.bytes);
    assert.equal(hash(bytes), record.sha256);
    const report = JSON.parse(
      execFileSync(process.execPath, ['scripts/inspect-glb.mjs', `public${record.url}`], {
        encoding: 'utf8',
      }),
    );
    assert.equal(report.validation, 'passed');
    assert.equal(report.triangles, record.triangles);
    results.push({
      url: record.url,
      bytes: bytes.length,
      sha256: record.sha256,
      triangles: record.triangles,
    });
  }
  if (!['camp-cave', 'camp-mountain'].includes(key)) continue;
  const p = asset.provenance,
    review = JSON.parse(await readFile(p.visualReview));
  assert.equal(hash(await readFile(p.referenceImage)), p.referenceSha256);
  assert.equal(hash(await readFile(p.sourceGeometry)), p.sourceGeometrySha256);
  assert.equal(review.decision, 'adopt');
  assert.equal(review.sha256, asset.sha256);
  if (asset.pigment) {
    const paint = await readFile(`public${asset.pigment.url}`);
    assert.equal(hash(paint), asset.pigment.sha256);
    assert.equal(hash(await readFile(asset.pigment.source)), asset.pigment.sha256);
  }
}
const report = {
  status: 'passed',
  models: specs.length,
  glbs: results.length,
  unchangedExistingManifestEntries: baseline.assets.length,
  scope:
    'All delivered GLB bytes, sizes, triangle counts and structure; new cave/hill source provenance. Historical archives excluded.',
  results,
};
await writeFile('assets/camp-cave/qa/delivered-assets.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }));
