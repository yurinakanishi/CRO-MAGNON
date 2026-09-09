import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rmdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { createPersistentGameServer } from '../dist/server.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { openLocalSave, UnsupportedSaveError } from '../dist/infrastructure/node/local-save.mjs';
import { createSessionStore } from '../dist/src/session-storage.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, timeout = 6000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('Persistence condition timed out');
    await sleep(20);
  }
}
const directory = () => mkdtemp(path.join(tmpdir(), 'cro-save-test-'));
const bytes = (dir) => readFile(path.join(dir, 'world.json'));
const state = (n) => ({ savedAt: n, value: n });
const validate = (value) => {
  if (!Number.isFinite(value?.value)) throw new Error('Invalid state');
};
function envelope(saved, revision = 1) {
  return JSON.stringify({
    format: 'cro-magnon-local-save',
    version: 1,
    revision,
    sha256: createHash('sha256')
      .update(JSON.stringify({ revision, state: saved }))
      .digest('hex'),
    state: saved,
  });
}
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
  ping() {}
  terminate() {
    this.close();
  }
}
function fakeJoin(core, params = {}) {
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'SAVE', name: '旅人', resume: '1', ...params }));
  return { socket, welcome: socket.messages.find((m) => m.type === 'welcome') };
}
async function join(game, session = '') {
  const messages = [],
    socket = new WebSocket(
      `ws://127.0.0.1:${game.address().port}/ws?${new URLSearchParams({ room: 'SAVE', resume: '1', name: '保存する旅人', session })}`,
    );
  socket.on('message', (b) => messages.push(JSON.parse(b)));
  socket.on('error', () => {});
  await until(() => messages.some((m) => m.type === 'welcome'));
  return { socket, messages, welcome: messages.find((m) => m.type === 'welcome') };
}

test('real files serialize successive saves and retain the previous complete checkpoint', async () => {
  const dir = await directory(),
    store = await openLocalSave(dir, validate);
  assert.equal(store.status().state, 'pending');
  await Promise.all([store.save(state(1)), store.save(state(2)), store.save(state(3))]);
  assert.equal(JSON.parse(await bytes(dir)).state.value, 3);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'world.backup.json'))).state.value, 2);
  assert.deepEqual((await readdir(dir)).sort(), ['world.backup.json', 'world.json']);
  await store.close();
  const restored = await openLocalSave(dir, validate);
  assert.deepEqual(restored.state, state(3));
  await restored.close();
});

test('checksum or invalid payload recovers backup, archives damaged bytes, and preserves both on total failure', async () => {
  const dir = await directory(),
    store = await openLocalSave(dir, validate);
  await store.save(state(1));
  await store.save(state(2));
  await store.close();
  const damaged = JSON.parse(await bytes(dir));
  damaged.state.value = 999;
  const raw = JSON.stringify(damaged);
  await writeFile(path.join(dir, 'world.json'), raw);
  const recovered = await openLocalSave(dir, validate);
  assert.equal(recovered.state.value, 1);
  assert.equal(recovered.status().recovered, true);
  const archive = (await readdir(dir)).find((n) => n.startsWith('world.corrupt-'));
  assert.equal(await readFile(path.join(dir, archive), 'utf8'), raw);
  await recovered.save(state(4));
  await recovered.close();
  assert.equal(JSON.parse(await readFile(path.join(dir, 'world.backup.json'))).state.value, 1);
  await writeFile(path.join(dir, 'world.json'), '{');
  await writeFile(path.join(dir, 'world.backup.json'), '[');
  await assert.rejects(openLocalSave(dir, validate), /No usable/);
  assert.equal((await bytes(dir)).toString(), '{');
  assert.equal(await readFile(path.join(dir, 'world.backup.json'), 'utf8'), '[');
});

test('unsupported formats fail closed even when a valid older backup exists', async () => {
  const dir = await directory(),
    store = await openLocalSave(dir, validate);
  await store.save(state(1));
  await store.save(state(2));
  await store.close();
  const future = JSON.parse(await bytes(dir));
  future.version = 2;
  const raw = JSON.stringify(future);
  await writeFile(path.join(dir, 'world.json'), raw);
  await assert.rejects(openLocalSave(dir, validate), UnsupportedSaveError);
  assert.equal((await bytes(dir)).toString(), raw);
});

