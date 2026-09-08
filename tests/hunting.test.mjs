import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createAnimals, updateAnimals, actorObstacle } from '../dist/shared/animals.mjs';
import { HUNTING_GROUNDS } from '../dist/shared/scenery-layout.mjs';
import { HUNTING, handleHuntingAction, updateHunting, initialHuntState, animalIsSolid, withinSpearReach } from '../dist/shared/hunting.mjs';

function fixture() {
  const animal = { id: 'mammoth', x: 20, z: 20, radius: 2.9, home: { x: 20, z: 20 }, roamRadius: 5, age: 0, ...initialHuntState(1000) };
  const player = { id: 'hunter', x: 20, z: 24, radius: .32, facing: Math.PI, energy: 50, inventory: { rawMeat: 0, cookedMeat: 0 }, attackSequence: 0, attackAt: 0, cookingEndsAt: 0 };
  const room = { animals: [animal], players: new Map([[player.id, player]]), collision: new CollisionWorld([], { river: false }), camp: { x: 50, z: 50, level: 0 } };
  return { room, player, animal };
}

test('both mammoth grounds have a continuous body-clear roaming area and substantial natural movement', () => {
  const collision = new CollisionWorld(), animals = createAnimals(collision, 1000);
  const room = { collision, animals, players: new Map() };
  const extents = animals.map(animal => ({ minX: animal.x, maxX: animal.x, minZ: animal.z, maxZ: animal.z }));
  for (const [i, ground] of HUNTING_GROUNDS.entries()) {
    for (let x = -5; x <= 5; x += .5) for (let z = -5; z <= 5; z += .5) {
      if (Math.hypot(x, z) <= 5) assert.ok(collision.free({ x: ground.x + x, z: ground.z + z }, animals[i].radius), `Blocked roaming position ${i}: ${x},${z}`);
    }
  }
  for (let i = 0; i < 2400; i++) {
    updateAnimals(room, .05, 1000 + i * 50);
    for (const [j, animal] of animals.entries()) {
      assert.ok(collision.free(animal, animal.radius, animals.filter(other => other !== animal).map(actorObstacle)));
      assert.ok(Math.hypot(animal.x - animal.home.x, animal.z - animal.home.z) <= animal.roamRadius + .01);
      const e = extents[j]; e.minX = Math.min(e.minX, animal.x); e.maxX = Math.max(e.maxX, animal.x); e.minZ = Math.min(e.minZ, animal.z); e.maxZ = Math.max(e.maxZ, animal.z);
    }
  }
  for (const e of extents) assert.ok(e.maxX - e.minX > 5 && e.maxZ - e.minZ > 5, JSON.stringify(e));
});

test('spear damage, body reach, cooldown and solid-obstacle occlusion are authoritative', () => {
  const { room, player, animal } = fixture();
  assert.ok(withinSpearReach(player, animal));
  const hit = handleHuntingAction(room, player, { action: 'attack', damage: 9000 }, 1000);
  assert.equal(hit.changed, true); assert.equal(animal.health, 100); assert.equal(player.attackSequence, 1);
  updateHunting(room, 1000 + HUNTING.attackImpactMs - 1); assert.equal(animal.health, 100);
  updateHunting(room, 1000 + HUNTING.attackImpactMs); assert.equal(animal.health,  100 - HUNTING.attackDamage);
  assert.equal(Math.abs(player.facing), Math.PI); assert.equal(player.energy, 48);
  handleHuntingAction(room, player, { action: 'attack' }, 1400);
  assert.equal(animal.health,  100 - HUNTING.attackDamage); assert.equal(player.attackSequence, 1);
  player.z = 30;
  handleHuntingAction(room, player, { action: 'attack', x: 20, z: 20 }, 2000);
  updateHunting(room, 2000 + HUNTING.attackImpactMs);
  assert.equal(animal.health,  100 - HUNTING.attackDamage);
  player.z = 24;
  room.collision = new CollisionWorld([{ id: 'rock', type: 'box', x: 20, z: 22, hx: 1, hz: .1, c: 1, s: 0, height: 3 }], { river: false });
  assert.equal(handleHuntingAction(room, player, { action: 'attack' }, 3000).changed, true);
  updateHunting(room, 3000 + HUNTING.attackImpactMs);
  assert.equal(animal.health,  100 - HUNTING.attackDamage);
});

test('death completes once, loot is finite, and full inventories cannot destroy shared meat', () => {
  const { room, player, animal } = fixture();
  for (let i = 0; i < Math.ceil(100 / HUNTING.attackDamage); i++) {
    const now = 1000 + i * HUNTING.attackCooldownMs;
    handleHuntingAction(room, player, { action: 'attack' }, now);
    assert.equal(animal.phase, 'alive');
    updateHunting(room, now + HUNTING.attackImpactMs);
  }
  assert.equal(animal.health, 0); assert.equal(animal.phase, 'dying'); assert.equal(animal.clip, 'Death'); assert.ok(animalIsSolid(animal));
  const diedAt = animal.phaseStartedAt;
  updateHunting(room, diedAt + HUNTING.deathDurationMs - 1);
  assert.equal(animal.phase, 'dying');
  updateHunting(room, diedAt + HUNTING.deathDurationMs);
  assert.equal(animal.phase, 'meat'); assert.equal(animal.meatRemaining, 4); assert.equal(animalIsSolid(animal), false);
  const harvestAt = diedAt + HUNTING.deathDurationMs + 1;
  player.x = 20; player.z = 21; player.inventory.rawMeat = 99;
  handleHuntingAction(room, player, { action: 'harvest' }, harvestAt);
  assert.equal(animal.meatRemaining, 4);
  player.inventory.rawMeat = 0;
  for (let i = 0; i < 8; i++) handleHuntingAction(room, player, { action: 'harvest', amount: 99 }, harvestAt + i * 500);
  assert.equal(player.inventory.rawMeat, 4); assert.equal(animal.meatRemaining, 0); assert.equal(animal.phase, 'respawning');
  updateHunting(room, animal.phaseStartedAt + 1);
  assert.equal(animal.meatRemaining, 0);
});

