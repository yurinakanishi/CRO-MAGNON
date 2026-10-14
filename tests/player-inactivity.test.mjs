import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { GameSocket } from '../dist/cloudflare/socket-adapter.mjs';
import {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_CODE,
  IDLE_MESSAGE,
} from '../dist/shared/player-inactivity.mjs';
import { translateText, registerTranslations } from '../dist/src/language.js';
import { ENGLISH_GAME } from '../dist/src/language-en.js';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
    this.emit('close');
  }
  ping() {
    this.emit('pong');
  }
  command(value) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }
}

function fixture() {
  let now = 100000;
  let sequence = 0;
  const runtime = {
    now: () => now,
    id: () => `idle-${++sequence}`,
    token: () => `resume-${++sequence}`,
  };
  const core = createGameCore({ runtime, keepEmptyRooms: true });
  const join = (params = {}) => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'IDLE', resume: '1', ...params }));
    const welcome = socket.messages.find((message) => message.type === 'welcome');
    return { socket, welcome, player: core.rooms.get('IDLE').players.get(welcome?.id) };
  };
  return {
    core,
    runtime,
    join,
    now: () => now,
    advance(ms) {
      now += ms;
      core.tick();
    },
  };
}

test('heartbeats, state broadcasts, zero movement and automatic cancellations cannot prevent the 30-second exit', () => {
  const f = fixture();
  const client = f.join();
  for (let step = 1; step <= 9; step++) {
    f.advance(3000);
    client.socket.command({ type: 'ping', at: f.now() });
    client.socket.command({ type: 'move', dx: 0, dz: 0 });
    for (const action of ['cancelBotThrows', 'cancelFishing', 'cancelCoastal'])
      client.socket.command({ type: 'action', action });
  }
  f.advance(2999);
  assert.equal(client.socket.readyState, 1);
  f.advance(1);
  assert.equal(client.socket.closed.code, IDLE_CLOSE_CODE);
  assert.deepEqual(
    client.socket.messages.find((message) => message.code === 'IDLE_TIMEOUT'),
    {
      type: 'error',
      code: 'IDLE_TIMEOUT',
      text: IDLE_MESSAGE,
    },
  );
  assert.equal(f.core.rooms.get('IDLE').players.size, 0);
  assert.ok(f.core.rooms.get('IDLE').sessions.has(client.welcome.session));
});

test('foreground activity renews the server deadline and cannot choose its own timestamp', () => {
  const f = fixture();
  const client = f.join();
  f.advance(29000);
  client.socket.command({ type: 'activity', at: 9999999999999, playerId: 'someone-else' });
  assert.deepEqual(decodeCommand('{"type":"activity","at":9999999999999}'), { type: 'activity' });
  assert.equal(client.player.lastActivityAt, f.now());
  f.advance(IDLE_TIMEOUT_MS - 1);
  assert.equal(client.socket.readyState, 1);
  f.advance(1);
  assert.equal(client.socket.closed.code, IDLE_CLOSE_CODE);
});

test('held movement and game actions keep active players connected while each idle peer releases a slot', () => {
  const f = fixture();
  const clients = Array.from({ length: 5 }, () => f.join());
  for (let step = 0; step < 29; step++) {
    f.advance(1000);
    clients[0].socket.command({ type: 'move', dx: 1, dz: 0 });
    clients[1].socket.command({ type: 'action', action: 'wave' });
  }
  f.advance(1000);
  assert.equal(f.core.rooms.get('IDLE').players.size, 2);
  assert.ok(clients.slice(2).every((client) => client.socket.closed.code === IDLE_CLOSE_CODE));
  const newcomer = f.join({ name: 'New traveller' });
  assert.ok(newcomer.welcome);
  assert.equal(f.core.rooms.get('IDLE').players.size, 3);
});

test('malformed or unknown commands do not renew inactivity', () => {
  const f = fixture();
  const client = f.join();
  f.advance(29000);
  for (const data of ['{', '{"type":"unknown"}', '{"type":"move","dx":"1","dz":0}'])
    client.socket.emit('message', Buffer.from(data), false);
  client.socket.emit('message', Buffer.from('{"type":"activity"}'), true);
  f.advance(1000);
  assert.equal(client.socket.closed.code, IDLE_CLOSE_CODE);
});

test('idle exit preserves the same traveller, belongings and companion choice across a saved-state restore', () => {
  const f = fixture();
  const client = f.join({ species: 'cat' });
  const room = f.core.rooms.get('IDLE');
  Object.assign(client.player, { x: 100, z: 120, gathered: 9, tool: true, energy: 37 });
  client.player.inventory.wood = 7;
  client.player.inventory.rawMeat = 2;
  client.socket.command({ type: 'action', action: 'selectMascot', targetId: '524' });
  const choice = client.player.mascot;
  assert.ok(choice);
  const inventory = structuredClone(client.player.inventory);
  client.player.cookingEndsAt = f.now() + 60000;
  client.player.pendingStrike = { impactAt: f.now() + 60000 };
  f.advance(IDLE_TIMEOUT_MS);
  assert.equal(room.players.size, 0);
  assert.equal(room.companions.length + room.orbBots.length, 0);
  assert.equal(client.player.cookingEndsAt, 0);
  assert.equal(client.player.pendingStrike, null);
  const saved = f.core.exportState();
  assert.equal(saved.rooms[0].sessions[0].player.lastActivityAt, undefined);
  const restored = createGameCore({ runtime: f.runtime, keepEmptyRooms: true });
  restored.importState(saved);
  const socket = new Socket();
  restored.connect(
    socket,
    new URLSearchParams({ room: 'IDLE', resume: '1', session: client.welcome.session }),
  );
  const welcome = socket.messages.find((message) => message.type === 'welcome');
  assert.equal(welcome.id, client.welcome.id);
  assert.equal(welcome.resumed, true);
  const player = restored.rooms.get('IDLE').players.get(welcome.id);
  assert.deepEqual(player.inventory, inventory);
  assert.equal(player.gathered, 9);
  assert.equal(player.mascot, choice);
  assert.deepEqual([player.x, player.z], [100, 120]);
  assert.equal(player.lastActivityAt, f.now());
});

test('the Cloudflare socket adapter delivers the idle close code and releases the same saved session', () => {
  const f = fixture();
  const host = new Socket();
  const socket = new GameSocket(host, f.now);
  host.on('close', () => socket.listeners.get('close')?.());
  f.core.connect(socket, new URLSearchParams({ room: 'IDLE', resume: '1' }));
  socket.flush();
  const welcome = host.messages.find((message) => message.type === 'welcome');
  for (let step = 0; step < 10; step++) {
    f.advance(3000);
    if (host.readyState === 1) {
      socket.lastMessage = f.now();
      socket.emit('message', JSON.stringify({ type: 'ping', at: f.now() }), false);
      socket.flush();
    }
  }
  assert.equal(host.closed.code, IDLE_CLOSE_CODE);
  assert.ok(host.messages.some((message) => message.code === 'IDLE_TIMEOUT'));
  assert.equal(f.core.rooms.get('IDLE').players.size, 0);
  assert.ok(f.core.rooms.get('IDLE').sessions.has(welcome.session));
});

test('idle exit and manual resume support both UI languages', () => {
  registerTranslations(ENGLISH_GAME);
  for (const message of [IDLE_MESSAGE, '自動退出', '続きから再開する']) {
    assert.equal(translateText(message, 'ja'), message);
    assert.doesNotMatch(translateText(message, 'en'), /[\u3040-\u30ff\u3400-\u9fff]/);
  }
});
