import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { walkHeight, riverX, WATER_LEVEL } from '../dist/shared/terrain.mjs';
import { mountainWaterHeight } from '../dist/shared/mountain-river.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import {
  BOT_KINDS,
  ORB_BOTS,
  syncOrbBots,
  updateOrbBots,
  handleOrbBotAction,
  orbBotSnapshots,
  botFlightPosition,
  botThrowPlan,
  canHandleBot,
  botGroundHeight,
  botHandPosition,
  nextOrbBot,
  posingOrbBot,
} from '../dist/shared/orb-bots.mjs';
import { OrbBotPose } from '../dist/src/orb-bot-pose.js';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';

function fixture(obstacles = []) {
  const p = {
    id: 'p',
    x: 50,
    z: 50,
    facing: 0,
    radius: 0.32,
    species: 'cro',
    gender: 'female',
    speed: 0,
    energy: 100,
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  const collision = new CollisionWorld(obstacles, { coast: false, river: false, walkSurfaces: [] });
  const room = { collision, players: new Map([[p.id, p]]) };
  syncOrbBots(room, 10000);
  return { p, room, b: room.orbBots[0] };
}
function advance(room, start, seconds, move) {
  for (let t = 0.05; t < seconds + 0.025; t += 0.05) {
    move?.(t);
    updateOrbBots(room, 0.05, start + t * 1000);
    for (const b of room.orbBots) {
      assert.ok([b.x, b.y, b.z].every(Number.isFinite));
      if (!['windup', 'stowed', 'airborne'].includes(b.mode))
        assert.ok(room.collision.free(b, ORB_BOTS.radius), `unsafe ${b.kind} ${b.mode}`);
    }
  }
}
function throwOne(f, kind = 'white', now = 10000) {
  assert.equal(handleOrbBotAction(f.room, f.p, 'throwBot', kind, now + 500), true);
  return f.room.orbBots.find((b) => b.kind === kind);
}

test('nine distinct owned bots per player; disconnection and reconnect remove every old projectile', () => {
  assert.deepEqual(BOT_KINDS, [
    'white',
    'blue',
    'green',
    'purple',
    'orange',
    'beret',
    'frog',
    'triangle',
    'heart',
  ]);
  const f = fixture();
  for (const b of f.room.orbBots) {
    assert.ok(
      Math.hypot(b.x - f.p.x, b.z - f.p.z) < ORB_BOTS.pickupRange,
      `${b.kind} is reachable from the formation`,
    );
    for (const other of f.room.orbBots.filter((entry) => entry.id !== b.id))
      assert.ok(
        Math.hypot(b.x - other.x, b.z - other.z) >= ORB_BOTS.diameter,
        'The two rows do not overlap',
      );
  }
  for (let i = 1; i < 5; i++) f.room.players.set(`p${i}`, { ...f.p, id: `p${i}`, x: 50 + i * 2 });
  syncOrbBots(f.room, 10001);
  syncOrbBots(f.room, 10002);
  assert.equal(f.room.orbBots.length, 45);
  assert.equal(new Set(f.room.orbBots.map((b) => b.id)).size, 45);
  throwOne(f);
  f.room.players.delete('p');
  syncOrbBots(f.room, 11000);
  assert.equal(f.room.orbBots.length, 36);
  f.room.players.set('p', f.p);
  syncOrbBots(f.room, 12000);
  assert.deepEqual(
    f.room.orbBots.filter((b) => b.ownerId === 'p').map((b) => b.kind),
    BOT_KINDS,
  );
  assert.ok(f.room.orbBots.every((b) => b.sequence === 0));
  assert.ok(orbBotSnapshots(f.room).every((b) => !('path' in b) && !('lastOwner' in b)));
});

test('one command throws each kind from the hand; it stays at the landing until recalled', () => {
  for (const kind of BOT_KINDS) {
    const f = fixture(),
      b = throwOne(f, kind);
    assert.equal(b.mode, 'windup');
    assert.equal(handleOrbBotAction(f.room, f.p, 'holdBot', 'blue', 10550), false);
    updateOrbBots(f.room, 0.05, 10760);
    assert.equal(b.mode, 'airborne');
    const first = botFlightPosition(b, 10760),
      middle = botFlightPosition(b, 11210),
      last = botFlightPosition(b, 11660);
    assert.ok(Math.abs(first.y - b.origin.y) < 1e-6);
    assert.ok(middle.y > Math.max(first.y, last.y) + 1);
    assert.ok(Math.abs(last.y - walkHeight(last.x, last.z)) < 1e-6);
    advance(f.room, 10760, 8);
    assert.equal(b.mode, 'waiting');
    assert.equal(b.sequence, 1);
    assert.equal(b.x, b.landing.x);
    assert.equal(b.z, b.landing.z);
    const landed = [b.x, b.y, b.z];
    advance(f.room, 18760, 30);
    assert.deepEqual([b.x, b.y, b.z], landed);
    handleOrbBotAction(f.room, f.p, 'recallBots', null, 48760);
    advance(f.room, 48760, 8);
    assert.equal(b.mode, 'following');
    assert.ok(Math.hypot(b.x - f.p.x, b.z - f.p.z) < ORB_BOTS.pickupRange);
  }
});

test('nine quick presses reserve nine distinct bots, throw in order, and never auto-repeat', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) {
    assert.equal(handleOrbBotAction(f.room, f.p, 'throwBot', 'white', 10000 + i * 20), true);
  }
  assert.equal(handleOrbBotAction(f.room, f.p, 'throwBot', 'white', 10180), false);
  assert.equal(f.room.orbBots.filter((b) => b.mode === 'windup').length, 1);
  assert.equal(f.room.orbBots.filter((b) => b.mode === 'queued').length, 8);
  const releases = [];
  advance(f.room, 10200, 8, () => {
    const windup = f.room.orbBots.filter((b) => b.mode === 'windup');
    assert.ok(windup.length <= 1, 'only one bot occupies the throwing hand');
    for (const b of f.room.orbBots) {
      if (b.mode === 'airborne' && !releases.includes(b.kind)) releases.push(b.kind);
    }
  });
  assert.deepEqual(releases, BOT_KINDS);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'waiting' && b.sequence === 1));
  for (const b of f.room.orbBots)
    for (const other of f.room.orbBots) {
      if (b !== other) assert.ok(Math.hypot(b.x - other.x, b.z - other.z) >= ORB_BOTS.diameter);
    }
  assert.equal(nextOrbBot(f.room.orbBots, f.p), undefined);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 18200);
  advance(f.room, 18200, 10);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'following' && b.sequence === 1));
  assert.equal(nextOrbBot(f.room.orbBots, f.p)?.kind, 'white');
});

