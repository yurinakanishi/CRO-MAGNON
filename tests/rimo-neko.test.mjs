import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { petMascot } from '../dist/shared/mascot-selection.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { mascotFixture } from './mascot-fixture.mjs';
import { companionBehavior } from './companion-behavior.mjs';
companionBehavior('rimo-neko');
function fixture() {
  const f = mascotFixture('rimo-neko');
  Object.assign(f.c, { x: f.p.x, z: f.p.z + 1.4 });
  return f;
}

test('all delivered characters crouch, keep both soles planted and reach the cat at different orientations', async () => {
  const cat = await loadMotion(await deliveredModel('rimo-neko'));
  const catMixer = new THREE.AnimationMixer(cat.scene),
    catAction = catMixer.clipAction(cat.animations.find((c) => c.name === 'Pet')).play();
  for (const character of CHARACTER_MODELS.filter((model) => model.bodyPlan !== 'octopus')) {
    const gltf = await loadMotion(await deliveredModel(character.key)),
      outer = new THREE.Group();
    outer.add(gltf.scene);
    const pose = new GroundPettingPose(gltf.scene),
      mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle_Loop')).play();
    const { c, p, room } = fixture();
    // a player names its look by key (several looks share a species and gender)
    Object.assign(p, character, { character: character.key });
    assert.equal(petMascot(room, p, c.id, 10000), true);
    outer.add(cat.scene);
    cat.scene.position.set(c.petGoal.x - p.x, 0, c.petGoal.z - p.z);
    cat.scene.rotation.y = Math.PI;
    for (const yaw of [0, Math.PI / 2, Math.PI])
      for (const stroke of [0, 0.0625, 0.125, 0.1875, 0.25, 0.5, 0.5625, 0.625, 0.6875, 0.75, 1]) {
        pose.restore();
        mixer.update(0.03);
        outer.position.set(2, 0.2, -1);
        outer.rotation.y = yaw;
        outer.updateMatrixWorld(true);
        const feet = ['FootL', 'FootR'].map((n) =>
          gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()),
        );
        const hips = gltf.scene.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
        catAction.time = stroke * 1.599;
        catMixer.update(0);
        outer.updateMatrixWorld(true);
        const target = cat.scene
          .getObjectByName('PetContact')
          .getWorldPosition(new THREE.Vector3());
        pose.update(target, 1, stroke);
        assert.ok(pose.depth > 0.025, `${character.key}: crouch`);
        const gap = pose.contact.distanceTo(pose.requested);
        assert.ok(gap < 0.045, `${character.key}: hand gap ${gap}`);
        for (const [i, n] of ['FootL', 'FootR'].entries())
          assert.ok(
            gltf.scene
              .getObjectByName(n)
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(feet[i]) < 0.006,
            `${character.key}: planted ${n}`,
          );
        pose.restore();
        outer.updateMatrixWorld(true);
        assert.ok(
          gltf.scene
            .getObjectByName('Hips')
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(hips) < 1e-8,
        );
      }
  }
});
