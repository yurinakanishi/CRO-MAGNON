import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/shared/game-core.mjs';
import { craftInventory, INVENTORY_RECIPES } from '../dist/shared/inventory-crafting.mjs';
import { confirmedAction } from '../dist/src/character-animation.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';

function fixture() {
  const player = {
    id: 'p',
    species: 'cro',
    gender: 'female',
    x: 50,
    z: 52,
    radius: 0.32,
    energy: 70,
    tool: false,
    spearHead: 'wood',
    path: [],
    inventory: {
      wood: 30,
      stone: 4,
      berry: 2,
      obsidian: 4,
      obsidianBlade: 1,
      boat: 0,
      rawMeat: 2,
      rawFish: 2,
      rawShellfish: 2,
      rawRoot: 4,
      herb: 2,
    },
  };
  const room = { camp: { x: 50, z: 50 }, collision: new CollisionWorld([], { river: false }) };
  return { room, player };
}
for (const recipe of INVENTORY_RECIPES) {
  test(`${recipe.name}: one atomic inventory transaction, no animation or world task`, () => {
    const { room, player } = fixture();
    const before = structuredClone(player);
    assert.equal(craftInventory(room, player, recipe.id, 10000).ok, true);
    for (const [key, n] of Object.entries(recipe.cost))
      assert.equal(player.inventory[key], before.inventory[key] - n);
    if (recipe.equipment === 'axe') assert.equal(player.tool, true);
    else if (recipe.equipment === 'spear') assert.equal(player.spearHead, 'obsidian');
    else assert.equal(player.inventory[recipe.output], (before.inventory[recipe.output] ?? 0) + 1);
    assert.equal(player.cookingEndsAt, undefined);
    assert.equal(player.coastalActivity, undefined);
    assert.equal(confirmedAction(before, player), null);
    if (recipe.id === 'blade') assert.equal(player.inventory.stone, before.inventory.stone);
  });
}
test('unavailable states and invalid recipes do not consume or grant anything', () => {
  for (const state of [
    { downedUntil: 11000 },
    { boatId: 'b' },
    { mountId: 'a' },
    { carrierId: 'c' },
    { passengerId: 'p' },
    { cookingEndsAt: 11000 },
    { fishing: {} },
    { coastalActivity: {} },
    { jumpSequence: 1, jumpAt: 9900 },
    { attackSequence: 1, attackAt: 9900 },
  ]) {
    for (const recipe of INVENTORY_RECIPES) {
      const { room, player } = fixture();
      Object.assign(player, state);
      const before = structuredClone(player);
      assert.equal(craftInventory(room, player, recipe.id, 10000).ok, false);
      assert.deepEqual(player, before);
    }
  }
  const { room, player } = fixture(),
    before = structuredClone(player);
  for (const id of ['unknown', null, {}, '__proto__'])
    assert.equal(craftInventory(room, player, id, 10000).ok, false);
  assert.deepEqual(player, before);
});
test('shortages, full stacks, duplicate equipment, non-spear characters and fire access are authoritative', () => {
  const cases = [
    ['boat', (p) => (p.inventory.wood = 11)],
    ['boat', (p) => (p.inventory.boat = 99)],
    ['axe', (p) => (p.tool = true)],
    ['spear', (p) => (p.spearHead = 'obsidian')],
    ['spear', (p) => (p.species = 'cat')],
    ['blade', (p) => (p.inventory.stone = 0)],
    ['blade', (p) => (p.inventory.obsidianBlade = 99)],
    ['herbRoot', (p) => (p.inventory.herb = 0)],
    ['meat', (p) => (p.inventory.cookedMeat = 99)],
    ['root', (p) => (p.x = 90)],
  ];
  for (const [id, prepare] of cases) {
    const { room, player } = fixture();
    prepare(player);
    const before = structuredClone(player);
    assert.equal(craftInventory(room, player, id, 10000).ok, false, id);
    assert.deepEqual(player, before);
  }
  const { room, player } = fixture();
  room.collision = { segmentFree: () => false };
  assert.equal(craftInventory(room, player, 'meat', 10000).ok, false);
});

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  handlers = {};
  messages = [];
  on(key, handler) {
    this.handlers[key] = handler;
  }
  send(raw) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  input(message) {
    this.handlers.message(Buffer.from(JSON.stringify(message)), false);
  }
}
test('five peers receive the crafted inventory; rapid requests acknowledge success and failure; save restores equipment', () => {
  const core = createGameCore({ keepEmptyRooms: true }),
    peers = [];
  let restored;
  try {
    for (let i = 0; i < 5; i++) {
      const socket = new Socket();
      core.connect(
        socket,
        new URLSearchParams({
          room: 'CRAFT-QA',
          name: `P${i}`,
          species: 'cro',
          gender: 'female',
          resume: '1',
        }),
      );
      peers.push(socket);
    }
    const room = core.rooms.get('CRAFT-QA'),
      player = [...room.players.values()][0];
    Object.assign(player.inventory, { wood: 27, stone: 2, obsidianBlade: 1 });
    const request = (id) =>
      peers[0].input({ type: 'action', action: 'inventoryCraft', targetId: id });
    request('axe');
    request('spear');
    request('boat');
    request('boat');
    assert.deepEqual(
      peers[0].messages.filter((m) => m.type === 'inventoryCraftResult').map((m) => m.ok),
      [true, true, true, false],
    );
    assert.equal(player.inventory.wood, 11);
    assert.equal(player.inventory.boat, 1);
    assert.equal(room.boats.length, 0);
    for (const peer of peers) {
      const state = peer.messages.filter((m) => m.type === 'state').at(-1);
      const copy = state.players.find((p) => p.id === player.id);
      assert.equal(copy.tool, true);
      assert.equal(copy.spearHead, 'obsidian');
      assert.equal(copy.inventory.boat, 1);
      assert.equal(copy.inventory.wood, 11);
    }
    player.downedUntil = Date.now() + 10000;
    request('boat');
    assert.equal(peers[0].messages.at(-1).type, 'inventoryCraftResult');
    assert.equal(peers[0].messages.at(-1).ok, false);
    restored = createGameCore({ keepEmptyRooms: true });
    restored.importState(JSON.parse(JSON.stringify(core.exportState())));
    restored.connect(
      new Socket(),
      new URLSearchParams({
        room: 'CRAFT-QA',
        resume: '1',
        session: peers[0].messages.find((message) => message.type === 'welcome').session,
      }),
    );
    const saved = [...restored.rooms.get('CRAFT-QA').players.values()][0];
    assert.equal(saved.tool, true);
    assert.equal(saved.spearHead, 'obsidian');
    assert.deepEqual(saved.inventory, player.inventory);
  } finally {
    restored?.close();
    core.close();
  }
});
