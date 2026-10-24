import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGameCore } from '../dist/application/game-core.mjs';
import { gatherDistance, gatherRange, interactionVisible } from '../dist/shared/interactions.mjs';
import { coastalInteraction } from '../dist/src/coastal-ui.js';
import { fishingInteraction } from '../dist/src/fishing-ui.js';
import { huntInteraction } from '../dist/src/hunting-ui.js';
import { caveFireInteraction } from '../dist/shared/cave-fire.mjs';
import { adventureInteraction } from '../dist/src/adventure-interaction.js';
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
function fixture(t) {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    runtime: { now: () => now, id: () => `camp-${++id}`, token: () => `session-${++id}` },
  });
  t.after(() => core.close());
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'CAMP', name: '旅人', resume: '1' }));
  const room = core.rooms.get('CAMP'),
    player = [...room.players.values()][0];
  const hint = () =>
    vm.runInNewContext(`${nearbySource}\nnearby()`, {
      state: core.snapshot(room, true),
      fixedIdentity: true,
      assistedControls: () => false,
      player: () => player,
      renderer: { collision: room.collision, resourceVisible: () => true, serverNow: () => now },
      coastalInteraction,
      fishingInteraction,
      huntInteraction,
      caveFireInteraction,
      adventureInteraction,
      residentInteraction,
      gulfInteraction,
      gatherDistance,
      gatherRange,
      interactionVisible,
      distance: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    });
  const act = () => {
    socket.command({ type: 'action', action: 'contribute', wood: 99, stone: 99 });
    now += 1000;
  };
  return { core, room, player, socket, hint, act };
}

test('camp delivery is absent with empty or full hands, near or far, including old completed saves', (t) => {
  const f = fixture(t);
  for (const level of [0, 1])
    for (const distance of [1.5, 3, 3.5, 10])
      for (const quantity of [0, 7, 99]) {
        Object.assign(f.player, { x: f.room.camp.x, z: f.room.camp.z + distance });
        Object.assign(f.player.inventory, { wood: quantity, stone: quantity });
        Object.assign(f.room.camp, { level, wood: 11, stone: 5 });
        assert.notEqual(f.hint()?.action, 'contribute');
        const before = structuredClone([
          f.player.inventory,
          f.room.camp,
          f.player.ready,
          f.player.lastAction,
        ]);
        const messages = f.socket.messages.length;
        f.act();
        assert.deepEqual(
          [f.player.inventory, f.room.camp, f.player.ready, f.player.lastAction],
          before,
        );
        assert.deepEqual(
          f.socket.messages.slice(messages),
          [],
          'no notice, popup, completion chat or state mutation',
        );
      }
});

test('an old delivery command is silent even while another action is busy', (t) => {
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
    const f = fixture(t);
    Object.assign(f.player, busy, { x: 50, z: 53 });
    f.player.inventory.wood = 7;
    const before = structuredClone([f.player.inventory, f.room.camp]);
    const messages = f.socket.messages.length;
    f.act();
    assert.deepEqual([f.player.inventory, f.room.camp], before);
    assert.deepEqual(f.socket.messages.slice(messages), []);
  }
});

test('a full inventory never recommends the removed camp delivery', (t) => {
  const f = fixture(t),
    resource = f.room.resources.find((r) => r.type === 'wood');
  Object.assign(f.player, { x: resource.x, z: resource.z });
  f.player.inventory.wood = 99;
  f.socket.command({ type: 'action', action: 'gather', targetId: resource.id });
  const notice = f.socket.messages.findLast((m) => m.type === 'notice');
  assert.equal(notice.text, '持ち物がいっぱいです。');
  assert.equal(notice.popup, false);
  assert.equal(f.player.inventory.wood, 99);
});

test('the client has no camp delivery prompt or shortcut', () => {
  assert.doesNotMatch(main, /['"]contribute['"]|焚き火に資材を届ける/);
});
