// Adopt a verified skin-weight repair, retaining the previous models and provenance.
// node scripts/face-remake/adopt-rigid-chibi-heads.mjs <stage> <visual report directory>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CHIBI_FACE_KEYS } from './stabilize-chibi-heads.mjs';
const [stage, visual] = process.argv.slice(2);
assert.ok(stage && visual, 'stage and reviewed Chrome output required');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const measures = JSON.parse(await readFile(`${stage}/measurements.json`));
const pictures = JSON.parse(await readFile(`${visual}/report.json`));
assert.equal(pictures.ok, true);
assert.deepEqual(pictures.errors, []);
const changes = [];
for (const key of CHIBI_FACE_KEYS) {
  const previous = await readFile(`${stage}/${key}/previous-manifest.json`);
  const current = await readFile(`public/models/${key}/asset.json`);
  assert.deepEqual(current, previous, `${key}: manifest changed since staging`);
  const asset = JSON.parse(current),
    repair = JSON.parse(await readFile(`${stage}/${key}/repair.json`));
  const model = await readFile(`${stage}/${key}/model.glb`);
  assert.equal(hash(model), repair.sha256);
  assert.equal(hash(await readFile(`public${asset.url}`)), asset.sha256);
  const measured = measures.find((row) => row.key === key);
  assert.ok(
    measured.maxDeviationM < 0.00002 &&
      measured.maxCrossfadeDeviationM < 0.00002 &&
      measured.maxSeamGapM < 0.00002,
  );
  assert.ok(pictures.records.some((row) => row.key === key && row.sha256 === repair.sha256));
  const inspection = JSON.parse(
    execFileSync(
      process.execPath,
      ['scripts/inspect-glb.mjs', `${stage}/${key}/model.glb`, '--humanoid', '--hunting'],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
  assert.equal(inspection.validation, 'passed');
  await writeFile(`${stage}/${key}/inspection.json`, json(inspection));
  const revision = `${asset.revision}-face-r01`,
    url = `/models/${key}/model-${revision}.glb`;
  const archive = `assets/${key}/archive-manifest-${asset.revision}-20261015-face.json`;
  const reviewPath = `assets/${key}/qa/${revision}.json`;
  const review = {
    schema: 'cro-magnon/skin-weight-repair@1',
    date: '2026-10-15',
    decision: 'adopt',
    reviewedBy: 'Codex',
    request: '大きい顔の子たちが歩行・走行中に顔の形を変えないようにする',
    modelKey: key,
    candidate: asset.candidate,
    revision,
    url,
    sha256: repair.sha256,
    bytes: model.length,
    repair,
    measurement: measured,
    visual: `${stage}/${key}/comparison.png`,
    previous: { manifest: archive, url: asset.url, sha256: asset.sha256 },
    preserved:
      'Every byte outside JOINTS_0/WEIGHTS_0: original TRELLIS geometry, normals, UV, images, materials, skeleton, bind matrices and all clips.',
  };
  const reviewBytes = Buffer.from(json(review));
  const next = {
    ...asset,
    revision,
    url,
    sha256: repair.sha256,
    bytes: model.length,
    faceRigidity: { review: reviewPath, sha256: hash(reviewBytes) },
  };
  let proofPath, proofBytes;
  if (asset.sourceRevision) {
    const source = await readFile(asset.sourceRevision.record);
    assert.equal(hash(source), asset.sourceRevision.sha256);
    const proof = {
      ...JSON.parse(source),
      files: [{ url, sha256: repair.sha256, bytes: model.length }],
      review: { path: reviewPath, sha256: hash(reviewBytes) },
    };
    proofPath = `assets/${key}/qa/source-revision-${revision}.json`;
    proofBytes = Buffer.from(json(proof));
    next.sourceRevision = { record: proofPath, sha256: hash(proofBytes) };
  }
  changes.push({
    key,
    model,
    previous,
    next,
    archive,
    reviewPath,
    reviewBytes,
    proofPath,
    proofBytes,
  });
}
// All ten source identities and QA results are checked before any live manifest changes.
for (const c of changes) {
  await mkdir(`assets/${c.key}/qa`, { recursive: true });
  await writeFile(`public${c.next.url}`, c.model, { flag: 'wx' });
  await writeFile(c.archive, c.previous, { flag: 'wx' });
  await writeFile(c.reviewPath, c.reviewBytes, { flag: 'wx' });
  if (c.proofPath) await writeFile(c.proofPath, c.proofBytes, { flag: 'wx' });
  await copyFile(`${visual}/${c.key}/comparison.png`, `${stage}/${c.key}/comparison.png`);
}
const catalog = JSON.parse(await readFile('assets/world-models.json'));
for (const c of changes) {
  assert.deepEqual(await readFile(`public/models/${c.key}/asset.json`), c.previous);
  await writeFile(`public/models/${c.key}/asset.json`, json(c.next));
  const entry = catalog.assets.find((a) => a.key === c.key);
  assert.ok(entry, `${c.key}: catalog entry`);
  entry.delivery = c.next.url;
  entry.sha256 = c.next.sha256;
  entry.revision = c.next.revision;
  entry.gameQA = c.reviewPath;
  console.log('ADOPTED', c.key, c.next.sha256);
}
await writeFile('assets/world-models.json', json(catalog));
await writeFile(
  `${stage}/adoption.json`,
  json(
    changes.map((c) => ({
      key: c.key,
      url: c.next.url,
      sha256: c.next.sha256,
      review: c.reviewPath,
    })),
  ),
);