test('waiting bots stay put when their owner walks away, warps, mounts, or respawns', () => {
  const f = fixture(),
    b = throwOne(f);
  advance(f.room, 10500, 3);
  const landed = [b.x, b.y, b.z];
  advance(f.room, 13500, 12, (t) => {
    f.p.x = 50 + 6 * t;
  });
  assert.equal(b.mode, 'waiting');
  assert.deepEqual([b.x, b.y, b.z], landed);
  for (const patch of [
    { x: 160, warpSequence: 1 },
    { mountId: 'm' },
    { mountId: null, boatId: 'boat' },
    { boatId: null, downedUntil: 40000 },
    { downedUntil: 0, x: 50, z: 50, warpSequence: 2 },
  ]) {
    Object.assign(f.p, patch);
    advance(f.room, 26000, 1);
    assert.equal(b.mode, 'waiting');
    assert.deepEqual([b.x, b.y, b.z], landed);
  }
  // Walking up to a deployed bot does not silently return it to the throwing queue.
  Object.assign(f.p, { x: b.x, z: b.z });
  assert.notEqual(nextOrbBot(f.room.orbBots, f.p)?.id, b.id);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 28000);
  advance(f.room, 28000, 8);
  assert.equal(b.mode, 'following');
});

test("recall and interruption cancel pending throws without summoning another owner's bots", () => {
  for (const action of ['recallBots', 'cancelBotThrows', 'attack']) {
    const f = fixture();
    const other = { ...f.p, id: 'other', x: 55 };
    f.room.players.set(other.id, other);
    syncOrbBots(f.room, 10000);
    handleOrbBotAction(f.room, other, 'throwBot', 'heart', 10000);
    updateOrbBots(f.room, 0.05, 10300);
    for (let i = 0; i < 4; i++) handleOrbBotAction(f.room, f.p, 'throwBot', 'white', 10300 + i);
    if (action === 'attack') {
      Object.assign(f.p, { attackAt: 10310, attackSequence: 1 });
      updateOrbBots(f.room, 0.05, 10310);
    } else handleOrbBotAction(f.room, f.p, action, null, 10310);
    advance(f.room, 10310, 8);
    assert.ok(
      f.room.orbBots.filter((b) => b.ownerId === f.p.id).every((b) => b.mode === 'following'),
    );
    assert.equal(
      f.room.orbBots.find((b) => b.ownerId === other.id && b.kind === 'heart').mode,
      'waiting',
    );
  }
});

