import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createMae, handleMaeAction } from '../dist/shared/mae.mjs';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { deliveredModel } from '../tests/delivered-model.mjs';
import { loadMotion } from './motion-glb.mjs';
const pet = await loadMotion(await deliveredModel('mae'));
const petMixer = new THREE.AnimationMixer(pet.scene);
const petAction = petMixer.clipAction(pet.animations.find((a) => a.name === 'Pet')).play();
const records = [];
for (const character of CHARACTER_MODELS.filter((c) => c.bodyPlan !== 'octopus')) {
  const gltf = await loadMotion(await deliveredModel(character.key)),
    outer = new THREE.Group();
  outer.add(gltf.scene, pet.scene);
  const pose = new GroundPettingPose(gltf.scene),
    mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find((a) => a.name === 'Idle_Loop')).play();
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] }),
    c = createMae(collision);
  const p = {
    ...character,
    id: 'p',
    x: c.x,
    z: c.z - 1.5,
    radius: 0.32,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  assert.ok(handleMaeAction({ collision, mae: c }, p, 'petMae', 10000));
  pet.scene.position.set(c.petGoal.x - p.x, 0, c.petGoal.z - p.z);
  pet.scene.rotation.y = Math.PI;
  const samples = [];
  for (const yaw of [0, Math.PI / 2, Math.PI])
    for (let i = 0; i <= 28; i++) {
      pose.restore();
      mixer.update(0.03);
      outer.rotation.y = yaw;
      outer.position.set(2, 0.2, -1);
      outer.updateMatrixWorld(true);
      const feet = ['FootL', 'FootR'].map((n) =>
        gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()),
      );
      petAction.time = (i / 28) * 1.399;
      petMixer.update(0);
      outer.updateMatrixWorld(true);
      const target = pet.scene.getObjectByName('PetContact').getWorldPosition(new THREE.Vector3());
      pose.update(target, 1, i / 28, true);
      samples.push({
        yaw,
        stroke: i / 28,
        gap: pose.contact.distanceTo(pose.requested),
        depth: pose.depth,
        footDelta: Math.max(
          ...['FootL', 'FootR'].map((n, j) =>
            gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).distanceTo(feet[j]),
          ),
        ),
      });
    }
  records.push({
    key: character.key,
    goal: pet.scene.position.toArray(),
    gap: Math.max(...samples.map((s) => s.gap)),
    footDelta: Math.max(...samples.map((s) => s.footDelta)),
    samples,
  });
  console.log(character.key, records.at(-1).gap, records.at(-1).footDelta);
}
await writeFile(
  'output/model-generation/models/mae/qa/contact.json',
  JSON.stringify(records, null, 2),
);
assert.ok(
  records.every((r) => r.gap < 0.045 && r.footDelta < 0.006),
  'moving crown reachable with planted feet',
);