test('failed writes keep the previous primary and can recover on the next save', async () => {
  const dir = await directory(),
    store = await openLocalSave(dir, validate);
  await store.save(state(1));
  const previous = await bytes(dir);
  await mkdir(path.join(dir, 'world.backup.json'));
  await assert.rejects(store.save(state(2)));
  assert.equal(store.status().state, 'error');
  assert.deepEqual(await bytes(dir), previous);
  await rmdir(path.join(dir, 'world.backup.json'));
  await store.save(state(3));
  assert.equal(store.status().state, 'saved');
  await store.close();
});

test('canonical directory aliases cannot hold two writer leases', async () => {
  const dir = await directory(),
    store = await openLocalSave(dir, validate);
  await assert.rejects(openLocalSave(path.join(dir, '.'), validate), /already in use/);
  await store.close();
  const next = await openLocalSave(dir, validate);
  await next.close();
});

test('persistent core retains 111 profiles and empty shared rooms without offline NPC production', () => {
  let now = Date.now();
  const core = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => crypto.randomUUID(), token: () => crypto.randomUUID() },
  });
  const tokens = [];
  for (let i = 0; i < 111; i++) {
    const c = fakeJoin(core, { name: `旅人${i}` });
    assert.ok(c.welcome);
    tokens.push(c.welcome.session);
    core.rooms.get('SAVE').players.get(c.welcome.id).inventory.obsidian = i % 99;
    c.socket.close();
  }
  const room = core.rooms.get('SAVE'),
    before = core.exportState();
  now += 365 * 86400000;
  core.tick();
  assert.equal(room.sessions.size, 111);
  assert.equal(core.exportState().rooms[0].sessions.length, 111);
  assert.deepEqual(
    core.exportState().rooms[0].residents.map((r) => ({
      forage: r.forage,
      supper: r.supper,
      watering: r.watering,
    })),
    before.rooms[0].residents.map((r) => ({
      forage: r.forage,
      supper: r.supper,
      watering: r.watering,
    })),
  );
  const restored = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => crypto.randomUUID(), token: () => crypto.randomUUID() },
  });
  restored.importState(core.exportState());
  for (const [i, token] of tokens.entries()) {
    const c = fakeJoin(restored, { session: token });
    assert.equal(c.welcome.resumed, true);
    assert.equal(restored.rooms.get('SAVE').players.get(c.welcome.id).inventory.obsidian, i % 99);
    c.socket.close();
  }
  assert.equal(before.rooms[0].sessions.length, 111);
  core.close();
  restored.close();
});

test('disk restart restores shared and personal records, freezes shutdown input, and discards transient work', async (t) => {
  const dir = await directory();
  const game = await createPersistentGameServer({
    saveDirectory: dir,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
    saveIntervalMs: 100000,
  });
  await game.listen();
  t.after(() => game.close());
  const client = await join(game),
    room = game.rooms.get('SAVE'),
    p = room.players.get(client.welcome.id);
  Object.assign(p, {
    x: 130,
    z: 50,
    energy: 54,
    gathered: 12,
    tool: true,
    spearHead: 'obsidian',
    dx: 1,
    dz: 0,
    jumpAt: Date.now(),
    cookingEndsAt: Date.now() + 5000,
  });
  Object.assign(p.inventory, {
    wood: 12,
    obsidian: 4,
    obsidianBlade: 3,
    cookedShellfish: 2,
    shells: 7,
    water: 2,
  });
  room.camp.wood = 8;
  room.resources[0].amount = 1;
  Object.assign(room.gulf.plots[0], { stage: 'planted', waterRequestAt: Date.now() });
  room.residents[0].watering.water = 2;
  room.gulf.pantries[0].food.cookedRoot = 3;
  room.gulf.pantries[0].supper.berry = 2;
  room.gulf.middens[0].shells = 9;
  const expected = game.core.exportState().rooms[0];
  await game.close();
  const reopened = await createPersistentGameServer({
    saveDirectory: dir,
    port: 0,
    host: '127.0.0.1',
    tickMs: 100000,
    saveIntervalMs: 100000,
  });
  await reopened.listen();
  t.after(() => reopened.close());
  const resumed = await join(reopened, client.welcome.session),
    after = reopened.rooms.get('SAVE'),
    saved = after.players.get(resumed.welcome.id);
  assert.equal(resumed.welcome.resumed, true);
  assert.equal(resumed.welcome.persistentSession, true);
  assert.equal(saved.id, p.id);
  assert.deepEqual(saved.inventory, p.inventory);
  assert.deepEqual([saved.x, saved.z, saved.energy, saved.gathered], [130, 50, 54, 12]);
  assert.equal(saved.dx, 0);
  assert.equal(saved.jumpAt, 0);
  assert.equal(saved.cookingEndsAt, 0);
  assert.equal(saved.target, null);
  assert.equal(saved.spearHead, 'obsidian');
  assert.equal(after.residents[0].watering.water, 2);
  assert.equal(after.camp.wood, 8);
  assert.equal(after.resources[0].amount, 1);
  assert.deepEqual(after.gulf, expected.gulf);
  assert.equal(
    JSON.stringify(reopened.snapshot(after, true)).includes(client.welcome.session),
    false,
  );
  const origin = `http://127.0.0.1:${reopened.address().port}`;
  for (const url of [
    '/.cro-magnon-save/world.json',
    '/infrastructure/node/local-save.mjs',
    '/api/save',
    '/world.json',
  ])
    assert.notEqual((await fetch(origin + url)).status, 200);
  const health = await fetch(origin + '/api/health').then((r) => r.json());
  assert.equal(health.save.enabled, true);
  assert.equal(JSON.stringify(health).includes(client.welcome.session), false);
  const closing = reopened.close();
  resumed.socket.send(JSON.stringify({ type: 'move', dx: 1, dz: 0 }));
  await closing;
  assert.equal(JSON.parse(await bytes(dir)).state.rooms[0].sessions[0].player.dx, 0);
});

