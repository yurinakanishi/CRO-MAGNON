// Read-only comparison of the actual entrance-to-blind-end aisle in exported GLBs.
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { geometryScene } from './measure-collision-bounds.mjs';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';

export function measureCaveAisle(scene, centreX = () => 0) {
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (node.isMesh)
      for (const material of [node.material].flat()) material.side = THREE.DoubleSide;
  });
  const bounds = new THREE.Box3().setFromObject(scene),
    ray = new THREE.Raycaster(),
    normalMatrix = new THREE.Matrix3(),
    normal = new THREE.Vector3();
  // The rock rim extends slightly beyond the flat entrance apron.
  const startZ = Math.floor(bounds.max.z),
    samples = [];
  let distance = 0;
  for (let z = startZ; z > bounds.min.z; z -= 0.2) {
    let floor;
    const clear = [-0.5, 0, 0.5].every((offset) => {
      ray.set(
        new THREE.Vector3(centreX(z) + offset, bounds.max.y + 1, z),
        new THREE.Vector3(0, -1, 0),
      );
      const hits = ray.intersectObject(scene, true).map((hit) => ({
        y: hit.point.y,
        facing: normal
          .copy(hit.face.normal)
          .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize().y,
      }));
      const ground = hits.find((h) => h.facing >= 0.35 && h.y >= -0.1 && h.y < 2.6);
      if (!ground) return false;
      const roof = hits.findLast((h) => h.facing <= -0.15 && h.y > ground.y + 0.1);
      if (roof && roof.y - ground.y < 2.6) return false;
      if (offset === 0) floor = ground.y;
      return true;
    });
    if (!clear) {
      if (samples.length) break;
      if (startZ - z > 2) throw new Error('No walkable entrance apron');
      continue;
    }
    const previous = samples.at(-1),
      point = { x: centreX(z), y: floor, z };
    if (previous)
      distance += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    samples.push({ ...point, distance });
  }
  return { entrance: samples[0], end: samples.at(-1), lengthMetres: distance, samples };
}

if (process.argv[1]?.endsWith('measure-cave-length.mjs')) {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json')),
    files = ['public/models/camp-cave/model-r07.glb', process.argv[2] ?? `public${asset.url}`],
    measurements = [];
  for (const [index, file] of files.entries()) {
    const { scene } = await geometryScene(file);
    measurements.push({
      file,
      sha256: createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      ...measureCaveAisle(scene, index ? caveCentreOffset : undefined),
    });
  }
  const report = {
    method:
      'Exact GLB rays every 0.2 m along the aisle and 0.5 m to either side; floor below 2.6 m and at least 2.6 m overhead clearance. Length follows the curved centreline, including floor height.',
    measurements,
    ratio: measurements[1].lengthMetres / measurements[0].lengthMetres,
  };
  await writeFile(
    process.argv[3] ?? `assets/camp-cave/qa/length-r${asset.revision}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ ...report, measurements: measurements.map(({ samples, ...rest }) => rest) }),
  );
}
