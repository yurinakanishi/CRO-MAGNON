import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterAnimation, HUMAN_CLIPS, confirmedAction } from '../src/character-animation.js';

test('animations follow confirmed server changes, including trade versus gathering', () => {
  const before = { id: 'one', tool: false, energy: 60, inventory: { wood: 3, stone: 2, berry: 2 } };
  const after = changes => ({ ...before, ...changes });
  assert.equal(confirmedAction(null, before), null);
  assert.equal(confirmedAction(before, after({ id: 'new-connection' })), null);
  assert.equal(confirmedAction(before, after({ moving: true, x: 45 })), null);
  assert.equal(confirmedAction(before, after({ inventory: { wood: 4, stone: 2, berry: 2 } })), 'Gather');
  assert.equal(confirmedAction(before, after({ tool: true, inventory: { wood: 0, stone: 0, berry: 2 } })), 'Craft');
  assert.equal(confirmedAction(before, after({ inventory: { wood: 1, stone: 2, berry: 5 } })), 'Give');
  assert.equal(confirmedAction(before, after({ inventory: { wood: 0, stone: 0, berry: 2 } })), 'Give');
  assert.equal(confirmedAction(before, after({ energy: 85, inventory: { wood: 3, stone: 2, berry: 1 } })), 'Eat');
});

function actor() {
  const root = new THREE.Group(), joint = new THREE.Bone();
  joint.name = 'Joint'; root.add(joint); root.position.set(12, 0, 6);
  const clips = HUMAN_CLIPS.map((name, index) => new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack('Joint.rotation[x]', [0, .5, 1], [0, .1 * (index + 1), 0]),
  ]));
  return { root, joint, animation: new CharacterAnimation(root, clips, { speed: 8, runSpeed: 4 }) };
}

test('each player can perform a different action and one-shots return to idle', () => {
  const a = actor(), b = actor();
  a.animation.play('Wave'); b.animation.play('Eat');
  a.animation.update(.5, false); b.animation.update(.5, false);
  assert.notEqual(a.joint.rotation.x, b.joint.rotation.x);
  assert.equal(a.animation.name, 'Wave');
  a.animation.update(.51, false);
  assert.equal(a.animation.name, 'Idle_Loop');
  assert.equal(b.animation.name, 'Eat');
  assert.deepEqual(a.root.position.toArray(), [12, 0, 6]);
  a.animation.dispose(); b.animation.dispose();
});

test('movement cancels a stationary action, matches clip speed, and stops cleanly', () => {
  const { animation, root } = actor();
  animation.play('Craft');
  animation.update(.2, true);
  assert.equal(animation.name, 'Run_Loop');
  assert.ok(Math.abs(animation.current.time - .4) < 1e-6);
  assert.equal(animation.play('Gather'), false);
  animation.update(.2, false);
  assert.equal(animation.name, 'Idle_Loop');
  animation.play('Wave'); animation.update(.5, false);
  animation.play('Wave'); animation.update(.1, false);
  assert.ok(animation.current.time < .2);
  assert.deepEqual(root.position.toArray(), [12, 0, 6]);
  animation.dispose();
});