test('the current windup takes arm priority over an earlier airborne bot', () => {
  const f = fixture();
  throwOne(f);
  updateOrbBots(f.room, 0.05, 10760);
  handleOrbBotAction(f.room, f.p, 'throwBot', 'blue', 10860);
  assert.equal(posingOrbBot(f.room.orbBots, f.p.id, 10870)?.kind, 'blue');
});

test('foreign IDs, unavailable actions, and grabbing through walls are rejected', () => {
  const f = fixture();
  assert.equal(handleOrbBotAction(f.room, f.p, 'throwBot', 'orb:foreign:white', 10000), false);
  for (const patch of [
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'q' },
    { passengerId: 'q' },
    { downedUntil: 20000 },
    { fishing: {} },
    { coastalActivity: {} },
    { cookingEndsAt: 20000 },
    { jumpSequence: 1, jumpAt: 10000 },
    { attackSequence: 1, attackAt: 10000 },
  ])
    assert.equal(canHandleBot({ ...f.p, ...patch }, 10010), false, JSON.stringify(patch));
  const g = fixture([{ id: 'wall', type: 'circle', x: 50, z: 49.4, radius: 0.45 }]);
  g.b.x = 50;
  g.b.z = 48.8;
  for (const bot of g.room.orbBots) {
    bot.x = 50;
    bot.z = 48.8;
  }
  assert.equal(handleOrbBotAction(g.room, g.p, 'throwBot', 'white', 10000), false);
});

test('recall during flight preserves the landing and returns; attack cancels the windup', () => {
  const f = fixture(),
    b = throwOne(f);
  updateOrbBots(f.room, 0.05, 10900);
  const origin = { ...b.origin };
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 11000);
  assert.equal(b.mode, 'airborne');
  assert.deepEqual(b.origin, origin);
  const landedAt = b.throwAt + ORB_BOTS.windupMs + ORB_BOTS.flightMs;
  updateOrbBots(f.room, 0.05, landedAt);
  assert.equal(b.mode, 'landing');
  handleOrbBotAction(f.room, f.p, 'recallBots', null, landedAt + 150);
  updateOrbBots(f.room, 0.15, landedAt + 150);
  assert.equal(b.mode, 'landing', 'recall must not skip the visible landing clip');
  updateOrbBots(f.room, 0.15, landedAt + ORB_BOTS.landMs - 1);
  assert.equal(b.mode, 'landing');
  advance(f.room, landedAt + ORB_BOTS.landMs, 8);
  assert.equal(b.mode, 'following');
  handleOrbBotAction(f.room, f.p, 'throwBot', 'white', 20000);
  f.p.attackAt = 20001;
  f.p.attackSequence = 1;
  updateOrbBots(f.room, 0.05, 20002);
  assert.equal(b.mode, 'returning');
});

test('flight and return paths stop before walls, and release is rechecked after turning', () => {
  const f = fixture([{ id: 'wall', type: 'circle', x: 50, z: 53, radius: 1 }]);
  const plan = botThrowPlan(f.p, f.room.collision);
  assert.ok(plan && plan.landing.z < 52);
  assert.ok(f.room.collision.segmentFree(plan.origin, plan.landing, ORB_BOTS.radius));
  const b = throwOne(f);
  f.p.facing = Math.PI / 2;
  updateOrbBots(f.room, 0.05, 10760);
  assert.ok(b.landing.x > 57 && Math.abs(b.landing.z - 50) < 0.01);
  advance(f.room, 10760, 8);
  assert.equal(b.mode, 'waiting');
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 18760);
  advance(f.room, 18760, 8);
  assert.equal(b.mode, 'following');
});

