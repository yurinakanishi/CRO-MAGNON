import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMeal, HEAL_REPEAT_MS } from '../dist/shared/pantry.mjs';
import { createActionHandler } from '../dist/application/actions.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

test('one press picks the meal that fits the missing energy, else the smallest carried', () => {
  assert.equal(chooseMeal({ energy: 100, inventory: { berry: 3, cookedMeat: 2 } }), null);
  assert.equal(chooseMeal({ energy: 40, inventory: {} }), null);
  assert.equal(chooseMeal({ energy: 70, inventory: { berry: 1, cookedMeat: 2 } }).id, 'berry');
  assert.equal(chooseMeal({ energy: 50, inventory: { berry: 1, cookedMeat: 2 } }).id, 'cookedMeat');
  assert.equal(chooseMeal({ energy: 90, inventory: { berry: 1, cookedMeat: 2 } }).id, 'berry');
  assert.equal(
    chooseMeal({ energy: 95, inventory: { cookedShellfish: 1, cookedMeat: 2 } }).id,
    'cookedShellfish',
  );
  assert.equal(chooseMeal({ energy: 40, inventory: { herbRoot: 1, cookedRoot: 1 } }).id, 'herbRoot');
});

test('the heal action eats through the food handlers with a short repeat guard', () => {
  const notices = [];
  const act = createActionHandler({
    notice: (player, text, tone) => notices.push({ text, tone }),
    broadcast: () => {},
    snapshot: () => ({}),
    systemChat: () => {},
    runtime: { now: () => 5000 },
  });
  const player = {
    id: 'p',
    x: 40,
    z: 40,
    radius: 0.32,
    species: 'human',
    gender: 'female',
    energy: 60,
    inventory: { berry: 2, cookedMeat: 1 },
    attackSequence: 0,
    attackAt: 0,
    cookingEndsAt: 0,
  };
  const room = {
    players: new Map([[player.id, player]]),
    enemies: [],
    animals: [],
    residents: [],
    collision: new CollisionWorld([], { river: false }),
    camp: { x: 50, z: 50 },
    gulf: { pantries: [] },
  };
  act(room, player, { action: 'heal' }, 5000);
  assert.equal(player.energy, 85, 'berry (25) fits the missing 40 better than meat (45)');
  assert.equal(player.inventory.berry, 1);
  act(room, player, { action: 'heal' }, 5000 + HEAL_REPEAT_MS - 1);
  assert.equal(player.energy, 85, 'a repeat inside the guard is ignored');
  act(room, player, { action: 'heal' }, 5000 + HEAL_REPEAT_MS);
  assert.equal(player.energy, 100);
  assert.equal(player.inventory.berry, 0);
  act(room, player, { action: 'heal' }, 6000);
  assert.equal(player.inventory.cookedMeat, 1, 'nothing is eaten at full energy');
  assert.match(notices.at(-1).text, /満タン/);
  player.energy = 10;
  player.inventory = {};
  act(room, player, { action: 'heal' }, 7000);
  assert.match(notices.at(-1).text, /食べ物がありません/);
});
