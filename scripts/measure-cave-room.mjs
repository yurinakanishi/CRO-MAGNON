// Measure usable width and headroom directly from the delivered rock triangles.
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { geometryScene } from './measure-collision-bounds.mjs';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';

export function measureCaveRoom(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (node.isMesh)
      for (const material of [node.material].flat()) material.side = THREE.DoubleSide;
  });
  const ray = new THREE.Raycaster(),
    records = [];
  const hit = (x, z, direction) => {
    ray.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(...direction));
    return ray.intersectObject(scene, true)[0]?.point;
  };
  for (let z = -13; z >= -31.5; z -= 0.5) {
    const x = caveCentreOffset(z),
      left = hit(x, z, [-1, 0, 0]),
      right = hit(x, z, [1, 0, 0]);
    const heights = [-2.5, 0, 2.5].map((offset) => {
      const floor = hit(x + offset, z, [0, -1, 0]),
        roof = hit(x + offset, z, [0, 1, 0]);
      return {
        across: offset,
        floor: floor?.y,
        roof: roof?.y,
        headroom: roof && floor ? roof.y - floor.y : 0,
      };
    });
    records.push({ z, width: left && right ? right.x - left.x : 0, heights });
  }
  return {
    minWidth: Math.min(...records.map((r) => r.width)),
    minHeadroom: Math.min(...records.flatMap((r) => r.heights.map((h) => h.headroom))),
    records,
  };
}

if (process.argv[1]?.endsWith('measure-cave-room.mjs')) {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const file = process.argv[2] ?? `public${asset.url}`,
    { scene } = await geometryScene(file);
  const report = {
    file,
    sha256: createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    ...measureCaveRoom(scene),
  };
  await writeFile(
    process.argv[3] ?? `assets/camp-cave/qa/room-r${asset.revision}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify({ ...report, records: undefined }));
}