test('bots catch a sprinting ape and recover from a warp, mount and respawn', () => {
  const f = fixture();
  f.p.species = 'ape';
  f.p.gender = 'male';
  f.p.speed = 6.4;
  throwOne(f);
  updateOrbBots(f.room, 0.05, 10760);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 11500);
  advance(f.room, 11500, 6, (t) => {
    f.p.x = 50 + t * 6.4;
  });
  f.p.speed = 0;
  advance(f.room, 17500, 7);
  assert.ok(f.room.orbBots.every((b) => Math.hypot(b.x - f.p.x, b.z - f.p.z) < 3));
  f.p.warpSequence = 1;
  f.p.x = 120;
  updateOrbBots(f.room, 0.05, 25000);
  assert.ok(f.room.orbBots.every((b) => Math.hypot(b.x - f.p.x, b.z - f.p.z) < 3));
  f.p.mountId = 'm';
  updateOrbBots(f.room, 0.05, 25050);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'stowed'));
  f.p.mountId = null;
  updateOrbBots(f.room, 0.05, 25100);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'following'));
});

test('ground return routes around a new obstacle without crossing it', () => {
  const f = fixture();
  const b = throwOne(f);
  updateOrbBots(f.room, 0.05, 11660);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 11661);
  f.room.collision = new CollisionWorld(
    [{ id: 'new-rock', type: 'circle', x: 50, z: 54, radius: 1 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  advance(f.room, 11660, 12);
  assert.equal(b.mode, 'following');
});

test('bots stay visible above lake and river water and return along the real lake bed', () => {
  assert.ok(botGroundHeight(-75, 320) >= mountainWaterHeight(-75, 320) - 0.061);
  assert.ok(botGroundHeight(riverX(50), 50) >= WATER_LEVEL - 0.061);
  assert.equal(botGroundHeight(50, 50), walkHeight(50, 50));
  const f = fixture();
  Object.assign(f.p, { x: -75, z: 320, warpSequence: 1 });
  f.room.collision = new CollisionWorld([]);
  updateOrbBots(f.room, 0.05, 10000);
  const b = throwOne(f);
  updateOrbBots(f.room, 0.05, 11660);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 11661);
  advance(f.room, 11661, 12);
  assert.equal(b.mode, 'following');
  assert.ok(b.y >= mountainWaterHeight(b.x, b.z) - 0.061);
});

test('all nine delivered rigs draw back, release from the hand, call, and restore every bone', async () => {
  for (const model of CHARACTER_MODELS) {
    const gltf = await loadMotion(await deliveredModel(model.key));
    const parent = new THREE.Group();
    parent.add(gltf.scene);
    const original = [];
    gltf.scene.traverse((n) => {
      if (n.isBone) original.push([n, n.position.clone(), n.quaternion.clone(), n.scale.clone()]);
    });
    const pose = new OrbBotPose(gltf.scene);
    const p = { ...fixture().p, species: model.species, gender: model.gender, x: 0, z: 0 };
    const bot = { mode: 'windup', phaseAt: 10000, throwAt: 10000 };
    pose.update(bot, p, 10130, parent);
    assert.equal(pose.weight, 1, model.key);
    assert.ok(
      pose.contact.distanceTo(pose.requested) < 0.001,
      `${model.key}: hand misses target by ${pose.contact.distanceTo(pose.requested)}`,
    );
    for (let i = 0; i <= 26; i++) {
      pose.update({ ...bot, mode: 'windup', throwAt: 11000 }, p, 11000 + i * 10, parent);
      assert.ok(pose.contact.toArray().every(Number.isFinite));
      if (i * 10 >= ORB_BOTS.pickupMs)
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.001,
          `${model.key}: windup hand leaves shared release path`,
        );
    }
    pose.restore();
    for (const [n, v, q, s] of original) {
      assert.ok(n.position.distanceTo(v) < 1e-9);
      assert.deepEqual(n.quaternion.toArray(), q.toArray());
      assert.ok(n.scale.distanceTo(s) < 1e-9);
    }
    // Carrying is allowed while walking. Shoulder sway and the character's
    // original animated torso must not pull the hand away from the bot.
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const name of ['Idle_Loop', 'Walk_Loop', 'Run_Loop']) {
      const clip = gltf.animations.find((clip) => clip.name === name);
      const action = mixer.clipAction(clip).play();
      for (let frame = 0; frame < 12; frame++) {
        pose.restore();
        action.time = (frame / 12) * clip.duration;
        mixer.update(0);
        parent.rotation.y = frame * 0.37;
        parent.updateMatrixWorld(true);
        const before = original.map(([n]) => n.quaternion.toArray());
        pose.update(bot, p, 10200, parent);
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.001,
          `${model.key}/${name}: moving hand leaves the bot`,
        );
        pose.update({ ...bot, mode: 'airborne' }, p, 10260, parent);
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.001,
          `${model.key}/${name}: animated shoulder moves the release off the hand`,
        );
        pose.restore();
        original.forEach(([n], i) => assert.deepEqual(n.quaternion.toArray(), before[i]));
      }
      mixer.stopAllAction();
    }
    parent.rotation.y = 0;
    parent.updateMatrixWorld(true);
    pose.update(bot, p, 10140, parent);
    const drawn = pose.contact.clone();
    pose.update({ ...bot, mode: 'airborne' }, p, 10260, parent);
    const release = botHandPosition(p, 0);
    assert.ok(
      pose.contact.distanceTo(new THREE.Vector3(release.x, release.y, release.z)) < 0.001,
      `${model.key}: release must start at the hand`,
    );
    const armLength =
      original.find(([n]) => n.name === 'LowerArmL')[1].length() +
      original.find(([n]) => n.name === 'HandL')[1].length();
    assert.ok(
      pose.contact.distanceTo(drawn) > armLength * 0.55,
      `${model.key}: throw needs a visible arm swing`,
    );
    // A second throw must begin from the preceding follow-through, not snap to idle.
    pose.update({ ...bot, mode: 'airborne' }, p, 10360, parent);
    const beforeVolley = pose.contact.clone();
    pose.update({ ...bot, throwAt: 10360 }, p, 10360, parent);
    assert.ok(pose.contact.distanceTo(beforeVolley) < 1e-8, `${model.key}: volley snaps`);
    pose.update({ ...bot, throwAt: 10360 }, p, 10490, parent);
    assert.equal(pose.weight, 1);
    pose.restore();
    const calling = { ...bot, mode: 'following', recallAt: 12000 };
    for (const t of [180, 350, 560, 700]) {
      pose.update(calling, p, 12000 + t, parent);
      assert.equal(pose.gesture, 'call');
      assert.ok(
        pose.contact.distanceTo(pose.requested) < 0.015,
        `${model.key}: calling hand cannot reach face (${pose.contact.distanceTo(pose.requested)})`,
      );
      const head = gltf.scene.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
      assert.ok(
        pose.contact.distanceTo(head) < armLength * 0.6 + 0.02,
        `${model.key}: calling hand must be beside the face`,
      );
    }
    pose.update(calling, p, 12000 + ORB_BOTS.callMs, parent);
    assert.equal(pose.weight, 0);
    assert.equal(pose.gesture, null);
    for (const [n, v, q, s] of original) {
      assert.ok(n.position.distanceTo(v) < 1e-9);
      assert.deepEqual(n.quaternion.toArray(), q.toArray());
      assert.ok(n.scale.distanceTo(s) < 1e-9);
    }
    for (const unavailable of [
      { attackAt: 12100, attackSequence: 1 },
      { downedUntil: 14000 },
      { mountId: 'm' },
      { jumpAt: 12100, jumpSequence: 1 },
    ]) {
      pose.update(calling, { ...p, ...unavailable }, 12300, parent);
      assert.equal(pose.weight, 0, `${model.key}: conflicting animation`);
    }
  }
});

