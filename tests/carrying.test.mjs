import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { canCarry, carryExit } from '../dist/shared/carrying.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { canStartAttack } from '../dist/src/combat-input.js';
import { startAttack } from '../dist/shared/combat.mjs';

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

test('invitations decline, expire and cancel outside reach without picking up another player', () => {
  for (const mode of ['decline', 'expire', 'leave']) {
    const f = fixture();
    f.action(0);
    if (mode === 'decline') f.action(1, 'carryDecline');
    if (mode === 'expire') f.advance(15000);
    if (mode === 'leave') {
      f.b.x = 10;
      f.advance(100);
    }
    assert.ok(!f.a.carryOfferToId);
    assert.ok(!f.b.carryOfferFromId);
    assert.ok(!f.b.carrierId);
  }
});

test('moving players can invite and board from a step apart without stopping the carrier', () => {
  const f = fixture();
  f.b.x = f.a.radius + f.b.radius + 1.8;
  for (const peer of f.peers.slice(0, 2)) peer.socket.command({ type: 'move', dx: 0, dz: 1 });
  f.advance(100);
  assert.ok(f.a.moving && f.b.moving);
  f.action(0);
  assert.equal(f.b.carryOfferFromId, f.a.id);
  f.advance(100);
  assert.equal(f.b.carryOfferFromId, f.a.id);
  const before = f.a.z;
  f.action(1);
  assert.equal(f.b.carrierId, f.a.id);
  assert.equal(f.a.passengerId, f.b.id);
  assert.equal(f.a.dz, 1);
  assert.equal(f.a.moving, true);
  assert.equal(f.b.dx, 0);
  assert.equal(f.b.dz, 0);
  f.advance(100);
  assert.ok(f.a.z > before);
  assert.equal(f.b.z, f.a.z);
  assert.equal(f.b.x, f.a.x);
});

