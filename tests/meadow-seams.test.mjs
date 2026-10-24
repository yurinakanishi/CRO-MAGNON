import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { prepareMeadowNormals } from '../dist/src/meadow-surface.js';

test('the delivered mountain and meadow share the image and repeat addressing used at their join', async () => {
  const images = [];
  for (const key of ['meadow-ground', 'camp-mountain']) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
    const glb = await readFile(`public${asset.url}`),
      length = glb.readUInt32LE(12);
    const doc = JSON.parse(glb.subarray(20, 20 + length));
    for (const material of doc.materials) {
      const texture = doc.textures[material.pbrMetallicRoughness.baseColorTexture.index];
      const sampler = doc.samplers?.[texture.sampler];
      assert.equal(sampler?.wrapS ?? 10497, 10497, `${key}: repeat S`);
      assert.equal(sampler?.wrapT ?? 10497, 10497, `${key}: repeat T`);
      const view = doc.bufferViews[doc.images[texture.source].bufferView];
      const start = 28 + length + (view.byteOffset ?? 0);
      images.push(
        createHash('sha256')
          .update(glb.subarray(start, start + view.byteLength))
          .digest('hex'),
      );
    }
  }
  assert.ok(images.length >= 3);
  assert.equal(
    new Set(images).size,
    1,
    'world-space mapping samples the exact same accepted image',
  );
});

test('all rotations of the delivered meadow meet in height and top lighting without modifying source triangles', async (t) => {
  const asset = JSON.parse(await readFile('public/models/meadow-ground/asset.json'));
  const { scene } = await geometryScene(`public${asset.url}`);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene),
    centre = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3());
  const root = new THREE.Group(),
    material = new THREE.MeshBasicMaterial();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry
      .clone()
      .applyMatrix4(node.matrixWorld)
      .translate(-centre.x, -asset.placement.surfaceHeightMetres, -centre.z)
      .scale(32 / size.x, 1, 32 / size.z);
    const positions = g.attributes.position.array.slice(),
      uvs = g.attributes.uv.array.slice(),
      indices = g.index?.array.slice();
    prepareMeadowNormals(g);
    assert.deepEqual(g.attributes.position.array, positions);
    assert.deepEqual(g.attributes.uv.array, uvs);
    assert.deepEqual(g.index?.array, indices);
    root.add(new THREE.Mesh(g, material));
  });
  const ray = new THREE.Raycaster(),
    transform = new THREE.Matrix3();
  const hit = (x, z) => {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const h = ray.intersectObject(root)[0];
    assert.ok(h, `top covers ${x},${z}`);
    const normal = h.normal
      .clone()
      .applyMatrix3(transform.getNormalMatrix(h.object.matrixWorld))
      .normalize();
    return { y: h.point.y, normal };
  };
  const edges = [];
  let worstTilt = 0,
    worstGap = 0;
  for (let q = 0; q < 4; q++) {
    root.rotation.y = (q * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const samples = [];
    for (let along = -15.75; along <= 15.75; along += 0.5) {
      const left = hit(-15.999, along),
        right = hit(15.999, along);
      for (const h of [left, right]) {
        worstTilt = Math.max(worstTilt, Math.acos(Math.min(1, h.normal.y)));
        assert.ok(h.normal.y > 0.999, `rotation ${q}, edge ${along}: no sideways rim lighting`);
      }
      samples.push({ left, right });
    }
    edges.push(samples);
  }
  for (const a of edges)
    for (const b of edges)
      for (let i = 0; i < a.length; i++) {
        const gap = Math.abs(a[i].right.y - b[i].left.y);
        worstGap = Math.max(worstGap, gap);
        assert.ok(gap < 0.001, `rotated tiles meet within 1 mm: ${gap}`);
      }
  t.diagnostic(
    `16 rotated joins: max height gap ${worstGap} m, max top normal tilt ${(worstTilt * 180) / Math.PI} degrees`,
  );
  root.traverse((n) => {
    if (n.isMesh) n.geometry.dispose();
  });
  material.dispose();
});
