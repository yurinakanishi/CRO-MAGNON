import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionHandler } from '../dist/application/actions.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

test('removed auto-heal action does not eat; explicit inventory food actions still heal', () => {
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
  assert.equal(player.energy, 60);
  assert.deepEqual(player.inventory, { berry: 2, cookedMeat: 1 });
  act(room, player, { action: 'eat' }, 6000);
  assert.equal(player.energy, 85);
  assert.equal(player.inventory.berry, 1);
  player.energy = 40;
  act(room, player, { action: 'eatMeat' }, 7000);
  assert.equal(player.energy, 85);
  assert.equal(player.inventory.cookedMeat, 0);
});