test('title leave retains progress; explicit character change discards it; save failures reach clients', async (t) => {
  const dir = await directory(),
    errors = [];
  const game = await createPersistentGameServer({
    saveDirectory: dir,
    port: 0,
    host: '127.0.0.1',
    saveIntervalMs: 100000,
    onSaveError: (e) => errors.push(e.message),
  });
  await game.listen();
  t.after(() => game.close());
  const first = await join(game);
  const room = game.rooms.get('SAVE');
  room.players.get(first.welcome.id).inventory.shells = 8;
  first.socket.send(JSON.stringify({ type: 'leave', keepSession: true }));
  await until(() => !room.players.size);
  const second = await join(game, first.welcome.session);
  assert.equal(second.welcome.id, first.welcome.id);
  assert.equal(room.players.get(second.welcome.id).inventory.shells, 8);
  await game.saveNow();
  await sleep(150);
  await game.saveNow();
  const oldBackup = path.join(dir, 'old-backup.json');
  await rename(path.join(dir, 'world.backup.json'), oldBackup);
  await mkdir(path.join(dir, 'world.backup.json'));
  await assert.rejects(game.saveNow());
  await until(() => second.messages.some((m) => m.type === 'saveStatus' && m.state === 'error'));
  assert.ok(errors.length);
  await rmdir(path.join(dir, 'world.backup.json'));
  await game.saveNow();
  await until(() => second.messages.at(-1)?.state === 'saved');
  second.socket.send(JSON.stringify({ type: 'leave' }));
  await until(() => !room.players.size);
  assert.equal(room.sessions.size, 0);
  assert.equal(game.rooms.size, 1);
  const third = await join(game, first.welcome.session);
  assert.equal(third.welcome.resumed, false);
  assert.notEqual(third.welcome.id, first.welcome.id);
});

test('legacy exports load; malformed rooms fall back; future world versions never roll back silently', async () => {
  const dir = await directory(),
    core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  const c = fakeJoin(core);
  c.socket.close();
  const saved = core.exportState();
  core.close();
  await writeFile(path.join(dir, 'world.json'), JSON.stringify(saved));
  const game = await createPersistentGameServer({ saveDirectory: dir });
  assert.equal(game.rooms.size, 1);
  await game.close();
  const valid = await bytes(dir);
  await writeFile(path.join(dir, 'world.backup.json'), valid);
  const broken = structuredClone(saved);
  broken.rooms.push({ name: 'BROKEN' });
  await writeFile(path.join(dir, 'world.json'), envelope(broken));
  const recovered = await createPersistentGameServer({ saveDirectory: dir });
  assert.equal(recovered.rooms.size, 1);
  assert.equal(recovered.saveStatus().recovered, true);
  await recovered.close();
  const future = structuredClone(saved);
  future.worldVersion = 99;
  const raw = envelope(future);
  await writeFile(path.join(dir, 'world.json'), raw);
  await assert.rejects(createPersistentGameServer({ saveDirectory: dir }), UnsupportedSaveError);
  assert.equal((await bytes(dir)).toString(), raw);
});

