import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { caveInteriorWeight, caveTorchAvailable } from '../dist/shared/cave-light.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { canStartAttack, attackBlockReason } from '../dist/src/combat-input.js';
import { attackReady } from '../dist/src/hunting-ui.js';
import { createGameCore } from '../dist/application/game-core.mjs';
import { canHandleBot, canThrowBot, handleOrbBotAction, updateOrbBots } from '../dist/shared/orb-bots.mjs';

function fixture(character = CHARACTER_MODELS[0]) {
  const player = {
    id: 'p', species: character.species, gender: character.gender,
    ...caveWorldAt(-21), facing: 0, radius: 0.32, energy: 80,
    attackSequence: 0, attackAt: 0, cookingEndsAt: 0, tool: true,
    inventory: { wood: 7, stone: 3 },
  };
  const animal = { id: 'a', x: player.x, z: player.z + 1, radius: 0.5, phase: 'alive', health: 100 };
  const room = {
    players: new Map([[player.id, player]]), animals: [animal], enemies: [],
    collision: { segmentFree: () => true, surfaceHeight: () => 0 },
  };
  return { player, animal, room };
}

test('all nine characters reject cave attacks with lit and unlit torches, without spending or interrupting', () => {
  for (const character of CHARACTER_MODELS) {
    for (const caveTorchOff of [false, true]) {
      const { room, player, animal } = fixture(character);
      Object.assign(player, { caveTorchOff, cookingEndsAt: 20000, dx: 1, moving: true });
      const before = structuredClone(player);
      assert.equal(canStartAttack(player, 10000), false, character.id);
      assert.match(attackBlockReason(player, 10000), /洞窟/);
      assert.equal(attackReady(player, animal), false);
      assert.equal(caveTorchAvailable(player), true);
      assert.deepEqual(startAttack(room, player, { targetId: animal.id }, 10000), { accepted: false, reason: 'cave' });
      assert.deepEqual(player, before);
      assert.equal(animal.health, 100);
    }
  }
});

test('the measured mouth restricts attacks while the apron, solid rock and mountain above keep outdoor attacks', () => {
  const { room, player } = fixture();
  for (const point of [caveWorldAt(10), caveWorldAt(5), caveWorldAt(-21)]) {
    Object.assign(player, point);
    assert.ok(caveInteriorWeight(player) > 0);
    assert.equal(startAttack(room, player, {}, 10000).reason, 'cave');
  }
  for (const point of [caveWorldAt(13), { ...caveWorldAt(-21), y: 40 }, caveWorldAt(-21, 35)]) {
    Object.assign(player, point, { attackSequence: 0 });
    assert.equal(caveInteriorWeight(player), 0);
    assert.equal(canStartAttack(player, 10000), true);
    assert.equal(startAttack(room, player, {}, 10000).accepted, true);
  }
});

test('arrival in the cave during windup cancels both melee impact and spell release', () => {
  for (const character of CHARACTER_MODELS) {
    const { room, player, animal } = fixture(character);
    Object.assign(player, { x: 50, z: 50 });
    assert.equal(startAttack(room, player, {}, 10000).accepted, true);
    Object.assign(player, caveWorldAt(-21));
    assert.deepEqual(resolveAttack(room, player, 11000), { hit: false });
    assert.equal(player.pendingStrike, null);
    assert.equal(animal.health, 100);
    assert.equal(room.projectiles?.length ?? 0, 0);
  }
});

test('a carried mage cannot bypass the restriction using an old position outside the cave', () => {
  const { room, player } = fixture(CHARACTER_MODELS.find((c) => c.species === 'bear'));
  const carrier = { id: 'ape', species: 'ape', passengerId: player.id, ...caveWorldAt(-21) };
  Object.assign(player, { x: 50, z: 50, carrierId: carrier.id });
  room.players.set(carrier.id, carrier);
  assert.equal(startAttack(room, player, {}, 10000).reason, 'cave');
});

test('torch-only hands reject companion throws and cancel a queued pickup on entry, retaining ownership and recall', () => {
  let now = 10000, id = 0;
  const core = createGameCore({ runtime: { now: () => now, id: () => `bot-${++id}`, token: () => `token-${++id}` } });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'CAVE-BOTS' }));
  const room = core.rooms.get('CAVE-BOTS'), player = [...room.players.values()][0];
  Object.assign(player, caveWorldAt(-21));
  assert.equal(canHandleBot(player, now), true, 'care and recall remain available');
  assert.equal(canThrowBot(player, now), false);
  const bot = room.orbBots[0];
  Object.assign(bot, { ownerId: player.id, mode: 'following', ...caveWorldAt(-20), lastOwner: { x: player.x, z: player.z } });
  assert.equal(handleOrbBotAction(room, player, 'throwBot', bot.kind, now), false);
  for (const mode of ['queued', 'windup']) {
    Object.assign(bot, { mode, throwAt: now, origin: { x: bot.x, y: bot.y, z: bot.z } });
    updateOrbBots(room, 0.05, now + 50);
    assert.equal(bot.mode, 'following');
    assert.equal(bot.ownerId, player.id);
  }
  bot.mode = 'waiting';
  assert.equal(handleOrbBotAction(room, player, 'recallBots', null, now), true);
  assert.equal(bot.mode, 'returning');
  Object.assign(player, { x: 50, z: 50 });
  assert.equal(canThrowBot(player, now), true);
  socket.close();
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  ping() { this.emit('pong'); }
  close() { this.readyState = 3; this.emit('close'); }
}

test('five clients see cave attack rejection and personal light switches; exit restores attacks and equipped tools', () => {
  let now = 10000, id = 0;
  const core = createGameCore({ runtime: { now: () => now, id: () => `cave-${++id}`, token: () => `session-${++id}` } });
  const sockets = Array.from({ length: 5 }, () => {
    const s = new Socket(); core.connect(s, new URLSearchParams({ room: 'CAVE' })); return s;
  });
  const room = core.rooms.get('CAVE'), player = [...room.players.values()][0];
  Object.assign(player, caveWorldAt(-21), { tool: true });
  const inventory = { ...player.inventory };
  const send = (action) => sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'action', action })), false);
  for (const unlit of [false, true]) {
    player.caveTorchOff = unlit;
    send('attack');
    assert.equal(player.attackSequence, 0);
    assert.equal(player.lastAction, 0);
    now += 500;
    send('toggleCaveTorch');
    for (const socket of sockets) {
      const state = socket.messages.filter((m) => m.type === 'state').at(-1);
      const self = state.players.find((p) => p.id === player.id);
      assert.equal(self.attackSequence, 0);
      assert.equal(self.caveTorchOff, !unlit);
      assert.equal(self.tool, true);
    }
  }
  Object.assign(player, { x: 50, z: 50, caveTorchOff: true });
  now += 1000; core.tick();
  assert.equal(player.caveTorchOff, false);
  assert.equal(player.tool, true);
  assert.deepEqual(player.inventory, inventory);
  send('attack');
  assert.equal(player.attackSequence, 1);
  sockets.forEach((s) => s.close());
});
