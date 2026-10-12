// CPU cost of the camera's clearance queries (2026-10-12), in Node on this PC. Not a phone
// measurement: a phone CPU is several times slower. Reports the median of 7 rounds.
//   cave      the camp cave's exact triangles (74k): the former single ray (distance) and the
//             sphere sweep (sweep) from the same origins inside the cave, 5.5 m camera arm
//   mountain  the camp mountain's densest surface chunk: indexing it once, then sweeps
//   boxes     the boxed rocks and props along the same arm around the camp
// Usage: node scripts/benchmark-camera-sweep.mjs
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { MeshRayGrid } from '../dist/src/mesh-ray-grid.js';
import { surfaceChunks } from '../dist/src/surface-chunks.js';
import { mountainCaveClipped } from '../dist/src/mountain-materials.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { CAMP_CAVE, CAMP_MOUNTAIN, caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';
import { geometryScene } from './measure-collision-bounds.mjs';

let seed = 7;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const orbit = (yaw, pitch) =>
  new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
function time(label, count, run) {
  const rounds = [];
  for (let round = 0; round < 7; round++) {
    const started = performance.now();
    run();
    rounds.push(((performance.now() - started) * 1000) / count);
  }
  return { label, microseconds: +median(rounds).toFixed(2) };
}
const results = [];
// The cave, placed as the game places it.
{
  const { url } = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
  const { scene } = await geometryScene(`public${url}`);
  scene.position.set(CAMP_CAVE.x, CAMP_CAVE.elevation, CAMP_CAVE.z);
  scene.rotation.y = CAMP_CAVE.yaw;
  scene.scale.setScalar(CAMP_CAVE.scale);
  const grid = new MeshRayGrid(scene);
  const queries = Array.from({ length: 400 }, () => {
    const depth = 8 - random() * 70;
    return {
      origin: new THREE.Vector3(
        CAMP_CAVE.x - caveCentreOffset(depth) - (random() - 0.5) * 6,
        1.4,
        CAMP_CAVE.z - depth,
      ),
      direction: orbit(random() * Math.PI * 2, -0.3 + random() * 1.3),
    };
  });
  results.push(
    time('cave: former ray (distance)', queries.length, () => {
      for (const q of queries) grid.distance(q.origin, q.direction, 5.5);
    }),
    time('cave: sphere sweep r=0.265', queries.length, () => {
      for (const q of queries) grid.sweep(q.origin, q.direction, 5.5, 0.265);
    }),
  );
}
// The mountain's densest chunk near the camp.
{
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json', 'utf8'));
  const gltf = await geometryScene(`public${asset.url}`);
  const root = new THREE.Group();
  root.position.set(CAMP_MOUNTAIN.x, CAMP_MOUNTAIN.groundOffset ?? 0, CAMP_MOUNTAIN.z);
  root.rotation.y = CAMP_MOUNTAIN.yaw;
  root.add(gltf.scenes[0]);
  root.updateMatrixWorld(true);
  let source = null;
  gltf.scenes[0].traverse((node) => node.isMesh && (source = node));
  const chunk = surfaceChunks(source.geometry)
    .map((geometry) => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      source.parent.add(mesh);
      mesh.position.copy(source.position);
      mesh.quaternion.copy(source.quaternion);
      mesh.scale.copy(source.scale);
      return mesh;
    })
    .find((mesh) => {
      mesh.updateMatrixWorld(true);
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      return box.containsPoint(new THREE.Vector3(30, box.min.y + 0.01, 70));
    });
  root.updateMatrixWorld(true);
  let grid;
  const triangles = chunk.geometry.index.count / 3;
  results.push({
    ...time(`mountain: index one chunk (${triangles} triangles), per chunk`, 1, () => {
      grid = new MeshRayGrid(chunk, 2, (a, b, c) =>
        [a, b, c].some((p) => !mountainCaveClipped(p.x, p.y, p.z)),
      );
    }),
  });
  const ground = new THREE.Raycaster();
  const queries = Array.from({ length: 400 }, () => {
    const x = 10 + random() * 40,
      z = 55 + random() * 50;
    ground.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    const hit = ground.intersectObject(chunk)[0];
    return (
      hit && {
        origin: hit.point.clone().add(new THREE.Vector3(0, 1.4, 0)),
        direction: orbit(random() * Math.PI * 2, -0.3 + random() * 1.3),
      }
    );
  }).filter(Boolean);
  results.push(
    time('mountain: sphere sweep in one chunk, r=0.265', queries.length, () => {
      for (const q of queries) grid.sweep(q.origin, q.direction, 5.5, 0.265);
    }),
  );
}
// Boxes around the camp.
{
  const world = new CollisionWorld();
  const queries = Array.from({ length: 2000 }, () => ({
    origin: new THREE.Vector3(20 + random() * 60, 1.4, 20 + random() * 60),
    direction: orbit(random() * Math.PI * 2, -0.3 + random() * 1.3),
  }));
  results.push(
    time('boxes: sphere sweep r=0.265', queries.length, () => {
      for (const q of queries) world.cameraDistance(q.origin, q.direction, 5.5, 0.265);
    }),
  );
}
console.log(JSON.stringify({ node: process.version, results }, null, 1));