test('browser resume survives new tabs and keeps servers separate, while blocked storage remains honest', () => {
  const provider = () => {
    const map = new Map();
    return {
      getItem: (k) => map.get(k) || null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    };
  };
  const disk = provider(),
    tab = provider();
  const store = createSessionStore(
    () => tab,
    () => disk,
  );
  assert.equal(store.write('server-a:ROOM', 'a', true), true);
  const reopened = createSessionStore(provider, () => disk);
  assert.equal(reopened.read('server-a:ROOM'), 'a');
  assert.equal(reopened.read('server-b:ROOM'), '');
  reopened.write('server-a:ROOM', null);
  assert.equal(createSessionStore(provider, () => disk).read('server-a:ROOM'), '');
  store.write('server-b:ROOM', 'b');
  assert.equal(createSessionStore(provider, () => disk).read('server-b:ROOM'), '');
  const blocked = createSessionStore(
    () => tab,
    () => {
      throw Error('Denied');
    },
  );
  assert.equal(blocked.write('private', 'x', true), false);
  assert.equal(blocked.read('private'), 'x');
  blocked.write('private', null);
  assert.equal(blocked.read('private'), '');
});

test('failed port binding releases the lease and close cannot overwrite the loaded world', async () => {
  const dir = await directory(),
    core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  fakeJoin(core);
  const saved = core.exportState();
  core.close();
  await writeFile(path.join(dir, 'world.json'), JSON.stringify(saved));
  const original = await bytes(dir),
    listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const game = await createPersistentGameServer({
    saveDirectory: dir,
    port: listener.address().port,
    host: '127.0.0.1',
  });
  try {
    await assert.rejects(game.listen(), { code: 'EADDRINUSE' });
    await game.close();
    assert.deepEqual(await bytes(dir), original);
  } finally {
    await new Promise((r) => listener.close(r));
  }
  const next = await createPersistentGameServer({ saveDirectory: dir });
  assert.equal(next.rooms.size, 1);
  await next.close();
});

test('save paths cannot point inside public assets or compiled modules', async () => {
  for (const relative of ['../public', '../dist'])
    await assert.rejects(
      createPersistentGameServer({ saveDirectory: path.resolve(import.meta.dirname, relative) }),
      /outside public and dist/,
    );
});

test('normal executable saves through parent IPC and survives a forced process exit with its last checkpoint', async (t) => {
  const dir = await directory(),
    listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const children = [];
  t.after(() => {
    for (const child of children) if (child.exitCode === null && !child.signalCode) child.kill();
  });
  async function start() {
    const child = fork(new URL('../server.mjs', import.meta.url), [], {
      env: { ...process.env, CRO_SAVE_DIR: dir, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    children.push(child);
    let log = '';
    child.stdout.on('data', (b) => (log += b));
    child.stderr.on('data', (b) => (log += b));
    await until(() => {
      if (child.exitCode !== null) throw Error(log);
      return log.includes('running at');
    }, 12000);
    return child;
  }
  const proxy = { address: () => ({ port }) };
  let child = await start(),
    client = await join(proxy);
  const token = client.welcome.session;
  client.socket.send(JSON.stringify({ type: 'move', dx: 1, dz: 0 }));
  await sleep(400);
  client.socket.send(JSON.stringify({ type: 'move', dx: 0, dz: 0 }));
  await sleep(100);
  let exited = once(child, 'exit');
  child.send('cro-shutdown');
  assert.equal((await exited)[0], 0);
  const checkpoint = JSON.parse(await bytes(dir));
  assert.equal(checkpoint.state.rooms[0].sessions[0].token, token);
  const firstPosition = checkpoint.state.rooms[0].sessions[0].player.x;
  child = await start();
  client = await join(proxy, token);
  assert.equal(client.welcome.resumed, true);
  await until(() => client.messages.some((m) => m.type === 'state'));
  assert.equal(
    client.messages.find((m) => m.type === 'state').players.find((p) => p.id === client.welcome.id)
      .x,
    firstPosition,
  );
  // Wait for the join checkpoint, then force termination before the next 10-second checkpoint.
  await until(async () => JSON.parse(await bytes(dir)).revision > checkpoint.revision);
  const beforeCrash = await bytes(dir);
  exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  assert.deepEqual(await bytes(dir), beforeCrash);
  child = await start();
  client = await join(proxy, token);
  assert.equal(client.welcome.resumed, true);
  exited = once(child, 'exit');
  child.send('cro-shutdown');
  assert.equal((await exited)[0], 0);
});
