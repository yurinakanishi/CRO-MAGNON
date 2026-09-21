import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { campContribution } from '../dist/shared/camp-contribution.mjs';
import { GATHER_RANGE, interactionVisible } from '../dist/shared/interactions.mjs';
import { coastalInteraction } from '../dist/src/coastal-ui.js';
import { fishingInteraction } from '../dist/src/fishing-ui.js';
import { huntInteraction } from '../dist/src/hunting-ui.js';
import { caveFireInteraction } from '../dist/shared/cave-fire.mjs';
import { adventureInteraction } from '../dist/src/adventure-ui.js';
import { residentInteraction } from '../dist/src/village-ui.js';
import { gulfInteraction } from '../dist/src/gulf-ui.js';

const main = await readFile(new URL('../dist/src/main.js', import.meta.url), 'utf8');
const nearbySource = main.slice(
  main.indexOf('function nearby()'),
  main.indexOf('function updateHUD()'),
);
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  command(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
}
function fixture() {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    runtime: { now: () => now, id: () => `camp-${++id}`, token: () => `session-${++id}` },
  });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'CAMP', name: '旅人', resume: '1' }));
  const room = core.rooms.get('CAMP');
  const player = [...room.players.values()][0];
  Object.assign(player, { x: room.camp.x, z: room.camp.z + 3 });
  const hint = () =>
    vm.runInNewContext(`${nearbySource}\nnearby()`, {
      state: core.snapshot(room, true),
      player: () => player,
      renderer: { collision: room.collision, resourceVisible: () => true, serverNow: () => now },
      campContribution,
      coastalInteraction,
      fishingInteraction,
      huntInteraction,
      caveFireInteraction,
      adventureInteraction,
      residentInteraction,
      gulfInteraction,
      GATHER_RANGE,
      interactionVisible,
      distance: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    });
  const act = (message = {}) => {
    socket.command({ type: 'action', action: 'contribute', ...message });
    now += 1000;
  };
  return { core, room, player, socket, hint, act, now: () => now };
}

test('empty hands hide the actual HUD contribution candidate and a direct command consumes nothing', () => {
  const f = fixture();
  assert.notEqual(f.hint()?.action, 'contribute');
  const before = JSON.stringify([f.player.inventory, f.room.camp]);
  f.act();
  assert.equal(JSON.stringify([f.player.inventory, f.room.camp]), before);
  assert.equal(f.socket.messages.findLast((m) => m.type === 'notice').popup, false);
});

test('stone alone can be delivered while the camp still needs stone', () => {
  const f = fixture();
  f.player.inventory.stone = 3;
  assert.equal(f.hint()?.action, 'contribute');
  f.act();
  assert.equal(f.room.camp.stone, 3);
  assert.equal(f.player.inventory.stone, 0);
  assert.notEqual(f.hint()?.action, 'contribute');
});

test('the HUD and server both use the gathering boundary, including exactly 3.5 metres', () => {
  const f = fixture();
  f.player.inventory.wood = 5;
  assert.equal(GATHER_RANGE, 3.5);
  for (const distance of [10, GATHER_RANGE + 0.001]) {
    f.player.z = f.room.camp.z + distance;
    assert.notEqual(f.hint()?.action, 'contribute');
    f.act({ x: f.room.camp.x, z: f.room.camp.z, range: 100 });
    assert.equal(f.room.camp.wood, 0);
    assert.equal(f.player.inventory.wood, 5);
  }
  f.player.z = f.room.camp.z + GATHER_RANGE;
  assert.equal(f.hint()?.action, 'contribute');
  f.act();
  assert.equal(f.room.camp.wood, 5);
});

test('a wall hides the hint and blocks the authoritative delivery inside the distance limit', () => {
  const f = fixture();
  f.player.inventory.wood = 4;
  f.room.collision = new CollisionWorld(
    [{ id: 'wall', type: 'box', x: 50, z: 51.5, hx: 2, hz: 0.1, c: 1, s: 0, height: 3 }],
    { river: false },
  );
  assert.notEqual(f.hint()?.action, 'contribute');
  f.act();
  assert.equal(f.room.camp.wood, 0);
  assert.equal(f.player.inventory.wood, 4);
});

test('only missing quantities are taken; completion rejects repeated and competing deliveries', () => {
  const f = fixture();
  const peer = new Socket();
  f.core.connect(peer, new URLSearchParams({ room: 'CAMP', name: '仲間' }));
  const p2 = [...f.room.players.values()].find((p) => p !== f.player);
  Object.assign(p2, { x: 51, z: 52 });
  Object.assign(p2.inventory, { wood: 9, stone: 2 });
  Object.assign(f.room.camp, { wood: 11, stone: 5 });
  Object.assign(f.player.inventory, { wood: 7, stone: 4, berry: 6 });
  assert.equal(f.hint()?.action, 'contribute');
  f.act({ wood: 99, stone: 99 });
  assert.deepEqual([f.room.camp.wood, f.room.camp.stone, f.room.camp.level], [12, 6, 1]);
  assert.deepEqual(
    [f.player.inventory.wood, f.player.inventory.stone, f.player.inventory.berry],
    [6, 3, 6],
  );
  assert.ok(f.player.ready && p2.ready);
  assert.notEqual(f.hint()?.action, 'contribute');
  const before = JSON.stringify([f.room.camp, f.player.inventory, p2.inventory]);
  peer.command({ type: 'action', action: 'contribute' });
  f.act();
  assert.equal(JSON.stringify([f.room.camp, f.player.inventory, p2.inventory]), before);
  assert.equal(
    f.socket.messages.filter((m) => m.type === 'chat' && m.text.includes('焚き火が完成')).length,
    1,
  );
});

test('already supplied material does not enable delivery or consume surplus, including older overfilled saves', () => {
  const f = fixture();
  f.room.camp.wood = 18;
  f.room.camp.stone = 4;
  f.player.inventory.wood = 8;
  assert.notEqual(f.hint()?.action, 'contribute');
  f.act();
  assert.equal(f.player.inventory.wood, 8);
  f.player.inventory.stone = 5;
  assert.equal(f.hint()?.action, 'contribute');
  f.act();
  assert.deepEqual([f.room.camp.wood, f.room.camp.stone, f.room.camp.level], [18, 6, 1]);
  assert.deepEqual([f.player.inventory.wood, f.player.inventory.stone], [8, 3]);
});

test('busy players do not receive a contribution hint, and server actions cannot bypass the restriction', () => {
  for (const busy of [
    { downedUntil: 110000 },
    { mountId: 'mount' },
    { boatId: 'boat' },
    { carrierId: 'carrier' },
    { passengerId: 'passenger' },
    { cookingEndsAt: 110000 },
    { fishing: {} },
    { coastalActivity: {} },
    { jumpAt: 100000, jumpSequence: 1 },
    { attackAt: 100000, attackSequence: 1 },
  ]) {
    const f = fixture();
    f.player.inventory.wood = 4;
    Object.assign(f.player, busy);
    assert.notEqual(f.hint()?.action, 'contribute', JSON.stringify(busy));
    f.act();
    assert.equal(f.player.inventory.wood, 4, JSON.stringify(busy));
    assert.equal(f.room.camp.wood, 0);
  }
});
