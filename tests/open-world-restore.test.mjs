import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';

async function join(game, name, species, expected = () => true, session = '') {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${game.address().port}/ws?${new URLSearchParams({ room: 'FANTASY-QA', name, species, gender: 'female', resume: '1', session })}`,
    );
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Restore snapshot timed out'));
    }, 3000);
    socket.on('error', reject);
    let token;
    socket.on('message', (bytes) => {
      const state = JSON.parse(bytes);
      if (state.type === 'welcome') token = state.session;
      if (state.type === 'state' && expected(state)) {
        clearTimeout(timer);
        resolve({ socket, state, token });
      }
    });
  });
}

test('a restored application core preserves inventories, resources and hunting phases through the Node adapter', async (t) => {
  const originalCore = createGameCore();
  const original = createGameServer({
    core: originalCore,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
  });
  await original.listen();
  t.after(async () => {
    if (original.server.listening) await original.close();
  });
  const firstCat = await join(original, '旅人猫', 'cat'),
    firstBear = await join(original, '旅人熊', 'bear');
  const room = original.rooms.get('FANTASY-QA'),
    players = [...room.players.values()];
  Object.assign(players[0], {
    x: -115,
    z: -96,
    tool: true,
    gathered: 7,
    energy: 63,
    inventory: { wood: 12, stone: 9, berry: 4, rawMeat: 2, cookedMeat: 3, obsidian: 0, seed: 0, water: 0 },
  });
  Object.assign(players[1], {
    x: 207,
    z: -107,
    inventory: { wood: 3, stone: 8, berry: 2, rawMeat: 1, cookedMeat: 4, obsidian: 0, seed: 0, water: 0 },
  });
  room.resources[0].amount = 1;
  room.camp.wood = 8;
  room.camp.stone = 4;
  Object.assign(room.animals[0], { phase: 'meat', health: 0, meatRemaining: 3 });
  Object.assign(room.enemies[0], {
    phase: 'respawning',
    health: 0,
    alive: false,
    phaseStartedAt: Date.now(),
  });
  const beforeSnapshot = original.snapshot(room, true);
  const saved = originalCore.exportState();
  await original.close();
  const restoredCore = createGameCore();
  restoredCore.importState(saved);
  const restored = createGameServer({
    core: restoredCore,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
  });
  await restored.listen();
  t.after(() => restored.close());
  const cat = await join(
    restored,
    '旅人猫',
    'cat',
    (s) => s.players.some((p) => p.name === '旅人猫' && p.inventory.rawMeat === 2),
    firstCat.token,
  );
  const bear = await join(
    restored,
    '旅人熊',
    'bear',
    (s) => s.players.some((p) => p.name === '旅人熊' && p.inventory.cookedMeat === 4),
    firstBear.token,
  );
  for (const before of beforeSnapshot.players) {
    const after = bear.state.players.find((p) => p.name === before.name);
    assert.deepEqual(after.inventory, before.inventory);
    assert.equal(after.x, before.x);
    assert.equal(after.z, before.z);
    assert.equal(after.species, before.species);
  }
  assert.equal(cat.state.worldVersion, 3);
  assert.equal(cat.state.combatVersion, 3);
  assert.equal(cat.state.characterVersion, 2);
  assert.equal(cat.state.players.find((p) => p.name === '旅人猫').gathered, 7);
  assert.deepEqual(cat.state.cookingFires, beforeSnapshot.cookingFires);
  assert.deepEqual(cat.state.projectiles, []);
  assert.equal(cat.state.animals[0].phase, 'meat');
  assert.equal(cat.state.animals[0].meatRemaining, 3);
  assert.equal(cat.state.enemies[0].phase, 'respawning');
  assert.equal(cat.state.enemies[0].health, 0);
  assert.equal(cat.state.resources[0].amount, 1);
  assert.equal(cat.state.camp.wood, 8);
});
