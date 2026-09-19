import * as THREE from 'three';
import { writeFile } from 'node:fs/promises';
import { loadMotion } from './motion-glb.mjs';

const { scene } = await loadMotion('public/models/camp-cave/model-r07.glb');
scene.traverse((node) => {
  if (node.isMesh) for (const material of [node.material].flat()) material.side = THREE.DoubleSide;
});
const ray = new THREE.Raycaster();
const rows = [];
for (let z = -8; z <= 8; z += 1) {
  const row = { z };
  for (const side of [-1, 1]) {
    row[side < 0 ? 'east' : 'west'] = [];
    for (const y of [1.6, 2.6, 3.6, 4.6]) {
      ray.set(new THREE.Vector3(0, y, z), new THREE.Vector3(side, 0, 0));
      const hit = ray.intersectObject(scene, true)[0];
      row[side < 0 ? 'east' : 'west'].push(
        hit
          ? {
              y,
              x: Number(hit.point.x.toFixed(2)),
              normal: hit.face.normal.toArray().map((n) => Number(n.toFixed(2))),
            }
          : null,
      );
    }
  }
  rows.push(row);
}
await writeFile('assets/camp-cave/qa/side-wall-survey.json', JSON.stringify(rows, null, 2));
// Dense front-to-wall rays verify the selected single side patch. The original
// cat folded because the old Z projection crossed the rear/side corner.
const patch = [];
let missing = 0,
  clipped = 0,
  maximumAdjacentDepthChange = 0;
for (let iz = 0; iz <= 90; iz++) {
  const z = -4.4 + iz * 0.1,
    column = [];
  for (let iy = 0; iy <= 30; iy++) {
    const y = 1.65 + iy * 0.1;
    ray.set(new THREE.Vector3(0, y, z), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(scene, true)[0];
    if (!hit) missing++;
    else if (hit.point.x > -3.25 || hit.point.x < -6.4 || hit.face.normal.x < 0.45) clipped++;
    column.push(hit ? hit.point.x : null);
    if (hit && iy && column[iy - 1] !== null)
      maximumAdjacentDepthChange = Math.max(
        maximumAdjacentDepthChange,
        Math.abs(hit.point.x - column[iy - 1]),
      );
    if (hit && iz && patch[iz - 1][iy] !== null)
      maximumAdjacentDepthChange = Math.max(
        maximumAdjacentDepthChange,
        Math.abs(hit.point.x - patch[iz - 1][iy]),
      );
  }
  patch.push(column);
}
const coverage = {
  samples: 91 * 31,
  missing,
  clipped,
  maximumAdjacentDepthChange,
  step: 0.1,
  localZ: [-4.4, 4.6],
  localY: [1.65, 4.65],
  direction: '-X',
  patch,
};
await writeFile('assets/camp-cave/qa/side-wall-coverage.json', JSON.stringify(coverage, null, 2));
console.log(JSON.stringify({ ...coverage, patch: undefined }));
console.log(
  rows
    .map(
      (r) =>
        `${r.z}: east ${r.east.map((h) => h?.x ?? 'hole').join(',')} / west ${r.west.map((h) => h?.x ?? 'hole').join(',')}`,
    )
    .join('\n'),
);
