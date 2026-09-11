import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { SABERTOOTH as R, SABERTOOTH_GROUND } from '../dist/shared/sabertooth-rules.mjs';
import { createSabertooth } from '../dist/shared/sabertooth.mjs';
import { updateEnemies } from '../dist/shared/enemies.mjs';
import { startAttack, resolveAttack, damageableTargets } from '../dist/shared/combat.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  enemyAnimationState,
  requireEnemyClips,
  SABERTOOTH_CLIPS,
} from '../dist/src/enemy-state.js';

const far = 1e9;
function fixture(offset = 12, species = 'ape') {
  const collision = new CollisionWorld([], { river: false });
  const e = createSabertooth(collision, [], 1000);
  e.facing = 0;
  e.nextRoamAt = far;
  const p = {
    id: 'p',
    x: e.x,
    z: e.z + offset,
    radius: species === 'ape' ? 0.76 : 0.32,
    species,
    gender: 'male',
    energy: 100,
    inventory: {},
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
const run = (tick, from, to) => {
  for (let t = from; t <= to; t += 50) tick(t);
};
// Skip the roar so a test starts in the engage loop.
const engaged = (e, p, now = 2000) => {
  e.targetId = p.id;
  e.aggroAfter = 0;
  e.nextAttackAt = 0;
  e.facing = Math.atan2(p.x - e.x, p.z - e.z);
  return now;
};

test('the snow-plain cat is added to new and old worlds; restore cancels its strike', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    send() {}
    close() {}
  }
  const core = createGameCore();
  core.connect(new Socket(), new URLSearchParams({ room: 'CAT-SAVE', name: 'T', species: 'ape' }));
  const room = core.rooms.get('CAT-SAVE');
  const cat = room.enemies.find((e) => e.modelKey === R.modelKey);
  assert.ok(Math.hypot(cat.x - SABERTOOTH_GROUND.x, cat.z - SABERTOOTH_GROUND.z) < 4);
  cat.health = 111;
  cat.pendingAttack = { kind: 'pounce', hitIds: [] };
  cat.superArmor = true;
  cat.targetId = 'old';
  const saved = core.exportState();
  const restored = createGameCore();
  restored.importState(saved);
  const after = restored.rooms.get('CAT-SAVE').enemies.find((e) => e.modelKey === R.modelKey);
  assert.equal(after.health, 111);
  assert.equal(after.pendingAttack, null);
  assert.equal(after.superArmor, false);
  assert.equal(after.targetId, null);
  // A save from before the move records the Siberian body and home; it resumes
  // on the current post with its health, not guarding or walking from the old one.
  const moved = structuredClone(saved);
  Object.assign(
    moved.rooms[0].enemies.find((e) => e.modelKey === R.modelKey),
    { x: 497.8, z: -19.3, home: { x: 493, z: -19 }, returning: true },
  );
  const rehomed = createGameCore();
  rehomed.importState(moved);
  const back = rehomed.rooms.get('CAT-SAVE').enemies.find((e) => e.modelKey === R.modelKey);
  assert.ok(Math.hypot(back.x - SABERTOOTH_GROUND.x, back.z - SABERTOOTH_GROUND.z) < 4);
  assert.ok(Math.hypot(back.home.x - SABERTOOTH_GROUND.x, back.home.z - SABERTOOTH_GROUND.z) < 4);
  assert.equal(back.health, 111);
  // Inside the current territory the saved body position is kept.
  const near = structuredClone(saved);
  Object.assign(near.rooms[0].enemies.find((e) => e.modelKey === R.modelKey), {
    x: SABERTOOTH_GROUND.x + 10,
    z: SABERTOOTH_GROUND.z,
    home: { x: 493, z: -19 },
  });
  const kept = createGameCore();
  kept.importState(near);
  const stay = kept.rooms.get('CAT-SAVE').enemies.find((e) => e.modelKey === R.modelKey);
  assert.equal(stay.x, SABERTOOTH_GROUND.x + 10);
  assert.ok(Math.hypot(stay.home.x - SABERTOOTH_GROUND.x, stay.home.z - SABERTOOTH_GROUND.z) < 4);
  saved.rooms[0].enemies = saved.rooms[0].enemies.filter((e) => e.modelKey !== R.modelKey);
  const legacy = createGameCore();
  legacy.importState(saved);
  const added = legacy.rooms.get('CAT-SAVE').enemies.find((e) => e.modelKey === R.modelKey);
  assert.equal(added.health, R.maxHealth);
});

