import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createRimoNeko } from '../dist/shared/rimo-neko.mjs';
import { createCompanion524 } from '../dist/shared/companion-524.mjs';
import { createMae } from '../dist/shared/mae.mjs';
import { createKohaku } from '../dist/shared/kohaku.mjs';
import { BOT_KINDS, botRadius, syncOrbBots, updateOrbBots } from '../dist/shared/orb-bots.mjs';
import { setMascotSelection } from '../dist/shared/mascot-selection.mjs';

function fixture() {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const p = {
    id: 'p',
    x: 44,
    z: 54,
    facing: 0,
    radius: 0.32,
    species: 'cro',
    gender: 'female',
    speed: 0,
    moving: false,
    downedUntil: 0,
    attackAt: 0,
    attackSequence: 0,
  };
  const q = { ...p, id: 'q', x: 46 };
  const room = {
    collision,
    players: new Map([
      [p.id, p],
      [q.id, q],
    ]),
    rimoNeko: createRimoNeko(collision),
    companion524: createCompanion524(collision),
    mae: createMae(collision),
    kohaku: createKohaku(collision),
  };
  syncOrbBots(room, 10000);
  const select = (target, enabled, player = p) =>
    setMascotSelection(room, player, target, enabled, 10000);
  return { room, p, q, select };
}

test('one card selects exactly one mascot and returns it without changing the others', () => {
  const f = fixture();
  const white = f.room.orbBots.find((b) => b.kind === 'white');
  assert.ok(f.select('white', true));
  assert.equal(white.ownerId, f.p.id);
  assert.equal(white.mode, 'following');
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === f.p.id).length, 1);
  assert.ok(f.select('white', false));
  assert.equal(white.ownerId, '');
  assert.equal(white.returnHome, true);
  assert.equal(f.select('white', false), false);
});

test('all cards select and clear every available mascot, including the four unique companions', () => {
  const f = fixture();
  assert.ok(f.select('all', true));
  assert.equal(
    f.room.orbBots.filter((b) => BOT_KINDS.includes(b.kind) && b.ownerId === 'p').length,
    9,
  );
  for (const key of ['rimoNeko', 'companion524', 'mae', 'kohaku'])
    assert.equal(f.room[key].followPlayerId, 'p', key);
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === 'p').length, 11);
  updateOrbBots(f.room, 0.05, 10050);
  assert.ok(f.select('all', false));
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === 'p').length, 0);
  for (const key of ['rimoNeko', 'companion524', 'mae', 'kohaku'])
    assert.equal(f.room[key].followPlayerId, null, key);
});

test('another connected player keeps their mascots during individual and bulk selection', () => {
  const f = fixture();
  assert.ok(f.select('white', true, f.q));
  assert.ok(f.select('mae', true, f.q));
  assert.equal(f.select('white', true), false);
  assert.equal(f.select('mae', true), false);
  assert.ok(f.select('all', true));
  assert.equal(f.room.orbBots.find((b) => b.kind === 'white').ownerId, 'q');
  assert.equal(f.room.mae.followPlayerId, 'q');
  assert.ok(f.select('all', false));
  assert.equal(f.room.orbBots.find((b) => b.kind === 'white').ownerId, 'q');
  assert.equal(f.room.mae.followPlayerId, 'q');
});

test('invalid targets and a downed player cannot change the roster', () => {
  const f = fixture();
  assert.equal(f.select('__proto__', true), false);
  f.p.downedUntil = 20000;
  assert.equal(f.select('all', true), false);
  assert.equal(f.room.orbBots.filter((b) => b.ownerId).length, 0);
});

test('an absent owner can be replaced, while a hidden mascot stays out of bulk selection', () => {
  const f = fixture();
  assert.ok(f.select('white', true, f.q));
  assert.ok(f.select('mae', true, f.q));
  f.room.players.delete(f.q.id);
  assert.ok(f.select('white', true));
  assert.ok(f.select('mae', true));
  assert.equal(f.room.orbBots.find((b) => b.kind === 'white').ownerId, 'p');
  assert.equal(f.room.mae.followPlayerId, 'p');
  delete f.room.mae;
  assert.ok(f.select('all', true));
  assert.equal(f.room.mae, undefined);
});

test('selecting from far away places companions safely near the player', () => {
  const f = fixture();
  Object.assign(f.p, { x: 120, z: 120 });
  delete f.room.orbBots;
  assert.ok(f.select('all', true));
  const mascots = [
    ...f.room.orbBots.filter((b) => BOT_KINDS.includes(b.kind)),
    f.room.rimoNeko,
    f.room.companion524,
    f.room.mae,
    f.room.kohaku,
  ];
  const radius = (mascot) => (mascot.kind ? botRadius(mascot.kind) : mascot.radius);
  for (const mascot of mascots) assert.ok(Math.hypot(mascot.x - f.p.x, mascot.z - f.p.z) < 6);
  for (const mascot of mascots)
    for (const other of mascots)
      if (mascot !== other)
        assert.ok(
          Math.hypot(mascot.x - other.x, mascot.z - other.z) >=
            radius(mascot) + radius(other) - 0.0001,
          `${mascot.kind ?? mascot.id} overlaps ${other.kind ?? other.id}`,
        );
});
