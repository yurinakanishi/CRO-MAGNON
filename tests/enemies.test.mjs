import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import {
  createEnemies,
  updateEnemies,
  ENEMY_RULES,
  inSorcererHall,
} from '../dist/shared/enemies.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';
import { createAnimals, updateAnimals, actorObstacle } from '../dist/shared/animals.mjs';
import { COMBAT, enemyIsSolid, startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import {
  CROW_ALTAR,
  CROW_FACTION_ROSTER,
  CROW_RITE_TEXT,
  CROW_ROLE_RULES,
  CROW_TIERS,
  crowSealNotice,
  castleTierAt,
  inCastleHall,
  inCrowWard,
} from '../dist/shared/crow-faction.mjs';
import { CASTLE_TIERS, castleLocal, castleWorld } from '../dist/shared/castle-layout.mjs';

const SHAMAN = CROW_ROLE_RULES.shaman;
// Mark a whole rank as fallen (its bodies already gone) so the rank above opens.
function fell(room, roles, now) {
  for (const enemy of room.enemies)
    if (roles.includes(enemy.crowRole))
      Object.assign(enemy, {
        phase: 'respawning',
        phaseStartedAt: now,
        alive: false,
        health: 0,
        clip: null,
        behavior: 'respawning',
      });
}

function fixture(collision = new CollisionWorld([], { river: false })) {
  const enemy = createEnemies(collision, [], 1000)[0];
  const player = {
    id: 'player',
    x: enemy.x,
    z: enemy.z + 1.3,
    radius: 0.32,
    facing: Math.PI,
    energy: 100,
    inventory: { wood: 3, stone: 1, rawMeat: 2, cookedMeat: 1 },
    hurtSequence: 0,
    hurtAt: 0,
    defeatSequence: 0,
    downedUntil: 0,
    invulnerableUntil: 0,
    attackSequence: 0,
    attackAt: 0,
    cookingEndsAt: 0,
  };
  const room = {
    players: new Map([[player.id, player]]),
    enemies: [enemy],
    animals: [],
    collision,
    camp: { x: 50, z: 50 },
  };
  // The staff tests below predate the red magic; hold both spells unless a test arms them.
  enemy.nextBoltAt = enemy.nextBurstAt = 1e12;
  return { room, enemy, player };
}

test('crow clearing is body-clear, away from camp, and patrols use real static collision', () => {
  const collision = new CollisionWorld(),
    animals = createAnimals(collision, 1000),
    enemies = createEnemies(collision, animals, 1000);
  const room = { collision, animals, enemies, players: new Map(), camp: { x: 50, z: 50 } },
    enemy = enemies[0];
  assert.ok(
    Math.hypot(enemy.x - 50, enemy.z - 50) > ENEMY_RULES.leashRadius + ENEMY_RULES.campSafeRadius,
  );
  const castleEnemies = enemies.filter((e) => e.castle);
  assert.equal(castleEnemies.length, 28);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(CROW_FACTION_ROSTER).map((role) => [
        role,
        castleEnemies.filter((e) => e.crowRole === role).length,
      ]),
    ),
    CROW_FACTION_ROSTER,
  );
  assert.equal(new Set(enemies.map((e) => e.id)).size, enemies.length);
  for (const crow of castleEnemies)
    for (let x = -crow.roamRadius; x <= crow.roamRadius; x += 0.4)
      for (let z = -crow.roamRadius; z <= crow.roamRadius; z += 0.4)
        if (Math.hypot(x, z) <= crow.roamRadius) {
          const point = { x: crow.home.x + x, z: crow.home.z + z };
          assert.ok(collision.free(point, crow.radius));
          assert.ok(inCrowWard(crow, point), `${crow.id} patrol disc stays in its ward`);
        }
  // Only the first rank is awake at the start; measure its patrol, and hold the
  // praying ranks to their posts.
  const soldier = castleEnemies.find((e) => e.crowRole === 'soldier'),
    posts = new Map(castleEnemies.map((e) => [e.id, { x: e.x, z: e.z }]));
  let minX = soldier.x,
    maxX = soldier.x,
    minZ = soldier.z,
    maxZ = soldier.z;
  for (let i = 0; i < 2400; i++) {
    const now = 1000 + i * 50;
    updateAnimals(room, 0.05, now);
    updateEnemies(room, 0.05, now);
    for (const actor of [...animals, ...enemies])
      assert.ok(
        collision.free(
          actor,
          actor.radius,
          [...animals, ...enemies].filter((other) => other !== actor).map(actorObstacle),
        ),
      );
    minX = Math.min(minX, soldier.x);
    maxX = Math.max(maxX, soldier.x);
    minZ = Math.min(minZ, soldier.z);
    maxZ = Math.max(maxZ, soldier.z);
    for (const crow of castleEnemies) {
      assert.ok(inCrowWard(crow, crow), `${crow.id} stays inside its ward`);
      if (crow.sealed) {
        const post = posts.get(crow.id);
        assert.ok(Math.hypot(crow.x - post.x, crow.z - post.z) < 1e-9, `${crow.id} prays in place`);
        assert.equal(crow.behavior, 'pray');
      }
    }
  }
  assert.ok(maxX - minX > 2 && maxZ - minZ > 2, `soldier patrol ${maxX - minX} x ${maxZ - minZ}`);
  assert.equal(enemy.sealed, true, 'the hex monks pray while the followers stand');
  assert.equal(soldier.attackSequence, 0);
});

