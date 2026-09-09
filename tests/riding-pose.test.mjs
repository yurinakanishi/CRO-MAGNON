import test from 'node:test';
import { deliveredModel } from './delivered-model.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { RidingPose, mammothSeat } from '../dist/src/riding-pose.js';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
test('all six delivered skins seat at the animated spine, restore their bind transforms and resume walking', async () => {
  const mammoth = await geometryScene(await deliveredModel('woolly-mammoth')),
    socket = mammothSeat(mammoth.scene),
    mixer = new THREE.AnimationMixer(mammoth.scene);
  const run = mixer.clipAction(mammoth.animations.find((c) => c.name === 'Run_Loop'));
  run.play();
  for (const model of CHARACTER_MODELS) {
    const gltf = await geometryScene(await deliveredModel(model.key)),
      group = new THREE.Group();
    group.add(gltf.scene);
    const originalBounds = new THREE.Box3().setFromObject(gltf.scene, true),
      height = originalBounds.max.y - originalBounds.min.y;
    const pose = new RidingPose(gltf.scene),
      animation = new CharacterAnimation(gltf.scene, gltf.animations, {
        walkSpeed: 1,
        runSpeed: 3,
      });
    for (let i = 0; i < 12; i++) {
      mixer.update(0.1);
      mammoth.scene.updateMatrixWorld(true);
      pose.update(animation, i * 0.1, 2.25);
      const pelvis = pose.pelvisOffset(new THREE.Vector3()),
        seat = socket.position(new THREE.Vector3());
      group.position.copy(seat).sub(pelvis);
      group.updateMatrixWorld(true);
      assert.ok(pose.hips.getWorldPosition(new THREE.Vector3()).distanceTo(seat) < 1e-5, model.key);
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
      assert.ok(Number.isFinite(bounds.min.x) && bounds.max.y - bounds.min.y < height * 1.2);
      assert.ok(
        pose.bones.get('LowerLegL').bone.getWorldPosition(new THREE.Vector3()).x > 0.1,
        model.key + ' left knee',
      );
      assert.ok(
        pose.bones.get('LowerLegR').bone.getWorldPosition(new THREE.Vector3()).x < -0.1,
        model.key + ' right knee',
      );
    }
    pose.leave(animation);
    for (const { bone, q, p } of pose.bones.values()) {
      assert.ok(bone.quaternion.equals(q));
      assert.ok(bone.position.distanceTo(p) < 1e-8);
    }
    animation.update(0.1, 1);
    assert.equal(animation.name, 'Walk_Loop');
    assert.equal(animation.current.isRunning(), true);
    animation.dispose();
  }
});
