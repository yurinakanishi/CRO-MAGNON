import { readFile } from 'node:fs/promises';
import { unpack } from './motion-glb.mjs';
export const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
export const positionKey = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
export function attribute(doc, binary, id) {
  const a = doc.accessors[id],
    v = doc.bufferViews[a.bufferView],
    w = widths[a.type];
  const spec = {
    5121: [1, 'readUInt8'],
    5123: [2, 'readUInt16LE'],
    5125: [4, 'readUInt32LE'],
    5126: [4, 'readFloatLE'],
  }[a.componentType];
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: w }, (_, k) =>
      binary[spec[1]](
        (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || w * spec[0]) + k * spec[0],
      ),
    ),
  );
}
export async function readSurface(file) {
  const bytes = await readFile(file),
    { doc, binary } = unpack(bytes);
  const prim = doc.meshes[0].primitives[0],
    attrs = Object.fromEntries(
      Object.entries(prim.attributes).map(([k, id]) => [k, attribute(doc, binary, id)]),
    );
  const vertices = attrs.POSITION.map((p, i) => ({
    p,
    n: attrs.NORMAL[i],
    uv: attrs.TEXCOORD_0?.[i] || [0, 0],
    j: attrs.JOINTS_0?.[i],
    w: attrs.WEIGHTS_0?.[i],
    original: i,
  }));
  const ids = attribute(doc, binary, prim.indices).flat(),
    triangles = [];
  for (let i = 0; i < ids.length; i += 3)
    triangles.push({ ids: ids.slice(i, i + 3), original: i / 3 });
  return { bytes, doc, binary, vertices, triangles };
}
export function mixVertex(a, b, t) {
  const lerp = (x, y) => x.map((v, k) => v * (1 - t) + y[k] * t),
    n = lerp(a.n, b.n),
    l = Math.hypot(...n);
  const v = { p: lerp(a.p, b.p), n: n.map((x) => x / l), uv: lerp(a.uv, b.uv) };
  if (a.j) {
    const weights = new Map();
    for (const [s, f] of [
      [a, 1 - t],
      [b, t],
    ])
      s.j.forEach((j, k) => weights.set(j, (weights.get(j) || 0) + s.w[k] * f));
    const ordered = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4),
      sum = ordered.reduce((s, a) => s + a[1], 0);
    v.j = Array.from({ length: 4 }, (_, i) => ordered[i]?.[0] || 0);
    v.w = Array.from({ length: 4 }, (_, i) => (ordered[i]?.[1] || 0) / sum);
  }
  return v;
}
export function splitAtPlane(surface, y, axis = 1) {
  const vertices = [...surface.vertices],
    low = [],
    high = [],
    edge = new Map();
  const point = (i, j) => {
    const key = [Math.min(i, j), Math.max(i, j)].join(':');
    if (edge.has(key)) return edge.get(key);
    const a = vertices[i],
      b = vertices[j],
      t = (y - a.p[axis]) / (b.p[axis] - a.p[axis]);
    if (t < 1e-7) return i;
    if (t > 1 - 1e-7) return j;
    const v = mixVertex(a, b, t);
    v.p[axis] = y;
    const id = vertices.length;
    vertices.push(v);
    edge.set(key, id);
    return id;
  };
  for (const tri of surface.triangles) {
    const flags = tri.ids.map((i) => vertices[i].p[axis] >= y);
    if (flags.every(Boolean)) {
      high.push(tri);
      continue;
    }
    if (flags.every((x) => !x)) {
      low.push(tri);
      continue;
    }
    for (const above of [false, true]) {
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const i = tri.ids[k],
          j = tri.ids[(k + 1) % 3];
        if (flags[k] === above) poly.push(i);
        if (flags[k] !== flags[(k + 1) % 3]) poly.push(point(i, j));
      }
      for (let k = 1; k < poly.length - 1; k++)
        (above ? high : low).push({
          ids: [poly[0], poly[k], poly[k + 1]],
          original: tri.original,
          cut: true,
        });
    }
  }
  return { vertices, low, high };
}
export function components(vertices, triangles) {
  const parent = triangles.map((_, i) => i),
    find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
  const seen = new Map();
  triangles.forEach((t, i) => {
    for (const id of t.ids) {
      const k = positionKey(vertices[id].p);
      if (seen.has(k)) parent[find(i)] = find(seen.get(k));
      else seen.set(k, i);
    }
  });
  const groups = new Map();
  triangles.forEach((t, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  });
  return [...groups.values()]
    .map((tris) => {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (const t of tris)
        for (const i of t.ids)
          vertices[i].p.forEach((p, k) => {
            min[k] = Math.min(min[k], p);
            max[k] = Math.max(max[k], p);
          });
      return { triangles: tris, min, max };
    })
    .sort((a, b) => b.triangles.length - a.triangles.length);
}
export function boundary(vertices, triangles) {
  const edges = new Map();
  for (const t of triangles)
    for (let k = 0; k < 3; k++) {
      const i = t.ids[k],
        j = t.ids[(k + 1) % 3],
        a = positionKey(vertices[i].p),
        b = positionKey(vertices[j].p);
      if (a === b) continue;
      const key = [a, b].sort().join('|');
      if (edges.has(key)) edges.get(key).count++;
      else edges.set(key, { i, j, count: 1 });
    }
  return [...edges.values()].filter((e) => e.count === 1);
}
export function keepBody(source, y) {
  const cut = splitAtPlane(source, y),
    upper = components(cut.vertices, cut.high);
  const retained = upper.filter((c) => c.max[1] < y + 0.055),
    removed = upper.filter((c) => !retained.includes(c));
  let tris = [...cut.low, ...retained.flatMap((c) => c.triangles)];
  const lower = components(cut.vertices, tris),
    discarded = lower.filter((c) => c.min[1] > y - 0.3 && c.max[1] >= y - 1e-6 && c.max[2] < -0.17);
  tris = lower.filter((c) => !discarded.includes(c)).flatMap((c) => c.triangles);
  const edges = boundary(cut.vertices, tris).filter(
    (e) =>
      Math.abs(cut.vertices[e.i].p[1] - y) < 1e-6 && Math.abs(cut.vertices[e.j].p[1] - y) < 1e-6,
  );
  const unique = new Map();
  for (const e of edges) for (const i of [e.i, e.j]) unique.set(positionKey(cut.vertices[i].p), i);
  return {
    vertices: cut.vertices,
    triangles: tris,
    ring: [...unique.values()],
    report: {
      cutY: y,
      upperComponents: upper.map((c) => ({
        triangles: c.triangles.length,
        min: c.min,
        max: c.max,
        retained: retained.includes(c),
      })),
      discardedLower: discarded.map((c) => ({
        triangles: c.triangles.length,
        min: c.min,
        max: c.max,
      })),
      retainedTriangles: tris.length,
      removedHeadTriangles: removed.reduce((s, c) => s + c.triangles.length, 0),
      boundaryEdges: edges.length,
      boundaryVertices: unique.size,
    },
  };
}
