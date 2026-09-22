import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { PettingPose, pettingProgress } from '../dist/src/petting-pose.js';
import { companion524Pose } from '../dist/src/companion-524-renderer.js';
import {
  COMPANION_524,
  createCompanion524,
  handleCompanion524Action,
} from '../dist/shared/companion-524.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

function fixture(character) {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const c = createCompanion524(collision);
  const p = {
    ...character,
    id: 'p',
    x: c.x,
    z: c.z - 2,
    facing: 0,
    radius: character.radius || 0.32,
    speed: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  const room = { collision, companion524: c, players: new Map([[p.id, p]]) };
  assert.ok(handleCompanion524Action(room, p, 'pet524', 10000));
  Object.assign(c, c.petGoal);
  c.petContactAt = 11200;
  return { c, p };
}

test('all seven delivered skins reach and stroke 524 without moving the feet, and restore exactly', async () => {
  for (const character of CHARACTER_MODELS) {
    const asset = await loadMotion(await deliveredModel(character.key));
    const model = new THREE.Group();
    model.add(asset.scene);
    const pose = new PettingPose(asset.scene);
    const mixer = new THREE.AnimationMixer(asset.scene);
    mixer.clipAction(asset.animations.find((c) => c.name === 'Idle_Loop')).play();
    const { c, p } = fixture(character);
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      model.position.set(4, 0.2, -3);
      model.rotation.y = yaw;
      for (let i = 0; i < 40; i++) {
        pose.restore();
        mixer.update(1 / 30);
        model.updateMatrixWorld(true);
        const bones = [];
        asset.scene.traverse((b) => {
          if (b.isBone) bones.push({ bone: b, q: b.quaternion.clone(), p: b.position.clone() });
        });
        const feet = ['FootL', 'FootR'].map((n) =>
          asset.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()),
        );
        const age = i * 30;
        const small = character.species === 'bear';
        const target = new THREE.Vector3(
          c.x - p.x,
          c.petHeight + (small ? 0.07 : 0.11),
          c.z - p.z - (small ? 0.13 : 0.08),
        );
        model.localToWorld(target);
        const progress = pettingProgress(c, p, c.petContactAt + age);
        pose.update(target, progress.weight, progress.stroke);
        if (progress.weight > 0.99)
          assert.ok(
            pose.contact.distanceTo(pose.requested) < 0.04,
            `${character.key}: hand gap ${pose.contact.distanceTo(pose.requested)}`,
          );
        for (const [j, name] of ['FootL', 'FootR'].entries())
          assert.ok(
            asset.scene
              .getObjectByName(name)
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(feet[j]) < 1e-8,
            'feet stay planted',
          );
        pose.restore();
        for (const { bone, q, p } of bones) {
          assert.ok(bone.quaternion.equals(q), `${character.key}: ${bone.name} rotation restored`);
          assert.ok(bone.position.equals(p), 'no bone length changes');
        }
      }
    }
  }
});

test('the happy reaction starts after the strokes and makes exactly one smooth revolution', () => {
  const { c, p } = fixture(CHARACTER_MODELS[0]);
  assert.equal(companion524Pose(c, c.petContactAt + 500).reaction, 'floating');
  assert.ok(pettingProgress(c, p, c.petContactAt + 500).weight > 0.99);
  const start = c.petContactAt + COMPANION_524.petStrokeMs;
  let previous = 0;
  for (let t = 0; t <= COMPANION_524.spinMs; t += 10) {
    const pose = companion524Pose(c, start + t);
    assert.equal(pose.reaction, 'happy');
    assert.ok(pose.spin >= previous);
    assert.ok(pose.spin - previous < 0.095);
    previous = pose.spin;
  }
  assert.equal(previous, Math.PI * 2);
  assert.equal(companion524Pose(c, start + COMPANION_524.happyMs).reaction, 'floating');
  assert.equal(pettingProgress(c, p, start + 300).weight, 0);
  assert.equal(pettingProgress(c, { ...p, moving: true }, c.petContactAt + 500).weight, 0);
});
