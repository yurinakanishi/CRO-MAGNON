import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) {
    this.messages.push(JSON.parse(raw));
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
const cases = [
  ['rimoNeko', 'petRimo', 'dismissRimo'],
  ['mae', 'petMae', 'dismissMae'],
  ['companion524', 'pet524', 'dismiss524'],
  ['orbBots', 'petBots', 'dismissBots'],
];
function fixture(key) {
  let now = 10000,
    serial = 0;
  const options = {
    mascotModels: ALL_MASCOT_MODELS,
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `start-${++serial}`, token: () => `session-${++serial}` },
  };
  let core = createGameCore(options);
  const join = (session = '') => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'START', resume: '1', session }));
    return { socket, welcome: socket.messages.find((m) => m.type === 'welcome') };
  };
  const owner = join(),
    observer = join();
  const room = () => core.rooms.get('START');
  const player = () => room().players.get(owner.welcome.id);
  room().collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  room().enemies = [];
  room().animals = [];
  const c = key === 'orbBots' ? { x: 44, z: 56 } : room()[key];
  Object.assign(player(), { x: c.x, z: c.z - 1.8 });
  player().inventory.wood = 7;
  const pet = () =>
    key === 'orbBots' ? room().orbBots.filter((b) => b.kind !== '524') : [room()[key]];
  const bond = (b) =>
    key === 'orbBots' ? b.ownerId : key === 'companion524' ? b.squadPlayerId : b.followPlayerId;
  const action = (action, socket = owner.socket) => {
    now += 200;
    socket.emit('message', JSON.stringify({ type: 'action', action }));
  };
  const step = (ms = 50) => {
    now += ms;
    core.tick();
  };
  return {
    owner,
    observer,
    room,
    player,
    join,
    pet,
    bond,
    action,
    step,
    restart() {
      const saved = core.exportState(),
        original = structuredClone(saved);
      core.close();
      core = createGameCore(options);
      core.importState(saved);
      assert.deepEqual(saved, original);
      return saved;
    },
    close: () => core.close(),
  };
}

for (const [key, action, dismiss] of cases) {
  test(`${key}: accepted pet is bonded in the first broadcast and survives recall before any contact`, () => {
    const f = fixture(key);
    try {
      f.action(action);
      const pets = f.pet();
      assert.equal(pets.length, key === 'orbBots' ? 9 : 1);
      assert.ok(pets.every((b) => b.petPlayerId === f.owner.welcome.id && !b.petContactAt));
      assert.ok(pets.every((b) => f.bond(b) === f.owner.welcome.id));
      for (const client of [f.owner, f.observer]) {
        const state = client.socket.messages.filter((m) => m.type === 'state').at(-1);
        const shared = key === 'orbBots' ? state.orbBots : [state[key]];
        assert.ok(shared.every((b) => f.bond(b) === f.owner.welcome.id));
      }
      f.action('recallBots');
      f.step();
      assert.ok(f.pet().every((b) => !b.petPlayerId && f.bond(b) === f.owner.welcome.id));
      f.action(dismiss);
      f.step();
      assert.ok(
        f.pet().every((b) => !f.bond(b)),
        'explicit dismissal still removes the bond',
      );
    } finally {
      f.close();
    }
  });

  test(`${key}: immediate disconnect and restart retain the new bond, progress and a single original body`, () => {
    const f = fixture(key);
    try {
      f.action(action);
      const ids = f.pet().map((b) => b.id);
      f.owner.socket.close();
      f.step();
      assert.ok(f.pet().every((b) => f.bond(b) === f.owner.welcome.id));
      f.restart();
      assert.ok(f.pet().every((b) => f.bond(b) === f.owner.welcome.id && !b.petPlayerId));
      const resumed = f.join(f.owner.welcome.session);
      assert.equal(resumed.welcome.id, f.owner.welcome.id);
      f.step();
      assert.deepEqual(
        f.pet().map((b) => b.id),
        ids,
      );
      assert.equal(f.player().inventory.wood, 7);
      assert.ok(f.pet().every((b) => f.bond(b) === f.owner.welcome.id));
      f.action('travelAlone', resumed.socket);
      f.restart();
      assert.ok(
        f.pet().every((b) => !f.bond(b)),
        'dismissal survives saving too',
      );
    } finally {
      f.close();
    }
  });
}
