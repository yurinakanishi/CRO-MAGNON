import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { GameSocket } from '../dist/cloudflare/socket-adapter.mjs';
import { createPreferences, createSessionStore } from '../dist/src/session-storage.js';
import { createGameServer } from '../server.mjs';

test('command boundary rejects malformed payloads and discards client-authored authority', () => {
  for (const value of [
    '{',
    'null',
    '[]',
    'true',
    '{}',
    '{"type":"move","dx":"1","dz":0}',
    '{"type":"target","x":1e999,"z":0}',
    '{"type":"gait","running":1}',
  ]) {
    assert.equal(decodeCommand(value), null, value);
  }
  assert.deepEqual(
    decodeCommand(
      JSON.stringify({
        type: 'action',
        action: 'attack',
        targetId: 'guardian',
        damage: 999,
        playerId: 'other',
      }),
    ),
    {
      type: 'action',
      action: 'attack',
      targetId: 'guardian',
      regionId: undefined,
    },
  );
  for (const action of ['ride', 'boardBoat', 'claimAdventure', 'rift']) {
    assert.equal(
      decodeCommand(JSON.stringify({ type: 'action', action, targetId: 'target' })).targetId,
      'target',
    );
  }
  assert.deepEqual(decodeCommand('{"type":"chat","text":"hello","name":"spoof"}'), {
    type: 'chat',
    text: 'hello',
  });
});

test('game clock and identities can be supplied without monkey-patching platform globals', () => {
  let now = 100000,
    id = 0;
  const game = createGameCore({
    runtime: { now: () => now, id: () => `id-${++id}`, token: () => 'private-token' },
  });
  const sent = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    on() {},
    send(data) {
      sent.push(JSON.parse(data));
    },
    close() {},
  };
  game.connect(socket, new URLSearchParams({ room: 'CLOCK', resume: '1' }));
  assert.equal(sent.find((m) => m.type === 'welcome').session, 'private-token');
  const room = game.rooms.get('CLOCK');
  assert.equal(room.createdAt, now);
  now += 240000;
  const snapshot = game.snapshot(room, true);
  assert.equal(snapshot.day, 2);
  assert.equal(snapshot.serverTime, now);
  assert.equal(JSON.stringify(snapshot).includes('private-token'), false);
  game.close();
});

test('Cloudflare connection queues state until flush and uses the supplied heartbeat clock', () => {
  const sent = [],
    closed = [];
  let now = 1000,
    pongs = 0;
  const socket = new GameSocket(
    { readyState: 1, send: (data) => sent.push(data), close: (...args) => closed.push(args) },
    () => now,
  );
  socket.on('pong', () => pongs++);
  socket.send('saved-state');
  assert.deepEqual(sent, []);
  socket.flush();
  assert.deepEqual(sent, ['saved-state']);
  socket.ping();
  assert.equal(pongs, 1);
  now += 45000;
  socket.ping();
  assert.deepEqual(closed, [[4000, 'Connection timeout']]);
});

test('denied browser storage retains current-page sessions and permits explicit removal', () => {
  const unavailable = () => {
    throw new Error('Storage denied');
  };
  const preferences = createPreferences(unavailable);
  assert.equal(preferences.read('name', 'traveller'), 'traveller');
  assert.doesNotThrow(() => preferences.write('name', 'new'));
  const sessions = createSessionStore(unavailable);
  sessions.write('EMBER', 'token');
  assert.equal(sessions.read('EMBER'), 'token');
  assert.equal(sessions.read('OTHER'), '');
  sessions.write('EMBER', null);
  assert.equal(sessions.read('EMBER'), '');
});

test('compiled browser modules and CSS retain their URLs while server sources stay private', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  await game.listen();
  t.after(() => game.close());
  const origin = `http://127.0.0.1:${game.address().port}`;
  for (const url of [
    '/',
    '/src/main.js',
    '/src/style.css',
    '/src/session-storage.js',
    '/shared/characters.mjs',
  ]) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, url);
    assert.ok((await response.text()).length > 0);
  }
  for (const url of [
    '/src/main.ts',
    '/server.mts',
    '/application/game-core.mjs',
    '/infrastructure/node/static-files.mjs',
  ]) {
    assert.ok((await fetch(origin + url)).status >= 400, url);
  }
});
