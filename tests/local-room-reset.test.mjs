import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rename, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createPersistentGameServer, createGameServer } from '../dist/server.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { localResetRequest } from '../dist/infrastructure/node/room-reset.mjs';

const until = async (fn) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Reset timed out');
};
async function join(game, room = 'RESET', session = '') {
  const messages = [];
  const socket = new WebSocket(
    `ws://127.0.0.1:${game.address().port}/ws?${new URLSearchParams({ room, name: '旅人', resume: '1', session })}`,
  );
  socket.on('message', (data) => messages.push(JSON.parse(data)));
  socket.on('error', () => {});
  await until(() => messages.some((message) => message.type === 'welcome'));
  return { socket, messages, welcome: messages.find((message) => message.type === 'welcome') };
}
const post = (game, room, session, options = {}) => {
  const origin = `http://127.0.0.1:${game.address().port}`;
  return fetch(`${origin}/api/reset-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ room, session }),
    ...options,
  });
};

test('reset is opt-in outside port 3000 and only a local, same-origin active member may request it', async (t) => {
  for (const address of ['192.168.1.5', '203.0.113.1'])
    assert.equal(
      localResetRequest({
        socket: { remoteAddress: address },
        headers: { host: 'localhost:3000' },
      }),
      false,
    );
  assert.equal(
    localResetRequest({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'attacker.example:3000' },
    }),
    false,
  );
  assert.equal(
    localResetRequest({
      socket: { remoteAddress: '::ffff:127.0.0.1' },
      headers: { host: 'localhost:3000' },
    }),
    true,
  );
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  await game.listen();
  t.after(() => game.close());
  const status = await fetch(`http://127.0.0.1:${game.address().port}/api/status`).then((r) =>
    r.json(),
  );
  assert.equal(status.localRoomReset, false);
  assert.equal((await post(game, 'RESET', 'fake')).status, 403);
});

test('room reset persists before disconnect, discards offline sessions and keeps other rooms across restart', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cro-reset-'));
  const options = {
    saveDirectory: directory,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
    saveIntervalMs: 100000,
    enableRoomReset: true,
  };
  const game = await createPersistentGameServer(options);
  await game.listen();
  t.after(() => game.close());
  const a = await join(game),
    b = await join(game),
    offline = await join(game),
    other = await join(game, 'OTHER');
  const original = game.rooms.get('RESET');
  original.camp.level = 2;
  original.resources[0].amount = 0;
  for (const player of original.players.values()) {
    player.energy = 40;
    player.inventory.berry = 9;
    player.gathered = 20;
    player.tool = true;
  }
  const unaffected = game.rooms.get('OTHER');
  unaffected.players.get(other.welcome.id).inventory.wood = 17;
  offline.socket.close();
  await until(() => original.sessions.has(offline.welcome.session));
  await game.saveNow();
  assert.equal((await post(game, 'RESET', 'wrong')).status, 409);
  assert.equal((await post(game, 'OTHER', a.welcome.session)).status, 409);
  assert.equal(
    (
      await post(game, 'RESET', a.welcome.session, {
        headers: { Origin: 'http://attacker.example', 'Content-Type': 'application/json' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await post(game, 'RESET', a.welcome.session, { method: 'GET', body: undefined })).status,
    405,
  );
  assert.equal(game.rooms.get('RESET'), original);
  const response = await post(game, 'RESET', a.welcome.session);
  assert.equal(response.status, 200);
  await until(() => a.socket.readyState === 3 && b.socket.readyState === 3);
  assert.ok(
    a.messages.some((m) => m.type === 'roomReset') &&
      b.messages.some((m) => m.type === 'roomReset'),
  );
  assert.equal(other.socket.readyState, 1);
  assert.equal(game.rooms.get('OTHER'), unaffected);
  const saved = JSON.parse(await readFile(path.join(directory, 'world.json'), 'utf8')).state;
  assert.deepEqual(
    saved.rooms.map((r) => r.name),
    ['OTHER'],
  );
  const fresh = await join(game, 'RESET', a.welcome.session);
  const late = await join(game, 'RESET', offline.welcome.session);
  assert.equal(fresh.welcome.resumed, false);
  assert.equal(late.welcome.resumed, false);
  const reset = game.rooms.get('RESET');
  const player = reset.players.get(fresh.welcome.id);
  assert.equal(reset.camp.level, 0);
  assert.ok(reset.resources[0].amount > 0);
  assert.equal(player.energy, 100);
  assert.equal(player.inventory.berry, 0);
  assert.equal(player.gathered, 0);
  assert.equal(player.tool, false);
  assert.equal(unaffected.players.get(other.welcome.id).inventory.wood, 17);
  await game.close();
  const restarted = await createPersistentGameServer(options);
  await restarted.listen();
  t.after(() => restarted.close());
  const resumed = await join(restarted, 'RESET', fresh.welcome.session);
  assert.equal(resumed.welcome.resumed, true);
  assert.equal(restarted.rooms.get('RESET').players.get(resumed.welcome.id).inventory.berry, 0);
  assert.equal(
    restarted.rooms.get('OTHER').sessions.get(other.welcome.session).player.inventory.wood,
    17,
  );
});

test('a real checkpoint write failure leaves the live room and its progress playable', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cro-reset-fail-'));
  const game = await createPersistentGameServer({
    saveDirectory: directory,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
    saveIntervalMs: 100000,
    enableRoomReset: true,
    onSaveError: () => {},
  });
  await game.listen();
  t.after(() => game.close());
  const client = await join(game);
  const room = game.rooms.get('RESET'),
    player = room.players.get(client.welcome.id);
  player.inventory.berry = 8;
  await game.saveNow();
  await new Promise((resolve) => setTimeout(resolve, 150));
  // The join's checkpoint may have coalesced with the first request. A second
  // completed save guarantees the backup exists even under the full suite's load.
  await game.saveNow();
  const backup = path.join(directory, 'world.backup.json');
  await rename(backup, backup + '.held');
  await mkdir(backup);
  try {
    assert.equal((await post(game, 'RESET', client.welcome.session)).status, 409);
    assert.equal(game.rooms.get('RESET'), room);
    assert.equal(player.inventory.berry, 8);
    assert.equal(client.socket.readyState, 1);
    assert.ok(!client.messages.some((m) => m.type === 'roomReset'));
  } finally {
    await rmdir(backup);
    await rename(backup + '.held', backup);
  }
  await game.saveNow();
});

test('pending reset freezes target input, rejects duplicate resets and resumes after failure', async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    send(data) {
      this.messages.push(JSON.parse(data));
    }
    close(code) {
      this.readyState = 3;
      this.code = code;
      this.emit('close');
    }
  }
  const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'RESET', resume: '1' }));
  const room = core.rooms.get('RESET'),
    player = [...room.players.values()][0];
  player.energy = 40;
  player.inventory.berry = 2;
  let fail;
  const pending = core.resetRoom(
    'RESET',
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const rejected = assert.rejects(pending, /disk unavailable/);
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'action', action: 'eat' })), false);
  core.tick();
  assert.equal(player.energy, 40);
  assert.equal(player.inventory.berry, 2);
  await assert.rejects(core.resetRoom('RESET', async () => {}));
  const joining = new Socket();
  core.connect(joining, new URLSearchParams({ room: 'RESET' }));
  assert.equal(joining.code, 1013);
  fail(Error('disk unavailable'));
  await rejected;
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'action', action: 'eat' })), false);
  assert.equal(player.energy, 65);
  core.close();
});
