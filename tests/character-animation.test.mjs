import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterAnimation, HUMAN_CLIPS, confirmedAction } from '../dist/src/character-animation.js';

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
  return { root, joint, animation: new CharacterAnimation(root, clips, { walkSpeed: 1, runSpeed: 4 }) };
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
  animation.update(.2, 8, true);
  assert.equal(animation.name, 'Run_Loop');
  // 8 m/s would be 2x the clip; the run clip is capped at 1.5x (no fast-forward blur).
  assert.ok(Math.abs(animation.current.time - .3) < 1e-6);
  assert.equal(animation.play('Gather'), false);
  animation.update(.2, false);
  assert.equal(animation.name, 'Idle_Loop');
  animation.play('Wave'); animation.update(.5, false);
  animation.play('Wave'); animation.update(.1, false);
  assert.ok(animation.current.time < .2);
  assert.deepEqual(root.position.toArray(), [12, 0, 6]);
  animation.dispose();
});

test('walking and running use separate clips and retime to actual travel speed', () => {
  const { animation } = actor();
  animation.update(.2, 1.25, false);
  assert.equal(animation.name, 'Walk_Loop');
  assert.equal(animation.current.getEffectiveTimeScale(), 1.25);
  animation.update(.2, 3.5, true);
  assert.equal(animation.name, 'Run_Loop');
  assert.equal(animation.current.getEffectiveTimeScale(), .875);
  animation.update(.2, 0, true);
  assert.equal(animation.name, 'Idle_Loop');
  animation.dispose();
});

test('attacks require a new server sequence and ignore interpolation drift', () => {
  const before={id:'one',attackSequence:2,inventory:{rawMeat:0,cookedMeat:0}},after={...before,attackSequence:3};
  assert.equal(confirmedAction(before,after),'Attack');assert.equal(confirmedAction(after,after),null);
  assert.equal(confirmedAction(null,after),null);
  const {animation}=actor();animation.update(.1,1.25);assert.equal(animation.playAttack(.25),true);
  animation.update(.1,.1);assert.equal(animation.name,'Attack');assert.ok(animation.current.time>.3);
  animation.update(.7,0);assert.equal(animation.name,'Idle_Loop');assert.equal(animation.playAttack(10),false);animation.dispose();
});

test('harvesting, cooking start, and eating meat animate only confirmed changes', () => {
  const before={id:'one',energy:40,inventory:{wood:0,stone:0,berry:0,rawMeat:0,cookedMeat:1}};
  assert.equal(confirmedAction(before,{...before,inventory:{...before.inventory,rawMeat:1}}),'Gather');
  assert.equal(confirmedAction(before,{...before,cookingEndsAt:5000}),'Craft');
  assert.equal(confirmedAction(before,{...before,energy:85,inventory:{...before.inventory,cookedMeat:0}}),'Eat');
  assert.equal(confirmedAction(before,{...before,inventory:{...before.inventory,cookedMeat:2}}),null);
});

test('walking and running use their own clips and never fast-forward past the rate cap', async () => {
  const { locomotionTimeScale, LOCOMOTION_RATE } = await import('../dist/src/character-animation.js');
  assert.equal(locomotionTimeScale('Walk_Loop', 0.86, 0.86), 1);
  assert.equal(locomotionTimeScale('Walk_Loop', 2.0, 0.86), LOCOMOTION_RATE.Walk_Loop);
  assert.equal(locomotionTimeScale('Run_Loop', 5.6, 2.58), LOCOMOTION_RATE.Run_Loop);
  assert.equal(locomotionTimeScale('Run_Loop', 0.3, 2.58), LOCOMOTION_RATE.min);
  assert.ok(LOCOMOTION_RATE.Walk_Loop < 1.5 && LOCOMOTION_RATE.Run_Loop <= 1.6);
});

