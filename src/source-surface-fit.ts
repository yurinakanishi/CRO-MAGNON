import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverBankDrop } from '../shared/terrain.mjs';

// Subdivide existing source triangles near the river, interpolating their UVs.
// Coarse flat triangles otherwise bridge across the lowered riverbed.
export function fitSourceRiverBank(source, maximumEdge = 0.5) {
  source.computeBoundingBox();
  if (
    source.boundingBox.max.x < 57 ||
    source.boundingBox.min.x > 73 ||
    source.boundingBox.max.z < -64 ||
    source.boundingBox.min.z > 184
  )
    return source;
  const names = Object.keys(source.attributes).filter(
    (name) => name !== 'normal' && name !== 'tangent',
  );
  const attributes = names.map((name) => source.attributes[name]);
  const output = attributes.map(() => []),
    positionIndex = names.indexOf('position');
  const points = Array.from({ length: source.attributes.position.count }, (_, index) =>
    attributes.map((attribute) =>
      Array.from({ length: attribute.itemSize }, (_, component) =>
        attribute.getComponent(index, component),
      ),
    ),
  );
  const index = source.index?.array ?? points.map((_, i) => i);
  const midpoint = (a, b) =>
    a.map((values, i) => values.map((value, j) => (value + b[i][j]) * 0.5));
  function triangle(a, b, c, depth = 0) {
    const vertices = [a, b, c],
      positions = vertices.map((vertex) => vertex[positionIndex]);
    const xs = positions.map((p) => p[0]);
    const distances = positions.map((p, i) => {
      const q = positions[(i + 1) % 3];
      return (p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2;
    });
    const longest = Math.max(...distances),
      edge = distances.indexOf(longest);
    if (
      Math.max(...xs) >= 57 &&
      Math.min(...xs) <= 73 &&
      longest > maximumEdge ** 2 &&
      depth < 18
    ) {
      const p = vertices[edge],
        q = vertices[(edge + 1) % 3],
        r = vertices[(edge + 2) % 3],
        middle = midpoint(p, q);
      triangle(p, middle, r, depth + 1);
      triangle(middle, q, r, depth + 1);
      return;
    }
    for (const vertex of vertices)
      for (let i = 0; i < attributes.length; i++) output[i].push(...vertex[i]);
  }
  for (let i = 0; i < index.length; i += 3)
    triangle(points[index[i]], points[index[i + 1]], points[index[i + 2]]);
  const expanded = new THREE.BufferGeometry();
  names.forEach((name, i) =>
    expanded.setAttribute(
      name,
      new THREE.Float32BufferAttribute(output[i], attributes[i].itemSize),
    ),
  );
  const geometry = mergeVertices(expanded, 0.00001);
  expanded.dispose();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, positions.getY(i) - riverBankDrop(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