test('crow hierarchy assigns physical, magical and flying abilities by rank', () => {
  const collision = new CollisionWorld([], { river: false }),
    enemies = createEnemies(collision, [], 1000).filter((e) => e.castle),
    byRole = (role) => enemies.find((e) => e.crowRole === role);
  for (const role of Object.keys(CROW_FACTION_ROSTER)) {
    const enemy = byRole(role),
      rules = CROW_ROLE_RULES[role];
    assert.ok(enemy, role);
    assert.equal(enemy.name, rules.name);
    assert.equal(enemy.scale, rules.scale);
    assert.equal(enemy.radius, rules.radius);
    assert.equal(enemy.maxHealth, rules.maxHealth);
  }
  assert.equal(CROW_ROLE_RULES.pontiff.physical, true);
  assert.equal(CROW_ROLE_RULES.pontiff.magic, true);
  assert.equal(CROW_ROLE_RULES.prelate.physical, true);
  assert.equal(CROW_ROLE_RULES.prelate.magic, true);
  assert.equal(CROW_ROLE_RULES.prelate.flying, true);
  for (const role of ['brute', 'soldier']) assert.equal(CROW_ROLE_RULES[role].magic, false);
});

test('prelates fly, cast from the air, then dive to use their physical weapon', () => {
  const collision = new CollisionWorld([], { river: false }),
    prelate = createEnemies(collision, [], 1000).find((e) => e.crowRole === 'prelate'),
    player = {
      id: 'target',
      x: prelate.x,
      z: prelate.z + 8,
      radius: 0.32,
      energy: 100,
      inventory: {},
      hurtSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      cookingEndsAt: 0,
    },
    room = {
      players: new Map([[player.id, player]]),
      enemies: [prelate],
      animals: [],
      collision,
      camp: { x: 50, z: 50 },
    };
  let now = 2000;
  prelate.nextBoltAt = prelate.nextBurstAt = 1e12;
  for (let i = 0; i < 30; i++) updateEnemies(room, 0.05, (now += 50));
  assert.ok(prelate.airborneHeight > 2.2, `flight height ${prelate.airborneHeight}`);
  prelate.targetId = null;
  prelate.aggroAfter = 0;
  prelate.nextBoltAt = 0;
  prelate.nextBurstAt = 1e12;
  updateEnemies(room, 0.05, (now += 50));
  assert.equal(prelate.behavior, 'bolt');
  assert.equal(prelate.pendingAttack.kind, 'bolt');
  assert.ok(prelate.airborneHeight > 2, 'casts while airborne');
  updateEnemies(room, 0, prelate.pendingAttack.impactAt);
  assert.equal(room.hexBolts.length, 1);
  room.hexBolts = [];

  prelate.pendingAttack = null;
  prelate.attackLockUntil = 0;
  prelate.nextBoltAt = prelate.nextBurstAt = 1e12;
  prelate.targetId = player.id;
  Object.assign(player, { x: prelate.x, z: prelate.z + 1.6 });
  let dove = false;
  const attacksBeforeDive = prelate.attackSequence;
  for (let i = 0; i < 40 && prelate.attackSequence === attacksBeforeDive; i++) {
    updateEnemies(room, 0.05, (now += 50));
    dove ||= prelate.behavior === 'dive';
  }
  assert.equal(dove, true);
  assert.ok(prelate.airborneHeight < 0.08);
  assert.equal(prelate.behavior, 'attack');
  const impact = prelate.pendingAttack.impactAt;
  updateEnemies(room, 0, impact);
  assert.equal(player.energy, 100 - CROW_ROLE_RULES.prelate.attackDamage);
});

test('the pontiff has both a close physical strike and stronger red magic', () => {
  const collision = new CollisionWorld([], { river: false }),
    pontiff = createEnemies(collision, [], 1000).find((e) => e.crowRole === 'pontiff'),
    player = {
      id: 'target',
      x: pontiff.x,
      z: pontiff.z + 1.8,
      radius: 0.32,
      energy: 100,
      inventory: {},
      hurtSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      cookingEndsAt: 0,
    },
    room = {
      players: new Map([[player.id, player]]),
      enemies: [pontiff],
      animals: [],
      collision,
      camp: { x: 50, z: 50 },
    };
  pontiff.nextBoltAt = pontiff.nextBurstAt = 1e12;
  updateEnemies(room, 0, 2000);
  assert.equal(pontiff.behavior, 'attack');
  updateEnemies(room, 0, pontiff.pendingAttack.impactAt);
  assert.equal(player.energy, 100 - CROW_ROLE_RULES.pontiff.attackDamage);
  pontiff.pendingAttack = null;
  pontiff.attackLockUntil = 0;
  pontiff.targetId = null;
  pontiff.aggroAfter = 0;
  pontiff.nextBoltAt = 0;
  Object.assign(player, { x: pontiff.x, z: pontiff.z + 9 });
  updateEnemies(room, 0, 5000);
  assert.equal(pontiff.behavior, 'bolt');
  assert.equal(pontiff.pendingAttack.damage, CROW_ROLE_RULES.pontiff.boltDamage);
});

