// Inspect delivered GLB triangles against every independent mural placement.
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { loadMotion } from './motion-glb.mjs';
import {
  CAVE_MOTIFS,
  CAVE_MURALS,
  caveMuralHeight,
  caveMuralPigment,
} from '../dist/src/cave-gallery-layout.js';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const source = process.argv[2] ?? `public${asset.url}`,
  output =
    process.argv[3] ??
    `assets/camp-cave/qa/gallery-surfaces-r${asset.galleryRevision ?? asset.revision}.json`;
const { scene } = await loadMotion(source);
scene.traverse((n) => {
  if (n.isMesh) for (const m of [n.material].flat()) m.side = THREE.DoubleSide;
});
const ray = new THREE.Raycaster();
const records = [];
for (const mural of CAVE_MURALS) {
  const height = caveMuralHeight(mural),
    samples = [];
  const columns = mural.motif === 'rimoFrieze' ? 96 : 16;
  const rows = mural.motif === 'rimoFrieze' ? 32 : 12;
  for (let v = 0; v <= rows; v++)
    for (let u = 0; u <= columns; u++) {
      const along = mural.centre + (u / columns - 0.5) * mural.width;
      const y = mural.bottom + (v / rows) * height;
      const centreX = caveCentreOffset(along);
      ray.set(
        new THREE.Vector3(centreX, y, along),
        mural.wall === 'east' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0),
      );
      const hit = ray.intersectObject(scene, true)[0];
      const normal = hit?.face.normal;
      samples.push({
        u: mural.wall === 'east' ? 1 - u / columns : u / columns,
        v: v / rows,
        point: hit?.point.toArray(),
        facing: normal ? (mural.wall === 'east' ? normal.x : -normal.x) : 0,
      });
    }
  records.push({
    ...mural,
    pigment: caveMuralPigment(mural),
    height,
    rectangle: CAVE_MOTIFS[mural.motif],
    samples,
  });
}
await writeFile(output, JSON.stringify(records, null, 2));
console.log(
  JSON.stringify({
    source,
    output,
    murals: records.map((r) => ({
      motif: r.motif,
      wall: r.wall,
      missing: r.samples.filter((s) => !s.point).length,
      sideFacing: r.samples.filter((s) => s.facing > 0.38).length,
      total: r.samples.length,
    })),
  }),
);
