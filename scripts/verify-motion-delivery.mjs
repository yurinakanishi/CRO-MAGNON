import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  // Later adoptions (player run gaits r05, the 2026-09-13 single-tail mammoth
  // r05) serve newer files that still carry revision 04's motion bytes as a
  // prefix; the prefix and clip checks below are what actually guard that.
  assert.ok(
    asset.url.startsWith(`/models/${key}/model-`) && asset.url.endsWith('.glb'),
    `${key}: ${asset.url}`,
  );
  const file = `public${asset.url}`,
    bytes = await readFile(file);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  // The archived source under output/ is byte-identical to the served
  // model.glb; hosts without the archive verify against that copy by hash.
  let source;
  for (const candidate of [asset.motionReview.sourceDelivery, `public/models/${key}/model.glb`]) {
    try {
      source = await readFile(candidate);
    } catch {
      continue;
    }
    if (hash(source) === asset.motionReview.sourceSha256) break;
    source = undefined;
  }
  assert.ok(source, `${key}: motion source ${asset.motionReview.sourceSha256} not found`);
  const a = unpack(source),
    b = unpack(bytes);
  assert.deepEqual(b.binary.subarray(0, a.binary.length), a.binary);
  if (asset.provenance.structuralRepair) {
    // The explicitly requested Blender tail reconstruction replaces the rear
    // topology. Keep the historical source, rig and motion assertions strong,
    // and independently measure the replacement surface and its deformation.
    assert.equal(key, 'woolly-mammoth');
    const repair = asset.provenance.structuralRepair;
    assert.equal(repair.source, 'public/models/woolly-mammoth/model-motion-r04.glb');
    const originalBytes = await readFile(repair.source),
      original = unpack(originalBytes);
    assert.equal(hash(originalBytes), repair.sourceSha256);
    for (const field of ['nodes', 'skins', 'animations'])
      assert.deepEqual(b.doc[field], original.doc[field], `Blender repair: ${field} unchanged`);
    for (const field of ['materials', 'textures', 'images'])
      assert.deepEqual(b.doc[field].slice(0, a.doc[field].length), a.doc[field]);
    const check = JSON.parse(
      execFileSync(
        process.execPath,
        ['scripts/verify-mammoth-tail-structure.mjs', file, '--no-write'],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(check.status, 'passed');
  } else {
    for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
      assert.deepEqual(b.doc[field], a.doc[field]);
  }
  // Later revisions re-author clips (walk/run gaits, the spear thrust, the
  // downed pose) and append new ones; every clip of the source must still be
  // present, and the untouched ones are still byte-identical at their index.
  assert.ok(b.doc.animations.length >= a.doc.animations.length, `${key}: clips dropped`);
  const sourceNames = a.doc.animations.map((clip) => clip.name),
    currentNames = b.doc.animations.map((clip) => clip.name);
  for (const name of sourceNames) assert.ok(currentNames.includes(name), `${key}: ${name} missing`);
  let preserved = 0;
  for (let i = 0; i < a.doc.animations.length; i++)
    if (JSON.stringify(b.doc.animations[i]) === JSON.stringify(a.doc.animations[i])) preserved++;
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
async function recordedUnderAssets(sha256, dir = 'assets') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (await recordedUnderAssets(sha256, file)) return true;
    } else if (entry.name.endsWith('.json') && (await readFile(file, 'utf8')).includes(sha256))
      return true;
  }
  return false;
}
const adoption = await json('assets/creature-motion/adoption.json');
// Every GLB that the motion adoption left untouched must still be the recorded
// bytes, unless a later adoption of that model replaced it: then the served
// manifest (or one of its LODs) records the new bytes instead.
let superseded = 0;
for (const record of adoption.originalFiles) {
  const current = hash(await readFile(record.file));
  if (current === record.sha256) continue;
  const key = record.file.split('/')[2],
    manifest = await json(`public/models/${key}/asset.json`),
    adopted = [manifest, ...(manifest.lods ?? [])].map((entry) => entry.sha256);
  // A file the manifest no longer serves (the castle's model.glb, replaced by
  // the stairs revision and then superseded by model-r10) must still be the
  // bytes some adoption record under assets/ names.
  assert.ok(
    adopted.includes(current) || (await recordedUnderAssets(current)),
    `${record.file}: changed since the motion adoption without a recorded adoption`,
  );
  superseded++;
}
await writeFile(
  'assets/creature-motion/delivery-validation.json',
  JSON.stringify(
    {
      status: 'passed',
      at: new Date().toISOString(),
      originalGLBsPreserved: adoption.originalFiles.length - superseded,
      originalGLBsSupersededByLaterAdoptions: superseded,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Verified ${results.length} active motion deliveries, ${results.reduce((s, x) => s + x.clips, 0)} clips and ${adoption.originalFiles.length - superseded} earlier GLBs (${superseded} replaced by later recorded adoptions).`,
);