// 2026-09-12: the sorcerer is an indoor enemy; only the great hall (the upper storey) is its ground.
test('the castle sorcerer ignores players below the hall, drops a target that leaves it, and never steps off the floor', () => {
  const { room, enemy, player } = fixture();
  assert.equal(enemy.castle, true);
  assert.ok(inSorcererHall(enemy));
  assert.ok(
    createEnemies(new CollisionWorld([], { river: false }), [], 1000)
      .filter((e) => e.modelKey === ENEMY_RULES.modelKey && e.regionId)
      .every((e) => !e.castle),
    'adventure guardians keep their own grounds',
  );
  // Castle floor cells within the leash disc that are not the hall: the stairs and the forecourt.
  const below = [];
  for (let dx = -22; dx <= 22; dx += 0.5)
    for (let dz = -22; dz <= 22; dz += 0.5) {
      const p = { x: enemy.home.x + dx, z: enemy.home.z + dz };
      if (
        Math.hypot(dx, dz) <= ENEMY_RULES.leashRadius &&
        Number.isFinite(CASTLE_SURFACE.height(p.x, p.z)) &&
        !inSorcererHall(p)
      )
        below.push(p);
    }
  assert.ok(below.length > 20, 'the leash disc reaches castle floor outside the hall');
  below.sort(
    (a, b) => Math.hypot(a.x - enemy.x, a.z - enemy.z) - Math.hypot(b.x - enemy.x, b.z - enemy.z),
  );
  Object.assign(player, below[0]);
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.targetId, null);
  assert.equal(enemy.behavior, 'roam');
  // A player in the hall is noticed; once they step down, the sorcerer lets go and returns home, staying on the hall floor throughout.
  const start = { x: enemy.x, z: enemy.z };
  Object.assign(player, { x: enemy.x, z: enemy.z + 5 });
  assert.ok(inSorcererHall(player));
  let now = 3000;
  updateEnemies(room, 0.05, now);
  assert.equal(enemy.targetId, player.id);
  for (let i = 0; i < 40; i++) {
    now += 50;
    updateEnemies(room, 0.05, now);
    assert.ok(inSorcererHall(enemy));
  }
  Object.assign(player, below[0]);
  updateEnemies(room, 0.05, (now += 50));
  assert.equal(enemy.targetId, null);
  assert.equal(enemy.returning, true);
  let nearestHome = Infinity;
  for (let i = 0; i < 400; i++) {
    now += 50;
    updateEnemies(room, 0.05, now);
    assert.ok(inSorcererHall(enemy));
    assert.equal(enemy.targetId, null);
    nearestHome = Math.min(nearestHome, Math.hypot(enemy.x - enemy.home.x, enemy.z - enemy.home.z));
  }
  assert.ok(nearestHome < 0.2, 'returned to its post before patrolling again');
  assert.equal(enemy.returning, false);
  assert.equal(enemy.behavior, 'roam');
  // Forced toward the lower floor, its step is undone rather than leaving the hall.
  enemy.castle = true;
  enemy.targetId = null;
  enemy.returning = false;
  for (let i = 0; i < 200; i++) {
    enemy.target = { ...below[0] };
    enemy.path = [];
    now += 50;
    updateEnemies(room, 0.05, now);
    assert.ok(inSorcererHall(enemy), `step ${i} left the hall`);
  }
  assert.ok(Math.hypot(enemy.x - start.x, enemy.z - start.z) < ENEMY_RULES.leashRadius);
});

test('crow notices nearby players, chases, winds up, and damages once per staff swing', () => {
  const { room, enemy, player } = fixture();
  player.z = enemy.z + 6;
  let now = 2000;
  updateEnemies(room, 0.05, now);
  assert.equal(enemy.targetId, player.id);
  assert.equal(enemy.behavior, 'chase');
  assert.ok(enemy.speed > 0);
  while (!enemy.attackSequence && now < 7000) {
    now += 50;
    updateEnemies(room, 0.05, now);
  }
  assert.equal(enemy.attackSequence, 1);
  assert.equal(enemy.clip, 'Attack');
  assert.equal(player.energy, 100);
  assert.ok(
    Math.hypot(enemy.x - player.x, enemy.z - player.z) <= 1.4 + 1e-9,
    'AI must approach within the visible staff contact distance',
  );
  assert.equal(overlap(player, player.radius, actorObstacle(enemy)), null);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackImpactMs - 1);
  assert.equal(player.energy, 100);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackImpactMs);
  assert.equal(player.energy, 100 - SHAMAN.attackDamage);
  assert.equal(player.hurtSequence, 1);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackDurationMs);
  assert.equal(player.energy, 100 - SHAMAN.attackDamage);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackCooldownMs - 1);
  assert.equal(enemy.attackSequence, 1);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackCooldownMs);
  assert.equal(enemy.attackSequence, 2);
});

test('staff damage uses the measured short contact range, including after windup', () => {
  const { room, enemy, player } = fixture();
  player.z = enemy.z + 1.9;
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.behavior, 'chase');
  assert.equal(enemy.attackSequence, 0);
  player.z = enemy.z + 1.45;
  updateEnemies(room, 0, 2050);
  assert.equal(enemy.attackSequence, 0);
  player.z = enemy.z + 1.4;
  updateEnemies(room, 0, 2100);
  assert.equal(enemy.attackSequence, 1);
  player.z = enemy.z + 1.45;
  updateEnemies(room, 0, 2550);
  assert.equal(player.energy, 100);
  assert.equal(player.hurtSequence, 0);
  player.z = enemy.z + 1.4;
  updateEnemies(room, 0, 3900);
  assert.equal(enemy.attackSequence, 2);
  updateEnemies(room, 0, 4350);
  assert.equal(player.energy, 100 - SHAMAN.attackDamage);
  assert.equal(player.hurtSequence, 1);
});

