import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOT_KINDS, ORB_BOTS, handleOrbBotAction } from '../dist/shared/orb-bots.mjs';
import { petMascot, chooseMascot } from '../dist/shared/mascot-selection.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { OctopusPettingPose } from '../dist/src/octopus-pose.js';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import {
  mascotFixture,
  mascotCore,
  person,
  distance,
  flatCollision,
  advanceMascots,
} from './mascot-fixture.mjs';

function fixture(kind = 'white') {
  const f = mascotFixture(kind);
  let now = 10000;
  Object.assign(f.b, { x: f.p.x, z: f.p.z + 1.3 });
  const q = person('visitor');
  f.room.players.set(q.id, q);
  return {
    ...f,
    q,
    get now() {
      return now;
    },
    step(seconds) {
      advanceMascots(f.room, now, seconds);
      now += seconds * 1000;
    },
  };
}

for (const kind of BOT_KINDS)
  test(
    kind + ': a visitor pets through approach, contact and happiness without gaining a companion',
    () => {
      const f = fixture(kind),
        start = { x: f.q.x, z: f.q.z };
      assert.equal(petMascot(f.room, f.q, f.b.id, f.now), true);
      assert.equal(f.b.petContactAt, 0);
      assert.equal(petMascot(f.room, f.p, f.b.id, f.now), false, 'already busy');
      for (let i = 0; i < 50 && !f.b.petContactAt; i++) f.step(0.05);
      assert.ok(f.b.petContactAt > 10000);
      assert.ok(distance(f.b, f.b.petGoal) < 0.015);
      const contact = f.b.petContactAt;
      while (f.now < contact + ORB_BOTS.petStrokeMs + 50) f.step(0.05);
      assert.equal(f.b.petPlayerId, f.q.id, 'happy phase remains shared');
      while (f.now < contact + ORB_BOTS.petStrokeMs + ORB_BOTS.happyMs + 50) f.step(0.05);
      assert.equal(f.b.petPlayerId, null);
      assert.equal(f.b.busy, false);
      assert.equal(f.b.ownerId, f.p.id);
      assert.equal(f.p.mascot, kind);
      assert.equal(f.q.mascot, null);
      assert.deepEqual({ x: f.q.x, z: f.q.z }, start);
    },
  );

for (const reason of ['walk', 'hurt', 'warp', 'character', 'disconnect'])
  test(reason + ' cancels a dot stroke and retains its owner', () => {
    const f = fixture();
    assert.equal(petMascot(f.room, f.q, f.b.id, f.now), true);
    if (reason === 'walk') f.q.moving = true;
    if (reason === 'hurt') f.q.hurtAt = f.now + 1;
    if (reason === 'warp') f.q.warpSequence++;
    if (reason === 'character') f.q.species = 'bear';
    if (reason === 'disconnect') f.room.players.delete(f.q.id);
    f.step(0.05);
    assert.equal(f.b.petPlayerId, null);
    assert.equal(f.b.busy, false);
    assert.equal(f.b.ownerId, f.p.id);
    assert.equal(f.p.mascot, 'white');
  });

test('distant, obstructed, flying and stowed dots cannot be petted, nor can busy players pet', () => {
  for (const patch of [
    { x: 80 },
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'p' },
    { passengerId: 'p' },
    { downedUntil: 20000 },
    { cookingEndsAt: 20000 },
    { fishing: {} },
    { coastalActivity: {} },
    { jumpAt: 10000, jumpSequence: 1 },
    { attackAt: 10000, attackSequence: 1 },
  ]) {
    const f = fixture();
    Object.assign(f.q, patch);
    assert.equal(petMascot(f.room, f.q, f.b.id, f.now), false, JSON.stringify(patch));
  }
  for (const mode of ['queued', 'windup', 'airborne', 'landing', 'stowed', 'leaving']) {
    const f = fixture();
    f.b.mode = mode;
    assert.equal(petMascot(f.room, f.q, f.b.id, f.now), false, mode);
  }
  const f = fixture();
  f.room.collision = flatCollision([
    { id: 'wall', type: 'box', x: 50, z: 50.6, hx: 2, hz: 0.1, c: 1, s: 0, height: 2 },
  ]);
  assert.equal(petMascot(f.room, f.q, f.b.id, f.now), false);
});

