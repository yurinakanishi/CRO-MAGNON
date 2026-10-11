// Low-poly head revision, step 1 of 3 (geometry): weld the adopted face-remake head by position,
// simplify it with the neck seam locked, and write the Blender bake inputs.
//
// The adopted heads (assets/face-remake) are 5–6万 triangles of an xatlas patchwork: every
// TRELLIS chart is its own island, so the head has 1.7–2.5万 open edges by position and the
// simplifier, which must keep every UV seam, cannot reduce it. Welding by position first turns
// the patchwork into one surface (its coincident double layers dropped, its cracks closed); the
// new UV layout and texture come from a bake of the adopted head (bake-head.py), so the approved
// look is the source. Every kept vertex is an adopted vertex: its position, skin joints and
// weights are copied, never re-derived. Vertices shared with the body's neck ring are locked, so
// the seam stays exactly where the body is in every clip. The low head is written with one
// winding per connected surface, which Blender's unwrap and bake cage rely on.
//
//   node scripts/face-remake/lowpoly-head.mjs --master <startup glb> --texture <glb with the
//     2048 head albedo> --out <dir> --eye <m> --chin <m> [--target 12000] [--weld 0.0001]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { logicalViews, parseGlb } from '../delivery/cook-glb.mjs';

const main = process.argv[1]?.endsWith('lowpoly-head.mjs');
const { values: args } = parseArgs({
  args: main ? process.argv.slice(2) : [],
  options: {
    master: { type: 'string' },
    texture: { type: 'string' },
    out: { type: 'string' },
    target: { type: 'string', default: '12000' },
    weld: { type: 'string', default: '0.0001' },
    error: { type: 'string', default: '0.02' },
    // Border vertices this close to another border vertex or edge are joined (metres).
    crack: { type: 'string', default: '0.001' },
    // Adopted vertices within this distance of the neck seam are kept as they are (metres).
    band: { type: 'string', default: '0.025' },
    // Growth of each bake-source triangle (metres), see the high OBJ below.
    dilate: { type: 'string', default: '0' },
    // Texels each chart of the bake-source albedo is grown by.
    pad: { type: 'string', default: '12' },
    // Crack tolerance inside the face region (metres): its UV chart must stay in one piece.
    'face-crack': { type: 'string', default: '0.0025' },
    head: { type: 'string', default: 'C2 face remake head' },
    // Face landmarks (model metres, from the face remake's graft): eye row and chin.
    eye: { type: 'string' },
    chin: { type: 'string' },
    // The face (eyes, nose, mouth, cheeks) is simplified only within this distance (metres);
    // hair, ears and the back of the head within --error (relative to the head's size).
    'face-error': { type: 'string', default: '0.0008' },
    // Skin outside the face (neck, ears, jaw sides; told from hair by the albedo) within this.
    'skin-error': { type: 'string', default: '0.002' },
    // Skin and hair islands smaller than this (vertices) join the region around them.
    'min-island': { type: 'string', default: '150' },
  },
});
for (const key of main ? ['master', 'texture', 'out', 'eye', 'chin'] : [])
  if (!args[key]) throw new Error(`--${key} is required`);
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function readPrimitives(bytes, label) {
  const { json, bin } = parseGlb(bytes, label);
  const views = logicalViews(json, bin, label);
  const read = (index) => {
    const a = json.accessors[index];
    const T = TYPED[a.componentType];
    const width = COMPONENTS[a.type];
    const raw = views[a.bufferView].bytes;
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    const stride =
      (json.bufferViews[a.bufferView].byteStride ?? width * T.BYTES_PER_ELEMENT) /
      T.BYTES_PER_ELEMENT;
    const src = new T(copy.buffer);
    const out = new T(a.count * width);
    const base = (a.byteOffset ?? 0) / T.BYTES_PER_ELEMENT;
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < width; c++) out[i * width + c] = src[base + i * stride + c];
    return out;
  };
  const primitives = json.meshes.flatMap((mesh, m) =>
    mesh.primitives.map((p, i) => ({
      mesh: m,
      index: i,
      material: json.materials[p.material]?.name ?? '',
      json: p,
      positions: read(p.attributes.POSITION),
      normals: p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : null,
      uvs: p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null,
      joints: p.attributes.JOINTS_0 !== undefined ? read(p.attributes.JOINTS_0) : null,
      weights: p.attributes.WEIGHTS_0 !== undefined ? read(p.attributes.WEIGHTS_0) : null,
      indices: new Uint32Array(read(p.indices)),
    })),
  );
  return { json, bin, views, primitives };
}

/**
 * Grow every UV chart of an RGB texture by `pad` texels: texels no triangle covers take the mean
 * of their covered neighbours, ring by ring. Covered texels keep their colour exactly.
 */
export function padCharts(data, width, height, uvs, indices, pad) {
  const covered = new Uint8Array(width * height);
  for (let t = 0; t < indices.length; t += 3) {
    const P = [0, 1, 2].map((k) => [
      uvs[indices[t + k] * 2] * width - 0.5,
      uvs[indices[t + k] * 2 + 1] * height - 0.5,
    ]);
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]) - 1));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]) - 1));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1]) + 1));
    const area =
      (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (!area) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const w0 = ((P[1][0] - x) * (P[2][1] - y) - (P[2][0] - x) * (P[1][1] - y)) / area;
        const w1 = ((P[2][0] - x) * (P[0][1] - y) - (P[0][0] - x) * (P[2][1] - y)) / area;
        const w2 = 1 - w0 - w1;
        // Half a texel of slack: a texel the triangle touches counts as covered.
        const slack = 0.75 / Math.sqrt(Math.abs(area));
        if (w0 >= -slack && w1 >= -slack && w2 >= -slack) covered[y * width + x] = 1;
      }
  }
  const out = Buffer.from(data);
  let frontier = covered;
  for (let ring = 0; ring < pad; ring++) {
    const next = frontier.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (frontier[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (!frontier[j]) continue;
            r += out[j * 3];
            g += out[j * 3 + 1];
            b += out[j * 3 + 2];
            n++;
          }
        if (n) {
          out[i * 3] = Math.round(r / n);
          out[i * 3 + 1] = Math.round(g / n);
          out[i * 3 + 2] = Math.round(b / n);
          next[i] = 1;
        }
      }
    frontier = next;
  }
  return out;
}

