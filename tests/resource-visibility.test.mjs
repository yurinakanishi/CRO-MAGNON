import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldRenderer } from '../dist/src/world3d.js';

function fixture(type) {
  const model = new THREE.Group();
  model.position.set(10, 0, 20);
  const item = {
    key: type === 'berry' ? 'berry-bush' : type === 'wood' ? 'firewood-log' : 'valley-boulder',
    model,
    resource: { id: type, type, amount: 5 },
  };
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    resources: new Map([[type, item]]),
    // A camera-clearance result must never remove an available gathering target.
    sightThroughPlant: () => true,
  });
  world.scene.fog = new THREE.Fog(0xffffff, 10, 75);
  return { world, item };
}

for (const type of ['berry', 'stone', 'wood', 'obsidian']) {
  test(`${type} stays visible and gatherable on approach, inside and around the model`, () => {
    const { world, item } = fixture(type);
    for (const distance of [20, 8, 3, 1, 0.5, 0])
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        world.camera.position
          .copy(item.model.position)
          .add(new THREE.Vector3(Math.sin(angle) * distance, 0.4, Math.cos(angle) * distance));
        world.updateResourceVisibility();
        assert.equal(item.model.visible, true, `distance ${distance}, angle ${angle}`);
        assert.equal(world.resourceVisible(type), true);
      }
    assert.equal(item.resource.amount, 5, 'view changes cannot consume the resource');
  });

  test(`${type} still disappears after depletion and returns after regeneration or distance culling`, () => {
    const { world, item } = fixture(type);
    world.camera.position.copy(item.model.position);
    item.resource.amount = 0;
    world.updateResourceVisibility();
    assert.equal(item.model.visible, false);
    assert.equal(world.resourceVisible(type), false);
    item.resource.amount = 2;
    world.updateResourceVisibility();
    assert.equal(item.model.visible, true);
    assert.equal(world.resourceVisible(type), true);
    world.camera.position.x += 100;
    world.updateResourceVisibility();
    assert.equal(item.model.visible, false, 'far-away resources keep the existing draw budget');
    world.camera.position.copy(item.model.position);
    world.updateResourceVisibility();
    assert.equal(item.model.visible, true, 'approaching restores the resource');
    world.resources.clear();
    assert.equal(world.resourceVisible(type), false, 'unloaded resources are not targets');
  });
}
