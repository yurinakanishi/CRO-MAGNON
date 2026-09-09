import test from 'node:test';
import { deliveredModel } from './delivered-model.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { JumpPose } from '../dist/src/jump-pose.js';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

test('all six delivered skins bend both knees in air and restore their original bones and locomotion', async () => {
  for (const profile of CHARACTER_MODELS) {
    const gltf = await geometryScene(await deliveredModel(profile.key));
    const pose = new JumpPose(gltf.scene),
      animation = new CharacterAnimation(gltf.scene, gltf.animations, {
        walkSpeed: 1,
        runSpeed: 3,
      });
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      pose.update(animation, progress);
      assert.equal(animation.name, 'Jump');
      for (const side of ['L', 'R']) {
        const foot = pose.bones.get(`Foot${side}`).bone.getWorldPosition(new THREE.Vector3());
        assert.ok([foot.x, foot.y, foot.z].every(Number.isFinite));
        assert.ok(
          foot.y > -0.2 && foot.y < pose.hips.getWorldPosition(new THREE.Vector3()).y,
          profile.key,
        );
        if (progress === 0.5)
          assert.ok(
            pose.bones
              .get(`LowerLeg${side}`)
              .bone.quaternion.angleTo(pose.bones.get(`LowerLeg${side}`).q) > 0.2,
          );
      }
    }
    pose.leave(animation);
    for (const { bone, q, p } of pose.bones.values()) {
      assert.ok(bone.quaternion.equals(q));
      assert.ok(bone.position.distanceTo(p) < 1e-8);
    }
    animation.update(0.1, 3, true);
    assert.equal(animation.name, 'Run_Loop');
    animation.update(0.1, 0);
    assert.equal(animation.name, 'Idle_Loop');
    animation.dispose();
  }
});