test('windup strikes recheck range and occlusion, while concurrent lethal strikes create only one death', () => {
  const { room, player, animal } = fixture();
  handleHuntingAction(room, player, { action: 'attack' }, 1000);
  animal.x = 30; updateHunting(room, 1000 + HUNTING.attackImpactMs);
  assert.equal(animal.health, 100); assert.equal(player.pendingStrike, null);
  animal.x = 20; handleHuntingAction(room, player, { action: 'attack' }, 2000);
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: 20, z: 22, hx: 1, hz: .1, c: 1, s: 0, height: 3 }], { river: false });
  updateHunting(room, 2000 + HUNTING.attackImpactMs); assert.equal(animal.health, 100);
  room.collision = new CollisionWorld([], { river: false });
  animal.health = HUNTING.attackDamage * 4;
  for (let i = 0; i < 5; i++) {
    const hunter = { ...player, id: `hunter-${i}`, attackSequence: 0, pendingStrike: null, inventory: { ...player.inventory } };
    room.players.set(hunter.id, hunter); handleHuntingAction(room, hunter, { action: 'attack' }, 3000);
  }
  updateHunting(room, 3000 + HUNTING.attackImpactMs);
  assert.equal(animal.phase, 'dying'); assert.equal(animal.health, 0); assert.equal(animal.phaseStartedAt, 3333);
  updateHunting(room, 3333 + HUNTING.deathDurationMs);
  assert.equal(animal.phase, 'meat'); assert.equal(animal.meatRemaining, 4);
});

test('cooking uses the existing flame, completes only after three seconds, and raw meat is never edible', () => {
  const { room, player } = fixture();
  player.inventory.rawMeat = 2;
  handleHuntingAction(room, player, { action: 'eatMeat' }, 1000);
  assert.equal(player.inventory.rawMeat, 2); assert.equal(player.energy, 50);
  assert.equal(handleHuntingAction(room, player, { action: 'cook' }, 1000).tone, 'error');
  Object.assign(player, { x: 50, z: 52 });
  handleHuntingAction(room, player, { action: 'cook', duration: 0 }, 1000);
  assert.equal(player.cookingEndsAt, 4000); assert.equal(room.camp.level, 0);
  handleHuntingAction(room, player, { action: 'cook' }, 2000);
  assert.equal(player.cookingEndsAt, 4000);
  updateHunting(room, 3999); assert.equal(player.inventory.cookedMeat, 0);
  updateHunting(room, 4000); updateHunting(room, 4500);
  assert.equal(player.inventory.cookedMeat, 1); assert.equal(player.inventory.rawMeat, 1);
  handleHuntingAction(room, player, { action: 'eatMeat' }, 5000);
  assert.equal(player.energy, 95); assert.equal(player.inventory.cookedMeat, 0);
  player.inventory.cookedMeat = 1; player.energy = 100;
  handleHuntingAction(room, player, { action: 'eatMeat' }, 5500);
  assert.equal(player.inventory.cookedMeat, 1);
});

test('leaving the fire or explicit cancellation preserves raw meat and capacity is rechecked on completion', () => {
  const { room, player } = fixture(); Object.assign(player, { x: 50, z: 52 }); player.inventory.rawMeat = 2;
  handleHuntingAction(room, player, { action: 'cook' }, 1000);
  player.z = 56; updateHunting(room, 2000); assert.equal(player.cookingEndsAt, 0); assert.equal(player.inventory.rawMeat, 2);
  player.z = 52; handleHuntingAction(room, player, { action: 'cook' }, 3000);
  handleHuntingAction(room, player, { action: 'cancelCook' }, 3100); updateHunting(room, 7000);
  assert.equal(player.inventory.rawMeat, 2); assert.equal(player.inventory.cookedMeat, 0);
  player.inventory.cookedMeat = 99;
  assert.equal(handleHuntingAction(room, player, { action: 'cook' }, 8000).tone, 'error');
  player.inventory.cookedMeat = 98; handleHuntingAction(room, player, { action: 'cook' }, 9000);
  player.inventory.cookedMeat = 99; updateHunting(room, 12000);
  assert.equal(player.inventory.rawMeat, 2); assert.equal(player.inventory.cookedMeat, 99);
});

test('respawning waits for room capacity and never puts a mammoth inside players or static objects', () => {
  const { room, animal, player } = fixture();
  Object.assign(animal, { phase: 'respawning', phaseStartedAt: 1000, health: 0 });
  Object.assign(player, { x: animal.home.x, z: animal.home.z, radius: 20 });
  updateHunting(room, 1000 + HUNTING.respawnMs - 1); assert.equal(animal.phase, 'respawning');
  updateHunting(room, 1000 + HUNTING.respawnMs); assert.equal(animal.phase, 'respawning');
  player.radius = .32;
  updateHunting(room, 1001 + HUNTING.respawnMs);
  assert.equal(animal.phase, 'alive'); assert.equal(animal.health, 100);
  assert.ok(room.collision.free(animal, animal.radius, [actorObstacle(player)]));
  assert.ok(Math.hypot(animal.x - animal.home.x, animal.z - animal.home.z) <= animal.roamRadius);
});
