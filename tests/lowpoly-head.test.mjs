import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dropDuplicateTriangles,
  orientConsistently,
} from '../scripts/face-remake/lowpoly-head.mjs';

// A 3×3 vertex grid in the XY plane (8 triangles), every vertex normal +Z.
const grid = () => {
  const positions = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) positions.push(x, y, 0);
  const indices = [];
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const a = y * 3 + x;
      indices.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  return {
    positions: Float32Array.from(positions),
    indices,
    normals: new Float32Array(27).map((_, i) => (i % 3 === 2 ? 1 : 0)),
  };
};
const faceZ = (positions, indices, t) => {
  const p = (v, k) => positions[indices[t * 3 + v] * 3 + k];
  return (p(1, 0) - p(0, 0)) * (p(2, 1) - p(0, 1)) - (p(2, 0) - p(0, 0)) * (p(1, 1) - p(0, 1));
};

test('coincident double layers are dropped whatever their winding', () => {
  const { indices, dropped } = dropDuplicateTriangles([0, 1, 2, 2, 1, 0, 1, 2, 3, 0, 2, 1]);
  assert.deepEqual([...indices], [0, 1, 2, 1, 2, 3]);
  assert.equal(dropped, 2);
});

test('mixed windings become one winding per surface, the one its normals agree with', () => {
  const { positions, indices, normals } = grid();
  // Reverse three of the eight triangles (the patchwork's mixed windings).
  for (const t of [1, 4, 6])
    [indices[t * 3 + 1], indices[t * 3 + 2]] = [indices[t * 3 + 2], indices[t * 3 + 1]];
  const result = orientConsistently(positions, Uint32Array.from(indices), normals);
  for (let t = 0; t < 8; t++)
    assert.ok(faceZ(positions, result.indices, t) > 0, `triangle ${t} faces +Z`);
  assert.equal(result.components, 1);
  assert.equal(result.flippedTriangles, 3);
  assert.equal(result.inconsistentEdges, 0);
  assert.equal(result.flippedNormals, 0);
  // The same surface with every normal reversed takes the opposite winding.
  const inward = orientConsistently(
    positions,
    Uint32Array.from(indices),
    normals.map((n) => -n),
  );
  for (let t = 0; t < 8; t++)
    assert.ok(faceZ(positions, inward.indices, t) < 0, `triangle ${t} faces -Z`);
});

test('a vertex normal against its surface is reversed; a fin edge is reported', () => {
  const { positions, indices, normals } = grid();
  normals[4 * 3 + 2] = -1; // the centre vertex points into the surface
  const result = orientConsistently(positions, Uint32Array.from(indices), normals);
  assert.equal(result.flippedNormals, 1);
  assert.equal(result.normals[4 * 3 + 2], 1);
  // A third triangle on the edge 0–4 (a fin standing out of the plane).
  const fin = Float32Array.from([...positions, 0.5, 0.5, 1]);
  const finNormals = Float32Array.from([...normals, 0, 0, 1]);
  const withFin = orientConsistently(fin, Uint32Array.from([...indices, 0, 4, 9]), finNormals);
  assert.equal(withFin.nonManifoldEdges, 1);
});
