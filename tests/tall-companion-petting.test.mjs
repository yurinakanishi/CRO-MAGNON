import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { petMascot } from '../dist/shared/mascot-selection.mjs';
import { mascotFixture } from './mascot-fixture.mjs';

for (const gender of ['female', 'male'])
  test(`${gender} reaches retained Howkey's animated head without lowering away from it`, async () => {
    const player = await loadMotion(
      await deliveredModel(gender === 'female' ? 'cro-magnon-woman' : 'cro-magnon-hunter'),
    );
    const friend = await loadMotion(await deliveredModel('howkey-scientist'));
    const outer = new THREE.Group();
    outer.add(player.scene, friend.scene);
    const pose = new GroundPettingPose(player.scene),
      mixer = new THREE.AnimationMixer(player.scene),
      friendMixer = new THREE.AnimationMixer(friend.scene);
    mixer.clipAction(player.animations.find((c) => c.name === 'Idle_Loop')).play();
    friendMixer.clipAction(friend.animations.find((c) => c.name === 'Idle_Loop')).play();
    const f = mascotFixture('howkey-scientist');
    f.p.gender = gender;
    Object.assign(f.c, { x: f.p.x, z: f.p.z + 1.3 });
    assert.equal(petMascot(f.room, f.p, f.c.id, 10000), true);
    friend.scene.position.set(f.c.petGoal.x - f.p.x, 0, f.c.petGoal.z - f.p.z);
    friend.scene.rotation.y = Math.PI;
    for (const yaw of [0, Math.PI / 2, Math.PI])
      for (let i = 0; i < 30; i++) {
        pose.restore();
        mixer.update(1 / 30);
        friendMixer.update(1 / 30);
        outer.rotation.y = yaw;
        outer.position.set(2, 0.2, -3);
        outer.updateMatrixWorld(true);
        const bones = [];
        player.scene.traverse((b) => {
          if (b.isBone) bones.push([b, b.position.clone(), b.quaternion.clone()]);
        });
        const feet = ['FootL', 'FootR']
          .map((name) => player.scene.getObjectByName(name))
          .map((b) => [b, b.getWorldPosition(new THREE.Vector3())]);
        const target = friend.scene.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
        pose.update(target, 1, i / 29, true);
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.045,
          `hand gap ${pose.contact.distanceTo(pose.requested)}`,
        );
        assert.ok(pose.depth < 0.05, 'stands to reach the human-height head');
        for (const [b, at] of feet)
          assert.ok(b.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 0.006);
        pose.restore();
        for (const [b, p, q] of bones) {
          assert.ok(b.position.distanceTo(p) < 1e-9);
          assert.deepEqual(b.quaternion.toArray(), q.toArray());
        }
      }
    mixer.stopAllAction();
    friendMixer.stopAllAction();
  });