/** Distance from each of `count` points (positions) to the nearest triangle of `indices`. */
export function surfaceDistances(positions, indices, count) {
  const cellSize = 0.01;
  const cellOf = (x) => Math.floor(x / cellSize);
  const grid = new Map();
  const p = (v, k) => positions[v * 3 + k];
  for (let t = 0; t < indices.length; t += 3) {
    const lo = [0, 1, 2].map((k) =>
      cellOf(Math.min(p(indices[t], k), p(indices[t + 1], k), p(indices[t + 2], k))),
    );
    const hi = [0, 1, 2].map((k) =>
      cellOf(Math.max(p(indices[t], k), p(indices[t + 1], k), p(indices[t + 2], k))),
    );
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = `${x},${y},${z}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(t);
        }
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // Closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5).
  const closest = (q, a, b, c) => {
    const ab = sub(b, a),
      ac = sub(c, a),
      ap = sub(q, a);
    const d1 = dot(ab, ap),
      d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(q, b),
      d3 = dot(ab, bp),
      d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
    }
    const cp = sub(q, c),
      d5 = dot(ab, cp),
      d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
    }
    const denom = 1 / (va + vb + vc),
      v = vb * denom,
      w = vc * denom;
    return [
      a[0] + ab[0] * v + ac[0] * w,
      a[1] + ab[1] * v + ac[1] * w,
      a[2] + ab[2] * v + ac[2] * w,
    ];
  };
  const out = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    const q = [p(v, 0), p(v, 1), p(v, 2)];
    let best = Infinity;
    for (let radius = 0; radius <= 3 && best === Infinity; radius++)
      for (let dx = -radius; dx <= radius; dx++)
        for (let dy = -radius; dy <= radius; dy++)
          for (let dz = -radius; dz <= radius; dz++) {
            for (const t of grid.get(
              `${cellOf(q[0]) + dx},${cellOf(q[1]) + dy},${cellOf(q[2]) + dz}`,
            ) ?? []) {
              const a = [p(indices[t], 0), p(indices[t], 1), p(indices[t], 2)];
              const b = [p(indices[t + 1], 0), p(indices[t + 1], 1), p(indices[t + 1], 2)];
              const c = [p(indices[t + 2], 0), p(indices[t + 2], 1), p(indices[t + 2], 2)];
              const r = closest(q, a, b, c);
              const d = Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]);
              if (d < best) best = d;
            }
          }
    out[v] = best;
  }
  return out;
}

/**
 * Turn every inside-out patch outward. The face remake grafted its projected face with winding
 * and normals both reversed (the material is double-sided, so it renders); the low head needs
 * one outward orientation for its welded normals and its bake cage. Triangles that share an edge
 * (by position) and traverse it oppositely form one coherent patch; a patch whose area-weighted
 * normals point toward the head's vertical axis is reversed: its winding and the normals of the
 * vertices it owns. Returns copies; the inputs are not changed.
 */
export function orientOutward(positions, normals, indices) {
  const count = positions.length / 3;
  const key = (v) => `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
  const ids = new Map(),
    pid = new Int32Array(count);
  for (let v = 0; v < count; v++) {
    const k = key(v);
    if (!ids.has(k)) ids.set(k, ids.size);
    pid[v] = ids.get(k);
  }
  const triangles = indices.length / 3;
  const parent = Int32Array.from({ length: triangles }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const edges = new Map();
  for (let t = 0; t < triangles; t++)
    for (let e = 0; e < 3; e++) {
      const a = pid[indices[t * 3 + e]],
        b = pid[indices[t * 3 + ((e + 1) % 3)]];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = edges.get(k);
      if (!entry) edges.set(k, [{ t, forward: a < b }]);
      else entry.push({ t, forward: a < b });
    }
  for (const list of edges.values())
    if (list.length === 2 && list[0].forward !== list[1].forward)
      parent[find(list[0].t)] = find(list[1].t);
  // Head axis: the vertical line through the bounding-box centre.
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  const cx = (lo[0] + hi[0]) / 2,
    cy = (lo[1] + hi[1]) / 2,
    cz = (lo[2] + hi[2]) / 2;
  const vote = new Map();
  const geometric = (t) => {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const m = [0, 1, 2].map(
      (k) => (positions[a * 3 + k] + positions[b * 3 + k] + positions[c * 3 + k]) / 3,
    );
    return { n, m };
  };
  for (let t = 0; t < triangles; t++) {
    const { n, m } = geometric(t);
    // Outward from the head's centre (a sphere test): faces, hair and the neck all agree.
    const out = n[0] * (m[0] - cx) + n[1] * (m[1] - cy) + n[2] * (m[2] - cz);
    const r = find(t);
    vote.set(r, (vote.get(r) ?? 0) + Math.sign(out) * Math.hypot(...n));
  }
  const flip = new Uint8Array(triangles);
  let flippedTriangles = 0;
  for (let t = 0; t < triangles; t++)
    if ((vote.get(find(t)) ?? 0) < 0) {
      flip[t] = 1;
      flippedTriangles++;
    }
  const outIndices = Uint32Array.from(indices);
  for (let t = 0; t < triangles; t++)
    if (flip[t])
      [outIndices[t * 3 + 1], outIndices[t * 3 + 2]] = [
        outIndices[t * 3 + 2],
        outIndices[t * 3 + 1],
      ];
  // A vertex's normal is reversed when most of the area around it was reversed.
  const share = new Float64Array(count);
  for (let t = 0; t < triangles; t++) {
    const a = Math.hypot(...geometric(t).n) * (flip[t] ? 1 : -1);
    for (let k = 0; k < 3; k++) share[indices[t * 3 + k]] += a;
  }
  const outNormals = Float32Array.from(normals);
  let flippedVertices = 0;
  for (let v = 0; v < count; v++)
    if (share[v] > 0) {
      for (let k = 0; k < 3; k++) outNormals[v * 3 + k] = -normals[v * 3 + k];
      flippedVertices++;
    }
  return { indices: outIndices, normals: outNormals, flippedTriangles, flippedVertices };
}

/**
 * Drop coincident duplicates: the patchwork's double layers (a patch and its reversed copy)
 * weld onto the same three vertices. The first copy is kept; orientConsistently winds it.
 */
export function dropDuplicateTriangles(indices) {
  const seen = new Set(),
    out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const key = [indices[t], indices[t + 1], indices[t + 2]].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return { indices: Uint32Array.from(out), dropped: (indices.length - out.length) / 3 };
}

/**
 * One winding per connected surface: the winding is carried across every manifold edge (two
 * triangles) so neighbours traverse it oppositely, and each connected surface then takes the
 * orientation its vertex normals agree with (area-weighted). A vertex normal that still points
 * against the surface around it is reversed. Blender derives the bake cage and the unwrap from
 * this winding: mixed windings fold the UV charts and push cage vertices sideways.
 * Returns copies, and the edges that stay inconsistent (non-orientable joins) or non-manifold.
 */
export function orientConsistently(positions, indices, normals) {
  const count = positions.length / 3,
    triangles = indices.length / 3;
  const edges = new Map();
  for (let t = 0; t < triangles; t++)
    for (let e = 0; e < 3; e++) {
      const a = indices[t * 3 + e],
        b = indices[t * 3 + ((e + 1) % 3)];
      const k = a < b ? a * count + b : b * count + a;
      const list = edges.get(k);
      if (list) list.push(t);
      else edges.set(k, [t]);
    }
  // Does triangle t (original winding) traverse a→b?
  const forward = (t, a, b) => {
    for (let e = 0; e < 3; e++)
      if (indices[t * 3 + e] === a && indices[t * 3 + ((e + 1) % 3)] === b) return true;
    return false;
  };
  const sign = new Int8Array(triangles),
    component = new Int32Array(triangles).fill(-1);
  let components = 0;
  for (let seed = 0; seed < triangles; seed++) {
    if (sign[seed]) continue;
    sign[seed] = 1;
    component[seed] = components;
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q];
      for (let e = 0; e < 3; e++) {
        let a = indices[t * 3 + e],
          b = indices[t * 3 + ((e + 1) % 3)];
        if (sign[t] < 0) [a, b] = [b, a];
        const list = edges.get(a < b ? a * count + b : b * count + a);
        if (list.length !== 2) continue;
        const u = list[0] === t ? list[1] : list[0];
        if (sign[u]) continue;
        // u must traverse the shared edge b→a.
        sign[u] = forward(u, a, b) ? -1 : 1;
        component[u] = components;
        queue.push(u);
      }
    }
    components++;
  }
  const geometric = (t, s) => {
    const [a, b, c] =
      s > 0
        ? [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]
        : [indices[t * 3], indices[t * 3 + 2], indices[t * 3 + 1]];
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    return [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
  };
  const agreement = new Float64Array(components);
  for (let t = 0; t < triangles; t++) {
    const n = geometric(t, sign[t]);
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      agreement[component[t]] +=
        n[0] * normals[v * 3] + n[1] * normals[v * 3 + 1] + n[2] * normals[v * 3 + 2];
    }
  }
  const outIndices = Uint32Array.from(indices);
  let flippedTriangles = 0;
  for (let t = 0; t < triangles; t++) {
    if (agreement[component[t]] < 0) sign[t] = -sign[t];
    if (sign[t] < 0) {
      [outIndices[t * 3 + 1], outIndices[t * 3 + 2]] = [
        outIndices[t * 3 + 2],
        outIndices[t * 3 + 1],
      ];
      flippedTriangles++;
    }
  }
  const around = new Float64Array(count * 3);
  for (let t = 0; t < triangles; t++) {
    const n = geometric(t, sign[t]);
    for (let k = 0; k < 3; k++)
      for (let j = 0; j < 3; j++) around[indices[t * 3 + k] * 3 + j] += n[j];
  }
  const outNormals = Float32Array.from(normals);
  let flippedNormals = 0;
  for (let v = 0; v < count; v++)
    if (
      around[v * 3] * normals[v * 3] +
        around[v * 3 + 1] * normals[v * 3 + 1] +
        around[v * 3 + 2] * normals[v * 3 + 2] <
      0
    ) {
      for (let j = 0; j < 3; j++) outNormals[v * 3 + j] = -normals[v * 3 + j];
      flippedNormals++;
    }
  let inconsistentEdges = 0,
    nonManifoldEdges = 0;
  for (const [k, list] of edges) {
    if (list.length > 2) nonManifoldEdges++;
    if (list.length !== 2) continue;
    const a = Math.floor(k / count),
      b = k % count;
    const along = (t) => forward(t, a, b) !== sign[t] < 0;
    if (along(list[0]) === along(list[1])) inconsistentEdges++;
  }
  return {
    indices: outIndices,
    normals: outNormals,
    components,
    flippedTriangles,
    flippedNormals,
    inconsistentEdges,
    nonManifoldEdges,
  };
}

