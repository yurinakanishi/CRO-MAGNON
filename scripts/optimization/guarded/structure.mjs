// Structural defects of a reduced primitive against its source, by IDENTITY, not by count.
// PROMOTED unchanged in algorithm from the reviewed output-only proof
// (output/optimization-audit-20261009/lowpoly-high-tools-r04/structure.mjs). A candidate is clean
// only with no non-manifold, incoherently wound or open-border edge absent from the source, no
// source border edge lost, no new degenerate or flipped triangle, and no source component
// merged, split or vanished. Pure; no IO.
import {
  components,
  edgeEnds,
  edgeStats,
  positionIds,
  triangleArea,
  triangleKey,
  verticesOfPosition,
} from './topology.mjs';

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], positions[i + d]);
      max[d] = Math.max(max[d], positions[i + d]);
    }
  return { min, max };
}

/** Everything the defect checks compare against, computed once from the source primitive. */
export function sourceStructure(positions, normals, indices) {
  const { ids, count } = positionIds(positions),
    stats = edgeStats(indices, ids),
    triangles = new Set(),
    { min, max } = boundsOf(positions),
    diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  for (let t = 0; t < indices.length; t += 3)
    triangles.add(triangleKey(indices[t], indices[t + 1], indices[t + 2]));
  return {
    positions,
    normals,
    indices,
    ids,
    count,
    stats,
    nonmanifold: new Set(stats.nonmanifoldEdges),
    inconsistent: new Set(stats.inconsistentEdges),
    border: new Set(stats.borderEdges),
    triangles,
    components: components(indices, ids, count),
    degenerateArea: (1e-6 * diagonal) ** 2,
    vertices: verticesOfPosition(ids, count),
  };
}

/** Defects of `mapped` (candidate triangles as source vertex indices) against `structure`. */
export function structuralDefects(structure, mapped) {
  const { ids, positions, normals } = structure,
    stats = edgeStats(mapped, ids),
    candidateBorder = new Set(stats.borderEdges),
    newNonmanifold = stats.nonmanifoldEdges.filter((key) => !structure.nonmanifold.has(key)),
    newInconsistent = stats.inconsistentEdges.filter((key) => !structure.inconsistent.has(key)),
    newBorder = stats.borderEdges.filter((key) => !structure.border.has(key)),
    lostBorder = [...structure.border].filter((key) => !candidateBorder.has(key)),
    newFlipped = [],
    newDegenerate = [];
  for (let t = 0; t < mapped.length; t += 3) {
    const [a, b, c] = [mapped[t], mapped[t + 1], mapped[t + 2]];
    if (structure.triangles.has(triangleKey(a, b, c))) continue;
    if (
      ids[a] === ids[b] ||
      ids[b] === ids[c] ||
      ids[a] === ids[c] ||
      triangleArea(positions, a, b, c) < structure.degenerateArea
    ) {
      newDegenerate.push(t / 3);
      continue;
    }
    if (!normals) continue;
    const p = (v, k) => positions[3 * v + k],
      e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)),
      e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k)),
      face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ],
      mean = [0, 1, 2].map((k) => normals[3 * a + k] + normals[3 * b + k] + normals[3 * c + k]);
    if (face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2] < 0) newFlipped.push(t / 3);
  }
  const source = structure.components.componentOfPosition,
    candidate = components(mapped, ids, structure.count).componentOfPosition,
    sourcesOfCandidate = new Map(),
    candidatesOfSource = new Map();
  for (let position = 0; position < structure.count; position++) {
    if (candidate[position] < 0) continue;
    (
      sourcesOfCandidate.get(candidate[position]) ??
      sourcesOfCandidate.set(candidate[position], new Set()).get(candidate[position])
    ).add(source[position]);
    (
      candidatesOfSource.get(source[position]) ??
      candidatesOfSource.set(source[position], new Set()).get(source[position])
    ).add(candidate[position]);
  }
  return {
    newNonmanifold,
    newInconsistent,
    newBorder,
    lostBorder,
    newFlipped,
    newDegenerate,
    merged: [...sourcesOfCandidate.values()].filter((set) => set.size > 1).length,
    split: [...candidatesOfSource.values()].filter((set) => set.size > 1).length,
    vanished: structure.components.count - candidatesOfSource.size,
    candidate: {
      triangles: stats.triangles,
      edges: stats.edges,
      border: stats.border,
      nonmanifold: stats.nonmanifold,
      inconsistent: stats.inconsistent,
      degenerate: stats.degenerate,
    },
  };
}

/** Defect counts for the record. */
export const defectCounts = (defects) => ({
  newNonmanifoldEdges: defects.newNonmanifold.length,
  newInconsistentEdges: defects.newInconsistent.length,
  newBorderEdges: defects.newBorder.length,
  lostBorderEdges: defects.lostBorder.length,
  newFlippedTriangles: defects.newFlipped.length,
  newDegenerateTriangles: defects.newDegenerate.length,
  mergedComponents: defects.merged,
  splitComponents: defects.split,
  vanishedComponents: defects.vanished,
});

/** The first `limit` bad edges as source-space coordinates, for review. */
export function describeEdges(structure, keys, limit = 20) {
  const at = (position) => {
    const v = structure.vertices[position][0];
    return [0, 1, 2].map((k) => structure.positions[3 * v + k]);
  };
  return keys.slice(0, limit).map((key) => edgeEnds(key).map(at));
}
