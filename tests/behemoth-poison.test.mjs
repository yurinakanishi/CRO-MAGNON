import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { BEHEMOTH as R } from '../dist/shared/behemoth-rules.mjs';
import { createBehemoth, updateBehemoths } from '../dist/shared/violet-behemoth.mjs';
import { poisonPoint, launchPoison, updatePoison } from '../dist/shared/behemoth-poison.mjs';
import { projectileHeight } from '../dist/shared/terrain.mjs';
import { enemyAnimationState } from '../dist/src/enemy-state.js';
import { PoisonEffects } from '../dist/src/poison-effects.js';
import { createGameCore } from '../dist/application/game-core.mjs';
import { snapshot } from '../dist/application/snapshot.mjs';
import { EventEmitter } from 'node:events';

function fixture() {
  const collision = new CollisionWorld([], { river: false }),
    e = createBehemoth(collision, [], 0);
  const p = { id: 'p', x: e.x, z: e.z + 18, radius: 0.5, energy: 100, species: 'cro' };
  Object.assign(e, { facing: 0, targetId: 'p', aggroAfter: 0 });
  const room = {
    collision,
    enemies: [e],
    players: new Map([[p.id, p]]),
    animals: [],
    camp: { x: 50, z: 50 },
  };
  const hits = [],
    damage = (_e, p, at, amount) => {
      hits.push({ at, amount, id: p.id });
      p.energy -= amount;
    };
  const tick = (now, dt = 0.05) => updateBehemoths(room, dt, now, damage);
  return { e, p, room, hits, damage, tick };
}
test('poison has its own grounded telegraph and releases once on the authoritative clock', () => {
  const { e, room, tick } = fixture();
  tick(1000);
  assert.equal(e.clip, 'SpitWindup');
  const start = { x: e.x, z: e.z };
  tick(1000 + R.spitWindupMs - 1);
  assert.deepEqual({ x: e.x, z: e.z }, start);
  assert.equal(room.poisonShots.length, 0);
  tick(1000 + R.spitWindupMs);
  assert.equal(e.clip, 'Spit');
  assert.equal(room.poisonShots.length, 0);
  tick(1000 + R.spitWindupMs + R.spitReleaseMs);
  assert.equal(room.poisonShots.length, 1);
  const shot = room.poisonShots[0];
  assert.equal(shot.createdAt, 1000 + R.spitWindupMs + R.spitReleaseMs);
  assert.ok(Math.abs(shot.originZ - e.z - R.mouthForward * e.scale) < 1e-9);
  assert.deepEqual(enemyAnimationState(e, 1000 + R.spitWindupMs + 240), {
    clip: 'Spit',
    elapsed: 0.3,
  });
  tick(1000 + R.spitWindupMs + R.spitReleaseMs + 10);
  assert.equal(room.poisonShots.length, 1);
});
test('liquid hits once, while a side step after aim lock avoids the whole shot', () => {
  for (const dodge of [false, true]) {
    const { p, room, hits, tick } = fixture();
    tick(1000);
    tick(1800);
    if (dodge) p.x += 4;
    let splashed = false;
    for (let now = 1950; now <= 3900; now += 25) {
      tick(now, 0.025);
      splashed ||= room.poisonSplashes.length > 0;
    }
    assert.equal(hits.length, dodge ? 0 : 1);
    if (!dodge) assert.equal(p.energy, 100 - R.spitDamage);
    assert.equal(room.poisonShots.length, 0);
    assert.ok(splashed, 'Ground and actor impacts both splash');
  }
});
test('delayed ticks sweep liquid through a target instead of tunnelling', () => {
  const { e, p, room, damage, hits } = fixture();
  launchPoison(room, e, { x: p.x, z: p.z, y: projectileHeight(p.x, p.z) + 0.85 }, 1000);
  updatePoison(room, 2500, damage, () => true);
  assert.equal(hits.length, 1);
  assert.equal(room.poisonShots.length, 0);
});