/** Open (one-triangle) edges of a triangle list over `count` vertices. */
export function openEdgeCount(triangles, count) {
  const edges = new Map();
  for (let t = 0; t < triangles.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e],
        b = triangles[t + ((e + 1) % 3)];
      const k = a < b ? a * count + b : b * count + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  let open = 0;
  for (const n of edges.values()) if (n === 1) open++;
  return open;
}

/**
 * Close cracks between patches: border vertices within `tolerance` of each other are merged, and a
 * border vertex lying on another border edge splits that edge (a T-junction becomes a shared
 * vertex). No vertex is created or moved; triangle winding is kept. `locked` vertices are never
 * merged into another vertex. Returns { triangles, merged } where merged[v] is v's survivor.
 */
export function repairCracks(positions, input, tolerance, locked, rounds = 6) {
  const count = positions.length / 3;
  // `tolerance` is metres, or one value per vertex (the vertex that moves or splits an edge).
  const tol = typeof tolerance === 'number' ? () => tolerance : (v) => tolerance[v];
  const maxTolerance = typeof tolerance === 'number' ? tolerance : Math.max(...tolerance);
  const merged = Int32Array.from({ length: count }, (_, i) => i);
  const find = (v) => {
    while (merged[v] !== v) v = merged[v] = merged[merged[v]];
    return v;
  };
  let triangles = [...input];
  const p = (v, k) => positions[v * 3 + k];
  const cellSize = Math.max(maxTolerance * 4, 1e-4);
  const cellOf = (x) => Math.floor(x / cellSize);
  for (let round = 0; round < rounds; round++) {
    // Border edges, oriented as their one triangle winds them.
    const edges = new Map();
    for (let t = 0; t < triangles.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = triangles[t + e],
          b = triangles[t + ((e + 1) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const list = edges.get(k);
        if (list) list.push([t, e]);
        else edges.set(k, [[t, e]]);
      }
    const border = [];
    for (const [k, list] of edges)
      if (list.length === 1) border.push({ key: k, t: list[0][0], e: list[0][1] });
    if (!border.length) break;
    const borderVertices = new Set();
    for (const b of border) {
      borderVertices.add(triangles[b.t + b.e]);
      borderVertices.add(triangles[b.t + ((b.e + 1) % 3)]);
    }
    // 1. Merge near-coincident border vertices.
    const grid = new Map();
    for (const v of borderVertices) {
      const k = `${cellOf(p(v, 0))},${cellOf(p(v, 1))},${cellOf(p(v, 2))}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(v);
    }
    let changes = 0;
    for (const v of borderVertices) {
      if (find(v) !== v || locked[v]) continue;
      const [cx, cy, cz] = [cellOf(p(v, 0)), cellOf(p(v, 1)), cellOf(p(v, 2))];
      let best = -1,
        bestDistance = tol(v);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (w === v || find(w) !== w) continue;
              const d = Math.hypot(p(v, 0) - p(w, 0), p(v, 1) - p(w, 1), p(v, 2) - p(w, 2));
              if (d <= bestDistance && (locked[w] || w < v || !locked[v])) {
                best = w;
                bestDistance = d;
              }
            }
      if (best >= 0) {
        merged[v] = best;
        changes++;
      }
    }
    if (changes) {
      const next = [];
      for (let t = 0; t < triangles.length; t += 3) {
        const a = find(triangles[t]),
          b = find(triangles[t + 1]),
          c = find(triangles[t + 2]);
        if (a !== b && b !== c && a !== c) next.push(a, b, c);
      }
      triangles = next;
      continue;
    }
    // 2. Split border edges at border vertices lying on them (T-junctions).
    const edgeGrid = new Map();
    border.forEach((b, i) => {
      const a = triangles[b.t + b.e],
        c = triangles[b.t + ((b.e + 1) % 3)];
      const lo = [0, 1, 2].map((k) => cellOf(Math.min(p(a, k), p(c, k)) - maxTolerance));
      const hi = [0, 1, 2].map((k) => cellOf(Math.max(p(a, k), p(c, k)) + maxTolerance));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = `${x},${y},${z}`;
            if (!edgeGrid.has(k)) edgeGrid.set(k, []);
            edgeGrid.get(k).push(i);
          }
    });
    const splits = new Map();
    for (const v of borderVertices) {
      const [cx, cy, cz] = [cellOf(p(v, 0)), cellOf(p(v, 1)), cellOf(p(v, 2))];
      let best = null;
      for (const i of edgeGrid.get(`${cx},${cy},${cz}`) ?? []) {
        const b = border[i];
        const a = triangles[b.t + b.e],
          c = triangles[b.t + ((b.e + 1) % 3)];
        if (a === v || c === v) continue;
        const ab = [0, 1, 2].map((k) => p(c, k) - p(a, k));
        const av = [0, 1, 2].map((k) => p(v, k) - p(a, k));
        const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
        if (!(len2 > 0)) continue;
        const s = (av[0] * ab[0] + av[1] * ab[1] + av[2] * ab[2]) / len2;
        if (s <= 0.02 || s >= 0.98) continue;
        const d = Math.hypot(av[0] - s * ab[0], av[1] - s * ab[1], av[2] - s * ab[2]);
        if (d <= tol(v) && (!best || d < best.d)) best = { i, s, d };
      }
      if (best) {
        if (!splits.has(best.i)) splits.set(best.i, []);
        splits.get(best.i).push({ s: best.s, v });
      }
    }
    if (!splits.size) break;
    const replaced = new Map();
    for (const [i, points] of splits) {
      const b = border[i];
      if (replaced.has(b.t)) continue; // one split edge per triangle per round
      points.sort((x, y) => x.s - y.s);
      const a = triangles[b.t + b.e],
        c = triangles[b.t + ((b.e + 1) % 3)],
        o = triangles[b.t + ((b.e + 2) % 3)];
      const chain = [a, ...points.map((q) => q.v).filter((v) => v !== o), c];
      const fan = [];
      for (let k = 0; k + 1 < chain.length; k++) fan.push(chain[k], chain[k + 1], o);
      replaced.set(b.t, fan);
    }
    const next = [];
    for (let t = 0; t < triangles.length; t += 3) {
      if (replaced.has(t)) next.push(...replaced.get(t));
      else next.push(triangles[t], triangles[t + 1], triangles[t + 2]);
    }
    const rebuilt = [];
    for (let t = 0; t + 2 < next.length; t += 3)
      if (next[t] !== next[t + 1] && next[t + 1] !== next[t + 2] && next[t] !== next[t + 2])
        rebuilt.push(next[t], next[t + 1], next[t + 2]);
    triangles = rebuilt;
  }
  return { triangles, merged: Int32Array.from({ length: count }, (_, i) => find(i)) };
}

function headImage(json, bin, views, primitive) {
  const material = json.materials[primitive.json.material];
  const texture = json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
  const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
  const image = json.images[source];
  return Buffer.from(views[image.bufferView].bytes);
}

if (main) {
  const out = path.resolve(args.out);
  await mkdir(out, { recursive: true });
  const master = readPrimitives(await readFile(args.master), args.master);
  const source = readPrimitives(await readFile(args.texture), args.texture);
  const head = master.primitives.find((p) => p.material.startsWith(args.head));
  const sourceHead = source.primitives.find((p) => p.material.startsWith(args.head));
  if (!head || !sourceHead) throw new Error(`No head primitive named ${args.head}`);
  // The bake source must be the very same surface and UV layout as the adopted head.
  for (const key of ['positions', 'uvs', 'indices'])
    if (Buffer.compare(Buffer.from(head[key].buffer), Buffer.from(sourceHead[key].buffer)) !== 0)
      throw new Error(`The texture source head differs from the master head (${key})`);
  const count = head.positions.length / 3;
  // One outward orientation for the low head (the bake source keeps the adopted triangles).
  const oriented = orientOutward(head.positions, head.normals, head.indices);
  const adoptedNormals = head.normals;
  head.indices = oriented.indices;
  head.normals = oriented.normals;

  // Neck seam: head vertices that sit exactly on a body vertex.
  const key = (x, y, z) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  const bodyPositions = new Set();
  for (const p of master.primitives)
    if (p !== head)
      for (let i = 0; i < p.positions.length; i += 3)
        bodyPositions.add(key(p.positions[i], p.positions[i + 1], p.positions[i + 2]));
  const ring = new Uint8Array(count);
  let ringCount = 0;
  for (let v = 0; v < count; v++)
    if (
      bodyPositions.has(
        key(head.positions[v * 3], head.positions[v * 3 + 1], head.positions[v * 3 + 2]),
      )
    ) {
      ring[v] = 1;
      ringCount++;
    }

  // The seam's normals were matched to the body ring: reorientation must not reverse them.
  for (let v = 0; v < count; v++)
    if (ring[v] && head.normals[v * 3 + 1] !== adoptedNormals[v * 3 + 1])
      throw new Error(`Neck seam vertex ${v} would change its normal`);

  // Weld by position: each cluster is represented by one adopted vertex (a ring vertex if any).
  const weld = Number(args.weld);
  const cell = (x) => Math.floor(x / weld);
  const grid = new Map();
  const cluster = new Int32Array(count).fill(-1);
  const representatives = [];
  const order = [...Array(count).keys()].sort((a, b) => ring[b] - ring[a]);
  for (const v of order) {
    const x = head.positions[v * 3],
      y = head.positions[v * 3 + 1],
      z = head.positions[v * 3 + 2];
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++)
          for (const c of grid.get(`${cell(x) + dx},${cell(y) + dy},${cell(z) + dz}`) ?? []) {
            const r = representatives[c];
            if (
              Math.hypot(
                head.positions[r * 3] - x,
                head.positions[r * 3 + 1] - y,
                head.positions[r * 3 + 2] - z,
              ) <= weld
            ) {
              found = c;
              break;
            }
          }
    if (found < 0 || (ring[v] && ring[representatives[found]])) {
      found = representatives.length;
      representatives.push(v);
      const k = `${cell(x)},${cell(y)},${cell(z)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(found);
    }
    cluster[v] = found;
  }
  const welded = representatives.length;
  const wPositions = new Float32Array(welded * 3);
  const wNormals = new Float32Array(welded * 3);
  const wLock = new Uint8Array(welded);
  representatives.forEach((r, c) => {
    wPositions.set(head.positions.subarray(r * 3, r * 3 + 3), c * 3);
    wLock[c] = ring[r];
  });
  for (let v = 0; v < count; v++) {
    const c = cluster[v];
    for (let k = 0; k < 3; k++) wNormals[c * 3 + k] += head.normals[v * 3 + k];
  }
  for (let c = 0; c < welded; c++) {
    const r = representatives[c];
    if (wLock[c]) {
      // The seam keeps the adopted normal the body ring was matched to.
      wNormals.set(head.normals.subarray(r * 3, r * 3 + 3), c * 3);
      continue;
    }
    const n = Math.hypot(wNormals[c * 3], wNormals[c * 3 + 1], wNormals[c * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) wNormals[c * 3 + k] /= n;
  }
  const triangles = [];
  for (let t = 0; t < head.indices.length; t += 3) {
    const a = cluster[head.indices[t]],
      b = cluster[head.indices[t + 1]],
      c = cluster[head.indices[t + 2]];
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  const weldedOpen = openEdgeCount(triangles, welded);
  // Close the patchwork's cracks (chart borders that meet as T-junctions), then lock the neck.
  // Cracks inside the face would cut its UV chart apart, so they are closed with --face-crack.
  const crackTolerance = new Float32Array(welded).fill(Number(args.crack));
  {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < wPositions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], wPositions[i]);
      hi[i % 3] = Math.max(hi[i % 3], wPositions[i]);
    }
    const cx = (lo[0] + hi[0]) / 2,
      cz = (lo[2] + hi[2]) / 2;
    for (let c = 0; c < welded; c++) {
      const x = wPositions[c * 3],
        y = wPositions[c * 3 + 1],
        z = wPositions[c * 3 + 2];
      const front = (z - cz) / (Math.hypot(x - cx, z - cz) || 1);
      if (y >= Number(args.chin) - 0.025 && y <= Number(args.eye) + 0.065 && front > 0.4)
        crackTolerance[c] = Number(args['face-crack']);
    }
  }
  const repair = repairCracks(wPositions, triangles, crackTolerance, wLock);
  const deduplicated = dropDuplicateTriangles(repair.triangles);
  const wIndices = deduplicated.indices;
  for (let c = 0; c < welded; c++) if (repair.merged[c] !== c) wLock[repair.merged[c]] ||= wLock[c];
  const band = Number(args.band);
  const seam = [...wLock.keys()].filter((c) => wLock[c]);
  if (seam.length && band > 0)
    for (let c = 0; c < welded; c++)
      for (const s of seam)
        if (
          Math.hypot(
            wPositions[c * 3] - wPositions[s * 3],
            wPositions[c * 3 + 1] - wPositions[s * 3 + 1],
            wPositions[c * 3 + 2] - wPositions[s * 3 + 2],
          ) <= band
        ) {
          wLock[c] = 1;
          break;
        }
  // Open edges before and after welding, by position.
  const openEdges = (indices) => {
    const edges = new Map();
    for (let t = 0; t < indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[t + e],
          b = indices[t + ((e + 1) % 3)];
        const k = a < b ? a * welded + b : b * welded + a;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    let open = 0;
    for (const n of edges.values()) if (n === 1) open++;
    return open;
  };

  // The face region: front-facing surface between the chin and the brow, away from the ears.
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < wPositions.length; i++) {
    box.min[i % 3] = Math.min(box.min[i % 3], wPositions[i]);
    box.max[i % 3] = Math.max(box.max[i % 3], wPositions[i]);
  }
  const centre = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
  const eye = Number(args.eye),
    chin = Number(args.chin);
  const face = new Uint8Array(welded);
  for (let c = 0; c < welded; c++) {
    const x = wPositions[c * 3],
      y = wPositions[c * 3 + 1],
      z = wPositions[c * 3 + 2];
    const dx = x - centre[0],
      dz = z - centre[2];
    const front = dz / (Math.hypot(dx, dz) || 1);
    face[c] =
      y >= chin - 0.025 && y <= eye + 0.065 && front > 0.4 && wNormals[c * 3 + 2] > -0.2 ? 1 : 0;
  }
  // Grow the region by one ring so its border triangles are face triangles too.
  const grown = face.slice();
  for (let t = 0; t < wIndices.length; t += 3) {
    const tri = [wIndices[t], wIndices[t + 1], wIndices[t + 2]];
    if (tri.some((v) => face[v])) for (const v of tri) grown[v] = 1;
  }
  face.set(grown);
  const faceTriangles = (indices) => {
    let n = 0;
    for (let t = 0; t < indices.length; t += 3)
      if (face[indices[t]] && face[indices[t + 1]] && face[indices[t + 2]]) n++;
    return n;
  };
  const scaleOf = MeshoptSimplifier.getScale(wPositions, 3);
  // Skin outside the face: the albedo under each vertex is not hair-dark (neck, ears, jaw).
  const albedo = await sharp(headImage(source.json, source.bin, source.views, sourceHead))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const skin = new Uint8Array(welded);
  for (let v = 0; v < count; v++) {
    const c = repair.merged[cluster[v]];
    const x = Math.min(
      albedo.info.width - 1,
      Math.max(0, Math.round(head.uvs[v * 2] * (albedo.info.width - 1))),
    );
    const y = Math.min(
      albedo.info.height - 1,
      Math.max(0, Math.round(head.uvs[v * 2 + 1] * (albedo.info.height - 1))),
    );
    const i = (y * albedo.info.width + x) * 3;
    const [r, g, b] = [albedo.data[i] / 255, albedo.data[i + 1] / 255, albedo.data[i + 2] / 255];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance > 0.24 && r - b > 0.1) skin[c] = 1;
  }
  // Regions: hair and the rest (0), other skin (1), the face (2). The albedo test is noisy along
  // the hairline, so the skin mask is cleaned first: a neighbourhood majority vote, then islands
  // under --min-island vertices join the region around them. Each region is then simplified in
  // turn with the others and every border between regions held, so regions meet exactly.
  const neighbours = Array.from({ length: welded }, () => new Set());
  for (let t = 0; t < wIndices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = wIndices[t + e],
        b = wIndices[t + ((e + 1) % 3)];
      neighbours[a].add(b);
      neighbours[b].add(a);
    }
  let mask = skin.slice();
  for (let iteration = 0; iteration < 3; iteration++) {
    const next = mask.slice();
    for (let c = 0; c < welded; c++) {
      if (!neighbours[c].size) continue;
      let votes = mask[c],
        n = 1;
      for (const d of neighbours[c]) {
        votes += mask[d];
        n++;
      }
      next[c] = votes * 2 > n ? 1 : votes * 2 < n ? 0 : mask[c];
    }
    mask = next;
  }
  const minIsland = Number(args['min-island']);
  for (const value of [1, 0]) {
    const seen = new Uint8Array(welded);
    for (let c = 0; c < welded; c++) {
      if (seen[c] || mask[c] !== value) continue;
      const component = [c];
      seen[c] = 1;
      for (let i = 0; i < component.length; i++)
        for (const d of neighbours[component[i]])
          if (!seen[d] && mask[d] === value) {
            seen[d] = 1;
            component.push(d);
          }
      if (component.length < minIsland) for (const d of component) mask[d] = 1 - value;
    }
  }
  const region = new Uint8Array(welded);
  for (let c = 0; c < welded; c++) region[c] = face[c] ? 2 : mask[c] ? 1 : 0;
  const target = Math.floor(Number(args.target)) * 3;
  const regionTriangles = (indices, r) => {
    let n = 0;
    for (let t = 0; t < indices.length; t += 3)
      if (region[indices[t]] === r && region[indices[t + 1]] === r && region[indices[t + 2]] === r)
        n++;
    return n;
  };
  const passes = {};
  let current = wIndices,
    error = 0;
  for (const [r, name, limit, weight] of [
    [0, 'hair', Number(args.error) * scaleOf, 0.4],
    [1, 'skin', Number(args['skin-error']), 0.5],
    [2, 'face', Number(args['face-error']), 0.6],
  ]) {
    const lock = Uint8Array.from(wLock, (l, c) => (l || region[c] !== r ? 1 : 0));
    let border = 0;
    for (let t = 0; t < current.length; t += 3) {
      const tri = [current[t], current[t + 1], current[t + 2]];
      if (tri.some((v) => region[v] !== region[tri[0]])) {
        border++;
        for (const v of tri) lock[v] = 1;
      }
    }
    const before = regionTriangles(current, r);
    // Only hair has a triangle budget; skin and face stop at their error.
    const budget = r === 0 ? Math.max(0, target - (current.length / 3 - before) * 3) : 0;
    const [next, passError] = MeshoptSimplifier.simplifyWithAttributes(
      current,
      wPositions,
      3,
      wNormals,
      3,
      [weight, weight, weight],
      lock,
      budget,
      limit / scaleOf,
      // Skin and face keep their open borders exactly: a crack whose two sides were simplified
      // separately opens a visible slit, while hair hides one.
      r === 0 ? [] : ['LockBorder'],
    );
    passes[name] = {
      trianglesBefore: before,
      trianglesAfter: regionTriangles(next, r),
      borderTriangles: border,
      errorMetres: Number((passError * scaleOf).toFixed(6)),
      errorLimitMetres: Number(limit.toFixed(6)),
    };
    error = Math.max(error, passError);
    current = next;
  }
  // The simplifier can collapse two layers onto the same vertices again.
  const lowDuplicates = dropDuplicateTriangles(current);
  const simplified = lowDuplicates.indices;
  const scale = MeshoptSimplifier.getScale(wPositions, 3);
  // Compact: low vertex i is welded cluster lowToCluster[i].
  const remap = new Int32Array(welded).fill(-1);
  const lowToCluster = [];
  const lowIndices = new Uint32Array(simplified.length);
  for (let i = 0; i < simplified.length; i++) {
    const c = simplified[i];
    if (remap[c] < 0) {
      remap[c] = lowToCluster.length;
      lowToCluster.push(c);
    }
    lowIndices[i] = remap[c];
  }
  const seamClusters = seam.map((c) => repair.merged[c]);
  const lockedKept = new Set(seamClusters.filter((c) => remap[c] >= 0)).size;
  const lockedTotal = new Set(seamClusters).size;
  // A locked cluster that no low triangle uses would open the seam.
  if (lockedKept !== lockedTotal)
    throw new Error(`Only ${lockedKept} of ${lockedTotal} neck seam vertices kept`);

  // Shape check: distance from every adopted (welded) vertex to the low surface, per region.
  const distances = surfaceDistances(wPositions, simplified, welded);
  // Only vertices of the surface being simplified count (not ones left unused by the weld).
  const referenced = new Uint8Array(welded);
  for (const v of wIndices) referenced[v] = 1;
  const farthest = { distance: 0, vertex: -1 };
  const regionNames = ['hair', 'skin', 'face'];
  passes.distance = {};
  for (let r = 0; r < 3; r++) {
    const values = [];
    for (let c = 0; c < welded; c++)
      if (region[c] === r && repair.merged[c] === c && referenced[c]) values.push(distances[c]);
    values.sort((a, b) => a - b);
    const q = (f) => values[Math.min(values.length - 1, Math.floor(values.length * f))] ?? 0;
    for (let c = 0; c < welded; c++)
      if (
        r === 2 &&
        region[c] === 2 &&
        referenced[c] &&
        repair.merged[c] === c &&
        distances[c] > farthest.distance
      )
        Object.assign(farthest, {
          distance: distances[c],
          vertex: c,
          position: Array.from(wPositions.subarray(c * 3, c * 3 + 3)),
        });
    passes.distance[regionNames[r]] = {
      vertices: values.length,
      p50Millimetres: Number((q(0.5) * 1000).toFixed(3)),
      p99Millimetres: Number((q(0.99) * 1000).toFixed(3)),
      maxMillimetres: Number(((values.at(-1) ?? 0) * 1000).toFixed(3)),
    };
  }
  // Open edges by region before simplification (cracks the repair could not close).
  {
    const edges = new Map();
    for (let t = 0; t < wIndices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = wIndices[t + e],
          b = wIndices[t + ((e + 1) % 3)];
        const key = a < b ? a * welded + b : b * welded + a;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    passes.openEdgesByRegion = [0, 0, 0];
    for (const [key, n] of edges)
      if (n === 1)
        passes.openEdgesByRegion[
          Math.max(region[Math.floor(key / welded)], region[key % welded])
        ]++;
  }
  passes.farthestFaceVertex = farthest;
  passes.lowTrianglesByRegion = [0, 1, 2].map((r) => {
    let n = 0;
    for (let t = 0; t < simplified.length; t += 3)
      if (
        Math.max(region[simplified[t]], region[simplified[t + 1]], region[simplified[t + 2]]) === r
      )
        n++;
    return n;
  });

  // Winding: the adopted patchwork mixes windings (its material is double-sided; the grafted face
  // centre winds opposite to its rim). Each connected low surface gets one winding, the one its
  // adopted vertex normals agree with, and normals that point against it are reversed.
  const lowPositions = new Float32Array(lowToCluster.length * 3),
    lowNormalsIn = new Float32Array(lowToCluster.length * 3);
  lowToCluster.forEach((c, i) => {
    lowPositions.set(wPositions.subarray(c * 3, c * 3 + 3), i * 3);
    lowNormalsIn.set(wNormals.subarray(c * 3, c * 3 + 3), i * 3);
  });
  const lowOriented = orientConsistently(lowPositions, lowIndices, lowNormalsIn);
  lowIndices.set(lowOriented.indices);
  const lowNormals = lowOriented.normals;
  passes.winding = {
    duplicateTrianglesDropped: { welded: deduplicated.dropped, low: lowDuplicates.dropped },
    components: lowOriented.components,
    reversedTriangles: lowOriented.flippedTriangles,
    reversedNormals: lowOriented.flippedNormals,
    inconsistentEdges: lowOriented.inconsistentEdges,
    nonManifoldEdges: lowOriented.nonManifoldEdges,
  };

  // Blender inputs: OBJ for the high (adopted UVs) and low (no UVs) heads, the 2048 albedo.
  // The bake source is the adopted head with every triangle grown by --dilate about its centroid
  // (UVs extrapolated with it): the patchwork's hairline gaps between charts would otherwise let
  // bake rays through to the dark inside of the head. Only the bake sees this copy.
  const dilate = Number(args.dilate);
  const highObj = ['# adopted head (bake source), triangles dilated for the bake'];
  const highUv = [];
  for (let t = 0; t < head.indices.length; t += 3) {
    const ids = [head.indices[t], head.indices[t + 1], head.indices[t + 2]];
    const P = ids.map((v) => [
      head.positions[v * 3],
      head.positions[v * 3 + 1],
      head.positions[v * 3 + 2],
    ]);
    const U = ids.map((v) => [head.uvs[v * 2], head.uvs[v * 2 + 1]]);
    const c = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3);
    const uc = [0, 1].map((k) => (U[0][k] + U[1][k] + U[2][k]) / 3);
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(P[i][0] - c[0], P[i][1] - c[1], P[i][2] - c[2]) || 1;
      const f = 1 + dilate / d;
      highObj.push(
        `v ${c[0] + (P[i][0] - c[0]) * f} ${c[1] + (P[i][1] - c[1]) * f} ${c[2] + (P[i][2] - c[2]) * f}`,
      );
      highUv.push(`vt ${uc[0] + (U[i][0] - uc[0]) * f} ${1 - (uc[1] + (U[i][1] - uc[1]) * f)}`);
    }
  }
  for (const line of highUv) highObj.push(line);
  for (let t = 0; t < head.indices.length; t += 3) {
    const [a, b, c] = [t + 1, t + 2, t + 3];
    highObj.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
  }
  const lowObj = ['# low head'];
  for (const c of lowToCluster)
    lowObj.push(`v ${wPositions[c * 3]} ${wPositions[c * 3 + 1]} ${wPositions[c * 3 + 2]}`);
  for (let i = 0; i < lowToCluster.length; i++)
    lowObj.push(`vn ${lowNormals[i * 3]} ${lowNormals[i * 3 + 1]} ${lowNormals[i * 3 + 2]}`);
  for (let t = 0; t < lowIndices.length; t += 3) {
    const [a, b, c] = [lowIndices[t] + 1, lowIndices[t + 1] + 1, lowIndices[t + 2] + 1];
    lowObj.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  await writeFile(path.join(out, 'high.obj'), highObj.join('\n') + '\n');
  await writeFile(path.join(out, 'low.obj'), lowObj.join('\n') + '\n');
  // Low triangles of the face region, in OBJ face order (bake-head.py unwraps them as one chart).
  const faceFaces = [];
  for (let t = 0; t < lowIndices.length; t += 3)
    if ([0, 1, 2].every((k) => face[lowToCluster[lowIndices[t + k]]])) faceFaces.push(t / 3);
  await writeFile(path.join(out, 'face-faces.json'), JSON.stringify(faceFaces));
  // Region of each low vertex (0 hair and the rest, 1 skin, 2 face): bake-head.py sizes its cage.
  await writeFile(
    path.join(out, 'low-regions.json'),
    JSON.stringify(lowToCluster.map((c) => region[c])),
  );
  // The bake source albedo with every chart's colours grown outward (--pad texels): the bake
  // samples across the adopted atlas's chart edges, where the dark background around each chart
  // would otherwise draw thin lines along the patchwork's seams.
  const sourceAlbedo = await sharp(headImage(source.json, source.bin, source.views, sourceHead))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const padded = padCharts(
    sourceAlbedo.data,
    sourceAlbedo.info.width,
    sourceAlbedo.info.height,
    head.uvs,
    head.indices,
    Number(args.pad),
  );
  await sharp(padded, {
    raw: { width: sourceAlbedo.info.width, height: sourceAlbedo.info.height, channels: 3 },
  })
    .png()
    .toFile(path.join(out, 'high-albedo.png'));
  const lowRepresentatives = lowToCluster.map((c) => representatives[c]);
  const meta = {
    schema: 'cro-magnon/lowpoly-head-geometry@1',
    master: path.relative(process.cwd(), args.master).replaceAll('\\', '/'),
    textureSource: path.relative(process.cwd(), args.texture).replaceAll('\\', '/'),
    headPrimitive: { mesh: head.mesh, index: head.index, material: head.material },
    adopted: { triangles: head.indices.length / 3, vertices: count, openEdgesByPosition: null },
    welded: {
      toleranceMetres: weld,
      vertices: welded,
      triangles: triangles.length / 3,
      openEdges: weldedOpen,
    },
    repaired: {
      crackToleranceMetres: Number(args.crack),
      triangles: wIndices.length / 3,
      openEdges: openEdges(wIndices),
      lockedVertices: wLock.reduce((s, v) => s + v, 0),
      bandMetres: band,
    },
    neckSeam: { vertices: ringCount, clusters: lockedTotal, kept: lockedKept },
    orientation: {
      reversedTriangles: oriented.flippedTriangles,
      reversedNormals: oriented.flippedVertices,
    },
    landmarks: { eye: Number(args.eye), chin: Number(args.chin) },
    options: Object.fromEntries(
      [
        'target',
        'weld',
        'error',
        'crack',
        'face-crack',
        'band',
        'dilate',
        'pad',
        'skin-error',
        'face-error',
        'min-island',
      ].map((name) => [name, Number(args[name])]),
    ),
    passes,
    low: {
      triangles: lowIndices.length / 3,
      vertices: lowToCluster.length,
      targetTriangles: target / 3,
      errorMetres: Number((error * scale).toFixed(6)),
      errorLimitRelative: Number(args.error),
    },
    // Low vertex i is adopted head vertex lowRepresentatives[i] (position, joints, weights).
    lowRepresentatives,
    lowNormals: Array.from(lowNormals),
  };
  await writeFile(path.join(out, 'geometry.json'), JSON.stringify(meta));
  const { lowRepresentatives: _r, lowNormals: _n, ...summary } = meta;
  (void _r, _n);
  console.log(JSON.stringify(summary, null, 2));
}