test('staff impacts recheck range and walls; hitting the crow interrupts its windup', () => {
  const { room, enemy, player } = fixture();
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.attackSequence, 1);
  player.z = enemy.z + 4;
  updateEnemies(room, 0, 2450);
  assert.equal(player.energy, 100);
  player.z = enemy.z + 1.3;
  updateEnemies(room, 0, 3800);
  assert.equal(enemy.attackSequence, 2);
  room.collision = new CollisionWorld(
    [
      {
        id: 'wall',
        type: 'box',
        x: enemy.x,
        z: enemy.z + 0.75,
        hx: 2,
        hz: 0.12,
        c: 1,
        s: 0,
        height: 3,
      },
    ],
    { river: false },
  );
  updateEnemies(room, 0, 4250);
  assert.equal(player.energy, 100);
  room.collision = new CollisionWorld([], { river: false });
  updateEnemies(room, 0, 5600);
  startAttack(room, player, { targetId: enemy.id }, 5650);
  const hit = resolveAttack(room, player, 5650 + COMBAT.attackImpactMs);
  assert.equal(hit.target, enemy);
  assert.equal(enemy.health, SHAMAN.maxHealth - COMBAT.attackDamage);
  assert.equal(enemy.pendingAttack, null);
  assert.equal(enemy.hitSequence, 1);
  updateEnemies(room, 0, 5650 + COMBAT.attackImpactMs);
  assert.equal(enemy.clip, 'Hit');
  updateEnemies(room, 0, 6050);
  assert.equal(player.energy, 98);
  assert.equal(player.hurtSequence, 0);
});

test('line of sight gates aggro, pursuit paths avoid walls, and leash returns without teleporting', () => {
  const { room, enemy, player } = fixture();
  player.z = enemy.z + 6;
  room.collision = new CollisionWorld(
    [
      {
        id: 'wall',
        type: 'box',
        x: enemy.x,
        z: enemy.z + 3,
        hx: 1,
        hz: 0.3,
        c: 1,
        s: 0,
        height: 3,
      },
    ],
    { river: false },
  );
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.targetId, null);
  room.collision = new CollisionWorld([], { river: false });
  updateEnemies(room, 0.05, 2050);
  assert.equal(enemy.targetId, player.id);
  room.collision = new CollisionWorld(
    [
      {
        id: 'wall',
        type: 'box',
        x: enemy.home.x,
        z: enemy.home.z + 3,
        hx: 1,
        hz: 0.3,
        c: 1,
        s: 0,
        height: 3,
      },
    ],
    { river: false },
  );
  for (let i = 0; i < 80; i++) {
    updateEnemies(room, 0.05, 2100 + i * 50);
    assert.ok(room.collision.free(enemy, enemy.radius));
  }
  assert.ok(
    Math.abs(enemy.x - enemy.home.x) > 0.5 || enemy.z > enemy.home.z + 3.5,
    'The chase must route around the wall',
  );
  const hurtsBeforeLeash = player.hurtSequence;
  player.z = enemy.home.z + ENEMY_RULES.leashRadius + 1;
  const before = { x: enemy.x, z: enemy.z };
  updateEnemies(room, 0.05, 7000);
  assert.equal(enemy.targetId, null);
  assert.equal(enemy.behavior, 'return');
  assert.ok(
    Math.hypot(enemy.x - before.x, enemy.z - before.z) <= ENEMY_RULES.chaseSpeed * 0.05 + 0.001,
  );
  for (let i = 0; i < 140; i++) updateEnemies(room, 0.05, 7050 + i * 50);
  assert.ok(Math.hypot(enemy.x - enemy.home.x, enemy.z - enemy.home.z) <= enemy.roamRadius + 0.01);
  assert.equal(player.hurtSequence, hurtsBeforeLeash);
});

test('camp and recovery protection prevent crow attacks', () => {
  const { room, enemy, player } = fixture();
  // Relocated beside camp for the rule under test: no longer the castle's indoor sorcerer.
  Object.assign(enemy, { x: 49, z: 41, home: { x: 49, z: 41 }, castle: false });
  Object.assign(player, { x: 49, z: 43 });
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.targetId, null);
  assert.equal(enemy.attackSequence, 0);
  Object.assign(enemy, { x: 45, z: 16, home: { x: 45, z: 16 } });
  Object.assign(player, { x: 45, z: 17.3, invulnerableUntil: 6000 });
  updateEnemies(room, 0, 3000);
  assert.equal(enemy.targetId, null);
  updateEnemies(room, 0, 6000);
  assert.equal(enemy.attackSequence, 1);
});

test('lethal staff damage pauses play then safely returns to camp, preserving every inventory item', () => {
  const { room, enemy, player } = fixture();
  const inventory = { ...player.inventory };
  player.energy = 10;
  updateEnemies(room, 0, 2000);
  updateEnemies(room, 0, 2450);
  assert.equal(player.energy, 0);
  assert.equal(player.downedUntil, 6450);
  assert.equal(player.defeatSequence, 1);
  assert.equal(player.hurtSequence, 1);
  assert.equal(startAttack(room, player, {}, 3000).reason, 'downed');
  updateEnemies(room, 0, 6449);
  assert.equal(player.energy, 0);
  updateEnemies(room, 0, 6450);
  assert.equal(player.energy, 50);
  assert.equal(player.downedUntil, 0);
  assert.equal(player.invulnerableUntil, 11450);
  assert.ok(Math.hypot(player.x - room.camp.x, player.z - room.camp.z) < 5);
  assert.deepEqual(player.inventory, inventory);
  assert.equal(player.pendingStrike, null);
  assert.equal(player.cookingEndsAt, 0);
  assert.ok(room.collision.free(player, player.radius, [actorObstacle(enemy)]));
});

