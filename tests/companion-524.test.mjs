import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COMPANION_524 } from '../dist/shared/companion-524.mjs';
import { companionBehavior } from './companion-behavior.mjs';
companionBehavior('524');

test('retained original C14 keeps its exact hash, four-second floating clip and twenty bones', async () => {
  const b = await readFile('public/models/yellow-524-mascot/model-c14.glb');
  assert.equal(
    createHash('sha256').update(b).digest('hex'),
    '2652765f480973f6d974d0c51b2bd294c6e4c81e32e369814e09ba6c03c3e418',
  );
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
  assert.equal(j.skins[0].joints.length, 20);
  assert.deepEqual(
    j.animations.map((a) => a.name),
    ['Floating_Ripple'],
  );
  assert.equal(Math.max(...j.animations[0].samplers.map((s) => j.accessors[s.input].max[0])), 4);
});

test('the retained midpoint delivery keeps all C14 geometry, skin and animation buffers at a 30cm game scale', async () => {
  const manifest = JSON.parse(await readFile('public/models/yellow-524-mascot/asset.json', 'utf8'));
  const midpoint = manifest.provenance.previousDelivery;
  assert.equal(midpoint.url, '/models/yellow-524-mascot/model-midpoint-r01.glb');
  const data = await readFile(`public${midpoint.url}`);
  assert.equal(createHash('sha256').update(data).digest('hex'), midpoint.sha256);
  const original = await readFile('public/models/yellow-524-mascot/model-c14.glb');
  const parse = (b) => {
    const length = b.readUInt32LE(12),
      doc = JSON.parse(b.subarray(20, 20 + length));
    return {
      doc,
      view(i) {
        const v = doc.bufferViews[i],
          start = 28 + length + (v.byteOffset ?? 0);
        return b.subarray(start, start + v.byteLength);
      },
    };
  };
  const a = parse(original),
    b = parse(data),
    image = a.doc.images[0].bufferView;
  for (let i = 0; i < a.doc.bufferViews.length; i++)
    if (i !== image) assert.deepEqual(a.view(i), b.view(i), `unchanged non-image buffer ${i}`);
  assert.notDeepEqual(a.view(image), b.view(image), 'the selected color is actually delivered');
  for (const key of ['nodes', 'meshes', 'skins', 'accessors', 'animations'])
    assert.deepEqual(a.doc[key], b.doc[key]);
  const position = b.doc.accessors[b.doc.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(Math.abs((position.max[1] - position.min[1]) * COMPANION_524.scale - 0.3) < 1e-8);
});

test('the 2026-10 remake (candidate 2) keeps the midpoint rig, clip and 30cm game scale with a lighter baked surface', async () => {
  const manifest = JSON.parse(await readFile('public/models/yellow-524-mascot/asset.json', 'utf8'));
  assert.equal(manifest.candidate, 2);
  assert.equal(manifest.heightMetres, 0.3);
  assert.equal(manifest.placement.scale, COMPANION_524.scale);
  const data = await readFile(`public${manifest.url}`);
  assert.equal(createHash('sha256').update(data).digest('hex'), manifest.sha256);
  const read = (b) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
  const remake = read(data),
    midpoint = read(await readFile(`public${manifest.provenance.previousDelivery.url}`));
  const jointNames = (doc) => doc.skins[0].joints.map((i) => doc.nodes[i].name);
  assert.deepEqual(jointNames(remake), jointNames(midpoint));
  for (const [i, j] of remake.skins[0].joints.map((n, k) => [n, midpoint.skins[0].joints[k]])) {
    const r = remake.nodes[i],
      m = midpoint.nodes[j];
    const rest = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    for (const key of Object.keys(rest))
      (r[key] ?? rest[key]).forEach((v, k) =>
        assert.ok(Math.abs(v - (m[key] ?? rest[key])[k]) < 1e-4, `${r.name}.${key}`),
      );
  }
  const seconds = (doc) =>
    doc.animations.map((a) => [
      a.name,
      Math.max(...a.samplers.map((s) => doc.accessors[s.input].max[0])),
    ]);
  assert.deepEqual(seconds(remake), seconds(midpoint));
  const position = remake.accessors[remake.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(Math.abs((position.max[1] - position.min[1]) * COMPANION_524.scale - 0.3) < 0.002);
  assert.ok(
    remake.materials.every((m) => m.normalTexture && m.pbrMetallicRoughness.baseColorTexture),
  );
  assert.ok(manifest.triangles < manifest.provenance.previousDelivery.triangles / 10);
});
