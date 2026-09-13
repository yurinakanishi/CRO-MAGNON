// Measure the exact TRELLIS-derived mesh; this tool creates no visible geometry.
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';
const file = process.argv[2],
  output = process.argv[3];
if (!file || !output) throw new Error('Usage: measure-castle-surface.mjs source.glb output.json');
const gltf = await geometryScene(file);
gltf.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(gltf.scene, true),
  step = 0.35;
const minX = Math.floor(box.min.x / step) * step - step * 2,
  minZ = Math.floor(box.min.z / step) * step - step * 2;
const nx = Math.ceil((box.max.x - minX) / step) + 3,
  nz = Math.ceil((box.max.z - minZ) / step) + 3;
const columns = Array.from({ length: nx * nz }, () => []);
let triangles = 0;
// 2026-09-13: downward-facing surfaces (the underside of the gate arch) are
// kept apart so the walk atlas can tell an overhang from a solid wall.
const ceilings = Array.from({ length: nx * nz }, () => []);
gltf.scene.traverse((node) => {
  if (!node.isMesh) return;
  const g = node.geometry,
    index = g.index,
    count = index?.count ?? g.attributes.position.count;
  for (let i = 0; i < count; i += 3) {
    const p = [0, 1, 2].map((j) =>
      new THREE.Vector3()
        .fromBufferAttribute(g.attributes.position, index ? index.getX(i + j) : i + j)
        .applyMatrix4(node.matrixWorld),
    );
    triangles++;
    const normal = new THREE.Vector3()
      .subVectors(p[1], p[0])
      .cross(new THREE.Vector3().subVectors(p[2], p[0]))
      .normalize();
    const facing = normal.y >= 0.35 ? columns : normal.y <= -0.15 ? ceilings : null;
    if (!facing) continue;
    const [a, b, c] = p,
      den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(den) < 1e-10) continue;
    const x0 = Math.max(0, Math.floor((Math.min(...p.map((v) => v.x)) - minX) / step)),
      x1 = Math.min(nx - 1, Math.ceil((Math.max(...p.map((v) => v.x)) - minX) / step));
    const z0 = Math.max(0, Math.floor((Math.min(...p.map((v) => v.z)) - minZ) / step)),
      z1 = Math.min(nz - 1, Math.ceil((Math.max(...p.map((v) => v.z)) - minZ) / step));
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const x = minX + (ix + 0.5) * step,
          z = minZ + (iz + 0.5) * step;
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
          v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
        if (u < -0.00001 || v < -0.00001 || u + v > 1.00001) continue;
        facing[iz * nx + ix].push(
          Math.round((u * a.y + v * b.y + (1 - u - v) * c.y) * 1000) / 1000,
        );
      }
  }
});
for (const set of [columns, ceilings])
  for (let i = 0; i < set.length; i++)
    set[i] = set[i].sort((a, b) => a - b).filter((h, j, a) => j === 0 || h - a[j - 1] > 0.08);
const report = {
  sha256: createHash('sha256')
    .update(await readFile(file))
    .digest('hex'),
  file,
  step,
  minX,
  minZ,
  nx,
  nz,
  bounds: { min: box.min.toArray(), max: box.max.toArray() },
  triangles,
  columns,
  ceilings,
};
await writeFile(output, JSON.stringify(report));
console.log(
  JSON.stringify({
    ...report,
    columns: undefined,
    ceilings: undefined,
    occupied: columns.filter((c) => c.length).length,
    overhung: ceilings.filter((c) => c.length).length,
  }),
);