test('one hand cannot pet two bodies and a competing pet does not change either choice', () => {
  const f = fixture();
  chooseMascot(f.room, f.q, 'blue', f.now);
  const other = f.room.orbBots.find((b) => b.ownerId === f.q.id);
  Object.assign(other, { x: 50, z: 51.2 });
  assert.equal(petMascot(f.room, f.q, f.b.id, f.now), true);
  assert.equal(petMascot(f.room, f.q, other.id, f.now), false);
  assert.equal(petMascot(f.room, f.p, f.b.id, f.now), false);
  assert.equal(f.p.mascot, 'white');
  assert.equal(f.q.mascot, 'blue');
});

test('petting puts down an unlaunched throw and prevents another launch until the gesture ends', () => {
  const f = fixture();
  chooseMascot(f.room, f.q, 'blue', f.now);
  assert.equal(handleOrbBotAction(f.room, f.q, 'throwBot', 'blue', f.now), true);
  const own = f.room.orbBots.find((b) => b.ownerId === f.q.id);
  assert.equal(own.mode, 'windup');
  assert.equal(petMascot(f.room, f.q, f.b.id, f.now + 1), true);
  assert.notEqual(own.mode, 'windup');
  f.step(1);
  assert.notEqual(own.mode, 'airborne');
  assert.equal(f.b.ownerId, f.p.id);
  assert.equal(own.ownerId, f.q.id);
});

test('deselecting during a visitor pet waves then removes the body permanently', () => {
  const f = fixture();
  assert.equal(petMascot(f.room, f.q, f.b.id, f.now), true);
  chooseMascot(f.room, f.p, null, f.now + 1);
  assert.equal(f.b.petPlayerId, null);
  assert.equal(petMascot(f.room, f.q, f.b.id, f.now + 2), false);
  f.step(2);
  assert.deepEqual(f.room.orbBots, []);
  assert.equal(f.p.mascot, null);
});

test('retired group, recruitment and dismissal commands cannot steal or create bodies', (t) => {
  const w = mascotCore(t),
    a = w.join(),
    b = w.join('B');
  w.act(a, 'selectMascot', 'white');
  const own = w.active(a);
  Object.assign(b.player(), { x: own.x, z: own.z - 1.3 });
  for (const action of ['petBot', 'petBots', 'dismissBot', 'dismissBots', 'travelAlone']) {
    w.act(b, action, own.id);
    w.step();
    assert.equal(w.active(a), own);
    assert.equal(own.ownerId, a.id);
    assert.equal(b.player().mascot, null);
    assert.equal(w.room().orbBots.length, 1);
  }
});

test('all delivered character rigs reach the dot crown at the authoritative pet position and restore their bones', async () => {
  for (const character of CHARACTER_MODELS) {
    const f = fixture();
    Object.assign(f.p, character, { x: f.b.x, z: f.b.z - 1.3 });
    assert.ok(petMascot(f.room, f.p, f.b.id, f.now));
    const gltf = await loadMotion(await deliveredModel(character.key));
    const outer = new THREE.Group();
    outer.add(gltf.scene);
    const pose =
      character.bodyPlan === 'octopus'
        ? new OctopusPettingPose(gltf.scene)
        : new GroundPettingPose(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle_Loop')).play();
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      outer.rotation.y = yaw;
      for (const stroke of [0, 0.25, 0.5, 0.75, 1]) {
        pose.restore();
        mixer.update(1 / 30);
        outer.updateMatrixWorld(true);
        const bones = [];
        gltf.scene.traverse((b) => {
          if (b.isBone) bones.push([b, b.position.clone(), b.quaternion.clone()]);
        });
        const feet = ['FootL', 'FootR']
          .map((n) => gltf.scene.getObjectByName(n))
          .filter(Boolean)
          .map((b) => [b, b.getWorldPosition(new THREE.Vector3())]);
        const target = outer.localToWorld(
          new THREE.Vector3(f.b.petGoal.x - f.p.x, ORB_BOTS.diameter * 0.9, f.b.petGoal.z - f.p.z),
        );
        pose.update(target, 1, stroke, true);
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.045,
          `${character.key}: hand gap ${pose.contact.distanceTo(pose.requested)}`,
        );
        for (const [b, at] of feet)
          assert.ok(
            b.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 0.006,
            `${character.key}: feet slide`,
          );
        pose.restore();
        for (const [b, pos, q] of bones) {
          assert.ok(b.position.distanceTo(pos) < 1e-9);
          assert.deepEqual(b.quaternion.toArray(), q.toArray());
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
});
