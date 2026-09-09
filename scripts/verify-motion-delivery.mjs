import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MOTION_KEYS, unpack } from './motion-glb.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const world = await json('public/models/world-assets.json'),
  catalog = await json('assets/world-models.json');
const results = [];
for (const key of MOTION_KEYS) {
  const asset = await json(`public/models/${key}/asset.json`);
  assert.equal(asset.motionReview.status, 'adopted');
  assert.equal(asset.url, `/models/${key}/model-motion-r04.glb`);
  const file = `public${asset.url}`,
    bytes = await readFile(file);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  const source = await readFile(asset.motionReview.sourceDelivery);
  assert.equal(hash(source), asset.motionReview.sourceSha256);
  const a = unpack(source),
    b = unpack(bytes);
  assert.deepEqual(b.binary.subarray(0, a.binary.length), a.binary);
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(b.doc[field], a.doc[field]);
  assert.equal(b.doc.animations.length, a.doc.animations.length);
  let preserved = 0;
  for (let i = 0; i < a.doc.animations.length; i++)
    if (!['Walk_Loop', 'Run_Loop'].includes(a.doc.animations[i].name)) {
      assert.deepEqual(b.doc.animations[i], a.doc.animations[i]);
      preserved++;
    }
  const review = await json(asset.provenance.visualReview);
  assert.equal(review.decision, 'adopt');
  assert.equal(review.sha256, asset.sha256);
  const spec = catalog.assets.find((a) => a.key === key);
  if (spec) {
    assert.equal(spec.sha256, asset.sha256);
    assert.equal(spec.delivery, asset.url);
  }
  const record = world.assets.find((a) => a.modelKey === key);
  if (record) assert.deepEqual(record, asset);
  const flags =
    key === 'crow-shaman'
      ? ['--enemy']
      : key !== 'woolly-mammoth'
        ? ['--humanoid', '--hunting']
        : ['--hunting'];
  const inspection = JSON.parse(
    execFileSync(process.execPath, ['scripts/inspect-glb.mjs', file, ...flags], {
      encoding: 'utf8',
    }),
  );
  assert.equal(inspection.validation, 'passed');
  assert.equal(inspection.triangles, asset.triangles);
  for (const clip of asset.clips)
    assert.ok(
      Math.abs(inspection.animations.find((c) => c.name === clip.name).duration - clip.seconds) <
        0.0001,
    );
  results.push({
    key,
    sha256: asset.sha256,
    clips: asset.clips.length,
    preservedClips: preserved,
    triangles: asset.triangles,
  });
}
const adoption = await json('assets/creature-motion/adoption.json');
for (const record of adoption.originalFiles)
  assert.equal(hash(await readFile(record.file)), record.sha256);
await writeFile(
  'assets/creature-motion/delivery-validation.json',
  JSON.stringify(
    {
      status: 'passed',
      at: new Date().toISOString(),
      originalGLBsPreserved: adoption.originalFiles.length,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Verified ${results.length} active motion deliveries, ${results.reduce((s, x) => s + x.clips, 0)} clips and all ${adoption.originalFiles.length} earlier GLBs.`,
);
