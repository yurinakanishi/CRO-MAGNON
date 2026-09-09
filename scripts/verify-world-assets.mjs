import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// JSON.stringify serializes -0 as 0. Ignore only that representation difference
// when comparing an aggregated manifest with its individual JSON source.
function canonicalizeZero(value) {
  if (typeof value === 'number') return value === 0 ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalizeZero);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, canonicalizeZero(entry)]),
    );
  return value;
}
const catalog = await json('assets/world-models.json'),
  world = await json('public/models/world-assets.json');
assert.equal(world.status, 'ready');
assert.deepEqual(
  world.assets.map((a) => a.modelKey).sort(),
  catalog.assets
    .filter((a) => a.kind !== 'humanoid')
    .map((a) => a.key)
    .sort(),
);
const results = [];
for (const spec of catalog.assets) {
  const manifest = await json(`public/models/${spec.key}/asset.json`);
  assert.equal(manifest.modelKey, spec.key);
  assert.equal(manifest.kind, spec.kind);
  assert.equal(manifest.provenance.claudeUsed, false);
  assert.equal(manifest.sha256, spec.sha256);
  if (spec.kind !== 'humanoid')
    assert.deepEqual(
      canonicalizeZero(world.assets.find((asset) => asset.modelKey === spec.key)),
      canonicalizeZero(manifest),
    );
  const review = await json(manifest.provenance.visualReview);
  assert.equal(review.decision, 'adopt');
  assert.equal(review.sha256, manifest.sha256);
  const reference = await readFile(resolve(root, manifest.provenance.referenceImage));
  assert.equal(hash(reference), manifest.provenance.referenceSha256);
  for (const record of [manifest, ...manifest.lods]) {
    assert.ok(record.url.startsWith(`/models/${spec.key}/`) && record.url.endsWith('.glb'));
    const path = resolve(root, `public${record.url}`),
      base = resolve(root, `public/models/${spec.key}`);
    assert.ok(!relative(base, path).startsWith(`..${sep}`));
    const bytes = await readFile(path);
    assert.equal(bytes.byteLength, record.bytes);
    assert.equal(hash(bytes), record.sha256);
    const inspection = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve(root, 'scripts/inspect-glb.mjs'),
          path,
          ...(spec.kind === 'humanoid' ? ['--humanoid'] : []),
          ...(spec.kind === 'enemy' ? ['--enemy'] : []),
          ...(['humanoid', 'quadruped'].includes(spec.kind) ? ['--hunting'] : []),
        ],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(inspection.validation, 'passed');
    assert.equal(inspection.triangles, record.triangles);
    if (['enemy', 'humanoid', 'quadruped'].includes(spec.kind)) {
      assert.deepEqual(
        manifest.clips.map((clip) => clip.name).sort(),
        inspection.animations.map((clip) => clip.name).sort(),
        `${spec.key}: manifest clip names differ from GLB`,
      );
      for (const clip of manifest.clips) {
        const actual = inspection.animations.find((animation) => animation.name === clip.name);
        assert.ok(
          Math.abs(clip.seconds - actual.duration) < 0.0001,
          `${spec.key}/${clip.name}: manifest duration differs from GLB`,
        );
        assert.equal(
          clip.loop,
          clip.name.endsWith('_Loop'),
          `${spec.key}/${clip.name}: invalid loop flag`,
        );
      }
    }
  }
  if (['humanoid', 'quadruped', 'enemy'].includes(spec.kind)) {
    assert.ok(
      manifest.locomotion.Walk_Loop.metresPerSecond > 0 &&
        manifest.locomotion.Run_Loop.metresPerSecond > 0,
    );
    assert.equal(
      manifest.clips.length,
      spec.kind === 'humanoid' ? 9 : spec.kind === 'enemy' ? 6 : 5,
    );
  }
  if (spec.kind === 'terrain')
    assert.equal(
      manifest.placement.heightField.heights.length,
      manifest.placement.heightField.resolution ** 2,
    );
  if (spec.kind === 'bridge') {
    assert.ok(Number.isFinite(manifest.placement.deckHeightMetres));
    const bounds = manifest.placement.walkBounds;
    assert.ok(
      Object.values(bounds).every(Number.isFinite) &&
        bounds.minX < bounds.maxX &&
        bounds.minZ < bounds.maxZ,
    );
  }
  if (spec.kind === 'equipment') {
    assert.equal(manifest.placement.pivot, 'grip');
    assert.equal(manifest.placement.gripNode, 'Grip.R');
    const { gripToButtMetres, gripToTipMetres } = manifest.placement;
    assert.ok(gripToButtMetres > 0 && gripToTipMetres > 0);
    assert.ok(Math.abs(gripToButtMetres + gripToTipMetres - manifest.heightMetres) < 0.015);
  }
  results.push({ key: spec.key, triangles: manifest.triangles, sha256: manifest.sha256 });
}
const originalCroHash = '8f92a0086c7aa3f44d4120c48c1c2ac70672c5febdb162e4b6156f361d0fc805';
const huntingKeys = [
  'cro-magnon-hunter',
  'cro-magnon-woman',
  'neanderthal-hunter',
  'neanderthal-woman',
  'woolly-mammoth',
];
function glbParts(bytes) {
  const jsonLength = bytes.readUInt32LE(12),
    binStart = 20 + jsonLength;
  return {
    doc: JSON.parse(bytes.subarray(20, binStart).toString('utf8').trim()),
    binary: bytes.subarray(binStart + 8),
  };
}
for (const key of huntingKeys) {
  const oldBytes = await readFile(
    resolve(root, `output/hunting-animation/previous-delivery/${key}/model.glb`),
  );
  const manifest = await json(`public/models/${key}/asset.json`);
  const currentBytes = await readFile(resolve(root, `public${manifest.url}`));
  // Preserve the historical hunting assertion against its own delivery. The
  // later motion revision is verified separately against that archived source.
  const huntingBytes = manifest.motionReview
    ? await readFile(resolve(root, manifest.motionReview.sourceDelivery))
    : currentBytes;
  if (manifest.motionReview) assert.equal(hash(huntingBytes), manifest.motionReview.sourceSha256);
  const old = glbParts(oldBytes),
    current = glbParts(huntingBytes);
  assert.equal(manifest.provenance.previousDeliverySha256, hash(oldBytes));
  assert.equal(manifest.sha256, hash(currentBytes));
  assert.deepEqual(
    current.binary.subarray(0, old.binary.length),
    old.binary,
    `${key}: original mesh/UV/skin/texture/keyframe bytes must remain intact`,
  );
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(current.doc[field], old.doc[field], `${key}: ${field} changed`);
  assert.deepEqual(
    current.doc.animations.slice(0, -1),
    old.doc.animations,
    `${key}: existing clips changed`,
  );
  if (key === 'cro-magnon-hunter') {
    assert.equal(hash(oldBytes), originalCroHash);
    const inspection = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve(root, 'scripts/inspect-glb.mjs'),
          resolve(root, `public${manifest.url}`),
          '--humanoid',
          '--hunting',
        ],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(inspection.validation, 'passed');
    assert.equal(inspection.animations.length, 9);
  }
}
if (results.some((result) => ['woolly-mammoth', 'crow-shaman'].includes(result.key))) {
  const motion = await json('public/models/woolly-mammoth/asset.json');
  if (motion.motionReview)
    execFileSync(process.execPath, [resolve(root, 'scripts/verify-motion-delivery.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
}
console.log(
  JSON.stringify(
    {
      status: 'passed',
      models: results.length + 1,
      existingCroMagnonPreservedInArchive: true,
      huntingSourcesAndOldClipsPreserved: huntingKeys,
      assets: results,
    },
    null,
    2,
  ),
);