test('wooden spear hits kill the crow; death remains briefly solid, then safe respawn restores health without loot', () => {
  const { room, enemy, player } = fixture();
  for (let i = 0; i < Math.ceil(SHAMAN.maxHealth / COMBAT.attackDamage); i++) {
    const now = 2000 + i * COMBAT.attackCooldownMs;
    startAttack(room, player, { targetId: enemy.id }, now);
    resolveAttack(room, player, now + COMBAT.attackImpactMs);
  }
  assert.equal(enemy.health, 0);
  assert.equal(enemy.phase, 'dead');
  assert.equal(enemyIsSolid(enemy), true);
  assert.equal(enemy.meatRemaining, undefined);
  const diedAt = enemy.phaseStartedAt;
  updateEnemies(room, 0, diedAt + ENEMY_RULES.deathDurationMs - 1);
  assert.equal(enemy.phase, 'dead');
  updateEnemies(room, 0, diedAt + ENEMY_RULES.deathDurationMs);
  assert.equal(enemy.phase, 'respawning');
  assert.equal(enemyIsSolid(enemy), false);
  // 2026-09-13: a fallen castle rank stays fallen while a player holds the keep.
  let respawnAt = enemy.phaseStartedAt + ENEMY_RULES.respawnMs;
  updateEnemies(room, 0, respawnAt + 5000);
  assert.equal(enemy.phase, 'respawning', 'held while the player stands in the castle');
  Object.assign(player, { x: 50, z: 55 });
  updateEnemies(room, 0, respawnAt + 5001);
  assert.equal(enemy.phase, 'respawning', 'the clock starts once the keep is empty');
  respawnAt = enemy.phaseStartedAt + ENEMY_RULES.respawnMs;
  const blocker = { id: 'blocker', phase: 'alive', x: enemy.home.x, z: enemy.home.z, radius: 20 };
  room.animals.push(blocker);
  updateEnemies(room, 0, respawnAt);
  assert.equal(enemy.phase, 'respawning');
  room.animals.pop();
  updateEnemies(room, 0, respawnAt + 1);
  assert.equal(enemy.phase, 'alive');
  assert.equal(enemy.alive, true);
  assert.equal(enemy.health, SHAMAN.maxHealth);
  assert.equal(enemy.hitSequence, Math.ceil(SHAMAN.maxHealth / COMBAT.attackDamage));
  assert.ok(room.collision.free(enemy, enemy.radius, [actorObstacle(player)]));
  assert.equal(player.inventory.rawMeat, 2);
});

test('a hit from outside the notice range still gives the attacker away', () => {
  const { room, enemy, player } = fixture();
  player.z = enemy.z + ENEMY_RULES.aggroRange + 2;
  updateEnemies(room, 0.05, 2000);
  assert.equal(enemy.targetId, null);
  enemy.provokedBy = player.id;
  updateEnemies(room, 0.05, 2050);
  assert.equal(enemy.targetId, player.id);
  assert.equal(enemy.provokedBy, null);
  assert.equal(enemy.behavior, 'chase');
});

test('red bolt: raised-staff windup, straight flight, one hit; a side-step after release dodges it', () => {
  for (const dodge of [false, true]) {
    const { room, enemy, player } = fixture();
    enemy.nextBoltAt = 0;
    player.z = enemy.z + 8;
    updateEnemies(room, 0.05, 2000);
    assert.equal(enemy.targetId, player.id);
    assert.equal(enemy.behavior, 'bolt');
    assert.equal(enemy.clip, 'Attack');
    assert.equal(enemy.pendingAttack.kind, 'bolt');
    assert.equal(enemy.attackSequence, 1);
    const release = 2000 + ENEMY_RULES.boltWindupMs;
    updateEnemies(room, 0.05, release - 50);
    assert.equal(enemy.speed, 0, 'the caster stands still through the windup');
    assert.equal(enemy.behavior, 'bolt');
    assert.equal((room.hexBolts ?? []).length, 0);
    updateEnemies(room, 0.05, release);
    assert.equal(room.hexBolts.length, 1);
    const bolt = room.hexBolts[0];
    assert.equal(bolt.kind, 'hex');
    assert.equal(bolt.ownerId, enemy.id);
    assert.ok(
      Math.abs(bolt.dz - 1) < 1e-9 && Math.abs(bolt.dx) < 1e-9,
      'aimed straight at the target',
    );
    if (dodge) player.x += 1.6;
    let now = release;
    while (room.hexBolts.length && now < release + 4000) {
      now += 50;
      updateEnemies(room, 0.05, now);
    }
    assert.equal(room.hexBolts.length, 0, 'the bolt hit or expired');
    if (dodge) {
      assert.equal(player.energy, 100);
      assert.equal(player.hurtSequence, 0);
    } else {
      assert.equal(player.energy, 100 - ENEMY_RULES.boltDamage);
      assert.equal(player.hurtSequence, 1);
      assert.ok(room.projectileImpacts.some((i) => i.kind === 'hex' && i.hit));
    }
    assert.ok(enemy.nextBoltAt >= 2000 + ENEMY_RULES.boltCooldownMs);
  }
});

