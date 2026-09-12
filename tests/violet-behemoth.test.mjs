import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  BEHEMOTH as R,
  BEHEMOTH_GROUND,
  BEHEMOTH_CLIP_TIMING,
} from '../dist/shared/behemoth-rules.mjs';
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
  assert.equal(e.targetId, null, 'standing still behind it is not heard');
  p.moving = true;
  tick(2010);
  assert.equal(e.targetId, p.id, 'walking footsteps eight metres behind are heard');
  e.targetId = null;
  e.returning = false;
  e.behavior = 'guard';
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.aggroAfter = 0;
  e.facing = 0;
  p.z = e.z - 15;
  tick(2020);
  assert.equal(e.targetId, null, 'walking fifteen metres behind is not heard');
  p.running = true;
  tick(2030);
  assert.equal(e.targetId, p.id, 'running fifteen metres behind is heard');
  e.targetId = null;
  e.returning = false;
  e.behavior = 'guard';
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.aggroAfter = 0;
  e.facing = 0;
  p.moving = false;
  p.running = false;
  p.z = e.z - 8;
  tick(2040);
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
  assert.equal(e.clip, 'Roar');
  assert.equal(e.behavior, 'roar');
  assert.equal(e.speed, 0);
});
test('a roar precedes a fast fixed-heading charge, with one damage event', () => {
  const { e, p, tick } = fixture();
  tick(2000);
  const z = e.z;
  tick(2000 + R.roarMs - 1);
  assert.equal(e.z, z, 'the body stays put through the whole roar');
  assert.equal(e.clip, 'Roar');
  assert.equal(p.energy, 100);
  for (let t = 2000 + R.roarMs; t < 2000 + R.roarMs + R.chargeMs; t += 50) tick(t);
  // The 5.25 m body meets the player after about six metres and stops there.
  assert.ok(e.z > z + 4);
  assert.equal(p.energy, 100 - R.chargeDamage);
  assert.equal(p.hurtSequence, 1);
  assert.ok(
    R.chargeSpeed > 6.4,
    'even the ape must evade the faster charge or leave the territory',
  );
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
    assert.equal(e.clip, 'Gape', 'the open mouth announces the bite');
    assert.equal(e.behavior, 'gape');
    tick(2000 + R.gapeMs);
    assert.equal(e.clip, 'Attack');
    tick(2000 + R.gapeMs + R.biteImpactMs - 1);
    assert.equal(p.energy, 100);
    if (rear) p.z = e.z - e.radius - p.radius - 0.1;
    tick(2000 + R.gapeMs + R.biteImpactMs);
    tick(2000 + R.gapeMs + R.biteImpactMs + 50);
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
  assert.equal(e.clip, 'Tremble', 'the shudder announces the tail spin');
  tick(2000 + R.trembleMs - 1);
  assert.equal(e.clip, 'Tremble');
  for (const peer of room.players.values()) assert.equal(peer.energy, 100);
  tick(2000 + R.trembleMs);
  assert.equal(e.clip, 'TailSpin');
  for (let t = 2050 + R.trembleMs; t <= 2000 + R.trembleMs + R.spinMs + 100; t += 50) tick(t);
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
  for (let t = 2050; t <= 2000 + R.trembleMs + R.spinMs + 100; t += 50) tick(t);
  assert.equal(p.energy, 100);
  room.collision = new CollisionWorld([], { river: false });
  p.invulnerableUntil = 10000;
  tick(5000);
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
  assert.deepEqual(enemyAnimationState(state, 3500), {
    clip: 'Charge',
    elapsed: (((1500 - R.roarMs) / 1000) * 2400) / R.chargeMs,
  });
  // Each telegraph clip starts at the attack; its strike clip starts when it ends.
  for (const [clip, offset] of [
    ['Roar', 0],
    ['Gape', 0],
    ['Tremble', 0],
    ['Attack', R.gapeMs],
    ['TailSpin', R.trembleMs],
  ])
    assert.deepEqual(enemyAnimationState({ ...state, clip }, 2000 + offset + 250), {
      clip,
      elapsed:
        0.25 *
        (BEHEMOTH_CLIP_TIMING[clip]
          ? BEHEMOTH_CLIP_TIMING[clip].authoredMs / BEHEMOTH_CLIP_TIMING[clip].activeMs
          : 1),
    });
});

test('the body is rendered at 2.5x and its radius and tail reach follow', () => {
  assert.equal(R.scale, 2.5);
  assert.ok(Math.abs(R.radius - 2.1 * 2.5) < 1e-9);
  assert.ok(Math.abs(R.tailReach - 4.35 * 2.5) < 1e-9);
  const { e } = fixture();
  assert.equal(e.scale, 2.5);
  assert.equal(e.radius, R.radius);
});

test('a blow from behind turns the behemoth on its attacker', () => {
  const { e, p, room, tick } = fixture();
  Object.assign(p, {
    species: 'cro',
    z: e.z - e.radius - p.radius - R.contactNoticeMargin - 0.1,
    facing: 0,
    attackSequence: 0,
    attackAt: 0,
    inventory: { wood: 7 },
  });
  tick(2000);
  assert.equal(e.targetId, null, 'a still player right behind is neither seen nor heard');
  startAttack(room, p, { targetId: e.id }, 2000);
  assert.equal(resolveAttack(room, p, 2400).hit, true);
  tick(2400, 0);
  assert.equal(e.clip, 'Hit');
  assert.equal(e.targetId, p.id, 'awareness changes on the hit frame, before flinch ends');
  tick(2400 + R.hitDurationMs + 10, 0);
  assert.equal(e.targetId, p.id);
  assert.equal(e.provokedBy, null);
});

