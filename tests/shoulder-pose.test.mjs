import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { RidingPose, apeShoulderSeat } from '../dist/src/riding-pose.js';
import { CharacterAnimation } from '../dist/src/character-animation.js';

test('real mage skin follows the animated ape shoulder through walk, run, turns and returns to ground pose', async () => {
  const ape = await loadMotion(await deliveredModel('giant-ape'));
  const mage = await loadMotion(await deliveredModel('desert-fennec-mage'));
  const carrier = new THREE.Group(),
    passenger = new THREE.Group();
  carrier.add(ape.scene);
  passenger.add(mage.scene);
  const seat = apeShoulderSeat(ape.scene),
    pose = new RidingPose(mage.scene);
  const animation = new CharacterAnimation(mage.scene, mage.animations, {
    walkSpeed: 0.6,
    runSpeed: 1.8,
  });
  const mixer = new THREE.AnimationMixer(ape.scene);
  for (const clip of ape.animations.filter((c) =>
    ['Idle_Loop', 'Walk_Loop', 'Run_Loop'].includes(c.name),
  )) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).play();
    for (let i = 0; i < 20; i++) {
      carrier.position.set(i * 0.15, 0.2, 0);
      carrier.rotation.y = i * 0.15;
      action.time = (i / 20) * clip.duration;
      mixer.update(0);
      carrier.updateMatrixWorld(true);
      passenger.rotation.y = carrier.rotation.y;
      pose.updateShoulder(animation, i * 0.05, clip.name === 'Idle_Loop' ? 0 : 5.4);
      const target = seat.position(new THREE.Vector3());
      passenger.position
        .copy(target)
        .sub(
          pose
            .pelvisOffset(new THREE.Vector3())
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), passenger.rotation.y),
        );
      passenger.updateMatrixWorld(true);
      assert.ok(pose.hips.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 1e-5);
      const bounds = new THREE.Box3().setFromObject(passenger, true);
      assert.ok(bounds.min.y > 1, 'passenger remains above ground');
      assert.ok(bounds.max.y < 2.8, 'passenger stays on the shoulder, not above the head');
      assert.ok(Math.abs(target.y - 1.8) < 0.4, 'shoulder height follows the torso');
    }
  }
  pose.leave(animation);
  for (const { bone, p, q, s } of pose.bones.values()) {
    assert.ok(bone.position.distanceTo(p) < 1e-8);
    assert.ok(bone.quaternion.equals(q));
    assert.ok(bone.scale.equals(s));
  }
  animation.update(0.1, 0.6);
  assert.equal(animation.name, 'Walk_Loop');
});
