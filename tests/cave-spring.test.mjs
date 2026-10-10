import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeDocument } from '../scripts/optimization/guarded/document.mjs';
import { accessorElements, sha256 } from '../scripts/optimization/glb.mjs';
import { CAMP_CAVE_SURFACE_DATA } from '../dist/shared/camp-cave-surface-data.mjs';
import { CAVE_SPRING, caveSpringRadius } from '../dist/shared/cave-spring.mjs';

test('the accepted spring retains the TRELLIS shell, gallery, UVs and embedded textures', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const prior = 'public/models/camp-cave/model-r26.opt-1debf5dafc216ce0.glb';
  const [before, bytes] = await Promise.all([readFile(prior), readFile(`public${asset.url}`)]);
  assert.equal(sha256(before), '1debf5dafc216ce01c46bd620e43d232026e0b5a4ad282a91e25676078384005');
  assert.equal(sha256(bytes), asset.sha256);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(CAMP_CAVE_SURFACE_DATA.sourceSha256, asset.sha256);
  const [a, b] = await Promise.all([
    decodeDocument(before, prior),
    decodeDocument(bytes, asset.url),
  ]);
  const ap = a.json.meshes[0].primitives[0],
    bp = b.json.meshes[0].primitives[0];
  assert.equal(b.json.meshes.length, a.json.meshes.length);
  assert.deepEqual(b.json.nodes, a.json.nodes);
  assert.deepEqual(
    accessorElements(b.json, b.views, bp.indices),
    accessorElements(a.json, a.views, ap.indices),
  );
  assert.deepEqual(
    accessorElements(b.json, b.views, bp.attributes.TEXCOORD_0),
    accessorElements(a.json, a.views, ap.attributes.TEXCOORD_0),
  );
  assert.deepEqual(b.json.materials, a.json.materials);
  assert.equal(b.json.images.length, a.json.images.length);
  for (let i = 0; i < a.json.images.length; i++)
    assert.deepEqual(b.views[b.json.images[i].bufferView], a.views[a.json.images[i].bufferView]);
  const p = accessorElements(a.json, a.views, ap.attributes.POSITION),
    q = accessorElements(b.json, b.views, bp.attributes.POSITION);
  const n = accessorElements(a.json, a.views, ap.attributes.NORMAL),
    m = accessorElements(b.json, b.views, bp.attributes.NORMAL);
  assert.equal(q.length, p.length);
  let retained = 0,
    lowered = 0;
  for (let i = 0; i < p.length; i += 12) {
    if (p.readFloatLE(i + 8) >= -29.5) {
      assert.deepEqual(q.subarray(i, i + 12), p.subarray(i, i + 12), 'unchanged gallery position');
      assert.deepEqual(m.subarray(i, i + 12), n.subarray(i, i + 12), 'unchanged gallery normal');
      retained++;
    }
    const x = q.readFloatLE(i),
      y = q.readFloatLE(i + 4),
      z = q.readFloatLE(i + 8);
    assert(
      [x, y, z, m.readFloatLE(i), m.readFloatLE(i + 4), m.readFloatLE(i + 8)].every(
        Number.isFinite,
      ),
    );
    assert(y >= CAVE_SPRING.bottomY - 0.001, 'the rock bed does not drop below the planned basin');
    if (caveSpringRadius(x, z) < 0.65 && Math.abs(y - CAVE_SPRING.bottomY) < 0.001) {
      lowered++;
    }
  }
  assert(retained > 20000, 'the entrance and mural gallery are retained');
  assert(lowered > 100, 'the spring is cut into the existing floor');
});