function returnToPost(f, start = 2000) {
  const { e, p, tick } = f;
  e.z = e.home.z + 4;
  e.targetId = p.id;
  p.z = e.home.z + R.territoryRadius + 1;
  tick(start);
  assert.equal(e.returning, true);
  for (let now = start + 50; now < start + 8000; now += 50) {
    tick(now);
    if (!e.returning) {
      assert.ok(Math.hypot(e.x - e.home.x, e.z - e.home.z) < 0.001);
      return now;
    }
  }
  assert.fail('did not return to post');
}
test('after an actual leash return, rear footsteps reacquire immediately, repeatedly', () => {
  const f = fixture(),
    { e, p, tick } = f;
  let nextReturnAt = 2000;
  for (let cycle = 0; cycle < 2; cycle++) {
    const at = returnToPost(f, nextReturnAt);
    Object.assign(p, { x: e.x, z: e.z + 12, moving: true, running: false });
    assert.equal(e.facing, Math.PI, 'standing with its back to the player');
    tick(at + 1, 0);
    assert.equal(e.targetId, p.id);
    assert.equal(e.returning, false);
    assert.equal(e.clip, 'Roar');
    nextReturnAt = at + 1000;
  }
});
test('returning and an occupied home do not disable hearing or close-contact awareness', () => {
  for (const contact of [false, true]) {
    const { e, p, tick } = fixture();
    Object.assign(e, {
      z: e.home.z + 2,
      returning: true,
      targetId: null,
      facing: Math.PI,
      aggroAfter: 99999,
    });
    Object.assign(p, {
      x: e.x,
      z: e.z + (contact ? e.radius + p.radius + 0.2 : 12),
      moving: !contact,
      running: false,
    });
    tick(2000, 0);
    assert.equal(e.targetId, p.id);
    assert.equal(e.returning, false);
    assert.equal(e.clip, 'Roar');
  }
});
test('a rear hit interrupts a return and records the attacker even during hit recovery', () => {
  const { e, p, room, tick } = fixture();
  Object.assign(e, { returning: true, targetId: null, facing: Math.PI, aggroAfter: 99999 });
  Object.assign(p, { species: 'cro', x: e.x, z: e.z + e.radius + p.radius + 0.5, facing: Math.PI });
  assert.equal(startAttack(room, p, { targetId: e.id }, 2000).accepted, true);
  assert.equal(resolveAttack(room, p, 2400).hit, true);
  tick(2400, 0);
  assert.equal(e.targetId, p.id);
  assert.equal(e.returning, false);
  assert.ok(Math.abs(e.facing) < 1e-6);
  assert.equal(e.clip, 'Hit');
  tick(2400 + R.hitDurationMs, 0);
  assert.ok(['roar', 'gape', 'tremble', 'chase'].includes(e.behavior));
});
test('another attacker is noticed immediately, while outside/protected/other-floor players remain excluded', () => {
  const { e, p, room, tick } = fixture();
  e.targetId = 'old';
  room.players.set('old', { ...p, id: 'old' });
  e.provokedBy = p.id;
  e.hitUntil = 2300;
  p.z = e.z - 8;
  tick(2100, 0);
  assert.equal(e.targetId, p.id);
  assert.equal(e.provokedBy, null);
  for (const mode of ['outside', 'protected', 'other-floor']) {
    Object.assign(e, { z: e.home.z + 2, targetId: null, returning: true, provokedBy: p.id });
    room.players.delete('old');
    Object.assign(p, {
      z: e.z - 8,
      moving: true,
      invulnerableUntil: mode === 'protected' ? 99999 : 0,
    });
    if (mode === 'outside') p.z = e.home.z + R.territoryRadius + 1;
    room.collision.surfaceHeight = (a) => (mode === 'other-floor' && a === p ? 4 : 0);
    tick(2400, 0);
    assert.equal(e.targetId, null, mode);
    assert.equal(e.returning, true, mode);
  }
});
test('faster attack playback completes every authored pose and keeps the mouth release aligned', () => {
  const offsets = {
    Charge: R.roarMs,
    Tremble: 0,
    TailSpin: R.trembleMs,
    SpitWindup: 0,
    Spit: R.spitWindupMs,
  };
  for (const [clip, timing] of Object.entries(BEHEMOTH_CLIP_TIMING)) {
    const e = { modelKey: R.modelKey, phase: 'alive', attackAt: 5000, clip };
    const final = enemyAnimationState(e, 5000 + offsets[clip] + timing.activeMs);
    assert.ok(Math.abs(final.elapsed - timing.authoredMs / 1000) < 1e-9, clip);
  }
  assert.ok(
    Math.abs(
      enemyAnimationState(
        { modelKey: R.modelKey, phase: 'alive', attackAt: 5000, clip: 'Spit' },
        5000 + R.spitWindupMs + R.spitReleaseMs,
      ).elapsed - 0.18,
    ) < 1e-9,
  );
});

test('exhibition rules respawn the behemoth ten seconds after death', async () => {
  const { EXHIBITION_RULES } = await import('../dist/shared/room-rules.mjs');
  const { e, room, tick } = fixture();
  room.rules = EXHIBITION_RULES;
  e.health = 0;
  e.phase = 'dead';
  e.phaseStartedAt = 2000;
  tick(2000 + R.deathMs);
  assert.equal(e.phase, 'respawning');
  tick(2000 + R.deathMs + 9990);
  assert.equal(e.phase, 'respawning');
  tick(2000 + R.deathMs + 10010);
  assert.equal(e.phase, 'alive');
  assert.equal(e.health, R.maxHealth);
});
