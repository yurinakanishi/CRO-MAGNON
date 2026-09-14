// Compare actual triangle winding, not just vertex positions. A disconnected
// imported surface must not have its faces reoriented independently in Blender.
import { loadMotion } from './motion-glb.mjs';
import * as T from 'three';
import { pathToFileURL } from 'node:url';

export async function checkMammothSurface(file) {
  const [source, candidate] = await Promise.all([
    loadMotion('public/models/woolly-mammoth/model-motion-r04.glb'),
    loadMotion(file),
  ]);
  const meshes = (g) => {
    const list = [];
    g.scene.traverse((n) => {
      if (n.isSkinnedMesh) list.push(n);
    });
    return list;
  };
  const originals = meshes(source),
    changed = meshes(candidate);
  const cells = new Map(),
    points = [],
    tolerance = 0.00001;
  const cell = (p) => p.map((v) => Math.floor(v / tolerance));
  function match(p, create = false) {
    const c = cell(p);
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          for (const id of cells.get([c[0] + x, c[1] + y, c[2] + z].join(',')) ?? []) {
            if (Math.hypot(...p.map((v, i) => v - points[id][i])) < tolerance) return id;
          }
        }
    if (!create) return -1;
    const id = points.length;
    points.push(p);
    if (!cells.has(c.join(','))) cells.set(c.join(','), []);
    cells.get(c.join(',')).push(id);
    return id;
  }
  const triangles = (list, create) => {
    const result = [];
    for (const mesh of list) {
      const a = mesh.geometry.attributes,
        index = mesh.geometry.index;
      const ids = Array.from({ length: a.position.count }, (_, i) =>
        match([a.position.getX(i), a.position.getY(i), a.position.getZ(i)], create),
      );
      for (let i = 0; i < index.count; i += 3) {
        const vertex = [0, 1, 2].map((k) => index.getX(i + k));
        const p = vertex.map((j) => new T.Vector3().fromBufferAttribute(a.position, j));
        if (!p.every((v) => v.z > -1.6 || v.y < 0.45)) continue;
        const canonical = vertex.map((j) => ids[j]);
        const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
        if (normal.length() < 1e-12) continue;
        const normals = vertex.map((j) => new T.Vector3().fromBufferAttribute(a.normal, j));
        result.push({
          key: canonical.toSorted((a, b) => a - b).join(','),
          canonical,
          normal: normal.normalize(),
          normals,
        });
      }
    }
    return result;
  };
  const old = triangles(originals, true),
    next = triangles(changed, false);
  const lookup = new Map();
  for (const tri of next) {
    if (!lookup.has(tri.key)) lookup.set(tri.key, []);
    lookup.get(tri.key).push(tri);
  }
  let missing = 0,
    reversed = 0,
    alteredCornerNormals = 0,
    maximumNormalError = 0;
  const normalErrors = [];
  for (const tri of old) {
    const found = lookup.get(tri.key)?.pop();
    if (!found) {
      missing++;
      continue;
    }
    if (tri.normal.dot(found.normal) < 0.99) reversed++;
    for (let k = 0; k < 3; k++) {
      const j = found.canonical.indexOf(tri.canonical[k]);
      const error = tri.normals[k].distanceTo(found.normals[j]);
      maximumNormalError = Math.max(maximumNormalError, error);
      if (error > 0.001) {
        alteredCornerNormals++;
        if (normalErrors.length < 5)
          normalErrors.push({
            point: points[tri.canonical[k]],
            expected: tri.normals[k].toArray(),
            actual: found.normals[j].toArray(),
            error,
          });
      }
    }
  }
  const extra = [...lookup.values()].reduce((s, a) => s + a.length, 0);
  return {
    sourceTriangles: old.length,
    candidateTriangles: next.length,
    missing,
    extra,
    reversed,
    alteredCornerNormals,
    maximumNormalError,
    normalErrors,
    opaqueSingleSided: candidate.doc.materials.every(
      (m) => (m.alphaMode ?? 'OPAQUE') === 'OPAQUE' && !m.doubleSided,
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkMammothSurface(process.argv[2]), null, 2));