test('sees ahead, hears close behind, and ignores far rear intruders', () => {
  {
    const { e, p, tick } = fixture();
    p.z = e.z - 15;
    tick(2000);
    assert.equal(e.targetId, null);
  }
  {
    const { e, p, tick } = fixture();
    p.z = e.z - (R.hearingRange - 1);
    tick(2000);
    assert.equal(e.targetId, p.id);
    assert.equal(e.clip, 'Alert');
  }
  {
    const { e, tick } = fixture(20);
    tick(2000);
    assert.equal(e.clip, 'Alert');
  }
});

test('outruns the fastest sprinter while inside its territory', () => {
  const { e, p, tick } = fixture(14);
  engaged(e, p);
  e.nextPounceAt = far;
  const start = Math.hypot(p.x - e.x, p.z - e.z);
  for (let t = 2000; t < 3000; t += 50) {
    p.z += 5.4 * 0.05;
    tick(t);
  }
  assert.ok(R.chaseSpeed > 5.4);
  assert.ok(Math.hypot(p.x - e.x, p.z - e.z) < start - 0.5);
});

test('pounce: still crouch telegraph, fast leap, one hit, then a landing opening', () => {
  const { e, p, tick } = fixture(7);
  engaged(e, p);
  tick(2000);
  assert.equal(e.pendingAttack.kind, 'pounce');
  assert.equal(e.clip, 'Pounce');
  const z = e.z;
  run(tick, 2050, 2000 + R.pounceCrouchMs - 50);
  assert.equal(e.z, z);
  assert.equal(e.behavior, 'crouch');
  assert.equal(p.energy, 100);
  run(tick, 2000 + R.pounceCrouchMs, 2000 + R.pounceCrouchMs + R.pounceLeapMs);
  assert.ok(e.z > z + 4);
  assert.equal(p.energy, 100 - R.pounceDamage);
  assert.equal(p.hurtSequence, 1);
  run(tick, 2000 + R.pounceCrouchMs + R.pounceLeapMs + 150, 2000 + R.pounceCrouchMs + R.pounceLeapMs + 300);
  assert.equal(e.behavior, 'land');
  assert.equal(e.speed, 0);
  assert.equal(p.energy, 100 - R.pounceDamage);
});

test('a blow during the crouch interrupts the pounce', () => {
  const { e, p, room, tick } = fixture(7);
  engaged(e, p);
  tick(2000);
  const hitter = { ...p, id: 'h', x: e.x, z: e.z + e.radius + 0.9, facing: Math.PI };
  room.players.set(hitter.id, hitter);
  startAttack(room, hitter, { targetId: e.id }, 2000);
  assert.equal(resolveAttack(room, hitter, 2400).hit, true);
  tick(2400, 0);
  assert.equal(e.clip, 'Hit');
  assert.equal(e.pendingAttack, null);
});

test('super armour keeps the pounce going when struck in mid-leap', () => {
  const { e, p, room, tick } = fixture(7);
  engaged(e, p);
  tick(2000);
  run(tick, 2050, 2000 + R.pounceCrouchMs + 100);
  const hitter = { ...p, id: 'h', energy: 100, x: e.x - e.radius - 0.9, z: e.z, facing: Math.PI / 2 };
  room.players.set(hitter.id, hitter);
  hitter.attackSequence = 0;
  startAttack(room, hitter, { targetId: e.id }, 2600);
  const result = resolveAttack(room, hitter, 3000);
  assert.equal(result.hit, true);
  assert.equal(e.health, R.maxHealth - 25);
  assert.equal(e.pendingAttack?.kind, 'pounce');
  assert.notEqual(e.clip, 'Hit');
});

