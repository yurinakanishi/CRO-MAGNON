import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { prepareMountainRiverBed } from '../dist/src/mountain-river.js';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  caveCentreOffset,
  caveWorldAt,
} from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE_DATA as cave } from '../dist/shared/camp-cave-surface-data.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import { riverX } from '../dist/shared/river-profile.mjs';

test('the main cave roof has continuous earth cover and a tall crown', () => {
  let covered = 0;
  for (let iz = 0; iz < cave.nz; iz++)
    for (let ix = 0; ix < cave.nx; ix++) {
      const x = cave.minX + (ix + 0.5) * cave.step;
      const z = cave.minZ + (iz + 0.5) * cave.step;
      const roof = cave.roofs[iz * cave.nx + ix] + CAMP_CAVE.groundOffset;
      if (z > 6 || z < -34 || Math.abs(x - caveCentreOffset(z)) > 7 || roof < 2) continue;
      assert.ok(
        mountainHeight(CAMP_CAVE.x - x, CAMP_CAVE.z - z) > roof + 2,
        `exposed cave roof ${x},${z}`,
      );
      covered++;
    }
  assert.ok(covered > 4500);
  const crown = caveWorldAt(-8);
  assert.ok(mountainHeight(crown.x, crown.z) >= 17.9);
});

test('both delivered mountain meshes cover the cave and leave the river open', async (t) => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json'));
  for (const { url } of [asset, ...asset.lods]) {
    const { scene } = await geometryScene(`public${url}`);
    prepareMountainRiverBed(scene);
    scene.position.set(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
    scene.rotation.y = CAMP_MOUNTAIN.yaw;
    scene.traverse((node) => {
      if (node.isMesh)
        for (const material of [node.material].flat()) material.side = THREE.DoubleSide;
    });
    scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    let worst = 0;
    for (const z of [80, 83, 84.6, 84.9, 85.2, 85.5, 85.8, 86, 90, 98, 110, 122, 130])
      for (const dx of [-6, 0, 6]) {
        const p = caveWorldAt(CAMP_CAVE.z - z, dx);
        ray.set(new THREE.Vector3(p.x, 60, p.z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(scene, true)[0];
        assert.ok(hit, `missing visible hillside ${url}: ${p.x},${p.z}`);
        const error = Math.abs(hit.point.y - mountainHeight(p.x, p.z));
        worst = Math.max(worst, error);
        assert.ok(error < 0.25, `visible hill/physics mismatch ${url} at ${p.x},${p.z}: ${error}`);
      }
    for (const z of [80, 90, 100, 110, 120, 130, 140]) {
      ray.set(new THREE.Vector3(riverX(z), 60, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(scene, true)[0];
      assert.ok(!hit || hit.point.y < -0.5, `hill blocks river at ${z}`);
    }
    t.diagnostic(`${url}: maximum visible terrain error ${worst.toFixed(3)} m`);
    scene.traverse((node) => {
      if (node.isMesh) {
        node.geometry.dispose();
        for (const material of [node.material].flat()) material.dispose();
      }
    });
  }
});
