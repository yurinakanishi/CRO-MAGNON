import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import { CAMP_CAVE, CAMP_MOUNTAIN, CAVE_MURAL_VIEW } from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from '../dist/shared/camp-cave-surface.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';

test('every exposed mountain triangle has matching ground, including former shoreline and steep flanks', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json'));
  const { scene } = await geometryScene(`public${asset.url}`);
  scene.updateMatrixWorld(true);
  let samples = 0,
    worst = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position,
      index = node.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const point = new THREE.Vector3();
      for (let j = 0; j < 3; j++)
        point.add(
          new THREE.Vector3()
            .fromBufferAttribute(p, index.getX(i + j))
            .applyMatrix4(node.matrixWorld),
        );
      point.multiplyScalar(1 / 3);
      if (point.y < 0.1) continue; // Buried skirts are not walking surfaces.
      const x = CAMP_MOUNTAIN.x - point.x,
        z = CAMP_MOUNTAIN.z - point.z;
      const error = Math.abs(mountainHeight(x, z) - point.y);
      worst = Math.max(worst, error);
      samples++;
      assert.ok(error < 0.12, `terrain mismatch ${x},${z}: ${error}`);
    }
  });
  assert.ok(samples > 150000);
  assert.ok(worst < 0.12);
});

test('the extended chamber has a continuous floor all the way to the far mural', async () => {
  const old = await geometryScene('public/models/camp-cave/model-r05.glb');
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const next = await geometryScene(`public${asset.url}`);
  const a = new THREE.Box3().setFromObject(old.scene),
    b = new THREE.Box3().setFromObject(next.scene);
  const ratio = (b.max.z - b.min.z) / (a.max.z - a.min.z);
  assert.ok(ratio > 1.95 && ratio < 2.05);
  assert.ok(CAVE_MURAL_VIEW.z - 107 > 22);
  let previous = walkHeight(35, 108);
  for (let z = 108.1; z <= CAVE_MURAL_VIEW.z; z += 0.1) {
    assert.ok(CAMP_CAVE_SURFACE.free(35, z, 0.8), `blocked interior ${z}`);
    const h = walkHeight(35, z);
    assert.ok(Math.abs(h - previous) < 0.025, `floor discontinuity ${z}`);
    assert.ok(Math.abs(h - CAMP_CAVE.elevation) < 0.15);
    previous = h;
  }
  assert.equal(CAMP_CAVE_SURFACE.free(35, 137, 0.32), false);
});