test('claw combo lands two separate swipes on a player in front', () => {
  const { e, p, tick } = fixture(0);
  p.z = e.z + e.radius + p.radius + 0.4;
  engaged(e, p);
  tick(2000);
  assert.equal(e.clip, 'Attack');
  tick(2000 + R.clawImpactsMs[0] - 10);
  assert.equal(p.energy, 100);
  tick(2000 + R.clawImpactsMs[0]);
  assert.equal(p.energy, 100 - R.clawDamage);
  tick(2000 + R.clawImpactsMs[1]);
  assert.equal(p.energy, 100 - 2 * R.clawDamage);
  tick(2000 + R.clawMs);
  assert.equal(p.hurtSequence, 2);
});

test('steps aside from a thrust it sees coming, and the thrust misses', () => {
  const { e, p, room, tick } = fixture(0, 'cro');
  p.z = e.z + e.radius + p.radius + 1.2;
  engaged(e, p);
  e.nextAttackAt = far;
  const before = { x: e.x, z: e.z };
  startAttack(room, p, { targetId: e.id }, 2000);
  assert.ok(p.pendingStrike);
  tick(2050);
  assert.equal(e.clip, 'Step');
  assert.equal(e.evading, true);
  assert.equal(damageableTargets(room).some((t) => t.target === e), false);
  run(tick, 2100, 2000 + R.stepMs - 50);
  const result = resolveAttack(room, p, 2000 + 333);
  assert.equal(result.hit, false);
  assert.equal(e.health, R.maxHealth);
  run(tick, 2000 + R.stepMs, 2000 + R.stepMs + 50);
  assert.ok(Math.hypot(e.x - before.x, e.z - before.z) > R.stepDistance * 0.8);
  assert.equal(e.evading, false);
  // Cooldown: the very next thrust is not dodged.
  p.attackSequence = 0;
  startAttack(room, p, { targetId: e.id }, 2500);
  tick(2550);
  assert.notEqual(e.clip, 'Step');
});

test('sidesteps an incoming light orb', () => {
  const { e, p, room, tick } = fixture(0);
  p.z = e.z + 8;
  engaged(e, p);
  e.nextAttackAt = far;
  room.projectiles = [{ id: 'o', ownerId: p.id, x: e.x, z: e.z + 5, dx: 0, dz: -1, speed: 7 }];
  tick(2000);
  assert.equal(e.clip, 'Step');
});

test('leaving the territory ends the hunt; the cat walks home without striking', () => {
  const { e, p, room, tick } = fixture(10);
  engaged(e, p);
  e.nextPounceAt = far;
  e.z += 8;
  p.z = e.home.z + R.territoryRadius + 3;
  tick(2000);
  assert.equal(e.targetId, null);
  assert.equal(e.returning, true);
  let t = 2050;
  for (; e.returning && t < 40000; t += 50) tick(t);
  assert.ok(Math.hypot(e.x - e.home.x, e.z - e.home.z) < 0.001);
  assert.equal(e.behavior, 'guard');
  assert.equal(p.energy, 100);
  assert.ok(room.collision.free(e, e.radius));
});

test('dies, waits, and respawns at home with full health', () => {
  const { e, p, tick } = fixture(30);
  Object.assign(e, { health: 0, alive: false, phase: 'dead', phaseStartedAt: 2000 });
  tick(2000 + R.deathMs);
  assert.equal(e.phase, 'respawning');
  tick(2000 + R.deathMs + R.respawnMs + 10);
  assert.equal(e.phase, 'alive');
  assert.equal(e.health, R.maxHealth);
  assert.equal(p.energy, 100);
});

