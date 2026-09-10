import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { MAP_PIN_LIFETIME_MS, MAP_PIN_COOLDOWN_MS } from '../dist/shared/map-pins.mjs';
import { WORLD_BOUNDS } from '../dist/shared/world-bounds.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  command(message) {
    this.emit('message', JSON.stringify(message));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  state() {
    return this.messages.filter((m) => m.type === 'state').at(-1);
  }
}
function setup() {
  let now = 10000,
    serial = 0;
  const core = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `pin-${++serial}`, token: () => `token-${++serial}` },
  });
  const join = (name, room = 'PINS') => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ name, room, resume: '1' }));
    return socket;
  };
  return {
    core,
    join,
    advance: (ms) => {
      now += ms;
    },
    room: () => core.rooms.get('PINS'),
  };
}
const place = (socket, x = 100, z = 200, extra = {}) =>
  socket.command({ type: 'mapPin', x, z, ...extra });

test('pin protocol rejects malformed/nonfinite/out-of-world coordinates and ignores claimed identity', () => {
  for (const x of [null, '100', {}, [], WORLD_BOUNDS.minX - 1, WORLD_BOUNDS.maxX + 1])
    assert.equal(decodeCommand(JSON.stringify({ type: 'mapPin', x, z: 0 })), null);
  for (const z of [null, '0', WORLD_BOUNDS.minZ - 1, WORLD_BOUNDS.maxZ + 1])
    assert.equal(decodeCommand(JSON.stringify({ type: 'mapPin', x: 0, z })), null);
  assert.equal(decodeCommand('{"type":"mapPin","x":1e999,"z":0}'), null);
  assert.deepEqual(decodeCommand('{"type":"mapPin","x":0,"z":0,"ownerId":"forged"}'), {
    type: 'mapPin',
    x: 0,
    z: 0,
  });
});

test('pin and named invitation reach the same room only, without changing player progress', () => {
  const s = setup(),
    a = s.join('First'),
    b = s.join('Friend'),
    outsider = s.join('Other', 'OTHER');
  const before = a.state().players;
  const outsiderCount = outsider.messages.length;
  place(a, 200, 300, { ownerId: 'forged', name: 'forged', expiresAt: Infinity });
  const pin = a.state().mapPins[0];
  assert.equal(pin.ownerId, before[0].id);
  assert.equal(pin.name, 'First');
  assert.equal(pin.expiresAt, 10000 + MAP_PIN_LIFETIME_MS);
  assert.deepEqual(a.state().mapPins, b.state().mapPins);
  assert.deepEqual(a.state().players, before);
  assert.equal(outsider.messages.length, outsiderCount);
  assert.equal(b.messages.filter((m) => m.type === 'chat' && m.mapPin).length, 1);
});

test('five players each get one pin, replacement is rate limited and clears only the owner', () => {
  const s = setup(),
    sockets = Array.from({ length: 5 }, (_, i) => s.join(`P${i}`));
  sockets.forEach((p, i) => place(p, 100 + i, 200));
  assert.equal(sockets[0].state().mapPins.length, 5);
  const id = sockets[0].state().mapPins[0].id;
  place(sockets[0], 900, 900);
  assert.equal(sockets[0].state().mapPins[0].id, id);
  s.advance(MAP_PIN_COOLDOWN_MS);
  place(sockets[0], 900, 900);
  assert.equal(sockets[0].state().mapPins.length, 5);
  assert.equal(sockets[0].state().mapPins.at(-1).x, 900);
  const otherPins = sockets[0].state().mapPins.slice(0, 4);
  sockets[0].command({ type: 'clearMapPin', ownerId: otherPins[0].ownerId });
  assert.deepEqual(sockets[1].state().mapPins, otherPins);
  place(sockets[0]); // Clear cannot bypass the send cooldown.
  assert.deepEqual(sockets[1].state().mapPins, otherPins);
});

test('late joining players see active pins; expiry and departure remove them', () => {
  const s = setup(),
    a = s.join('First');
  place(a);
  const b = s.join('Late');
  assert.equal(b.state().mapPins.length, 1);
  s.advance(MAP_PIN_LIFETIME_MS);
  b.command({ type: 'clearMapPin' });
  assert.deepEqual(b.state().mapPins, []);
  place(a);
  a.close();
  assert.deepEqual(b.state().mapPins, []);
});

test('temporary pins and cooldown do not enter saved worlds or reappear after restart', () => {
  const s = setup(),
    a = s.join('First');
  place(a);
  const saved = s.core.exportState();
  assert.ok(!JSON.stringify(saved).includes('mapPins'));
  assert.ok(!JSON.stringify(saved).includes('lastMapPinAt'));
  const restored = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  restored.importState(saved);
  const b = new Socket();
  restored.connect(b, new URLSearchParams({ room: 'PINS', name: 'New' }));
  assert.deepEqual(b.state().mapPins, []);
});
