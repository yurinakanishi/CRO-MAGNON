// Inspect unchanged GLB triangles against every independent mural placement.
import * as THREE from 'three';
import { writeFile } from 'node:fs/promises';
import { loadMotion } from './motion-glb.mjs';
import { CAVE_MOTIFS, CAVE_MURALS, caveMuralHeight } from '../dist/src/cave-gallery-layout.js';
const { scene } = await loadMotion('public/models/camp-cave/model-r07.glb');
scene.traverse((n) => {
  if (n.isMesh) for (const m of [n.material].flat()) m.side = THREE.DoubleSide;
});
const ray = new THREE.Raycaster();
const records = [];
for (const mural of CAVE_MURALS) {
  const height = caveMuralHeight(mural),
    samples = [];
  for (let v = 0; v <= 12; v++)
    for (let u = 0; u <= 16; u++) {
      const along = mural.centre + (u / 16 - 0.5) * mural.width;
      const y = mural.bottom + (v / 12) * height;
      ray.set(
        mural.wall === 'back' ? new THREE.Vector3(along, y, -6) : new THREE.Vector3(0, y, along),
        mural.wall === 'east'
          ? new THREE.Vector3(-1, 0, 0)
          : mural.wall === 'west'
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 0, -1),
      );
      const hit = ray.intersectObject(scene, true)[0];
      const normal = hit?.face.normal;
      samples.push({
        u: mural.wall === 'east' ? 1 - u / 16 : u / 16,
        v: v / 12,
        point: hit?.point.toArray(),
        facing: normal
          ? mural.wall === 'east'
            ? normal.x
            : mural.wall === 'west'
              ? -normal.x
              : normal.z
          : 0,
      });
    }
  records.push({ ...mural, height, rectangle: CAVE_MOTIFS[mural.motif], samples });
}
await writeFile('assets/camp-cave/qa/gallery-surfaces-r05.json', JSON.stringify(records, null, 2));
console.log(
  JSON.stringify(
    records.map((r) => ({
      motif: r.motif,
      wall: r.wall,
      missing: r.samples.filter((s) => !s.point).length,
      sideFacing: r.samples.filter((s) => s.facing > 0.45).length,
      total: r.samples.length,
    })),
  ),
);
