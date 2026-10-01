import test from 'node:test';
import assert from 'node:assert/strict';
import { characterModel, normalizeCharacter, isCarryable } from '../dist/shared/characters.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { handleCharacterSwitch } from '../dist/shared/character-switching.mjs';
import { characterChoicesMarkup, parseCharacterValue } from '../dist/src/character-selection.js';

function fixture(obstacles = []) {
  const player = {
    id: 'maruimo', species: 'maruimo', gender: 'male', x: 20, z: 20,
    radius: .6, facing: 0, energy: 90, attackAt: 0, attackSequence: 0,
    inventory: { wood: 7, stone: 8, berry: 3 },
  };
  return { player, room: {
    players: new Map([[player.id, player]]), animals: [], enemies: [],
    collision: new CollisionWorld(obstacles, { river: false }),
    camp: { x: 10, z: 10 }, projectiles: [],
  } };
}
const target = (id, x, z) => ({ id, x, z, radius: .35, health: 75, maxHealth: 75, hostile: true, phase: 'alive' });

test('Maruimo is selectable, survives saved-profile normalization and keeps the octopus body plan', () => {
  assert.deepEqual(normalizeCharacter({ species: 'maruimo', gender: 'female' }), { species: 'maruimo', gender: 'male' });
  assert.deepEqual(parseCharacterValue('maruimo-male'), { species: 'maruimo', gender: 'male' });
  assert.equal(characterModel({ species: 'maruimo' }).bodyPlan, 'octopus');
  assert.equal(isCarryable({ species: 'maruimo' }), false);
  assert.equal(attackProfile({ species: 'maruimo', spearHead: 'obsidian' }).key, 'tentacle');
  assert.match(characterChoicesMarkup(), /value="maruimo-male"/);
  assert.match(characterChoicesMarkup(), /models\/maruimo-octopus\/portrait.png/);
});

test('tentacle attack uses server timing, reach, facing, energy and one hit instead of client damage', () => {
  const { player, room } = fixture();
  const near = target('near', 20, 21.3), far = target('far', 20, 23.4), behind = target('behind', 20, 19);
  room.enemies.push(near, far, behind);
  assert.equal(startAttack(room, player, { damage: 999, impactMs: 0 }, 1000).accepted, true);
  assert.equal(resolveAttack(room, player, 1399), null);
  resolveAttack(room, player, 1400);
  assert.equal(near.health, 53);
  assert.equal(far.health, 75);
  assert.equal(behind.health, 75);
  assert.equal(player.energy, 87);
  assert.equal(room.projectiles.length, 0);
  assert.equal(resolveAttack(room, player, 1450), null);
  assert.equal(near.health, 53);
  assert.equal(startAttack(room, player, {}, 2099).reason, 'cooldown');
  assert.equal(startAttack(room, player, {}, 2100).accepted, true);
});

test('tentacle does not pass through a wall or damage another player', () => {
  const { player, room } = fixture([{ type: 'box', x: 20, z: 20.8, hx: 2, hz: .04, c: 1, s: 0, height: 2 }]);
  const blocked = target('blocked', 20, 21.3), friend = target('friend', 20, 20.5);
  room.enemies.push(blocked);
  room.players.set(friend.id, friend);
  startAttack(room, player, {}, 1000);
  resolveAttack(room, player, 1400);
  assert.equal(blocked.health, 75);
  assert.equal(friend.health, 75);
});

test('switching to and from Maruimo preserves inventory and restores the chosen weapon', () => {
  const { player, room } = fixture();
  player.species = 'cro'; player.gender = 'female'; player.tool = true; player.spearHead = 'obsidian';
  const inventory = player.inventory;
  assert.equal(handleCharacterSwitch(room, player, { targetId: 'maruimo-octopus' }, 10000).ok, true);
  assert.equal(player.species, 'maruimo');
  assert.equal(player.radius, .6);
  assert.equal(player.inventory, inventory);
  assert.equal(attackProfile(player).key, 'tentacle');
  assert.equal(handleCharacterSwitch(room, player, { targetId: 'cro-magnon-woman' }, 11000).ok, true);
  assert.equal(attackProfile(player).id, 'obsidianSpear');
  assert.equal(player.inventory, inventory);
});
