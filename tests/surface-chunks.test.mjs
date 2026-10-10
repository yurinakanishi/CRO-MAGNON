import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { surfaceChunks, chunkMountainSurface } from '../dist/src/surface-chunks.js';

function fixture(indexed = true) {
  const positions = [],
    uv = [],
    ids = [];
  for (let n = 0; n < 1200; n++) {
    const x = (n % 40) * 7 - 140,
      z = Math.floor(n / 40) * 9 - 135;
    // A few triangles cross multiple cells. The bounds must include their
    // extremities, not just the cell that contains their centroid.
    for (const [dx, dz] of [
      [0, 0],
      [n % 73 === 0 ? 150 : 4, 0],
      [0, 3],
    ]) {
      ids.push(ids.length);
      positions.push(x + dx, n % 5, z + dz);
      uv.push((x + dx) / 301, (z + dz) / 311);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  if (indexed) g.setIndex(ids);
  return g;
}
for (const indexed of [true, false])
  test(`chunking preserves every triangle and bounds crossing edges (indexed=${indexed})`, () => {
    const source = fixture(indexed),
      chunks = surfaceChunks(source),
      triangles = [],
      p = new T.Vector3();
    assert.ok(chunks.length > 8);
    for (const g of chunks) {
      assert.equal(g.getAttribute('position'), source.getAttribute('position'));
      assert.equal(g.getAttribute('uv'), source.getAttribute('uv'));
      for (let i = 0; i < g.index.count; i += 3) {
        const tri = [0, 1, 2].map((j) => g.index.getX(i + j));
        triangles.push(tri);
        for (const index of tri) {
          p.fromBufferAttribute(source.getAttribute('position'), index);
          assert.ok(g.boundingBox.containsPoint(p));
          assert.ok(g.boundingSphere.distanceToPoint(p) < 1e-9);
        }
      }
    }
    triangles.sort((a, b) => a[0] - b[0]);
    assert.deepEqual(
      triangles,
      Array.from({ length: 1200 }, (_, i) => [i * 3, i * 3 + 1, i * 3 + 2]),
    );
    const camera = new T.PerspectiveCamera(40, 1, 0.1, 80);
    camera.position.set(0, 20, 25);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    assert.ok(
      chunks.filter((g) => frustum.intersectsSphere(g.boundingSphere)).length < chunks.length / 2,
    );
  });
test('mountain chunks retain local placement and shared material; unsupported moving/transparent surfaces stay intact', () => {
  const root = new T.Group(),
    material = new T.MeshStandardMaterial(),
    mesh = new T.Mesh(fixture(), material);
  mesh.position.set(3, 2, -7);
  mesh.rotation.y = 0.7;
  mesh.scale.setScalar(2);
  mesh.name = 'accepted surface';
  root.add(mesh);
  root.updateMatrixWorld(true);
  const expected = mesh.matrixWorld.clone();
  assert.ok(chunkMountainSurface(root) > 8);
  root.updateMatrixWorld(true);
  assert.equal(root.children[0].name, mesh.name);
  root.traverse((n) => {
    if (n.isMesh) {
      assert.equal(n.material, material);
      assert.ok(n.matrixWorld.equals(expected));
    }
  });
  const transparent = new T.Mesh(fixture(), new T.MeshStandardMaterial({ transparent: true }));
  root.add(transparent);
  assert.equal(chunkMountainSurface(root), 0);
  assert.equal(transparent.parent, root);
});
