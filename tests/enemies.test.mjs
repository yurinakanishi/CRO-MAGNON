import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { createEnemies, updateEnemies, ENEMY_RULES, ENEMY_GROUNDS } from '../dist/shared/enemies.mjs';
import { createAnimals, updateAnimals, actorObstacle } from '../dist/shared/animals.mjs';
import { COMBAT, enemyIsSolid, startAttack, resolveAttack } from '../dist/shared/combat.mjs';

function fixture(collision = new CollisionWorld([], { river: false })) {
  const enemy = createEnemies(collision, [], 1000)[0];
  const player = { id: 'player', x: enemy.x, z: enemy.z + 1.3, radius: .32, facing: Math.PI, energy: 100, inventory: { wood: 3, stone: 1, rawMeat: 2, cookedMeat: 1 }, hurtSequence: 0, hurtAt: 0, defeatSequence: 0, downedUntil: 0, invulnerableUntil: 0, attackSequence: 0, attackAt: 0, cookingEndsAt: 0 };
  const room = { players: new Map([[player.id, player]]), enemies: [enemy], animals: [], collision, camp: { x: 50, z: 50 } };
  return { room, enemy, player };
}

test('crow clearing is body-clear, away from camp, and patrols use real static collision', () => {
  const collision = new CollisionWorld(), animals = createAnimals(collision, 1000), enemies = createEnemies(collision, animals, 1000);
  const room = { collision, animals, enemies, players: new Map(), camp: { x: 50, z: 50 } }, enemy = enemies[0], ground = ENEMY_GROUNDS[0];
  assert.ok(Math.hypot(enemy.x - 50, enemy.z - 50) > ENEMY_RULES.leashRadius + ENEMY_RULES.campSafeRadius);
  for (let x = -3.2; x <= 3.2; x += .4) for (let z = -3.2; z <= 3.2; z += .4) if (Math.hypot(x, z) <= 3.2) assert.ok(collision.free({ x: ground.x + x, z: ground.z + z }, enemy.radius));
  let minX = enemy.x, maxX = enemy.x, minZ = enemy.z, maxZ = enemy.z;
  for (let i = 0; i < 2400; i++) {
    const now = 1000 + i * 50; updateAnimals(room, .05, now); updateEnemies(room, .05, now);
    for (const actor of [...animals, ...enemies]) assert.ok(collision.free(actor, actor.radius, [...animals, ...enemies].filter(other => other !== actor).map(actorObstacle)));
    minX = Math.min(minX, enemy.x); maxX = Math.max(maxX, enemy.x); minZ = Math.min(minZ, enemy.z); maxZ = Math.max(maxZ, enemy.z);
  }
  assert.ok(maxX - minX > 5 && maxZ - minZ > 5); assert.equal(enemy.attackSequence, 0);
});

test('crow notices nearby players, chases, winds up, and damages once per staff swing', () => {
  const { room, enemy, player } = fixture(); player.z = enemy.z + 6;
  let now = 2000;
  updateEnemies(room, .05, now); assert.equal(enemy.targetId, player.id); assert.equal(enemy.behavior, 'chase'); assert.ok(enemy.speed > 0);
  while (!enemy.attackSequence && now < 7000) { now += 50; updateEnemies(room, .05, now); }
  assert.equal(enemy.attackSequence, 1); assert.equal(enemy.clip, 'Attack'); assert.equal(player.energy, 100);
  assert.ok(Math.hypot(enemy.x - player.x, enemy.z - player.z) <= 1.4 + 1e-9, 'AI must approach within the visible staff contact distance');
  assert.equal(overlap(player, player.radius, actorObstacle(enemy)), null);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackImpactMs - 1); assert.equal(player.energy, 100);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackImpactMs); assert.equal(player.energy, 85); assert.equal(player.hurtSequence, 1);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackDurationMs); assert.equal(player.energy, 85);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackCooldownMs - 1); assert.equal(enemy.attackSequence, 1);
  updateEnemies(room, 0, enemy.attackAt + ENEMY_RULES.attackCooldownMs); assert.equal(enemy.attackSequence, 2);
});

