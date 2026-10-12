import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { activeMascot, chooseMascot, updateMascots } from '../dist/shared/mascot-selection.mjs';

export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const flatCollision = (obstacles = []) =>
  new CollisionWorld(obstacles, { coast: false, river: false, walkSurfaces: [] });
export const person = (id = 'p', extra = {}) => ({
  id,
  name: id,
  x: 50,
  z: 50,
  facing: 0,
  radius: 0.32,
  species: 'cro',
  gender: 'female',
  speed: 0,
  energy: 100,
  attackAt: 0,
  attackSequence: 0,
  jumpAt: 0,
  jumpSequence: 0,
  warpSequence: 0,
  hurtAt: 0,
  moving: false,
  downedUntil: 0,
  cookingEndsAt: 0,
  inventory: {},
  mascot: null,
  ...extra,
});

/** One explicitly selected mascot in an open world; no shared camp bodies. */
export function mascotFixture(key = '524', obstacles = []) {
  const p = person();
  const room = {
    collision: flatCollision(obstacles),
    players: new Map([[p.id, p]]),
    companions: [],
    orbBots: [],
    animals: [],
    enemies: [],
  };
  assert.equal(chooseMascot(room, p, key, 10000), true);
  const c = activeMascot(room, p.id);
  const b = room.orbBots.find((entry) => entry.ownerId === p.id);
  return { p, room, c, b };
}

export function advanceMascots(room, start, seconds, dt = 0.05, move) {
  for (let elapsed = dt; elapsed < seconds + dt / 2; elapsed += dt) {
    move?.(elapsed);
    updateMascots(room, dt, start + elapsed * 1000);
    for (const body of [...room.companions, ...room.orbBots]) {
      assert.ok([body.x, body.z].every(Number.isFinite), `finite ${body.id}`);
    }
  }
}

export class MascotSocket extends EventEmitter {
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
  ping() {
    this.emit('pong');
  }
  terminate() {
    this.close();
  }
}

/** Real commands, snapshots and session checkpoints on a deterministic game clock. */
export function mascotCore(t, options = {}) {
  let now = 10000,
    serial = 0;
  const settings = {
    persistentSessions: true,
    keepEmptyRooms: true,
    ...options,
    runtime: { now: () => now, id: () => `mascot-${++serial}`, token: () => `session-${++serial}` },
  };
  let core = createGameCore(settings);
  t?.after(() => core.close());
  const room = () => core.rooms.get('MASCOTS');
  const flatten = () => {
    room().collision = flatCollision();
    room().animals = [];
    room().enemies = [];
    room().behemoth = null;
    room().sabertooth = null;
  };
  const join = (name = 'A', session = '', at = { x: 50, z: 50 }) => {
    const socket = new MascotSocket();
    core.connect(socket, new URLSearchParams({ room: 'MASCOTS', name, resume: '1', session }));
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    assert.ok(welcome, `${name} joined`);
    flatten();
    if (at) Object.assign(room().players.get(welcome.id), at, { facing: 0 });
    return {
      socket,
      welcome,
      id: welcome.id,
      session: welcome.session,
      player: () => room().players.get(welcome.id),
    };
  };
  return {
    core: () => core,
    room,
    join,
    now: () => now,
    act(who, action, targetId) {
      now += 500;
      who.socket.emit('message', JSON.stringify({ type: 'action', action, targetId }));
    },
    step(ms = 50, count = 1) {
      for (let i = 0; i < count; i++) {
        now += ms;
        core.tick();
      }
    },
    active: (who) => activeMascot(room(), who.id),
    state: (who) => who.socket.messages.filter((m) => m.type === 'state').at(-1),
    load(saved, overrides = {}) {
      core.close();
      core = createGameCore({ ...settings, ...overrides });
      core.importState(saved);
      if (room()) flatten();
    },
  };
}
