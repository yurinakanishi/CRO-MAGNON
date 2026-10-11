// The camera ray grid (MeshRayGrid) lists every triangle of a model under each 2 m cell it
// overlaps. Its build must hold exactly what the original string-keyed build held, float for
// float and cell for cell, and answer every ray the same, on the camp cave and the castle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { MeshRayGrid } from '../dist/src/mesh-ray-grid.js';
import { CAMP_CAVE } from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE } from '../dist/shared/castle-layout.mjs';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';

/** The build MeshRayGrid had before 2026-10-11 (string cell keys, an array of
 * corners converted at the end), and its ray query. */
function originalGrid(root, cellSize = 2) {
  const cells = new Map(),
    corners = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position,
      index = node.geometry.index;
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      for (const [v, j] of [
        [a, 0],
        [b, 1],
        [c, 2],
      ])
        v.fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(node.matrixWorld);
      const id = corners.length / 9;
      corners.push(...a, ...b, ...c);
      for (
        let x = Math.floor(Math.min(a.x, b.x, c.x) / cellSize);
        x <= Math.floor(Math.max(a.x, b.x, c.x) / cellSize);
        x++
      )
        for (
          let z = Math.floor(Math.min(a.z, b.z, c.z) / cellSize);
          z <= Math.floor(Math.max(a.z, b.z, c.z) / cellSize);
          z++
        ) {
          const key = `${x},${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(id);
        }
    }
  });
  return { cellSize, cells, vertices: new Float32Array(corners) };
}
function originalDistance(grid, origin, direction, maximum) {
  const ray = new THREE.Ray(origin, direction),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    hit = new THREE.Vector3();
  const ids = new Set(),
    n = Math.ceil(maximum / (grid.cellSize / 3));
  for (let i = 0; i <= n; i++) {
    const t = (maximum * i) / n,
      x = Math.floor((origin.x + direction.x * t) / grid.cellSize),
      z = Math.floor((origin.z + direction.z * t) / grid.cellSize);
    for (const id of grid.cells.get(`${x},${z}`) ?? []) ids.add(id);
  }
  let result = maximum;
  for (const id of ids) {
    a.fromArray(grid.vertices, id * 9);
    b.fromArray(grid.vertices, id * 9 + 3);
    c.fromArray(grid.vertices, id * 9 + 6);
    if (ray.intersectTriangle(a, b, c, false, hit)) {
      const d = hit.distanceTo(origin);
      if (d > 0.08) result = Math.min(result, Math.max(0.35, d - 0.2));
    }
  }
  return result;
}

async function placed(key, place) {
  const { url } = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const { scene } = await geometryScene(`public${url}`);
  scene.position.set(place.x, place.elevation ?? 0, place.z);
  scene.rotation.y = place.yaw;
  scene.scale.setScalar(place.scale);
  return scene;
}

test('the camera ray grid holds and answers exactly what its original build did', async () => {
  for (const [key, place] of [
    ['camp-cave', CAMP_CAVE],
    ['valley-castle', CASTLE],
  ]) {
    const root = await placed(key, place),
      grid = new MeshRayGrid(root),
      original = originalGrid(root);
    assert.ok(grid.vertices.length > 9 * 10000, `${key} is a full model`);
    assert.deepEqual(grid.vertices, original.vertices, `${key} corners`);
    assert.equal(grid.cells.size, original.cells.size, `${key} cells`);
    for (const [cell, ids] of original.cells) {
      const [x, z] = cell.split(',').map(Number);
      assert.deepEqual(
        grid.cell((x + 0.5) * grid.cellSize, (z + 0.5) * grid.cellSize),
        ids,
        `${key} cell ${cell}`,
      );
    }
    // Rays from inside and around the model, in every direction.
    const bounds = new THREE.Box3().setFromObject(root);
    let seed = 20261011,
      hits = 0;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 2000; i++) {
      const origin = new THREE.Vector3(
        THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, random()),
        THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, random()),
        THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, random()),
      );
      const direction = new THREE.Vector3(
        random() - 0.5,
        random() - 0.5,
        random() - 0.5,
      ).normalize();
      const expected = originalDistance(original, origin, direction, 9);
      assert.equal(grid.distance(origin, direction, 9), expected, `${key} ray ${i}`);
      if (expected < 9) hits++;
    }
    assert.ok(hits > 200, `${key} rays meet the model (${hits})`);
  }
});
