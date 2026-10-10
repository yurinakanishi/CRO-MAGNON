// Welded topology of an indexed triangle list. PROMOTED unchanged in algorithm from the reviewed
// output-only proof (output/optimization-audit-20261009/lowpoly-high-tools-r04/topology.mjs),
// keeping only what the guarded-surface@1 verifier uses. Vertices with bit-identical positions
// share a position id; attribute splits are seams, not borders. Pure; no IO.

/** Position id per vertex (bit-identical float32 positions share one id) and the id count. */
export function positionIds(positions) {
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length),
    ids = new Uint32Array(positions.length / 3),
    seen = new Map();
  for (let v = 0; v < ids.length; v++) {
    const key = `${bits[3 * v]},${bits[3 * v + 1]},${bits[3 * v + 2]}`;
    let id = seen.get(key);
    if (id === undefined) seen.set(key, (id = seen.size));
    ids[v] = id;
  }
  return { ids, count: seen.size };
}

export const EDGE_BASE = 2 ** 22;
export const edgeKey = (a, b) => {
  if (a >= EDGE_BASE || b >= EDGE_BASE)
    throw new Error(`position id ${Math.max(a, b)} exceeds the edge key range`);
  return a * EDGE_BASE + b;
};
/** The two position ids of an undirected edge key. */
export const edgeEnds = (key) => [Math.floor(key / EDGE_BASE), key % EDGE_BASE];

/** A triangle's identity with its winding: vertex triple rotated to start at its smallest index. */
export function triangleKey(x, y, z) {
  const m = Math.min(x, y, z);
  return m === x ? `${x},${y},${z}` : m === y ? `${y},${z},${x}` : `${z},${x},${y}`;
}

/** The vertices carrying each position id. */
export function verticesOfPosition(pid, positionCount) {
  const out = Array.from({ length: positionCount }, () => []);
  for (let v = 0; v < pid.length; v++) out[pid[v]].push(v);
  return out;
}

/**
 * Welded edge census. `border` edges are used by one triangle; `nonmanifold` by more than two;
 * `inconsistent` are two-triangle edges traversed in the same direction (incoherent winding).
 */
export function edgeStats(indices, pid) {
  const undirected = new Map(),
    directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = pid[indices[t]],
      b = pid[indices[t + 1]],
      c = pid[indices[t + 2]];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = edgeKey(Math.min(u, v), Math.max(u, v)),
        dkey = edgeKey(u, v);
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      directed.set(dkey, (directed.get(dkey) ?? 0) + 1);
    }
  }
  const borderEdges = [],
    nonmanifoldEdges = [],
    inconsistentEdges = [];
  for (const [key, uses] of undirected) {
    if (uses === 1) borderEdges.push(key);
    else if (uses > 2) nonmanifoldEdges.push(key);
    else {
      const [u, v] = edgeEnds(key);
      if ((directed.get(edgeKey(u, v)) ?? 0) !== 1) inconsistentEdges.push(key);
    }
  }
  for (const list of [borderEdges, nonmanifoldEdges, inconsistentEdges]) list.sort((x, y) => x - y);
  return {
    triangles: indices.length / 3,
    degenerate,
    edges: undirected.size,
    border: borderEdges.length,
    nonmanifold: nonmanifoldEdges.length,
    inconsistent: inconsistentEdges.length,
    borderEdges,
    nonmanifoldEdges,
    inconsistentEdges,
  };
}

/** Connected components over welded edges; `componentOfPosition` maps a position id to its component. */
export function components(indices, pid, positionCount) {
  const parent = new Int32Array(positionCount).map((_, i) => i),
    find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    },
    used = new Uint8Array(positionCount);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [pid[indices[t]], pid[indices[t + 1]], pid[indices[t + 2]]];
    used[a] = used[b] = used[c] = 1;
    for (const [u, v] of [
      [a, b],
      [b, c],
    ]) {
      const ru = find(u),
        rv = find(v);
      if (ru !== rv) parent[Math.max(ru, rv)] = Math.min(ru, rv);
    }
  }
  const componentOfPosition = new Int32Array(positionCount).fill(-1),
    roots = new Map();
  for (let p = 0; p < positionCount; p++) {
    if (!used[p]) continue;
    const root = find(p);
    if (!roots.has(root)) roots.set(root, roots.size);
    componentOfPosition[p] = roots.get(root);
  }
  return { count: roots.size, componentOfPosition };
}

/** Triangle area in metres² of triangle (a, b, c) of `positions`. */
export function triangleArea(positions, a, b, c) {
  const e1 = [0, 1, 2].map((k) => positions[3 * b + k] - positions[3 * a + k]),
    e2 = [0, 1, 2].map((k) => positions[3 * c + k] - positions[3 * a + k]);
  return (
    0.5 *
    Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    )
  );
}

/** Share of triangles whose face normal points against the sum of their vertex normals. */
export function faceNormalDisagreement(positions, normals, indices) {
  if (!normals || !indices.length) return null;
  let against = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]],
      p = (v, k) => positions[3 * v + k],
      e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)),
      e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k)),
      face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ],
      mean = [0, 1, 2].map((k) => normals[3 * a + k] + normals[3 * b + k] + normals[3 * c + k]);
    if (face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2] < 0) against++;
  }
  return against / (indices.length / 3);
}
