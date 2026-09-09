import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { canCarry, carryExit } from '../dist/shared/carrying.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  handlers = {};
  messages = [];
  on(name, fn) {
    this.handlers[name] = fn;
  }
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  command(m) {
    this.handlers.message({ toString: () => JSON.stringify(m) }, false);
  }
}
function fixture() {
  let now = 100000,
    id = 0;
  const runtime = { now: () => now, id: () => `carry-${++id}`, token: () => `token-${++id}` };
  const core = createGameCore({ runtime, keepEmptyRooms: true });
  const peers = ['ape', 'bear', 'ape', 'bear'].map((species, i) => {
    const socket = new Socket();
    core.connect(
      socket,
      new URLSearchParams({ room: 'CARRY', species, name: `peer-${i}`, resume: '1' }),
    );
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    return { socket, welcome, p: core.rooms.get('CARRY').players.get(welcome.id) };
  });
  const room = core.rooms.get('CARRY');
  room.collision = new CollisionWorld([], { river: false });
  room.animals = [];
  room.enemies = [];
  room.residents = [];
  peers.forEach(({ p }, i) =>
    Object.assign(p, { x: i < 2 ? i * 1.3 : 15 + i * 2, z: 0, facing: 0 }),
  );
  const advance = (ms = 500) => {
    now += ms;
    core.tick();
  };
  const action = (i, action = 'carry', targetId = peers[i === 0 ? 1 : 0].p.id) =>
    peers[i].socket.command({ type: 'action', action, targetId, x: 9999, carrierId: 'forged' });
  const board = () => {
    action(0);
    action(1);
  };
  return {
    core,
    room,
    peers,
    now: () => now,
    advance,
    action,
    board,
    a: peers[0].p,
    b: peers[1].p,
  };
}

test('shoulder invitation requires the mage to accept; identities, range, walls, busy and occupancy are authoritative', () => {
  const f = fixture();
  f.action(1);
  assert.ok(!f.b.carrierId);
  f.advance();
  f.action(0);
  assert.equal(f.b.carryOfferFromId, f.a.id);
  assert.ok(!f.a.passengerId);
  f.action(3, 'carry', f.a.id);
  assert.ok(!f.peers[3].p.carrierId);
  f.advance();
  f.action(1, 'carry', f.peers[2].p.id);
  assert.ok(!f.b.carrierId);
  f.advance();
  f.board();
  assert.equal(f.a.passengerId, f.b.id);
  assert.equal(f.b.carrierId, f.a.id);
  const wrong = { ...f.b, carrierId: null, species: 'cro' };
  assert.equal(canCarry({ ...f.a, passengerId: null }, wrong, f.room.collision, f.now()), false);
  assert.equal(canCarry(f.peers[2].p, f.b, f.room.collision, f.now()), false);
  for (const props of [
    { mountId: 'm' },
    { boatId: 'b' },
    { jumpAt: f.now(), jumpSequence: 1 },
    { moving: true },
    { cookingEndsAt: f.now() + 1 },
    { attackSequence: 1, attackAt: f.now() },
  ]) {
    assert.equal(
      canCarry(
        { ...f.a, passengerId: null, ...props },
        { ...f.b, carrierId: null },
        f.room.collision,
        f.now(),
      ),
      false,
    );
  }
  const wall = new CollisionWorld([{ type: 'box', x: 0.65, z: 0, hx: 0.1, hz: 4, c: 1, s: 0 }], {
    river: false,
  });
  assert.equal(
    canCarry(
      { ...f.a, passengerId: null, x: 0 },
      { ...f.b, carrierId: null, x: 1.3 },
      wall,
      f.now(),
    ),
    false,
  );
});

test('invitations decline, expire and cancel on movement without picking up another player', () => {
  for (const mode of ['decline', 'expire', 'move']) {
    const f = fixture();
    f.action(0);
    if (mode === 'decline') f.action(1, 'carryDecline');
    if (mode === 'expire') f.advance(15000);
    if (mode === 'move') {
      f.peers[0].socket.command({ type: 'move', dx: 1, dz: 0 });
      f.advance(100);
    }
    assert.ok(!f.a.carryOfferToId);
    assert.ok(!f.b.carryOfferFromId);
    assert.ok(!f.b.carrierId);
  }
});