test('unavailable world actions return quiet notices without changing inventory or mounting', () => {
  const f = fixture();
  f.room.resources = [];
  f.a.x = f.a.z = -100;
  const inventory = structuredClone(f.a.inventory);
  for (const action of [
    'gather',
    'ride',
    'boardBoat',
    'harvest',
    'cook',
    'contribute',
    'trade',
    'carry',
  ]) {
    const start = f.peers[0].socket.messages.length;
    f.action(0, action, 'missing');
    const notices = f.peers[0].socket.messages.slice(start).filter((m) => m.type === 'notice');
    assert.ok(notices.length > 0, action);
    assert.ok(
      notices.every((m) => m.popup === false),
      action,
    );
    f.advance();
  }
  assert.deepEqual(f.a.inventory, inventory);
  assert.ok(!f.a.mountId && !f.a.boatId && !f.a.passengerId);
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
  assert.ok(Math.abs(f.a.z - 0.24) < 1e-8);
  assert.equal(f.a.z, f.b.z);
  f.peers[0].socket.command({ type: 'move', dx: 0, dz: 1, running: true });
  f.advance(100);
  assert.ok(Math.abs(f.a.z - 0.88) < 1e-8);
  assert.equal(f.b.running, true);
  f.advance(600);
  assert.ok(Math.abs(f.a.z - 0.88) < 1e-8);
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

test('carrying blocks jump, work, barter and mounts for both participants and carrier attacks', () => {
  const f = fixture();
  f.board();
  const inventories = f.peers.slice(0, 2).map(({ p }) => structuredClone(p.inventory));
  for (const i of [0, 1])
    for (const action of [
      'jump',
      'craft',
      'gather',
      'ride',
      'boardBoat',
      'rift',
      ...(i === 0 ? ['attack'] : []),
    ]) {
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

test('shoulder mage casts while the ape runs, damages once and synchronizes the attached attack', () => {
  const f = fixture();
  f.board();
  const target = {
    id: 'target',
    x: 0,
    z: 4,
    radius: 0.4,
    health: 100,
    phase: 'alive',
    path: [],
    nextRoam: Infinity,
    age: 0,
    scale: 1,
  };
  f.room.animals = [target];
  f.peers[0].socket.command({ type: 'move', dx: 0, dz: 1, running: true });
  assert.equal(canStartAttack(f.b, f.now()), true);
  const energy = f.b.energy;
  f.action(1, 'attack', target.id);
  assert.equal(f.b.attackSequence, 1);
  assert.equal(f.b.energy, energy - 4);
  assert.equal(canStartAttack(f.b, f.now()), false);
  for (let i = 0; i < 8; i++) {
    f.peers[0].socket.command({ type: 'move', dx: 1, dz: 0, running: true });
    f.advance(100);
    assert.equal(f.b.carrierId, f.a.id);
    assert.equal(f.b.x, f.a.x);
    if (i < 7) assert.equal(f.b.facing, 0, 'casting aim survives carrier turns');
    if (i === 3) {
      assert.equal(f.room.projectiles.length, 1);
      const orb = f.room.projectiles[0];
      assert.equal(orb.ownerId, f.b.id);
      assert.equal(orb.x, f.a.x, 'launch follows current carrier position');
      target.x = orb.x + ((target.z - orb.z) * orb.dx) / orb.dz;
      assert.ok(Math.abs(orb.dx * orb.speed - 6.4) < 1e-8);
      assert.ok(Math.abs(orb.dz * orb.speed - 7) < 1e-8);
      for (const { socket } of f.peers) {
        const state = socket.messages.filter((m) => m.type === 'state').at(-1);
        assert.equal(state.projectiles[0].speed, orb.speed);
        assert.equal(state.projectiles[0].dx, orb.dx);
        assert.equal(state.players.find((p) => p.id === f.b.id).attackSequence, 1);
        assert.equal(state.players.find((p) => p.id === f.b.id).carrierId, f.a.id);
      }
    }
  }
  assert.ok(f.a.x > 4, 'carrier keeps running during cast');
  f.advance(300);
  assert.equal(target.health, 40);
  assert.equal(f.room.projectiles.length, 0);
  // The heavy bolt keeps the caster on a long recharge before the next cast.
  assert.equal(canStartAttack(f.b, f.now()), false);
  f.advance(4000);
  assert.equal(canStartAttack(f.b, f.now()), true);
  f.action(1, 'attack');
  assert.equal(f.b.attackSequence, 2);
});

test('shoulder magic retains wall, cooldown and canonical appearance restrictions', () => {
  const f = fixture();
  f.board();
  for (const change of [
    { species: 'cro' },
    { species: 'ape' },
    { downedUntil: 123456 },
    { mountId: 'm' },
    { boatId: 'b' },
  ]) {
    const p = { ...f.b, ...change };
    assert.equal(canStartAttack(p, f.now()), false);
    assert.equal(startAttack(f.room, p, { weapon: 'magic' }, f.now()).accepted, false);
  }
  assert.equal(startAttack(f.room, { ...f.b, carrierId: 'forged' }, {}, f.now()).accepted, false);
  f.room.collision = new CollisionWorld(
    [{ type: 'box', x: 0, z: 1, hx: 4, hz: 0.05, c: 1, s: 0 }],
    { river: false },
  );
  const target = {
    id: 'behind-wall',
    x: 0,
    z: 3,
    radius: 0.4,
    health: 100,
    phase: 'alive',
    path: [],
    nextRoam: Infinity,
    age: 0,
    scale: 1,
  };
  f.room.animals = [target];
  f.action(1, 'attack', target.id);
  assert.equal(f.b.attackSequence, 1);
  assert.equal(startAttack(f.room, f.b, {}, f.now() + 100).reason, 'cooldown');
  f.advance(1000);
  assert.equal(target.health, 100);
  assert.equal(f.room.projectiles.length, 0);
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