test('red burst: a ring telegraph around the caster, then damage only to those still inside', () => {
  const { room, enemy, player } = fixture();
  enemy.nextBurstAt = 0;
  const stayer = { ...player, id: 'stayer', x: enemy.x + 2.5, z: enemy.z + 2, hurtSequence: 0 };
  room.players.set(stayer.id, stayer);
  player.z = enemy.z + 3;
  updateEnemies(room, 0.05, 2000);
  assert.equal(enemy.behavior, 'burst');
  assert.equal(enemy.clip, 'Attack');
  assert.equal(room.hexBursts.length, 1);
  const burst = room.hexBursts[0];
  assert.equal(burst.radius, ENEMY_RULES.burstRadius);
  assert.equal(burst.startedAt, 2000);
  assert.equal(burst.at, 2000 + ENEMY_RULES.burstWindupMs);
  assert.equal(burst.detonatedAt, null);
  updateEnemies(room, 0.05, burst.at - 50);
  assert.equal(player.energy, 100);
  assert.equal(stayer.energy, 100);
  assert.equal(enemy.speed, 0);
  // Leaving the ring before it closes is the answer.
  player.z = enemy.z + ENEMY_RULES.burstRadius + player.radius + 0.5;
  updateEnemies(room, 0.05, burst.at);
  assert.equal(burst.detonatedAt, burst.at);
  assert.equal(player.energy, 100);
  assert.equal(player.hurtSequence, 0);
  assert.equal(stayer.energy, 100 - ENEMY_RULES.burstDamage);
  assert.equal(stayer.hurtSequence, 1);
  assert.ok(enemy.nextBurstAt >= 2000 + ENEMY_RULES.burstCooldownMs);
  // The flash lingers briefly for the renderer, then the record is dropped.
  updateEnemies(room, 0.05, burst.at + 500);
  assert.equal(room.hexBursts.length, 1);
  updateEnemies(room, 0.05, burst.at + 900);
  assert.equal(room.hexBursts.length, 0);
});

test('exhibition rules restore fallen players fully and bring the crow back in ten seconds', async () => {
  const { EXHIBITION_RULES } = await import('../dist/shared/room-rules.mjs');
  const { room, enemy, player } = fixture();
  room.rules = EXHIBITION_RULES;
  player.energy = 10;
  player.downedUntil = 5000;
  updateEnemies(room, 0.05, 5000);
  assert.equal(player.downedUntil, 0);
  assert.equal(player.energy, 100);
  enemy.phase = 'respawning';
  enemy.phaseStartedAt = 6000;
  enemy.health = 0;
  enemy.alive = false;
  updateEnemies(room, 0, 6000);
  updateEnemies(room, 0, 6000 + 9999);
  assert.equal(enemy.phase, 'respawning');
  updateEnemies(room, 0, 6000 + 10000);
  assert.equal(enemy.phase, 'alive');
  assert.equal(enemy.health, enemy.maxHealth);
  room.rules = undefined;
  player.energy = 10;
  player.downedUntil = 20000;
  updateEnemies(room, 0.05, 20000);
  assert.equal(player.energy, ENEMY_RULES.recoveryEnergy);
});

// 2026-09-13: the cult is fought rank by rank.
function castleFixture(now = 1000) {
  const collision = new CollisionWorld([], { river: false }),
    enemies = createEnemies(collision, [], now).filter((e) => e.castle),
    notices = [],
    player = {
      id: 'raider',
      x: 0,
      z: 0,
      radius: 0.32,
      facing: 0,
      energy: 100,
      inventory: { wood: 3, stone: 1 },
      hurtSequence: 0,
      hurtAt: 0,
      defeatSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      attackSequence: 0,
      attackAt: 0,
      cookingEndsAt: 0,
    },
    room = {
      players: new Map([[player.id, player]]),
      enemies,
      animals: [],
      collision,
      camp: { x: 50, z: 50 },
    },
    notify = (target, text) => notices.push({ id: target.id, text }),
    byRole = (role) => enemies.filter((e) => e.crowRole === role),
    tick = (t, dt = 0.05) => updateEnemies(room, dt, t, notify);
  return { collision, enemies, player, room, notices, byRole, tick };
}

