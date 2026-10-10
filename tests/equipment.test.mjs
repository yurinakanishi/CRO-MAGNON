import test from 'node:test';
import assert from 'node:assert/strict';
import { equippedItem, ownsEquipment } from '../dist/shared/equipment.mjs';
import { equipItem } from '../dist/shared/equipment-actions.mjs';
import { craftInventory } from '../dist/shared/inventory-crafting.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { canStartAttack } from '../dist/src/combat-input.js';
import { createActionHandler } from '../dist/application/actions.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

function fixture() {
  const player = {
    id: 'p',
    species: 'cro',
    gender: 'female',
    x: 20,
    z: 20,
    facing: 0,
    radius: 0.32,
    energy: 100,
    tool: true,
    spearHead: 'obsidian',
    inventory: { wood: 20, stone: 5, berry: 0, obsidianBlade: 1 },
    path: [],
  };
  const room = {
    players: new Map([[player.id, player]]),
    animals: [],
    enemies: [],
    collision: new CollisionWorld([], { river: false }),
    camp: { x: 20, z: 18 },
  };
  return { player, room };
}

test('legacy ownership resolves to one weapon; an invalid/unowned slot never equips an axe', () => {
  const { player } = fixture();
  assert.equal(equippedItem(player), 'obsidianSpear');
  player.tool = false;
  player.equippedItem = 'axe';
  assert.equal(equippedItem(player), 'obsidianSpear');
  assert.equal(ownsEquipment(player, 'axe'), false);
  player.species = 'cat';
  assert.equal(equippedItem(player), 'character');
  assert.equal(ownsEquipment(player, 'obsidianSpear'), false);
});

test('crafting a spear while holding wood spear or axe keeps the old selection until equipping', () => {
  for (const selected of ['spear', 'axe', undefined]) {
    const { player, room } = fixture();
    player.spearHead = 'wood';
    player.equippedItem = selected;
    const previous = equippedItem(player);
    const result = craftInventory(room, player, 'spear', 10000);
    assert.equal(result.ok, true);
    assert.equal(result.equipment, 'obsidianSpear');
    assert.equal(equippedItem(player), previous);
    assert.equal(attackProfile(player).damage, 15);
    assert.equal(equipItem(player, 'obsidianSpear', 10000).ok, true);
    assert.equal(equippedItem(player), 'obsidianSpear');
    assert.equal(attackProfile(player).damage, 30);
    assert.equal(player.tool, true);
  }
});

test('crafting an axe leaves the spear equipped and ownership intact when switching either way', () => {
  const { player, room } = fixture();
  player.tool = false;
  const before = equippedItem(player);
  assert.equal(craftInventory(room, player, 'axe', 10000).equipment, 'axe');
  assert.equal(equippedItem(player), before);
  const inventory = structuredClone(player.inventory);
  for (const id of ['axe', 'obsidianSpear', 'spear', 'axe']) {
    assert.equal(equipItem(player, id, 10000).ok, true);
    assert.equal(equippedItem(player), id);
    assert.equal(player.tool, true);
    assert.equal(player.spearHead, 'obsidian');
    assert.deepEqual(player.inventory, inventory);
  }
});

test('invalid, unowned and busy equip requests are atomic and do not interrupt a strike', () => {
  for (const [id, state] of [
    ['unknown', {}],
    [null, {}],
    [{}, {}],
    ['__proto__', {}],
    ['axe', { tool: false }],
    ['obsidianSpear', { spearHead: 'wood' }],
    ['character', {}],
    ['spear', { species: 'cat' }],
    ['axe', { downedUntil: 11000 }],
    ['axe', { mountId: 'a' }],
    ['axe', { boatId: 'b' }],
    ['axe', { carrierId: 'p' }],
    ['axe', { passengerId: 'p' }],
    ['axe', { jumpAt: 9900, jumpSequence: 1 }],
    ['axe', { cookingEndsAt: 11000 }],
    ['axe', { fishing: {} }],
    ['axe', { coastalActivity: {} }],
    ['axe', { attackAt: 9900, attackSequence: 1, pendingStrike: { kind: 'obsidianSpear' } }],
  ]) {
    const { player } = fixture();
    Object.assign(player, state);
    const before = structuredClone(player);
    assert.equal(equipItem(player, id, 10000).ok, false);
    assert.deepEqual(player, before);
  }
});

test('axe cannot silently attack with the stored spear; choosing a spear enables its actual damage', () => {
  const { player, room } = fixture();
  room.animals.push({
    id: 'a',
    x: 20,
    z: 22,
    radius: 0.7,
    phase: 'alive',
    health: 100,
    maxHealth: 100,
  });
  equipItem(player, 'axe', 10000);
  assert.equal(canStartAttack(player, 10000), false);
  assert.equal(startAttack(room, player, {}, 10000).accepted, false);
  assert.equal(player.attackSequence, undefined);
  equipItem(player, 'spear', 10000);
  assert.equal(canStartAttack(player, 10000), true);
  assert.equal(startAttack(room, player, {}, 10000).accepted, true);
  resolveAttack(room, player, 10333);
  assert.equal(room.animals[0].health, 85);
  equipItem(player, 'obsidianSpear', 11000);
  startAttack(room, player, {}, 11000);
  resolveAttack(room, player, 11333);
  assert.equal(room.animals[0].health, 55);
});

test('gathering applies the axe bonus only when that slot is selected', () => {
  const { player, room } = fixture();
  room.resources = [{ id: 'wood', type: 'wood', x: 20, z: 20, amount: 20 }];
  const act = createActionHandler({
    notice() {},
    broadcast() {},
    snapshot() {},
    systemChat() {},
    runtime: { now: () => 10000 },
  });
  for (const [id, amount] of [
    ['spear', 1],
    ['axe', 2],
    ['obsidianSpear', 1],
  ]) {
    equipItem(player, id, 10000);
    const before = player.inventory.wood;
    act(room, player, { action: 'gather', targetId: 'wood' }, 10000);
    assert.equal(player.inventory.wood - before, amount);
  }
});

test('native character attacks and the axe also share the one equipment slot', () => {
  const { player } = fixture();
  player.species = 'cat';
  for (const id of ['axe', 'character']) {
    assert.equal(equipItem(player, id, 10000).ok, true);
    assert.equal(equippedItem(player), id);
    assert.equal(canStartAttack(player, 10000), id === 'character');
  }
});
