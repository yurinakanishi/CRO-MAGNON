import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { BEHEMOTH as R, BEHEMOTH_GROUND } from '../dist/shared/behemoth-rules.mjs';
import { createBehemoth } from '../dist/shared/violet-behemoth.mjs';
import { updateEnemies } from '../dist/shared/enemies.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { EventEmitter } from 'node:events';
import { enemyAnimationState, requireEnemyClips, BEHEMOTH_CLIPS } from '../dist/src/enemy-state.js';
function fixture() {
  const collision = new CollisionWorld([], { river: false });
  const e = createBehemoth(collision, [], 1000);
  e.facing = 0;
  const p = {
    id: 'p',
    x: e.x,
    z: e.z + 12,
    radius: 0.76,
    species: 'ape',
    energy: 100,
    inventory: { wood: 7 },
    downedUntil: 0,
    invulnerableUntil: 0,
    facing: Math.PI,
  };
  const room = {
    collision,
    enemies: [e],
    animals: [],
    players: new Map([[p.id, p]]),
    camp: { x: 50, z: 50 },
  };
  return { e, p, room, tick: (now, dt = 0.05) => updateEnemies(room, dt, now) };
}
test('old saves gain the enemy and restored attacks are cancelled without losing health', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    send() {}
    close() {}
  }
  const core = createGameCore();
  core.connect(
    new Socket(),
    new URLSearchParams({ room: 'BEHEMOTH-SAVE', name: 'Test', species: 'ape' }),
  );
  const room = core.rooms.get('BEHEMOTH-SAVE'),
    enemy = room.enemies.find((e) => e.modelKey === R.modelKey);
  enemy.health = 177;
  enemy.pendingAttack = { kind: 'charge', hitIds: [] };
  enemy.targetId = 'old';
  const saved = core.exportState(),
    restored = createGameCore();
  restored.importState(saved);
  const after = restored.rooms.get('BEHEMOTH-SAVE').enemies.find((e) => e.modelKey === R.modelKey);
  assert.equal(after.health, 177);
  assert.equal(after.pendingAttack, null);
  assert.equal(after.targetId, null);
  assert.equal(after.returning, true);
  saved.rooms[0].enemies = saved.rooms[0].enemies.filter((e) => e.modelKey !== R.modelKey);
  const legacy = createGameCore();
  legacy.importState(saved);
  assert.equal(
    legacy.rooms.get('BEHEMOTH-SAVE').enemies.find((e) => e.modelKey === R.modelKey).health,
    R.maxHealth,
  );
});
test('forward vision ignores rear intruders and checks walls', () => {
  const { e, p, room, tick } = fixture();
  p.z = e.z - 8;
  tick(2000);
  assert.equal(e.targetId, null);
  p.z = e.z + 8;
  room.collision = new CollisionWorld(
    [{ id: 'wall', type: 'box', x: e.x, z: e.z + 4, hx: 5, hz: 0.2, c: 1, s: 0, height: 4 }],
    { river: false },
  );
  tick(2050);
  assert.equal(e.targetId, null);
  room.collision = new CollisionWorld([], { river: false });
  tick(2100);
  assert.equal(e.targetId, p.id);
  assert.equal(e.clip, 'Alert');
  assert.equal(e.speed, 0);
});
test('telegraph precedes a fast fixed-heading charge, with one damage event', () => {
  const { e, p, tick } = fixture();
  tick(2000);
  const z = e.z;
  tick(2000 + R.alertMs - 1);
  assert.equal(e.z, z);
  assert.equal(p.energy, 100);
  for (let t = 2000 + R.alertMs; t < 2000 + R.alertMs + R.chargeMs; t += 50) tick(t);
  assert.ok(e.z > z + 6);
  assert.equal(p.energy, 100 - R.chargeDamage);
  assert.equal(p.hurtSequence, 1);
  assert.ok(R.chargeSpeed < 5.4 && R.chargeSpeed > 5);
});
test('great ape sprint can leave territory and monster walks back without further damage', () => {
  const { e, p, room, tick } = fixture();
  tick(2000);
  for (let t = 2050; t < 10000; t += 50) {
    p.z += 5.4 * 0.05;
    tick(t);
    assert.equal(p.energy, 100);
    assert.ok(room.collision.free(e, e.radius));
  }
  assert.equal(e.targetId, null);
  for (let t = 10000; t < 35000; t += 50) tick(t);
  assert.ok(Math.hypot(e.x - e.home.x, e.z - e.home.z) < 0.001);
  assert.equal(e.behavior, 'guard');
});
test('crossing leash cancels even a due bite before impact', () => {
  const { e, p, tick } = fixture();
  e.targetId = p.id;
  e.attackSequence = 1;
  e.attackAt = 2000;
  e.pendingAttack = { kind: 'bite', facing: 0, hitIds: [] };
  p.z = e.home.z + R.territoryRadius + 0.01;
  tick(2500);
  assert.equal(e.pendingAttack, null);
  assert.equal(e.targetId, null);
  assert.equal(p.energy, 100);
});
test('bite has a delayed frontal contact and does not hit a player behind it', () => {
  for (const rear of [false, true]) {
    const { e, p, tick } = fixture();
    e.targetId = p.id;
    e.nextAttackAt = 0;
    p.z = e.z + e.radius + p.radius + 0.1;
    tick(2000);
    assert.equal(e.clip, 'Attack');
    tick(2499);
    assert.equal(p.energy, 100);
    if (rear) p.z = e.z - e.radius - p.radius - 0.1;
    tick(2500);
    tick(2550);
    assert.equal(p.energy, rear ? 100 : 100 - R.biteDamage);
  }
});
test('tail makes a full sweep with at most one hit per player', () => {
  const { e, p, room, tick } = fixture();
  e.targetId = p.id;
  e.meleeIndex = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2,
      peer = {
        ...p,
        id: `p${i}`,
        x: e.x + Math.sin(a) * (R.tailReach + 0.65),
        z: e.z + Math.cos(a) * (R.tailReach + 0.65),
      };
    room.players.set(peer.id, peer);
  }
  p.z = e.z + R.tailReach + 0.65;
  tick(2000);
  assert.equal(e.clip, 'TailSpin');
  for (let t = 2050; t <= 3500; t += 50) tick(t);
  for (const peer of room.players.values()) {
    assert.equal(peer.energy, 100 - R.tailDamage);
    assert.equal(peer.hurtSequence, 1);
  }
});
test('tail rechecks walls and protected players during the sweep', () => {
  const { e, p, room, tick } = fixture();
  e.targetId = p.id;
  e.meleeIndex = 1;
  p.z = e.z + R.tailReach + 0.65;
  tick(2000);
  room.collision = new CollisionWorld(
    [{ id: 'wall', type: 'box', x: e.x, z: e.z + 1.5, hx: 4, hz: 0.1, c: 1, s: 0, height: 4 }],
    { river: false },
  );
  for (let t = 2050; t <= 3500; t += 50) tick(t);
  assert.equal(p.energy, 100);
  room.collision = new CollisionWorld([], { river: false });
  p.invulnerableUntil = 10000;
  tick(4000);
  assert.equal(e.targetId, null);
  assert.equal(p.energy, 100);
});
test('hit interrupts windup and high health survives several ape strikes', () => {
  const { e, p, room, tick } = fixture();
  p.z = e.z + e.radius + p.radius + 0.1;
  tick(2000);
  startAttack(room, p, { targetId: e.id }, 2100);
  resolveAttack(room, p, 2500);
  tick(2500, 0);
  assert.equal(e.health, R.maxHealth - 25);
  assert.equal(e.clip, 'Hit');
  assert.equal(e.pendingAttack, null);
});
test('death and respawn keep original home and wait for occupied spawn', () => {
  const { e, p, tick } = fixture();
  e.health = 0;
  e.alive = false;
  e.phase = 'dead';
  e.phaseStartedAt = 2000;
  tick(3600);
  assert.equal(e.phase, 'respawning');
  Object.assign(p, e.home);
  tick(63600);
  assert.equal(e.phase, 'respawning');
  p.x += 10;
  tick(63650);
  assert.equal(e.phase, 'alive');
  assert.equal(e.health, 300);
  assert.equal(e.x, BEHEMOTH_GROUND.x);
  assert.equal(e.z, BEHEMOTH_GROUND.z);
});
test('extra clips are required only for behemoth and charge seeks after the telegraph', () => {
  requireEnemyClips(
    BEHEMOTH_CLIPS.map((name) => ({ name })),
    R.modelKey,
  );
  assert.throws(
    () =>
      requireEnemyClips(
        BEHEMOTH_CLIPS.filter((n) => n !== 'TailSpin').map((name) => ({ name })),
        R.modelKey,
      ),
    /TailSpin/,
  );
  const state = { modelKey: R.modelKey, phase: 'alive', attackAt: 2000, clip: 'Charge' };
  assert.deepEqual(enemyAnimationState(state, 3000), {
    clip: 'Charge',
    elapsed: (1000 - R.alertMs) / 1000,
  });
});
