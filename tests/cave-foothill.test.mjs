import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import { CAMP_CAVE } from '../dist/shared/camp-cave-layout.mjs';
import {
  riverX,
  riverHalfWidth,
  riverBankDrop,
  riverDiversion,
} from '../dist/shared/river-profile.mjs';
import { fitSourceRiverBank } from '../dist/src/source-surface-fit.js';

test('the cave joins the main massif without an isolated crown or intervening saddle', () => {
  for (const z of [90, 100, 110, 120]) {
    const cave = mountainHeight(CAMP_CAVE.x, z);
    for (let x = CAMP_CAVE.x; x >= 0; x--)
      assert.ok(mountainHeight(x, z) >= cave - 0.15, `saddle at ${x},${z}`);
    assert.ok(mountainHeight(0, z) > cave + 3, 'the main mountain remains the higher landform');
  }
  // The steep recess at the mouth is hidden inside the rock shell. Check the
  // exposed slope behind that shell, rather than requiring an open front ramp.
  let previous = mountainHeight(CAMP_CAVE.x, 86);
  for (let z = 86.25; z <= 122; z += 0.25) {
    const next = mountainHeight(CAMP_CAVE.x, z);
    assert.ok(Math.abs(next - previous) / 0.25 < 0.8, `abrupt front/crown at ${z}`);
    previous = next;
  }
});

test('the diverted river gives the entrance room while keeping the camp bridge fixed', () => {
  const mouthZ = CAMP_CAVE.z - 9.4;
  assert.ok(riverX(mouthZ) - riverHalfWidth(mouthZ) - (CAMP_CAVE.x + 9) > 12);
  for (const z of [-64, 0, 43.5, 50, 58, 184]) assert.equal(riverDiversion(z), 0);
  for (const z of [85, 95, 110, 125]) {
    const oldChannel = 65 + Math.sin(z * 0.065) * 3.5;
    assert.equal(riverBankDrop(oldChannel, z), 0, 'the former channel is filled');
  }
});

test('real source triangles east of the former river bounds are carved under the new water', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([74, 0, 80, 114, 0, 80, 114, 0, 125, 74, 0, 125], 3),
  );
  source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  source.setIndex([0, 2, 1, 0, 3, 2]);
  const fitted = fitSourceRiverBank(source),
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(fitted, material),
    ray = new THREE.Raycaster();
  for (const z of [88, 95, 105, 115, 123])
    for (const offset of [-2, 0, 2]) {
      const x = riverX(z) + offset;
      ray.set(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit, `new riverbed missing ${x},${z}`);
      assert.ok(
        Math.abs(hit.point.y + riverBankDrop(x, z)) < 0.045,
        `ground protrudes into the new river at ${x},${z}`,
      );
    }
  source.dispose();
  fitted.dispose();
  material.dispose();
});

// A hillside rising over the roofless apron used to require a fake arch cut,
// leaving several metres of open air between its cut edge and the actual cave.
test('the approach stays below the apron until it reaches the real rock mouth', () => {
  for (let z = CAMP_CAVE.z - 18; z <= CAMP_CAVE.z - 9.4; z += 0.1)
    for (let across = -4.1; across <= 4.1; across += 0.25)
      assert.ok(
        Math.abs(mountainHeight(CAMP_CAVE.x + across, z)) < 0.001,
        `floating entrance slope at ${across},${z}`,
      );
  assert.ok(mountainHeight(CAMP_CAVE.x, 86) > 8, 'the hillside still buries the cave roof');
});
