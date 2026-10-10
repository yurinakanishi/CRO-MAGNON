import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGameCore } from '../dist/application/game-core.mjs';
import { actorObstacle } from '../dist/shared/animals.mjs';
import { characterModel } from '../dist/shared/characters.mjs';
import { spawnSite } from '../dist/shared/spawn-sites.mjs';

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

function fixture(options = {}) {
  let id = 0;
  const runtime = { now: () => 100000, id: () => `title-${++id}`, token: () => `token-${++id}` };
  const core = createGameCore({ runtime, ...options });
  function join(params = {}) {
    const socket = new Socket();
    core.connect(
      socket,
      new URLSearchParams({ room: 'TITLE', name: '旅人', resume: '1', ...params }),
    );
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    return { socket, welcome, p: core.rooms.get('TITLE')?.players.get(welcome?.id) };
  }
  return { core, join };
}

for (const persistentSessions of [false, true]) {
  test(`title start reselects appearance and difficulty at a safe camp spawn, preserving possessions and peers (persistent=${persistentSessions})`, () => {
    const { core, join } = fixture({ persistentSessions, exhibition: !persistentSessions });
    const first = join();
    const peer = join({ name: '相棒' });
    const room = core.rooms.get('TITLE');
    Object.assign(first.p, { x: 100, z: 120, energy: 63, gathered: 12, tool: true });
    Object.assign(first.p.inventory, { wood: 8, stone: 3, cookedMeat: 2 });
    const inventory = structuredClone(first.p.inventory);
    const peerBefore = { x: peer.p.x, z: peer.p.z, inventory: structuredClone(peer.p.inventory) };
    room.camp.wood = 7;
    room.resources[0].amount = 1;
    const worldBefore = JSON.stringify([room.createdAt, room.camp, room.resources, room.gulf]);

    first.socket.command({ type: 'leave', keepSession: true });
    assert.equal(room.players.size, 1);
    assert.ok(room.sessions.has(first.welcome.session));
    const next = join({
      session: first.welcome.session,
      startAtCamp: '1',
      species: 'ape',
      difficulty: 'hard',
    });
    assert.equal(next.welcome.id, first.welcome.id);
    assert.equal(next.p.species, 'ape');
    assert.equal(next.p.difficulty, 'hard');
    assert.equal(next.p.radius, characterModel(next.p).radius);
    assert.ok(Math.hypot(next.p.x - 49.1, next.p.z - 58) < 10);
    assert.ok(room.collision.free(next.p, next.p.radius, [actorObstacle(peer.p)]));
    assert.deepEqual(next.p.inventory, inventory);
    assert.equal(next.p.energy, 63);
    assert.equal(next.p.gathered, 12);
    assert.equal(next.p.tool, true);
    assert.deepEqual({ x: peer.p.x, z: peer.p.z, inventory: peer.p.inventory }, peerBefore);
    assert.equal(
      JSON.stringify([room.createdAt, room.camp, room.resources, room.gulf]),
      worldBefore,
    );
    assert.equal(room.sessions.size, 0);
    assert.equal(room.players.size, 2);
    assert.equal(peer.socket.readyState, 1);

    // An ordinary network reconnect still resumes in place, without taking a
    // different character from stale browser preferences.
    Object.assign(next.p, { x: 100, z: 120 });
    next.socket.close();
    const reconnect = join({ session: next.welcome.session, species: 'cat' });
    assert.equal(reconnect.p.species, 'ape');
    assert.deepEqual([reconnect.p.x, reconnect.p.z], [100, 120]);
    assert.deepEqual(reconnect.p.inventory, inventory);
    reconnect.socket.close();
    peer.socket.close();
  });
}

test('a failed camp spawn preserves the saved appearance, position and items for a retry', () => {
  const { core, join } = fixture({ persistentSessions: true });
  const first = join();
  Object.assign(first.p, { x: 100, z: 120 });
  first.p.inventory.wood = 9;
  first.socket.command({ type: 'leave', keepSession: true });
  const room = core.rooms.get('TITLE');
  const nearestFree = room.collision.nearestFree;
  room.collision.nearestFree = () => null;
  const refused = join({ session: first.welcome.session, startAtCamp: '1', species: 'ape' });
  assert.equal(refused.welcome, undefined);
  assert.ok(refused.socket.messages.some((m) => m.code === 'NO_SPAWN'));
  const saved = room.sessions.get(first.welcome.session).player;
  assert.equal(saved.species, 'cro');
  assert.deepEqual([saved.x, saved.z, saved.inventory.wood], [100, 120, 9]);
  room.collision.nearestFree = nearestFree;
  const retry = join({ session: first.welcome.session, startAtCamp: '1', species: 'ape' });
  assert.equal(retry.p.species, 'ape');
  assert.equal(retry.p.inventory.wood, 9);
  retry.socket.close();
});