test('staff damage uses the measured short contact range, including after windup', () => {
  const { room, enemy, player } = fixture();
  player.z = enemy.z + 1.9;
  updateEnemies(room, 0, 2000);
  assert.equal(enemy.behavior, 'chase'); assert.equal(enemy.attackSequence, 0);
  player.z = enemy.z + 1.45;
  updateEnemies(room, 0, 2050); assert.equal(enemy.attackSequence, 0);
  player.z = enemy.z + 1.4;
  updateEnemies(room, 0, 2100); assert.equal(enemy.attackSequence, 1);
  player.z = enemy.z + 1.45;
  updateEnemies(room, 0, 2550); assert.equal(player.energy, 100); assert.equal(player.hurtSequence, 0);
  player.z = enemy.z + 1.4;
  updateEnemies(room, 0, 3900); assert.equal(enemy.attackSequence, 2);
  updateEnemies(room, 0, 4350); assert.equal(player.energy, 85); assert.equal(player.hurtSequence, 1);
});

test('staff impacts recheck range and walls; hitting the crow interrupts its windup', () => {
  const { room, enemy, player } = fixture();
  updateEnemies(room, 0, 2000); assert.equal(enemy.attackSequence, 1);
  player.z = enemy.z + 4; updateEnemies(room, 0, 2450); assert.equal(player.energy, 100);
  player.z = enemy.z + 1.3; updateEnemies(room, 0, 3800); assert.equal(enemy.attackSequence, 2);
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: enemy.x, z: enemy.z + .75, hx: 2, hz: .12, c: 1, s: 0, height: 3 }], { river: false });
  updateEnemies(room, 0, 4250); assert.equal(player.energy, 100);
  room.collision = new CollisionWorld([], { river: false }); updateEnemies(room, 0, 5600);
  startAttack(room, player, { targetId: enemy.id }, 5650);
  const hit = resolveAttack(room, player, 5650 + COMBAT.attackImpactMs);
  assert.equal(hit.target, enemy); assert.equal(enemy.health, 75 - COMBAT.attackDamage); assert.equal(enemy.pendingAttack, null); assert.equal(enemy.hitSequence, 1);
  updateEnemies(room, 0, 5650 + COMBAT.attackImpactMs); assert.equal(enemy.clip, 'Hit');
  updateEnemies(room, 0, 6050); assert.equal(player.energy, 98); assert.equal(player.hurtSequence, 0);
});

test('line of sight gates aggro, pursuit paths avoid walls, and leash returns without teleporting', () => {
  const { room, enemy, player } = fixture(); player.z = enemy.z + 6;
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: enemy.x, z: enemy.z + 3, hx: 1, hz: .3, c: 1, s: 0, height: 3 }], { river: false });
  updateEnemies(room, 0, 2000); assert.equal(enemy.targetId, null);
  room.collision = new CollisionWorld([], { river: false }); updateEnemies(room, .05, 2050); assert.equal(enemy.targetId, player.id);
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: enemy.home.x, z: enemy.home.z + 3, hx: 1, hz: .3, c: 1, s: 0, height: 3 }], { river: false });
  for (let i = 0; i < 80; i++) { updateEnemies(room, .05, 2100 + i * 50); assert.ok(room.collision.free(enemy, enemy.radius)); }
  assert.ok(Math.abs(enemy.x - enemy.home.x) > .5 || enemy.z > enemy.home.z + 3.5, 'The chase must route around the wall');
  const hurtsBeforeLeash = player.hurtSequence;
  player.z = enemy.home.z + ENEMY_RULES.leashRadius + 1;
  const before = { x: enemy.x, z: enemy.z }; updateEnemies(room, .05, 7000);
  assert.equal(enemy.targetId, null); assert.equal(enemy.behavior, 'return'); assert.ok(Math.hypot(enemy.x - before.x, enemy.z - before.z) <= ENEMY_RULES.chaseSpeed * .05 + .001);
  for (let i = 0; i < 140; i++) updateEnemies(room, .05, 7050 + i * 50);
  assert.ok(Math.hypot(enemy.x - enemy.home.x, enemy.z - enemy.home.z) <= enemy.roamRadius + .01);
  assert.equal(player.hurtSequence, hurtsBeforeLeash);
});

