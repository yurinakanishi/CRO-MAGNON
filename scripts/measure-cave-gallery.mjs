// Inspect delivered GLB triangles against every independent mural placement.
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { loadMotion } from './motion-glb.mjs';
import { CAVE_MOTIFS, CAVE_MURALS, caveMuralHeight } from '../dist/src/cave-gallery-layout.js';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const source = process.argv[2] ?? `public${asset.url}`,
  output = process.argv[3] ?? `assets/camp-cave/qa/gallery-surfaces-r${asset.revision}.json`;
const { scene } = await loadMotion(source);
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
      const centreX = caveCentreOffset(along);
      ray.set(
        new THREE.Vector3(centreX, y, along),
        mural.wall === 'east' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0),
      );
      const hit = ray.intersectObject(scene, true)[0];
      const normal = hit?.face.normal;
      samples.push({
        u: mural.wall === 'east' ? 1 - u / 16 : u / 16,
        v: v / 12,
        point: hit?.point.toArray(),
        facing: normal ? (mural.wall === 'east' ? normal.x : -normal.x) : 0,
      });
    }
  records.push({
    ...mural,
    pigment: mural.motif === 'creature524' ? 'character524' : 'atlas',
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