test('five ranks hold their own levels of the stepped fortress: followers in the forecourt, the pontiff on the summit', () => {
  const { enemies } = castleFixture();
  assert.deepEqual(CROW_TIERS, ['soldier', 'brute', 'shaman', 'prelate', 'pontiff']);
  for (const [index, role] of CROW_TIERS.entries()) {
    assert.equal(CROW_ROLE_RULES[role].tier, index + 1);
    for (const crow of enemies.filter((e) => e.crowRole === role)) {
      assert.equal(crow.tier, index + 1);
      assert.ok(inCrowWard(crow, crow.home), `${crow.id} is posted inside its ward`);
      assert.equal(castleTierAt(crow.home), index + 1, `${crow.id} stands on level ${index + 1}`);
      assert.ok(
        Math.abs(
          (CASTLE_SURFACE.height(crow.home.x, crow.home.z) ?? -1) - CASTLE_TIERS[index].floor,
        ) < 1.5,
        `${crow.id} stands on the measured floor of its level`,
      );
    }
  }
  for (const crow of enemies) {
    const l = castleLocal(crow.home.x, crow.home.z);
    if (crow.crowRole === 'soldier') {
      assert.ok(!inCastleHall(crow.home), `${crow.id} stands below the terraces`);
      assert.ok(l.z > 28, `${crow.id} is in the forecourt (z ${l.z.toFixed(1)})`);
    } else assert.ok(inCastleHall(crow.home), `${crow.id} stands on a terrace`);
    if (crow.crowRole === 'pontiff')
      assert.ok(l.z < -8 && l.z > -22, 'the pontiff is on the summit altar');
  }
  // Level edges along the grand central stairs: the lower half of each stair
  // still belongs to the level it leaves, the upper half to the level it climbs to.
  const soldier = enemies.find((e) => e.crowRole === 'soldier'),
    brute = enemies.find((e) => e.crowRole === 'brute'),
    shaman = enemies.find((e) => e.crowRole === 'shaman'),
    prelate = enemies.find((e) => e.crowRole === 'prelate'),
    pontiff = enemies.find((e) => e.crowRole === 'pontiff');
  assert.equal(inCrowWard(soldier, castleWorld(0, 44)), true);
  assert.equal(inCrowWard(soldier, castleWorld(0, 36)), true, 'followers may start up the stair');
  assert.equal(
    inCrowWard(soldier, castleWorld(0, 23)),
    false,
    'followers never reach the first terrace',
  );
  assert.equal(inCrowWard(brute, castleWorld(0, 23)), true);
  assert.equal(inCrowWard(brute, castleWorld(-30, 20)), true);
  assert.equal(
    inCrowWard(brute, castleWorld(0, 44)),
    false,
    'warrior monks stay off the forecourt',
  );
  assert.equal(
    inCrowWard(brute, castleWorld(-2, 9)),
    false,
    'warrior monks stay below the second terrace',
  );
  assert.equal(inCrowWard(shaman, castleWorld(-2, 9)), true);
  assert.equal(inCrowWard(shaman, castleWorld(-33, -30)), true);
  assert.equal(inCrowWard(shaman, castleWorld(0, 23)), false);
  assert.equal(
    inCrowWard(shaman, castleWorld(0, -4)),
    false,
    'hex monks stay below the third terrace',
  );
  assert.equal(inCrowWard(prelate, castleWorld(0, -4)), true);
  assert.equal(
    inCrowWard(prelate, castleWorld(-1, -20)),
    false,
    'high priests stay off the summit',
  );
  assert.equal(inCrowWard(pontiff, castleWorld(-1, -20)), true);
  assert.equal(inCrowWard(pontiff, castleWorld(0, -4)), false, 'the pontiff keeps to the summit');
  assert.equal(inCrowWard(pontiff, castleWorld(0, 44)), false);
  // Rank order in the numbers: each rank is a clear step up.
  assert.ok(CROW_ROLE_RULES.soldier.maxHealth < CROW_ROLE_RULES.shaman.maxHealth);
  assert.ok(CROW_ROLE_RULES.shaman.maxHealth < CROW_ROLE_RULES.prelate.maxHealth);
  assert.ok(CROW_ROLE_RULES.brute.maxHealth < CROW_ROLE_RULES.pontiff.maxHealth);
  assert.equal(CROW_ROLE_RULES.soldier.magic, false);
  assert.equal(CROW_ROLE_RULES.brute.magic, false);
  assert.equal(CROW_ROLE_RULES.shaman.magic, true);
  assert.ok(CROW_ROLE_RULES.shaman.attackDamage < CROW_ROLE_RULES.shaman.boltDamage);
});