test('client requires the cat clips and samples one-shots from the server clock', () => {
  requireEnemyClips(
    SABERTOOTH_CLIPS.map((name) => ({ name })),
    R.modelKey,
  );
  assert.throws(
    () =>
      requireEnemyClips(
        SABERTOOTH_CLIPS.filter((n) => n !== 'Pounce').map((name) => ({ name })),
        R.modelKey,
      ),
    /Pounce/,
  );
  for (const clip of ['Pounce', 'Step', 'Attack', 'Alert'])
    assert.deepEqual(
      enemyAnimationState({ modelKey: R.modelKey, phase: 'alive', attackAt: 2000, clip }, 2500),
      { clip, elapsed: 0.5 },
    );
});

test('the post is on the snow plain just south of the starting camp', async () => {
  const { CAMP } = await import('../dist/shared/world.mjs');
  const { nearCastle } = await import('../dist/shared/castle-layout.mjs');
  const { BEHEMOTH_GROUND } = await import('../dist/shared/behemoth-rules.mjs');
  const { WARP_POINTS } = await import('../dist/shared/warp-sites.mjs');
  const { geographicBiome, isLand, locationName } = await import('../dist/shared/paleo-geography.mjs');
  const { riverX, riverHalfWidth } = await import('../dist/shared/terrain.mjs');
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const fromCamp = d(SABERTOOTH_GROUND, CAMP);
  assert.equal(locationName(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z), 'ヨーロッパの雪原');
  assert.ok(isLand(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z, R.territoryRadius));
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = SABERTOOTH_GROUND.x + 16 * Math.cos(a),
      z = SABERTOOTH_GROUND.z + 16 * Math.sin(a);
    assert.equal(geographicBiome(x, z), 'snow', `${x},${z}`);
  }
  assert.ok(fromCamp < 90, `camp ${fromCamp}`);
  // The river runs south through this snow plain; the pounce ground stays dry.
  for (let z = -64; z <= 184; z += 0.5)
    if (riverHalfWidth(z) > 0.7)
      assert.ok(
        Math.hypot(SABERTOOTH_GROUND.x - riverX(z), SABERTOOTH_GROUND.z - z) - riverHalfWidth(z) > 14,
        `river at z ${z}`,
      );
  // The territory overlaps neither the camp's safe radius, the marsh, the castle nor a warp fire.
  assert.ok(fromCamp > R.territoryRadius + 12);
  assert.ok(d(SABERTOOTH_GROUND, BEHEMOTH_GROUND) > R.territoryRadius + BEHEMOTH_GROUND.radius);
  assert.equal(nearCastle(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z, 10), false);
  for (const fire of WARP_POINTS) assert.ok(d(SABERTOOTH_GROUND, fire) > R.territoryRadius + 8, fire.id);
});

test('the hunting ground has no tree in the territory and no rock around the post', async () => {
  const { SCENERY, inSabertoothClearing, inSabertoothTreeClearing } = await import(
    '../dist/shared/scenery-layout.mjs'
  );
  for (const kind of ['trees', 'rocks', 'ridges'])
    assert.equal(SCENERY[kind].filter((i) => inSabertoothClearing(i.x, i.z)).length, 0, kind);
  const near = (i) => Math.hypot(i.x - SABERTOOTH_GROUND.x, i.z - SABERTOOTH_GROUND.z);
  assert.equal(SCENERY.trees.filter((t) => near(t) < R.territoryRadius + 4).length, 0);
  assert.ok(inSabertoothTreeClearing(SABERTOOTH_GROUND.x + R.territoryRadius, SABERTOOTH_GROUND.z));
  // Trees just beyond the cleared ring are kept.
  assert.ok(SCENERY.trees.some((t) => near(t) < R.territoryRadius + 20));
  assert.ok(inSabertoothClearing(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z, -13));
  assert.equal(inSabertoothClearing(SABERTOOTH_GROUND.x + 40, SABERTOOTH_GROUND.z), false);
});