test('starting from a persisted title session preserves items after a server restart', () => {
  const original = fixture({ persistentSessions: true });
  const first = original.join();
  first.p.inventory.shells = 6;
  Object.assign(first.p, { x: 100, z: 120 });
  first.socket.command({ type: 'leave', keepSession: true });
  const restored = fixture({ persistentSessions: true });
  restored.core.importState(original.core.exportState());
  const next = restored.join({
    session: first.welcome.session,
    startAtCamp: '1',
    species: 'bear',
    difficulty: 'easy',
  });
  assert.equal(next.welcome.id, first.welcome.id);
  assert.equal(next.p.inventory.shells, 6);
  assert.equal(next.p.species, 'bear');
  assert.equal(next.p.difficulty, 'easy');
  assert.ok(Math.hypot(next.p.x - 48, next.p.z - 57) < 10);
  next.socket.close();
});

test('the title Start button opens setup even with a saved session', async () => {
  const main = await readFile(new URL('../dist/src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf("$('#title-start').onclick");
  const handler = main.slice(start, main.indexOf("$('#title-contributors')", start));
  assert.ok(start >= 0 && handler.length > 0);
  const button = {};
  let setup = 0;
  vm.runInNewContext(handler, {
    $: () => button,
    savedSession: () => 'existing-session',
    sessionKey: () => 'TITLE',
    profile: { room: 'TITLE' },
    enterGame: () => assert.fail('Start skipped character and difficulty selection'),
    showSetup: () => setup++,
  });
  button.onclick();
  button.onclick();
  assert.equal(setup, 2);
});

test('the contributors cave button starts once at the cave without an extra setup or loading-gallery choice', async () => {
  const main = await readFile(new URL('../dist/src/main.js', import.meta.url), 'utf8');
  // The visit is bound by a function the title-shell handoff also uses.
  const start = main.indexOf('function bindContributorsVisit(');
  const handler = main.slice(start, main.indexOf("$('#title-fullscreen').onclick", start));
  assert.ok(start >= 0 && handler.includes("$('#title-contributors').addEventListener"));
  const visit = { disabled: false };
  const calls = [];
  let open;
  const context = {
    $: (selector) =>
      selector === '#title-contributors'
        ? {
            addEventListener: (_event, callback) => {
              open = callback;
            },
          }
        : selector === '#contributors-cave'
          ? visit
          : { close: () => calls.push('close') },
    openModal: () => calls.push('dialog'),
    contributorsDialogMarkup: () => '',
    onlineTitle: true,
    renderUnavailable: false,
    loadingCave: null,
    spawnChoice: 'camp',
    startAtCamp: false,
    contributorsCavePending: false,
    enterGame: (skipGallery) => calls.push(['enterGame', skipGallery]),
  };
  vm.runInNewContext(handler, context);
  open();
  context.renderUnavailable = true;
  visit.onclick();
  assert.equal(visit.disabled, false);
  context.renderUnavailable = false;
  visit.onclick();
  visit.onclick();
  assert.equal(context.spawnChoice, 'cave');
  assert.equal(context.startAtCamp, true);
  assert.equal(context.contributorsCavePending, true);
  assert.deepEqual(calls, ['dialog', 'close', ['enterGame', true]]);
});

for (const persistentSessions of [false, true]) {
  test(`visiting the contributors cave resumes the same person and possessions (persistent=${persistentSessions})`, () => {
    const { core, join } = fixture({ persistentSessions, exhibition: !persistentSessions });
    const first = join({ species: 'bear', difficulty: 'easy' });
    Object.assign(first.p, { x: 100, z: 120, energy: 64, gathered: 9 });
    first.p.inventory.wood = 8;
    first.p.inventory.shells = 6;
    const inventory = structuredClone(first.p.inventory);
    first.socket.command({ type: 'leave', keepSession: true });
    const arrival = join({
      session: first.welcome.session,
      startAtCamp: '1',
      spawn: 'cave',
      species: 'bear',
      difficulty: 'easy',
    });
    const cave = spawnSite('cave');
    arrival.socket.command({ type: 'action', action: 'warp', targetId: 'spawn-cave' });
    assert.equal(arrival.welcome.id, first.welcome.id);
    assert.equal(arrival.p.species, 'bear');
    assert.equal(arrival.p.difficulty, 'easy');
    assert.equal(arrival.p.energy, 64);
    assert.equal(arrival.p.gathered, 9);
    assert.deepEqual(arrival.p.inventory, inventory);
    assert.ok(Math.hypot(arrival.p.x - cave.x, arrival.p.z - cave.z) <= 8);
    assert.ok(core.rooms.get('TITLE').collision.free(arrival.p, arrival.p.radius));
    arrival.socket.close();
  });
}
