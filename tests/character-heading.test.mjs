import test from 'node:test';
import { deliveredModel } from './delivered-model.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

test('actual exported humanoid clips cannot overwrite the world heading', async () => {
  for (const { key } of CHARACTER_MODELS) {
    const gltf = await geometryScene(await deliveredModel(key)),
      placement = new THREE.Group();
    placement.add(gltf.scene);
    const animation = new CharacterAnimation(gltf.scene, gltf.animations, {
      walkSpeed: 1,
      runSpeed: 3,
    });
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const running of [false, true]) {
        placement.rotation.y = heading;
        placement.position.set(30, 0, 40);
        for (let i = 0; i < 35; i++) animation.update(1 / 30, running ? 3.5 : 1.25, running);
        placement.updateMatrixWorld(true);
        const forward = new THREE.Vector3(0, 0, 1).transformDirection(gltf.scene.matrixWorld);
        assert.ok(forward.dot(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))) > 0.999);
        assert.deepEqual(placement.position.toArray(), [30, 0, 40]);
      }
    // Each character's full attack rotates its arms without changing its heading.
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      placement.rotation.y = heading;
      assert.equal(animation.playAttack(), true);
      const attackFrames = Math.ceil(animation.actions.get('Attack').getClip().duration * 30) + 2;
      for (let frame = 0; frame < attackFrames; frame++) {
        animation.update(1 / 30, 0, false);
        placement.updateMatrixWorld(true);
        const forward = new THREE.Vector3(0, 0, 1).transformDirection(gltf.scene.matrixWorld);
        assert.ok(forward.dot(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))) > 0.999);
        assert.deepEqual(placement.position.toArray(), [30, 0, 40]);
      }
      assert.equal(animation.name, 'Idle_Loop');
    }
    animation.dispose();
  }
});
