import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { OctopusPettingPose, OctopusJumpPose, OctopusRidingPose } from '../dist/src/octopus-pose.js';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { characterModel } from '../dist/shared/characters.mjs';

async function actor() {
  const asset = JSON.parse(await readFile('public/models/maruimo-octopus/asset.json', 'utf8'));
  const gltf = await loadMotion('public' + asset.url);
  const animation = new CharacterAnimation(gltf.scene, gltf.animations, {
    walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
    runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
  });
  return { ...gltf, animation, asset };
}

test('the delivered octopus reaches both pets with its tentacle, keeps the lower arms fixed and restores every bone', async () => {
  const a = await actor();
  const outer = new THREE.Group();
  outer.add(a.scene);
  const pose = new OctopusPettingPose(a.scene);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
    for (const height of [.45, .75])
      for (const stroke of [0, .125, .25, .375, .5, .625, .75, .875, 1]) {
        pose.restore();
        a.animation.update(.031, 0);
        outer.position.set(4, .2, -3);
        outer.rotation.y = yaw;
        outer.updateMatrixWorld(true);
        const before = [];
        a.scene.traverse((bone) => {
          if (bone.isBone) before.push({ bone, p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone(), world: bone.getWorldPosition(new THREE.Vector3()) });
        });
        const target = a.scene.localToWorld(new THREE.Vector3(-.12, height, 1));
        pose.update(target, 1, stroke);
        assert.ok(pose.contact.distanceTo(pose.requested) < .015, `tentacle contact gap: ${pose.contact.distanceTo(pose.requested)}`);
        for (const { bone, world } of before)
          if (bone.name.startsWith('Tentacle'))
            assert.ok(bone.getWorldPosition(new THREE.Vector3()).distanceTo(world) < 1e-7, 'supporting arms do not slide');
        pose.restore();
        for (const { bone, p, q, s } of before) {
          assert.deepEqual(bone.position.toArray(), p.toArray());
          assert.deepEqual(bone.quaternion.toArray(), q.toArray());
          assert.deepEqual(bone.scale.toArray(), s.toArray());
        }
      }
  a.animation.dispose();
});

test('octopus jump and mount clips share the actor mixer, seek deterministically and return to locomotion', async () => {
  const a = await actor();
  const jump = new OctopusJumpPose(a.scene, a.animations);
  const riding = new OctopusRidingPose(a.scene, a.animations);
  const outer = new THREE.Group();
  outer.add(a.scene);
  const mixer = a.animation.mixer;
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const progress of [0, .25, .5, .75, 1]) {
      jump.update(a.animation, progress);
      assert.equal(a.animation.mixer, mixer);
      assert.equal(a.animation.name, 'Jump');
      assert.equal(a.animation.current.time, progress);
      assert.ok(a.scene.getObjectByName('Root').position.length() < 1e-7);
    }
    jump.leave(a.animation);
    for (const boat of [false, true]) {
      riding.update(a.animation, 1.2, 4, boat);
      const seat = new THREE.Vector3(0, 3.51, .6);
      outer.position.copy(seat).sub(riding.pelvisOffset(new THREE.Vector3()));
      outer.updateMatrixWorld(true);
      const contact=riding.pelvisOffset(new THREE.Vector3());a.scene.localToWorld(contact);
      assert.ok(contact.distanceTo(seat)<1e-6);
      if(!boat)assert.ok(outer.position.y>=3.39-1e-6,'supporting arms rest on the measured mammoth back');
      assert.equal(a.animation.name, boat ? 'Boat_Loop' : 'Ride_Loop');
      riding.leave(a.animation);
    }
    a.animation.update(.2, a.asset.locomotion.Run_Loop.metresPerSecond, true);
    assert.equal(a.animation.name, 'Run_Loop');
    assert.ok(a.animation.current.isRunning());
    a.animation.update(.2, 0);
    assert.equal(a.animation.name, 'Idle_Loop');
  }
  a.animation.dispose();
});

test('octopus supporting sections match game travel while walk and run use separate cadences', async () => {
  const a = await actor();
  for (const name of ['Walk_Loop','Run_Loop']) {
    a.animation.change(name, 0);
    const action=a.animation.current, duration=action.getClip().duration;
    const speed=a.asset.locomotion[name].metresPerSecond;
    let first;
    for (let i=0;i<=12;i++) {
      const time=duration*(.12+i*.025);
      action.time=time;a.animation.mixer.update(0);a.scene.updateMatrixWorld(true);
      const point=a.scene.getObjectByName('Tentacle103').getWorldPosition(new THREE.Vector3());
      point.z+=speed*time;
      if (!first) first=point.clone();
      assert.ok(Math.hypot(point.x-first.x,point.z-first.z)<.004,'supporting section stays planted in world travel');
    }
    assert.ok(a.scene.getObjectByName('Root').position.length()<1e-7);
  }
  assert.ok(a.animation.actions.get('Run_Loop').getClip().duration<a.animation.actions.get('Walk_Loop').getClip().duration*.7);
  a.animation.dispose();
});

test('the exported tentacle reaches the authoritative strike distance at the impact time', async () => {
  const a=await actor(), profile=attackProfile({species:'maruimo'});
  a.animation.playAttack();
  a.animation.update(profile.impactMs/1000,0);
  a.scene.updateMatrixWorld(true);
  const tip=a.scene.getObjectByName('GripR').getWorldPosition(new THREE.Vector3());
  const reach=profile.reach+characterModel({species:'maruimo'}).radius;
  assert.ok(Math.abs(tip.z-reach)<.04);
  assert.ok(Math.abs(tip.x)<.12);
  a.animation.dispose();
});