test('carrier walks and runs at doubled speed with one body; passenger input cannot move it; all peers see attachment', () => {
  const f = fixture();
  f.board();
  const inv = structuredClone(f.b.inventory);
  f.peers[1].socket.command({ type: 'move', dx: 1, dz: 0, running: true });
  f.advance(100);
  assert.equal(f.a.x, 0);
  assert.equal(f.b.x, 0);
  f.peers[0].socket.command({ type: 'move', dx: 0, dz: 1 });
  f.advance(100);
  assert.ok(Math.abs(f.a.z - 0.18) < 1e-8);
  assert.equal(f.a.z, f.b.z);
  f.peers[0].socket.command({ type: 'move', dx: 0, dz: 1, running: true });
  f.advance(100);
  assert.ok(Math.abs(f.a.z - 0.72) < 1e-8);
  assert.equal(f.b.running, true);
  f.advance(600);
  assert.ok(Math.abs(f.a.z - 0.72) < 1e-8);
  assert.equal(f.b.moving, false);
  for (const { socket } of f.peers) {
    const snap = socket.messages.filter((m) => m.type === 'state').at(-1);
    assert.equal(snap.players.find((p) => p.id === f.b.id).carrierId, f.a.id);
    assert.equal(snap.players.find((p) => p.id === f.a.id).passengerId, f.b.id);
  }
  assert.deepEqual(f.b.inventory, inv);
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  prediction.receive(f.b, 100);
  prediction.setInput(1, 0, true, 100);
  const before = prediction.actor.x;
  prediction.step(0.1, 120, f.now(), f.room.collision, []);
  assert.equal(prediction.actor.x, before);
});

test('carrying blocks attack, jump, work, barter and mounts for both participants', () => {
  const f = fixture();
  f.board();
  const inventories = f.peers.slice(0, 2).map(({ p }) => structuredClone(p.inventory));
  for (const i of [0, 1])
    for (const action of ['attack', 'jump', 'craft', 'gather', 'ride', 'boardBoat', 'rift']) {
      f.advance();
      f.action(i, action);
    }
  for (const i of [0, 1]) {
    const { p, socket } = f.peers[i];
    socket.command({ type: 'barter', kind: 'invite', targetId: f.peers[2].p.id });
    assert.equal(p.attackSequence, 0);
    assert.equal(p.jumpSequence, 0);
    assert.ok(!p.mountId && !p.boatId);
    assert.deepEqual(p.inventory, inventories[i]);
  }
  assert.equal(f.b.carrierId, f.a.id);
});

test('either participant can dismount safely; blocked exits keep the pair and do not cross walls', () => {
  for (const i of [0, 1]) {
    const f = fixture();
    f.board();
    f.advance();
    const free = f.room.collision.free;
    f.room.collision.free = () => false;
    assert.equal(carryExit(f.room, f.a, f.b), null);
    f.action(i);
    assert.equal(f.b.carrierId, f.a.id);
    f.room.collision.free = free;
    f.advance();
    f.action(i);
    assert.ok(!f.b.carrierId && !f.a.passengerId);
    assert.equal(overlap(f.b, f.b.radius, { ...f.a, type: 'circle' }), null);
    assert.equal(f.a.dx, 0);
    assert.equal(f.b.dx, 0);
  }
});

test('disconnect and damage clear the pair; exported and restored sessions never resurrect a shoulder link', () => {
  for (const i of [0, 1]) {
    const f = fixture();
    f.board();
    f.peers[i].socket.close();
    assert.ok(!f.a.passengerId && !f.b.carrierId);
  }
  const f = fixture();
  f.board();
  f.a.hurtSequence++;
  f.advance(100);
  assert.ok(!f.a.passengerId && !f.b.carrierId);
  const saved = fixture();
  saved.board();
  const state = saved.core.exportState();
  assert.ok(!JSON.stringify(state).includes('carrierId'));
  assert.ok(!JSON.stringify(state).includes('passengerId'));
  const restored = createGameCore({
    runtime: { now: saved.now, id: () => 'fresh', token: () => 'fresh-token' },
  });
  restored.importState(state);
  for (const session of restored.rooms.get('CARRY').sessions.values())
    assert.ok(!session.player.carrierId && !session.player.passengerId);
});