test('call gesture uses a shared timestamp, expires, and is cancelled by a new throw or other action', () => {
  const f = fixture();
  const other = { ...f.p, id: 'other' };
  f.room.players.set(other.id, other);
  syncOrbBots(f.room, 10000);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 12000);
  const called = orbBotSnapshots(f.room);
  assert.ok(called.filter((b) => b.ownerId === f.p.id).every((b) => b.recallAt === 12000));
  assert.ok(called.filter((b) => b.ownerId === other.id).every((b) => !b.recallAt));
  assert.equal(posingOrbBot(called, f.p.id, 11999), undefined);
  assert.equal(posingOrbBot(called, f.p.id, 12350)?.recallAt, 12000);
  assert.equal(posingOrbBot(called, f.p.id, 12000 + ORB_BOTS.callMs), undefined);
  handleOrbBotAction(f.room, f.p, 'throwBot', 'white', 12400);
  assert.ok(f.room.orbBots.every((b) => !b.recallAt));
  assert.equal(posingOrbBot(f.room.orbBots, f.p.id, 12410)?.mode, 'windup');
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 12500);
  handleOrbBotAction(f.room, f.p, 'cancelBotThrows', null, 12550);
  assert.equal(posingOrbBot(f.room.orbBots, f.p.id, 12600), undefined);
  handleOrbBotAction(f.room, f.p, 'recallBots', null, 12700);
  f.p.attackAt = 12800;
  f.p.attackSequence = 1;
  updateOrbBots(f.room, 0.05, 12800);
  assert.ok(f.room.orbBots.every((b) => !b.recallAt));
});

