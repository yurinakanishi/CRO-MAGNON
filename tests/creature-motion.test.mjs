import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CharacterAnimation,
  HUMAN_CLIPS,
  confirmedAction,
} from '../dist/src/character-animation.js';
import { WorldAssets } from '../dist/src/world-assets.js';

function fixture() {
  const root = new THREE.Group(),
    bone = new THREE.Bone();
  bone.name = 'Body';
  bone.position.y = 50;
  root.add(bone);
  const clips = HUMAN_CLIPS.map(
    (name) =>
      new THREE.AnimationClip(name, name === 'Run_Loop' ? 0.7 : 1, [
        new THREE.NumberKeyframeTrack(
          'Body.position[y]',
          [0, name === 'Run_Loop' ? 0.7 : 1],
          [2, 2],
        ),
      ]),
  );
  const animation = new CharacterAnimation(root, clips, { walkSpeed: 1, runSpeed: 3 });
  animation.update(0);
  return { root, bone, clips, animation };
}
test('rapid locomotion and action changes keep the mixed pose normalized, never exposing the bind pose', () => {
  const { animation, bone } = fixture();
  for (let i = 0; i < 120; i++) {
    if (i % 4 === 0) {
      animation.update(0.012, 0);
      animation.play('Wave');
    } else animation.update(0.012, i % 2 ? 1 : 3, i % 2 === 0);
    assert.ok(Math.abs(bone.position.y - 2) < 1e-6, `bind pose leaked at ${i}: ${bone.position.y}`);
  }
  animation.update(1, 0);
  animation.update(1, 0);
  assert.equal([...animation.actions.values()].filter((a) => a.isScheduled()).length, 1);
  animation.dispose();
});
test('walk/run transitions preserve normalized stride phase at arbitrary points', () => {
  for (const phase of [0.1, 0.37, 0.61, 0.9]) {
    const { animation } = fixture();
    animation.update(phase, 1, false);
    animation.update(0, 3, true);
    assert.ok(Math.abs(animation.current.time / 0.7 - phase) < 1e-6);
    animation.update(0, 1, false);
    assert.ok(Math.abs(animation.current.time - phase) < 1e-6);
    animation.dispose();
  }
});
test('zero-duration transition stops the former action and a new attack retains its authoritative elapsed time', () => {
  const { animation, bone } = fixture();
  animation.play('Eat');
  animation.update(0.05);
  animation.change('Idle_Loop', 0);
  animation.update(0);
  assert.equal([...animation.actions.values()].filter((a) => a.isScheduled()).length, 1);
  assert.ok(Math.abs(bone.position.y - 2) < 1e-6);
  animation.playAttack(0.42);
  assert.equal(animation.current.time, 0.42);
  animation.update(0.05, 0);
  assert.ok(Math.abs(animation.current.time - 0.47) < 1e-6);
  animation.dispose();
});
test('animal walk/run blends preserve phase and repeated transitions remain normalized', () => {
  const { root, clips, animation } = fixture();
  animation.dispose();
  const assets = new WorldAssets();
  assets.templates.set('sample', { gltf: { scene: root, animations: clips }, asset: {} });
  const actor = assets.createAnimal('sample');
  actor.play('Walk_Loop');
  actor.update(0.37);
  actor.play('Run_Loop');
  assert.ok(
    Math.abs(
      actor.mixer.existingAction(clips.find((c) => c.name === 'Run_Loop')).time / 0.7 - 0.37,
    ) < 1e-6,
  );
  for (let i = 0; i < 100; i++) {
    actor.play(i % 3 === 0 ? 'Idle_Loop' : i % 2 ? 'Run_Loop' : 'Walk_Loop');
    actor.update(0.013);
    assert.ok(Math.abs(actor.root.getObjectByName('Body').position.y - 2) < 1e-6);
  }
  actor.dispose();
});
test('root dishes play the existing eating action only after confirmed consumption and energy recovery', () => {
  for (const food of ['cookedRoot', 'herbRoot']) {
    const before = { id: 'p', energy: 50, inventory: { wood: 0, stone: 0, berry: 0, [food]: 1 } },
      after = { ...before, energy: 85, inventory: { ...before.inventory, [food]: 0 } };
    assert.equal(confirmedAction(before, after), 'Eat');
    assert.notEqual(confirmedAction(before, { ...after, energy: 50 }), 'Eat');
  }
});
