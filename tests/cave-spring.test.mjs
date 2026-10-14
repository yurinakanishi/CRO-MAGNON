import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeDocument } from '../scripts/optimization/guarded/document.mjs';
import { accessorElements, sha256 } from '../scripts/optimization/glb.mjs';
import { CAMP_CAVE_SURFACE_DATA } from '../dist/shared/camp-cave-surface-data.mjs';
import { CAVE_SPRING, CAVE_SPRING_R27, caveSpringRadius } from '../dist/shared/cave-spring.mjs';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';
import { R28_DEEP, deepened } from './cave-deepening.mjs';

// The accepted spring (r27-rounded) is kept as the source of the r28 deepening.
const ROUNDED = 'public/models/camp-cave/model-r27-rounded.glb';
const ROUNDED_SHA256 = 'f3e513c9f311ba2bafdc8ebb8a846a9de0eba15be4c1f35b302e10efbd58b75b';

test('the accepted spring retains the TRELLIS shell, gallery, UVs and embedded textures', async () => {
  const prior = 'public/models/camp-cave/model-r26.opt-1debf5dafc216ce0.glb';
  const [before, bytes] = await Promise.all([readFile(prior), readFile(ROUNDED)]);
  assert.equal(sha256(before), '1debf5dafc216ce01c46bd620e43d232026e0b5a4ad282a91e25676078384005');
  assert.equal(sha256(bytes), ROUNDED_SHA256);
  const [a, b] = await Promise.all([decodeDocument(before, prior), decodeDocument(bytes, ROUNDED)]);
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
    assert(
      y >= CAVE_SPRING_R27.bottomY - 0.001,
      'the rock bed does not drop below the planned basin',
    );
    if (
      caveSpringRadius(x, z, CAVE_SPRING_R27) < 0.65 &&
      Math.abs(y - CAVE_SPRING_R27.bottomY) < 0.001
    ) {
      lowered++;
    }
  }
  assert(retained > 20000, 'the entrance and mural gallery are retained');
  assert(lowered > 100, 'the spring is cut into the existing floor');
});

test('the deepened cave moves only the accepted shell: the mouth stays, the gallery stretches and the spring moves back', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const [before, bytes] = await Promise.all([readFile(ROUNDED), readFile(`public${asset.url}`)]);
  assert.equal(sha256(before), ROUNDED_SHA256);
  assert.equal(R28_DEEP.sourceSha256, ROUNDED_SHA256);
  assert.equal(sha256(bytes), asset.sha256);
  assert.equal(asset.sha256, R28_DEEP.sha256);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(CAMP_CAVE_SURFACE_DATA.sourceSha256, asset.sha256);
  // The spring is where the remap carried it, at the bend's centre.
  assert.equal(CAVE_SPRING.z, -deepened(-CAVE_SPRING_R27.z));
  assert.equal(CAVE_SPRING.x, caveCentreOffset(CAVE_SPRING.z));
  const [a, b] = await Promise.all([
    decodeDocument(before, ROUNDED),
    decodeDocument(bytes, asset.url),
  ]);
  const ap = a.json.meshes[0].primitives[0],
    bp = b.json.meshes[0].primitives[0];
  // The same TRELLIS shell: topology, UVs, materials and the embedded 1024 px textures.
  assert.deepEqual(b.json.nodes, a.json.nodes);
  assert.deepEqual(b.json.materials, a.json.materials);
  assert.deepEqual(
    accessorElements(b.json, b.views, bp.indices),
    accessorElements(a.json, a.views, ap.indices),
  );
  assert.deepEqual(
    accessorElements(b.json, b.views, bp.attributes.TEXCOORD_0),
    accessorElements(a.json, a.views, ap.attributes.TEXCOORD_0),
  );
  assert.equal(b.json.images.length, a.json.images.length);
  for (let i = 0; i < a.json.images.length; i++)
    assert.deepEqual(b.views[b.json.images[i].bufferView], a.views[a.json.images[i].bufferView]);
  // Every vertex is exactly the recorded remap of its source along the bend: none is added,
  // and the mouth and apron keep their bytes and normals.
  const p = accessorElements(a.json, a.views, ap.attributes.POSITION),
    q = accessorElements(b.json, b.views, bp.attributes.POSITION),
    n = accessorElements(a.json, a.views, ap.attributes.NORMAL),
    m = accessorElements(b.json, b.views, bp.attributes.NORMAL);
  assert.equal(q.length, p.length);
  let kept = 0,
    moved = 0,
    lowered = 0;
  for (let i = 0; i < p.length; i += 12) {
    const x = p.readFloatLE(i),
      y = p.readFloatLE(i + 4),
      z = p.readFloatLE(i + 8);
    if (-z <= R28_DEEP.constants.D0) {
      assert.deepEqual(q.subarray(i, i + 12), p.subarray(i, i + 12), 'unchanged mouth position');
      assert.deepEqual(m.subarray(i, i + 12), n.subarray(i, i + 12), 'unchanged mouth normal');
      kept++;
      continue;
    }
    const z2 = -deepened(-z);
    assert.equal(q.readFloatLE(i + 8), Math.fround(z2));
    assert.equal(q.readFloatLE(i + 4), y);
    assert.equal(q.readFloatLE(i), Math.fround(x + caveCentreOffset(z2) - caveCentreOffset(z)));
    moved++;
    const qx = q.readFloatLE(i),
      qz = q.readFloatLE(i + 8);
    if (caveSpringRadius(qx, qz) < 0.65 && Math.abs(y - CAVE_SPRING.bottomY) < 0.001) lowered++;
  }
  assert.equal(moved, R28_DEEP.changedVertices);
  assert(kept > 5000, 'the mouth and apron are retained');
  assert(lowered > 100, 'the spring basin moved with the floor it is cut into');
});