test('five real command connections share throws, reject a sixth, and preserve player saves', () => {
  let now = 10000,
    id = 0;
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    ping() {
      this.emit('pong');
    }
    send(data) {
      this.messages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const core = createGameCore({
    runtime: { now: () => now, id: () => `bot-${++id}`, token: () => `bot-token-${++id}` },
    keepEmptyRooms: true,
    persistentSessions: true,
  });
  const sockets = Array.from({ length: 5 }, () => new Socket());
  for (const socket of sockets) core.connect(socket, new URLSearchParams({ room: 'BOTS-QA' }));
  now += 50;
  core.tick();
  const room = core.rooms.get('BOTS-QA');
  assert.equal(room.players.size, 5);
  assert.equal(room.orbBots.length, 45);
  const sixth = new Socket();
  core.connect(sixth, new URLSearchParams({ room: 'BOTS-QA' }));
  assert.equal(room.players.size, 5);
  const p = [...room.players.values()][0];
  Object.assign(p, { x: 50, z: 50, facing: 0, moving: false, speed: 0 });
  now += 500;
  core.tick();
  // Let the newly joined bots settle at the real camp before grabbing them.
  for (let i = 0; i < 100; i++) {
    now += 50;
    core.tick();
  }
  const before = structuredClone(p.inventory);
  const send = (action) =>
    sockets[0].emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action, targetId: 'green' })),
      false,
    );
  now += 500;
  send('throwBot');
  assert.equal(room.orbBots.filter((b) => b.mode === 'windup').length, 1);
  for (let i = 0; i < 8; i++) {
    now += 10;
    send('throwBot');
  }
  assert.equal(
    room.orbBots.filter((b) => b.mode === 'queued').length,
    8,
    'rapid commands bypass the unrelated 450 ms action gate',
  );
  const states = sockets.map((s) => s.messages.filter((m) => m.type === 'state').at(-1));
  assert.ok(states.every((s) => JSON.stringify(s.orbBots) === JSON.stringify(states[0].orbBots)));
  for (let i = 0; i < 160; i++) {
    now += 50;
    core.tick();
  }
  const bot = room.orbBots.find((b) => b.ownerId === p.id && b.kind === 'green');
  assert.equal(bot.mode, 'waiting');
  assert.ok(room.orbBots.filter((b) => b.ownerId === p.id).every((b) => b.mode === 'waiting'));
  send('recallBots');
  const calls = sockets.map((s) =>
    s.messages
      .filter((m) => m.type === 'state')
      .at(-1)
      .orbBots.filter((b) => b.ownerId === p.id)
      .map((b) => b.recallAt),
  );
  assert.ok(calls.every((times) => times.length === 9 && times.every((at) => at === now)));
  for (let i = 0; i < 160; i++) {
    now += 50;
    core.tick();
  }
  assert.equal(bot.mode, 'following');
  assert.deepEqual(p.inventory, before);
  const saved = core.exportState();
  assert.ok(!('orbBots' in saved.rooms[0]));
  const restored = createGameCore({
    runtime: { now: () => now, id: () => `next-${++id}`, token: () => `next-token-${++id}` },
  });
  restored.importState(saved);
  assert.equal(restored.rooms.get('BOTS-QA').orbBots?.length ?? 0, 0);
  sockets[0].close();
  now += 50;
  core.tick();
  assert.equal(room.orbBots.length, 36);
});
