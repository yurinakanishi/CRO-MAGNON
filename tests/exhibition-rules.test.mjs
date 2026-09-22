import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { DEFAULT_RULES, EXHIBITION_RULES, roomRules } from '../dist/shared/room-rules.mjs';
import { SPAWN_SITES, spawnSite } from '../dist/shared/spawn-sites.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { SABERTOOTH } from '../dist/shared/sabertooth-rules.mjs';
import { BEHEMOTH } from '../dist/shared/behemoth-rules.mjs';

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  listeners = new Map();
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  on(type, handler) {
    this.listeners.set(type, handler);
  }
  close() {}
  ping() {}
  command(message) {
    this.listeners.get('message')?.(Buffer.from(JSON.stringify(message)), false);
  }
}
function join(exhibition, params = {}) {
  let now = 1000,
    serial = 0;
  const runtime = {
    now: () => now,
    id: () => `visitor-${++serial}`,
    token: () => `token-${++serial}`,
  };
  const core = createGameCore({ runtime, keepEmptyRooms: true, exhibition });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'FLOOR', name: 'Visitor', ...params }));
  const welcome = socket.messages.find((message) => message.type === 'welcome');
  const room = core.rooms.get('FLOOR');
  return {
    core,
    socket,
    welcome,
    room,
    player: room.players.get(welcome.id),
    advance: (ms) => {
      now += ms;
      core.tick();
    },
  };
}

test('partial room rules fall back to the ordinary game', () => {
  assert.deepEqual(roomRules({}), DEFAULT_RULES);
  assert.equal(roomRules({ rules: { respawnMs: 5 } }).speedScale, 1);
  assert.equal(roomRules({ rules: { respawnMs: 5 } }).castleSeal, true);
});

test('an exhibition visitor always runs, 1.4 times faster, and the client is told so', () => {
  const floor = join(true),
    plain = join(false);
  assert.deepEqual(floor.welcome.rules, { alwaysRun: true, speedScale: 1.4, spawnChoice: true });
  assert.deepEqual(plain.welcome.rules, { alwaysRun: false, speedScale: 1, spawnChoice: false });
  for (const session of [floor, plain]) {
    session.socket.command({ type: 'move', dx: 0, dz: 1, running: false });
    session.advance(50);
  }
  assert.equal(floor.player.running, true);
  assert.ok(Math.abs(floor.player.speed - WORLD.runSpeed * 1.4) < 0.2, String(floor.player.speed));
  assert.equal(plain.player.running, false);
  assert.ok(Math.abs(plain.player.speed - WORLD.walkSpeed) < 0.2, String(plain.player.speed));
  floor.socket.command({ type: 'gait', running: false });
  assert.equal(floor.player.runningRequested, true, 'a walk request cannot slow the visitor');
});

test('a title start may name a pictured sight only where the room allows it', () => {
  assert.deepEqual(
    SPAWN_SITES.map(({ id }) => id),
    ['camp', 'mammoth', 'sabertooth', 'behemoth', 'castle', 'cave'],
  );
  assert.equal(spawnSite('nowhere').id, 'camp');
  for (const site of SPAWN_SITES) {
    const { player } = join(true, { startAtCamp: '1', spawn: site.id });
    assert.ok(
      Math.hypot(player.x - site.x, player.z - site.z) < 6,
      `${site.id}: ${player.x},${player.z}`,
    );
    if (site.id !== 'camp') {
      const toward = Math.atan2(site.look.x - player.x, site.look.z - player.z);
      assert.ok(Math.abs(Math.sin(player.facing - toward)) < 1e-6, `${site.id} faces its sight`);
    }
  }
  const tiger = spawnSite('sabertooth'),
    beast = spawnSite('behemoth');
  assert.ok(
    Math.hypot(tiger.x - tiger.look.x, tiger.z - tiger.look.z) > SABERTOOTH.territoryRadius,
    'nobody arrives inside the sabertooth territory',
  );
  assert.ok(
    Math.hypot(beast.x - beast.look.x, beast.z - beast.look.z) > BEHEMOTH.territoryRadius,
    'nobody arrives inside the behemoth territory',
  );
  const camp = spawnSite('camp'),
    ordinary = join(false, { startAtCamp: '1', spawn: 'sabertooth' }).player;
  assert.ok(Math.hypot(ordinary.x - camp.x, ordinary.z - camp.z) < 6, 'ordinary rooms ignore it');
});

test('exhibition blows land fourfold, cost nothing, and ignore the castle seal', () => {
  const { room, player, advance } = join(true);
  advance(50);
  const crows = room.enemies.filter((enemy) => enemy.castle);
  assert.ok(crows.length > 20);
  assert.ok(
    crows.every((enemy) => !enemy.sealed),
    'every rank can be struck at once',
  );
  const pontiff = crows.find((enemy) => enemy.crowRole === 'pontiff');
  Object.assign(player, { x: pontiff.x, z: pontiff.z - 1.2, facing: 0, energy: 100 });
  player.invulnerableUntil = 1e12;
  const profile = attackProfile(player),
    before = pontiff.health;
  assert.equal(startAttack(room, player, {}, 5000).accepted, true);
  assert.equal(player.energy, 100, 'attacking is free');
  // Height and walls are the keep's own concern; strike through a permissive world.
  const open = { ...room, collision: { segmentFree: () => true, surfaceHeight: () => 0 } };
  const result = resolveAttack(open, player, 5000 + profile.impactMs);
  assert.equal(result.hit, true);
  assert.notEqual(result.sealed, true);
  assert.equal(pontiff.health, before - profile.damage * EXHIBITION_RULES.playerDamageScale);
});

test('the ordinary game keeps its seal and single damage', () => {
  const { room, advance } = join(false);
  advance(50);
  const crows = room.enemies.filter((enemy) => enemy.castle);
  assert.ok(crows.some((enemy) => enemy.sealed));
  assert.equal(DEFAULT_RULES.playerDamageScale, 1);
});