test('camp and recovery protection prevent crow attacks', () => {
  const { room, enemy, player } = fixture();
  Object.assign(enemy, { x: 49, z: 41, home: { x: 49, z: 41 } }); Object.assign(player, { x: 49, z: 43 });
  updateEnemies(room, 0, 2000); assert.equal(enemy.targetId, null); assert.equal(enemy.attackSequence, 0);
  Object.assign(enemy, { x: 45, z: 16, home: { x: 45, z: 16 } }); Object.assign(player, { x: 45, z: 17.3, invulnerableUntil: 6000 });
  updateEnemies(room, 0, 3000); assert.equal(enemy.targetId, null);
  updateEnemies(room, 0, 6000); assert.equal(enemy.attackSequence, 1);
});

test('lethal staff damage pauses play then safely returns to camp, preserving every inventory item', () => {
  const { room, enemy, player } = fixture(); const inventory = { ...player.inventory }; player.energy = 10;
  updateEnemies(room, 0, 2000); updateEnemies(room, 0, 2450);
  assert.equal(player.energy, 0); assert.equal(player.downedUntil, 6450); assert.equal(player.defeatSequence, 1); assert.equal(player.hurtSequence, 1);
  assert.equal(startAttack(room, player, {}, 3000).reason, 'downed');
  updateEnemies(room, 0, 6449); assert.equal(player.energy, 0);
  updateEnemies(room, 0, 6450);
  assert.equal(player.energy, 50); assert.equal(player.downedUntil, 0); assert.equal(player.invulnerableUntil, 11450);
  assert.ok(Math.hypot(player.x - room.camp.x, player.z - room.camp.z) < 5);
  assert.deepEqual(player.inventory, inventory); assert.equal(player.pendingStrike, null); assert.equal(player.cookingEndsAt, 0);
  assert.ok(room.collision.free(player, player.radius, [actorObstacle(enemy)]));
});

test('wooden spear hits kill the crow; death remains briefly solid, then safe respawn restores health without loot', () => {
  const { room, enemy, player } = fixture();
  for (let i = 0; i < Math.ceil(75 / COMBAT.attackDamage); i++) {
    const now = 2000 + i * COMBAT.attackCooldownMs; startAttack(room, player, { targetId: enemy.id }, now); resolveAttack(room, player, now + COMBAT.attackImpactMs);
  }
  assert.equal(enemy.health, 0); assert.equal(enemy.phase, 'dead'); assert.equal(enemyIsSolid(enemy), true); assert.equal(enemy.meatRemaining, undefined);
  const diedAt = enemy.phaseStartedAt;
  updateEnemies(room, 0, diedAt + ENEMY_RULES.deathDurationMs - 1); assert.equal(enemy.phase, 'dead');
  updateEnemies(room, 0, diedAt + ENEMY_RULES.deathDurationMs); assert.equal(enemy.phase, 'respawning'); assert.equal(enemyIsSolid(enemy), false);
  const respawnAt = enemy.phaseStartedAt + ENEMY_RULES.respawnMs;
  Object.assign(player, { x: enemy.home.x, z: enemy.home.z, radius: 20 });
  updateEnemies(room, 0, respawnAt); assert.equal(enemy.phase, 'respawning');
  player.radius = .32; updateEnemies(room, 0, respawnAt + 1);
  assert.equal(enemy.phase, 'alive'); assert.equal(enemy.alive, true); assert.equal(enemy.health, 75);
  assert.equal(enemy.hitSequence, Math.ceil(75 / COMBAT.attackDamage)); assert.ok(room.collision.free(enemy, enemy.radius, [actorObstacle(player)]));
  assert.equal(player.inventory.rawMeat, 2);
});
