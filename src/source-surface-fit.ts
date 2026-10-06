import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverBankDrop, riverX, RIVER_BOUNDS } from '../shared/river-profile.mjs';
import { mountainRiverBed, mountainRiverIntersects } from '../shared/mountain-river.mjs';
import { CAMP_CAVE, CAVE_FOOT, CAVE_HILL, caveFootHeight } from '../shared/camp-cave-layout.mjs';
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
    (!mountainOnly &&
      maxX >= RIVER_BOUNDS.minX &&
      minX <= RIVER_BOUNDS.maxX &&
      maxZ >= RIVER_BOUNDS.minZ &&
      minZ <= RIVER_BOUNDS.maxZ);
  if (
    !overlaps(
      source.boundingBox.min.x,
      source.boundingBox.max.x,
      projectedZ(source.boundingBox.min.z),
      projectedZ(source.boundingBox.max.z),
    ) &&
    !(
      mountainOnly &&
      (source.boundingBox.max.z > MOUNTAIN_EXPANSION.start ||
        (source.boundingBox.max.z >= CAVE_HILL.minZ && source.boundingBox.min.z <= CAVE_HILL.maxZ))
    )
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
    const fitFoot =
      mountainOnly &&
      [CAVE_FOOT, CAVE_HILL].some(
        (bounds) =>
          Math.max(...xs) >= bounds.minX &&
          Math.min(...xs) <= bounds.maxX &&
          Math.max(...zs) >= bounds.minZ &&
          Math.min(...zs) <= bounds.maxZ,
      );
    const expand =
      mountainOnly &&
      Math.max(...sourcePositions.map((p) => p[2])) > MOUNTAIN_EXPANSION.start &&
      Math.min(...sourcePositions.map((p) => p[2])) < MOUNTAIN_EXPANSION.end;
    // Resolve the short transition inside the measured mouth in both source LODs.
    // Coarse triangles otherwise bridge its ground-level approach and rock rim.
    const fitMouth =
      fitFoot &&
      Math.max(...xs) >= CAMP_CAVE.x - 8 &&
      Math.min(...xs) <= CAMP_CAVE.x + 8 &&
      Math.max(...zs) >= CAMP_CAVE.z - 10 &&
      Math.min(...zs) <= CAMP_CAVE.z - 7.5;
    const footEdge = fitMouth
      ? 0.1
      : fitFoot && positions.some((p) => Math.abs(p[0] - riverX(p[2])) < 6)
        ? 0.2
        : 0.6;
    if (
      (fitWater || expand || fitFoot) &&
      longest > (fitFoot ? Math.min(footEdge, maximumEdge) : fitWater ? maximumEdge : 2) ** 2 &&
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
  const cut = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const x = projectedX(positions.getX(i), positions.getZ(i)),
      z = projectedZ(positions.getZ(i));
    const fitted = mountainOnly
      ? caveFootHeight(x, z, positions.getY(i))
      : positions.getY(i) - riverBankDrop(x, z);
    const y = mountainRiverBed(x, z, fitted);
    cut[i] = Math.max(0, fitted - y);
    positions.setY(i, y);
    positions.setX(i, x);
    positions.setZ(i, z);
  }
  geometry.setAttribute('riverCut', new THREE.BufferAttribute(cut, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
