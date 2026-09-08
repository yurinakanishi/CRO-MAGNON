import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BoatRenderer } from '../dist/src/boat-renderer.js';

test('a large position correction keeps the local hull and seat available for camera following', () => {
  const world = {
    scene: new THREE.Scene(),
    selfId: 'self',
    focus: new THREE.Vector3(),
    canvas: { dataset: {} },
    worldAssets: { create: () => new THREE.Group() },
    state: {
      boats: [
        { id: 'ours', riderId: 'self', x: 600, z: 500, facing: 0 },
        { id: 'distant', riderId: 'other', x: 620, z: 500, facing: 0 },
      ],
    },
  };
  const renderer = new BoatRenderer(world);
  renderer.update(1, 0.1);
  assert.equal(renderer.boats.get('ours').model.visible, true);
  assert.equal(renderer.boats.get('distant').model.visible, false);
  const seat = renderer.seat('ours', new THREE.Vector3());
  assert.equal(seat.x, 600);
  assert.ok(seat.z > 498);
  world.focus.copy(seat);
  renderer.update(2, 0.1);
  assert.equal(renderer.boats.get('distant').model.visible, true);
  renderer.dispose();
  assert.equal(world.scene.children.length, 0);
});
