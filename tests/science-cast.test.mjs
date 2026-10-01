import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { scienceAttackClip } from '../dist/src/science-cast.js';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { SpellEffects } from '../dist/src/spell-effects.js';

test('Howkey reaches with the left hand only, keeps the authored body, and restores the source rig', async () => {
  const actor = await loadMotion('public/models/howkey-scientist/model-r11.glb');
  const source = actor.animations.find((c) => c.name === 'Attack');
  const original = T.AnimationClip.toJSON(source);
  const saved = new Map();
  actor.scene.traverse((n) =>
    saved.set(n, { p: n.position.toArray(), q: n.quaternion.toArray(), s: n.scale.toArray() }),
  );
  const clip = scienceAttackClip(actor.scene, source);
  assert.deepEqual(T.AnimationClip.toJSON(source), original);
  for (const [n, b] of saved) {
    assert.deepEqual(n.position.toArray(), b.p);
    assert.deepEqual(n.quaternion.toArray(), b.q);
    assert.deepEqual(n.scale.toArray(), b.s);
  }
  for (const track of source.tracks.filter(
    (t) => !/^(UpperArm|LowerArm|Hand)[LR]\.quaternion$/.test(t.name),
  )) {
    const next = clip.tracks.find((t) => t.name === track.name);
    assert.deepEqual(next.times, track.times);
    assert.deepEqual(next.values, track.values);
  }
  const mixer = new T.AnimationMixer(actor.scene),
    action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const point = (name) => actor.scene.getObjectByName(name).getWorldPosition(new T.Vector3());
  const neutral = {};
  for (const time of [0, 0.18, 0.34, 0.4, 0.48, 0.52, 0.7, 0.9]) {
    action.time = time;
    mixer.update(0);
    actor.scene.updateMatrixWorld(true);
    const left = point('GripL'),
      right = point('GripR');
    if (time === 0) {
      neutral.left = left;
      neutral.right = right;
    }
    if (time >= 0.34 && time <= 0.52) {
      assert.ok(left.z > 0.35, 'left arm is already extended at release');
      assert.ok(left.y > 1.12, 'casting hand is at chest height');
      assert.ok(left.z - right.z > 0.4, 'only one arm reaches');
    }
    assert.ok(right.z < 0.05 && right.y < 0.86, 'right hand stays beside the body');
    if (time === 0.9) {
      assert.ok(left.distanceTo(neutral.left) < 1e-6);
      assert.ok(right.distanceTo(neutral.right) < 1e-6);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(actor.scene);
});

test('normal animation playback and a late attack seek use the same left-hand pose and return to locomotion', async () => {
  const actor = await loadMotion('public/models/howkey-scientist/model-r11.glb');
  const clips = actor.animations.map((c) =>
    c.name === 'Attack' ? scienceAttackClip(actor.scene, c) : c,
  );
  const animation = new CharacterAnimation(actor.scene, clips, { walkSpeed: 1, runSpeed: 3 });
  assert.equal(animation.playAttack(0.33), true);
  animation.update(0.07, 0);
  actor.scene.updateMatrixWorld(true);
  const left = actor.scene.getObjectByName('GripL').getWorldPosition(new T.Vector3());
  const right = actor.scene.getObjectByName('GripR').getWorldPosition(new T.Vector3());
  assert.ok(left.z > 0.35 && right.z < 0.05);
  animation.update(0.55, 1);
  assert.equal(animation.name, 'Walk_Loop');
  animation.update(0.2, 0);
  assert.equal(animation.name, 'Idle_Loop');
  assert.equal(animation.playAttack(1), false);
  animation.dispose();
});

test('science charge and launch coincide with the left hand at every heading, even without a right socket', () => {
  for (const facing of [0, 0.7, Math.PI / 2, Math.PI, -1.8]) {
    const model = new T.Group(),
      left = new T.Object3D();
    left.position.set(0.13, 1.2, 0.4);
    model.add(left);
    model.position.set(20, 0, 30);
    model.rotation.y = facing;
    model.updateMatrixWorld(true);
    const hand = left.getWorldPosition(new T.Vector3()),
      p = { id: 'howkey', species: 'howkey', attackAt: 1000, attackSequence: 1 };
    const players = new Map([[p.id, { state: p, model, gripLeft: left }]]),
      effect = new SpellEffects(new T.Scene());
    const head = () => new T.Vector3(...effect.xyz.slice(0, 3));
    effect.update({ projectiles: [] }, players, 1390, 1 / 60, 800);
    assert.ok(head().distanceTo(hand) < 2e-6, 'charge follows the casting palm');
    const dx = Math.sin(facing),
      dz = Math.cos(facing);
    const orb = {
      id: 'science:1',
      ownerId: p.id,
      kind: 'science',
      x: 20,
      z: 30,
      dx,
      dz,
      travelled: 0,
      elevation: 0,
    };
    effect.update({ projectiles: [orb] }, players, 1400, 1 / 60, 800);
    assert.ok(head().distanceTo(hand) < 2e-6, 'released core starts at the same palm');
    let previous = 0;
    for (let frame = 1; frame <= 30; frame++) {
      orb.travelled = (frame / 60) * 9;
      orb.x = 20 + dx * orb.travelled;
      orb.z = 30 + dz * orb.travelled;
      const before = structuredClone(orb);
      effect.update({ projectiles: [orb] }, players, 1400 + (frame / 60) * 1000, 1 / 60, 800);
      assert.deepEqual(orb, before, 'rendering leaves authoritative collision state unchanged');
      const forward = head()
        .sub(hand)
        .dot(new T.Vector3(dx, 0, dz));
      assert.ok(forward >= previous - 1e-5);
      previous = forward;
    }
    effect.dispose();
  }
});

test('a science projectile survives changing character without snapping to the new character hand', () => {
  const effect = new SpellEffects(new T.Scene()),
    model = new T.Group(),
    left = new T.Object3D(),
    right = new T.Object3D();
  left.position.set(30, 10, 30);
  right.position.set(30, 10, 30);
  model.add(left, right);
  const orb = {
    id: 'science:late',
    ownerId: 'p',
    kind: 'science',
    x: 0,
    z: 4,
    dx: 0,
    dz: 1,
    travelled: 4,
    elevation: 0,
  };
  effect.update(
    { projectiles: [orb] },
    new Map([['p', { state: { species: 'bear' }, model, gripLeft: left, gripRight: right }]]),
    2000,
    1 / 60,
    800,
  );
  assert.ok(Math.abs(effect.xyz[0]) < 1e-6);
  assert.ok(Math.abs(effect.xyz[2] - 4) < 1e-6);
  effect.dispose();
});