test('higher ranks pray behind the seal, cannot be hurt or provoked, and each rank rises when the one below has fallen', () => {
  const { room, player, byRole, tick, notices } = castleFixture();
  let now = 2000;
  tick(now);
  assert.equal(room.crowRite.openTier, 1);
  for (const role of CROW_TIERS)
    for (const crow of byRole(role))
      assert.equal(crow.sealed, role !== 'soldier', `${crow.id} sealed=${crow.sealed}`);
  // A raider beside a praying warrior monk is ignored; the monk faces the altar and stays put.
  const brute = byRole('brute')[2];
  Object.assign(player, { x: brute.x, z: brute.z + 1.4 });
  const post = { x: brute.x, z: brute.z };
  for (let i = 0; i < 40; i++) tick((now += 50));
  assert.equal(brute.targetId, null);
  assert.equal(brute.behavior, 'pray');
  assert.equal(brute.clip, 'Idle_Loop');
  assert.ok(Math.hypot(brute.x - post.x, brute.z - post.z) < 1e-9);
  const toAltar = Math.atan2(CROW_ALTAR.x - brute.x, CROW_ALTAR.z - brute.z);
  assert.ok(
    Math.abs(Math.atan2(Math.sin(brute.facing - toAltar), Math.cos(brute.facing - toAltar))) < 1e-6,
  );
  // Spear thrusts are absorbed: no damage, no flinch, and the raider learns which rank must fall.
  player.facing = Math.atan2(brute.x - player.x, brute.z - player.z);
  startAttack(room, player, { targetId: brute.id }, now);
  const strike = resolveAttack(room, player, now + COMBAT.attackImpactMs);
  assert.equal(strike.hit, true);
  assert.equal(strike.sealed, true);
  assert.equal(brute.health, brute.maxHealth);
  assert.equal(brute.hitSequence, 0);
  assert.equal(brute.provokedBy ?? null, null);
  assert.equal(crowSealNotice(room), '祈りの結界に阻まれた。先に第一階位・黒羽の門徒を全て倒せ。');
  brute.provokedBy = player.id;
  tick((now += 50));
  assert.equal(brute.targetId, null, 'a praying rank cannot be provoked');
  // The followers fall: the warrior monks take up their axes and the raider in the keep is told.
  fell(room, ['soldier'], now);
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 2);
  assert.ok(byRole('brute').every((e) => !e.sealed));
  assert.ok(byRole('shaman').every((e) => e.sealed));
  assert.deepEqual(notices.at(-1), { id: player.id, text: CROW_RITE_TEXT[2] });
  for (let i = 0; i < 40 && brute.targetId !== player.id; i++) tick((now += 50));
  assert.equal(brute.targetId, player.id, 'the woken monk now notices the raider beside it');
  assert.equal(crowSealNotice(room), '祈りの結界に阻まれた。先に第二階位・黒羽の戦僧を全て倒せ。');
  // Then rank by rank up to the pontiff, and finally silence.
  fell(room, ['brute'], now);
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 3);
  assert.ok(byRole('shaman').every((e) => !e.sealed));
  assert.equal(notices.at(-1).text, CROW_RITE_TEXT[3]);
  fell(room, ['shaman'], now);
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 4);
  assert.ok(byRole('prelate').every((e) => !e.sealed));
  assert.equal(byRole('pontiff')[0].sealed, true);
  assert.equal(notices.at(-1).text, CROW_RITE_TEXT[4]);
  fell(room, ['prelate'], now);
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 5);
  assert.equal(byRole('pontiff')[0].sealed, false);
  assert.equal(notices.at(-1).text, CROW_RITE_TEXT[5]);
  fell(room, ['pontiff'], now);
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 6);
  assert.equal(room.crowRite.endedAt, now);
  assert.equal(notices.at(-1).text, CROW_RITE_TEXT[6]);
  // Only people in the keep were told.
  assert.ok(notices.every((n) => n.id === player.id));
});

test('a fallen rank stays fallen while the keep is held; after the pontiff falls the congregation re-forms together', () => {
  const { room, player, byRole, tick, notices, enemies } = castleFixture();
  const soldiers = byRole('soldier'),
    pontiff = byRole('pontiff')[0];
  let now = 2000;
  Object.assign(player, { x: soldiers[0].x, z: soldiers[0].z + 3 });
  tick(now);
  fell(room, ['soldier'], now);
  tick((now += 50));
  assert.ok(soldiers.every((e) => e.phase === 'respawning'));
  // Twice the respawn delay passes with the raider still in the forecourt: nobody returns.
  tick((now += ENEMY_RULES.respawnMs * 2));
  assert.ok(
    soldiers.every((e) => e.phase === 'respawning'),
    'held while the keep is occupied',
  );
  assert.ok(byRole('brute').every((e) => !e.sealed));
  // The raider leaves; the clock runs from the last moment the keep was held.
  const held = now;
  Object.assign(player, { x: 50, z: 55 });
  tick((now += 50));
  tick((now = held + ENEMY_RULES.respawnMs - 1));
  assert.ok(soldiers.every((e) => e.phase === 'respawning'));
  tick((now = held + ENEMY_RULES.respawnMs));
  assert.ok(
    soldiers.every((e) => e.phase === 'alive'),
    'the followers return once the keep has been empty long enough',
  );
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 1);
  assert.ok(
    byRole('brute').every((e) => e.sealed),
    'the seal closes again above the returned rank',
  );
  for (const soldier of soldiers) assert.ok(inCrowWard(soldier, soldier));
  // A full assault: ranks fall at different times with the raider inside, then the pontiff.
  Object.assign(player, { x: pontiff.x, z: pontiff.z + 6 });
  tick((now += 50));
  fell(room, ['soldier'], now);
  tick((now += 20000));
  fell(room, ['brute', 'shaman'], now);
  tick((now += 20000));
  fell(room, ['prelate'], now);
  tick((now += 50));
  assert.equal(pontiff.sealed, false);
  // The pontiff dies in play: its body lies for the death animation, then the rite ends.
  pontiff.health = 0;
  pontiff.alive = false;
  pontiff.phase = 'dead';
  pontiff.phaseStartedAt = now;
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 6, 'the rite ends as soon as no rank is standing');
  const ended = room.crowRite.endedAt;
  assert.equal(ended, now);
  tick((now = ended + ENEMY_RULES.deathDurationMs));
  assert.equal(pontiff.phase, 'respawning');
  // Even with the raider still standing in the hall, the whole cult returns together.
  tick((now = ended + ENEMY_RULES.respawnMs - 1));
  assert.ok(
    enemies.every((e) => e.phase === 'respawning'),
    'nobody returns early',
  );
  tick((now = ended + ENEMY_RULES.respawnMs + ENEMY_RULES.deathDurationMs));
  assert.ok(
    enemies.every((e) => e.phase === 'alive'),
    'all 28 return within one delay of the fall',
  );
  tick((now += 50));
  assert.equal(room.crowRite.openTier, 1);
  assert.equal(room.crowRite.endedAt, null);
  assert.equal(notices.at(-1).text, CROW_RITE_TEXT.reform);
  assert.ok(byRole('soldier').every((e) => !e.sealed) && byRole('pontiff')[0].sealed);
});
