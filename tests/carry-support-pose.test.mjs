import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { CarrySupportPose } from '../dist/src/carry-support-pose.js';
import { RidingPose, apeShoulderSeat } from '../dist/src/riding-pose.js';
import { CharacterAnimation } from '../dist/src/character-animation.js';

test('delivered ape holds its left hand beside the passenger through idle, walk, run and turns; other bones keep their animation', async () => {
  const ape = await loadMotion(await deliveredModel('giant-ape'));
  const carrier = new THREE.Group();
  carrier.add(ape.scene);
  const support = new CarrySupportPose(ape.scene);
  const seat = apeShoulderSeat(ape.scene);
  const mixer = new THREE.AnimationMixer(ape.scene);
  const bones = [];
  ape.scene.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
  const hand = ape.scene.getObjectByName('HandL');
  const chest = ape.scene.getObjectByName('Chest');
  const expected = chest.worldToLocal(ape.scene.localToWorld(new THREE.Vector3(0.7, 1.5, 0.03)));
  const leftArm = new Set(['UpperArmL', 'LowerArmL', 'HandL']);
  for (const clip of ape.animations.filter((c) =>
    ['Idle_Loop', 'Walk_Loop', 'Run_Loop'].includes(c.name),
  )) {
    support.reset();
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    for (let i = 0; i < Math.ceil(clip.duration * 60) * 2; i++) {
      support.restore();
      carrier.position.set(i * 0.01, 0.1, -i * 0.03);
      carrier.rotation.y = i * 0.04;
      mixer.update(1 / 60);
      carrier.updateMatrixWorld(true);
      const base = bones.map((b) => b.quaternion.clone());
      const shoulder = seat.position(new THREE.Vector3());
      support.update(1 / 60, true);
      bones.forEach((bone, j) => {
        if (!leftArm.has(bone.name)) assert.ok(bone.quaternion.equals(base[j]), bone.name);
      });
      assert.ok(seat.position(new THREE.Vector3()).distanceTo(shoulder) < 1e-8);
      if (i > 14) {
        const wrist = hand.getWorldPosition(new THREE.Vector3());
        assert.ok(
          wrist.distanceTo(chest.localToWorld(expected.clone())) < 1e-5,
          `${clip.name}: wrist tracks chest socket`,
        );
        assert.ok(
          wrist.distanceTo(shoulder) < 0.48,
          'supporting hand stays near the occupied shoulder',
        );
      }
      support.restore();
      bones.forEach((bone, j) =>
        assert.ok(bone.quaternion.equals(base[j]), `${bone.name} restored`),
      );
    }
    // No locomotion/mixer change: constant channels must also recover exactly.
    const base = bones.map((b) => b.quaternion.clone());
    for (let i = 0; i < 20; i++) support.update(1 / 60, false);
    bones.forEach((bone, j) =>
      assert.ok(bone.quaternion.equals(base[j]), 'idle release restores arm'),
    );
  }
});

test('the delivered left hand stays within 2.5 cm of the mage foot surface during each gait', async () => {
  const ape = await loadMotion(await deliveredModel('giant-ape'));
  const mage = await loadMotion(await deliveredModel('desert-fennec-mage'));
  const support = new CarrySupportPose(ape.scene),
    seat = apeShoulderSeat(ape.scene);
  const rider = new RidingPose(mage.scene),
    passenger = new THREE.Group();
  passenger.add(mage.scene);
  const animation = new CharacterAnimation(mage.scene, mage.animations, {
    walkSpeed: 0.6,
    runSpeed: 1.8,
  });
  const mixer = new THREE.AnimationMixer(ape.scene);
  const hand = [];
  ape.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const index = mesh.skeleton.bones.findIndex((b) => b.name === 'HandL');
    const g = mesh.geometry.attributes;
    for (let i = 0; i < g.position.count; i += 2) {
      let weight = 0;
      for (let j = 0; j < 4; j++)
        if (g.skinIndex.getComponent(i, j) === index) weight += g.skinWeight.getComponent(i, j);
      if (weight > 0.75) hand.push({ mesh, index: i });
    }
  });
  for (const clip of ape.animations.filter((c) =>
    ['Idle_Loop', 'Walk_Loop', 'Run_Loop'].includes(c.name),
  )) {
    support.reset();
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).play();
    for (let i = 0; i < 8; i++) {
      support.restore();
      action.time = (i * clip.duration) / 8;
      mixer.update(0);
      support.update(1, true);
      rider.updateShoulder(animation, i / 8, clip.name === 'Idle_Loop' ? 0 : 5.4);
      const hip = seat.position(new THREE.Vector3());
      passenger.position.copy(hip).sub(rider.pelvisOffset(new THREE.Vector3()));
      passenger.updateMatrixWorld(true);
      ape.scene.traverse((mesh) => {
        if (mesh.isSkinnedMesh) mesh.skeleton.update();
      });
      const points = hand.map(({ mesh, index }) =>
        mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
      );
      let distance = Infinity;
      mage.scene.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        mesh.skeleton.update();
        for (let v = 0; v < mesh.geometry.attributes.position.count; v += 3) {
          const point = mesh
            .getVertexPosition(v, new THREE.Vector3())
            .applyMatrix4(mesh.matrixWorld);
          if (point.y > hip.y || point.x < hip.x) continue;
          for (const p of points) distance = Math.min(distance, point.distanceToSquared(p));
        }
      });
      assert.ok(
        Math.sqrt(distance) < 0.025,
        `${clip.name} phase ${i / 8}: hand is beside the foot`,
      );
    }
  }
});