test('the wider splash hits nearby players once, with walls, elevation and protection respected', () => {
  const { e, p, room, tick, hits } = fixture();
  for (const [id, dx, dz, extra] of [
    ['near', 2, 0, {}],
    ['far', 5, 0, {}],
    ['protected', -2, 0, { invulnerableUntil: 10000 }],
    ['wall', -2, 0, {}],
    ['upstairs', 1, 0, {}],
  ])
    room.players.set(id, { ...p, id, x: p.x + dx, z: p.z + dz, ...extra });
  room.collision = new CollisionWorld(
    [{ id: 'screen', type: 'box', x: p.x - 1, z: p.z, hx: 0.1, hz: 3, c: 1, s: 0, height: 4 }],
    { river: false },
  );
  room.collision.surfaceHeight = (a) => (a.id === 'upstairs' ? 4 : 0);
  tick(1000);
  for (let t = 1050; t <= 3500; t += 25) tick(t, 0.025);
  assert.deepEqual(hits.map((h) => h.id).sort(), ['near', 'p']);
  assert.equal(p.energy, 100 - R.spitDamage, 'direct hit is not applied twice');
});
test('poison reaches a player 28 metres away and its splash renders at its damage radius', () => {
  const { p, room, tick, hits } = fixture();
  p.z += 10;
  tick(1000);
  let splash;
  for (let t = 1050; t <= 3800; t += 25) {
    tick(t, 0.025);
    splash ??= room.poisonSplashes[0];
  }
  assert.equal(hits.length, 1);
  assert.equal(splash.radius, R.spitSplashRadius);
  const fx = new PoisonEffects(new THREE.Scene());
  fx.update({ poisonSplashes: [splash] }, splash.at + 250, 900);
  let reach = 0;
  for (let i = 0; i < 36; i++)
    reach = Math.max(reach, Math.hypot(fx.xyz[i * 3] - splash.x, fx.xyz[i * 3 + 2] - splash.z));
  assert.ok(reach > R.spitSplashRadius * 0.96 && reach < R.spitSplashRadius + 0.01);
  fx.dispose();
});
test('walls block poison; death, interruption and leaving the territory cancel it', () => {
  for (const mode of ['wall', 'death', 'interrupt', 'leave']) {
    const { e, p, room, hits, tick } = fixture();
    tick(1000);
    tick(1600);
    if (mode === 'interrupt') e.hitUntil = 3000;
    if (mode === 'leave') p.z = e.home.z + R.territoryRadius + 1;
    if (mode === 'death') e.phase = 'dead';
    if (mode === 'wall')
      room.collision = new CollisionWorld(
        [{ id: 'block', type: 'box', x: e.x, z: e.z + 9, hx: 4, hz: 0.2, c: 1, s: 0, height: 10 }],
        { river: false },
      );
    for (let now = 1650; now <= 4000; now += 50) tick(now);
    assert.equal(hits.length, 0, mode);
    assert.equal(room.poisonShots.length, 0, mode);
  }
});
test('poison is bounded by cooldown and cannot hit protected or elevated players', () => {
  const { e, p, room, hits, tick } = fixture();
  tick(1000);
  const next = e.nextSpitAt;
  assert.equal(next, 1000 + R.spitCooldownMs);
  for (let now = 1050; now < 3200; now += 50) {
    p.invulnerableUntil = 10000;
    tick(now);
  }
  assert.equal(hits.length, 0);
  assert.equal(room.poisonShots.length, 0);
  const other = fixture();
  other.room.collision.surfaceHeight = () => 8;
  launchPoison(
    other.room,
    other.e,
    { x: other.p.x, z: other.p.z, y: projectileHeight(other.p.x, other.p.z) + 0.85 },
    1000,
  );
  updatePoison(other.room, 2500, other.damage, () => true);
  assert.equal(other.hits.length, 0, 'High floor cannot be hit by a low ballistic path');
});
test('ballistics have constant downward acceleration and rendering samples a late shot in place', () => {
  const { e, p, room } = fixture();
  launchPoison(room, e, { x: p.x, z: p.z, y: projectileHeight(p.x, p.z) + 0.85 }, 1000);
  const shot = room.poisonShots[0],
    a = poisonPoint(shot, 0.2),
    b = poisonPoint(shot, 0.3),
    c = poisonPoint(shot, 0.4);
  assert.ok(Math.abs(c.y - 2 * b.y + a.y + R.spitGravity * 0.01) < 1e-9);
  const scene = new THREE.Scene(),
    fx = new PoisonEffects(scene);
  shot.updatedAt = 1500;
  Object.assign(shot, poisonPoint(shot, 0.5));
  const before = structuredClone(shot);
  fx.update(room, 1500, 900);
  assert.deepEqual(shot, before);
  assert.ok(
    new THREE.Vector3(...fx.xyz.slice(0, 3)).distanceTo(new THREE.Vector3(shot.x, shot.y, shot.z)) <
      1e-5,
  );
  assert.ok(fx.count > 10);
  assert.equal(fx.material.blending, THREE.NormalBlending);
  fx.update({ poisonShots: [], poisonSplashes: [] }, 1600, 900);
  assert.equal(fx.count, 0);
  fx.dispose();
  assert.equal(scene.children.length, 0);
});

test('late joins receive the ballistic clock, while disk restore discards in-flight poison', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    send() {}
    close() {}
  }
  const core = createGameCore();
  core.connect(
    new Socket(),
    new URLSearchParams({ room: 'POISON-SAVE', name: 'Check', species: 'cro' }),
  );
  const room = core.rooms.get('POISON-SAVE'),
    e = room.enemies.find((e) => e.modelKey === R.modelKey);
  e.facing = 0;
  launchPoison(room, e, { x: e.x, z: e.z + 18, y: projectileHeight(e.x, e.z + 18) + 0.85 }, 1000);
  const state = snapshot(room, false, 1300);
  assert.equal(state.poisonShots.length, 1);
  assert.equal(state.poisonShots[0].createdAt, 1000);
  assert.notEqual(state.poisonShots[0], room.poisonShots[0]);
  e.pendingAttack = { kind: 'poison', aim: { x: 0, z: 0, y: 0 } };
  const restored = createGameCore();
  restored.importState(core.exportState());
  const after = restored.rooms.get('POISON-SAVE');
  assert.equal(after.enemies.find((enemy) => enemy.id === e.id).pendingAttack, null);
  assert.equal(after.poisonShots?.length ?? 0, 0);
});
