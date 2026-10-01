import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverBankDrop } from '../shared/river-profile.mjs';
import { mountainRiverBed, mountainRiverIntersects } from '../shared/mountain-river.mjs';
import {
  expandedMountainZ,
  expandedMountainX,
  MOUNTAIN_EXPANSION,
} from '../shared/mountain-expansion.mjs';

// Subdivide existing source triangles near the river, interpolating their UVs.
// Coarse flat triangles otherwise bridge across the lowered riverbed.
export function fitSourceRiverBank(source, maximumEdge = 0.5, mountainOnly = false) {
  source.computeBoundingBox();
  const projectedZ = mountainOnly ? expandedMountainZ : (z) => z;
  const projectedX = mountainOnly ? expandedMountainX : (x, z) => x;
  const overlaps = (minX, maxX, minZ, maxZ) =>
    mountainRiverIntersects(minX, maxX, minZ, maxZ) ||
    (!mountainOnly && maxX >= 57 && minX <= 73 && maxZ >= -64 && minZ <= 184);
  if (
    !overlaps(
      source.boundingBox.min.x,
      source.boundingBox.max.x,
      projectedZ(source.boundingBox.min.z),
      projectedZ(source.boundingBox.max.z),
    ) &&
    !(mountainOnly && source.boundingBox.max.z > MOUNTAIN_EXPANSION.start)
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
      sourcePositions = vertices.map((vertex) => vertex[positionIndex]),
      positions = sourcePositions.map((p) => [projectedX(p[0], p[2]), p[1], projectedZ(p[2])]);
    const xs = positions.map((p) => p[0]);
    const zs = positions.map((p) => p[2]);
    const distances = positions.map((p, i) => {
      const q = positions[(i + 1) % 3];
      return (p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2;
    });
    const longest = Math.max(...distances),
      edge = distances.indexOf(longest);
    const fitWater = overlaps(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
    const expand =
      mountainOnly &&
      Math.max(...sourcePositions.map((p) => p[2])) > MOUNTAIN_EXPANSION.start &&
      Math.min(...sourcePositions.map((p) => p[2])) < MOUNTAIN_EXPANSION.end;
    if ((fitWater || expand) && longest > (fitWater ? maximumEdge : 2) ** 2 && depth < 18) {
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
  const cut = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const x = projectedX(positions.getX(i), positions.getZ(i)),
      z = projectedZ(positions.getZ(i));
    const y = mountainRiverBed(x, z, positions.getY(i) - (mountainOnly ? 0 : riverBankDrop(x, z)));
    cut[i] = Math.max(0, positions.getY(i) - y);
    positions.setY(i, y);
    positions.setX(i, x);
    positions.setZ(i, z);
  }
  geometry.setAttribute('riverCut', new THREE.BufferAttribute(cut, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
