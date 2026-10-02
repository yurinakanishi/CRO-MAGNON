import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  COMPANION_524,
  createCompanion524,
  handleCompanion524Action,
  updateCompanion524,
  hitCompanion524,
  nearCompanion524,
  restoreCompanion524,
  companion524Snapshot,
} from '../dist/shared/companion-524.mjs';
import {
  BOT_ORDER,
  ORB_BOTS,
  syncOrbBots,
  updateOrbBots,
  handleOrbBotAction,
  nextOrbBot,
  ownedBotKinds,
  orbBotSnapshots,
  botRadius,
  botRestHeight,
} from '../dist/shared/orb-bots.mjs';
import { damageableTargets } from '../dist/shared/combat.mjs';

const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const c = createCompanion524(collision);
  const p = {
    id: 'p',
    x: c.x,
    z: c.z + 2,
    facing: Math.PI,
    radius: 0.32,
    speed: 0,
    species: 'cro',
    gender: 'female',
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  const q = { ...p, id: 'q', x: p.x + 3 };
  const room = {
    collision,
    companion524: c,
    players: new Map([
      [p.id, p],
      [q.id, q],
    ]),
    animals: [],
    enemies: [],
  };
  let now = 10000;
  syncOrbBots(room, now);
  const step = (seconds) => {
    for (let n = 0; n < Math.round(seconds / 0.05); n++) {
      now += 50;
      updateCompanion524(room, 0.05, now);
      updateOrbBots(room, 0.05, now);
      for (const b of room.orbBots) {
        assert.ok([b.x, b.y, b.z].every(Number.isFinite));
        if (!['windup', 'airborne', 'stowed'].includes(b.mode))
          assert.ok(collision.free(b, botRadius(b.kind)));
      }
    }
  };
  return {
    c,
    p,
    q,
    room,
    step,
    get now() {
      return now;
    },
    get bot() {
      return room.orbBots.find((b) => b.kind === '524');
    },
    pet(player = p) {
      return handleCompanion524Action(room, player, 'pet524', now);
    },
    action(action, kind, player = p) {
      return handleOrbBotAction(room, player, action, kind, now);
    },
    recruit() {
      assert.ok(this.pet());
      step(5);
      assert.equal(c.squadPlayerId, p.id);
      assert.ok(this.bot);
    },
  };
}

test('524 joins only after the complete pet and happy reaction, as one tenth member for its owner', () => {
  const f = fixture();
  assert.equal(f.room.orbBots.length, 18);
  assert.equal(f.action('throwBot', '524'), false);
  assert.ok(f.pet());
  f.step(1.5);
  assert.ok(f.c.petContactAt > 0);
  assert.equal(f.bot, undefined);
  const contact = f.c.petContactAt;
  while (f.now < contact + COMPANION_524.petStrokeMs + COMPANION_524.happyMs - 50) f.step(0.05);
  assert.equal(f.bot, undefined);
  f.step(0.1);
  assert.equal(f.bot.ownerId, f.p.id);
  assert.equal(f.c.petPlayerId, null);
  assert.equal(f.room.orbBots.length, 19);
  assert.equal(ownedBotKinds(orbBotSnapshots(f.room), f.p.id).length, 10);
  assert.equal(ownedBotKinds(orbBotSnapshots(f.room), f.q.id).length, 9);
  assert.equal(f.action('throwBot', '524', f.q), false);
  for (let i = 0; i < 5; i++) syncOrbBots(f.room, f.now);
  assert.equal(f.room.orbBots.filter((b) => b.kind === '524').length, 1);
  assert.equal(companion524Snapshot(f.c).squadPlayerId, f.p.id);
});

for (const reason of ['movement', 'hit'])
  test(`an interrupted ${reason} pet does not recruit 524`, () => {
    const f = fixture();
    assert.ok(f.pet());
    f.step(1);
    if (reason === 'movement') f.p.x += 0.5;
    else hitCompanion524(f.c, 1, 0, f.now);
    f.step(5);
    assert.equal(f.c.petPlayerId, null);
    assert.equal(f.c.squadPlayerId, null);
    assert.equal(f.bot, undefined);
  });

test('one repeated button queues all ten; the original 524 travels from the hand and waits', () => {
  const f = fixture();
  f.recruit();
  const order = [];
  for (let i = 0; i < 10; i++) {
    order.push(nextOrbBot(f.room.orbBots, f.p).kind);
    assert.ok(f.action('throwBot'));
    f.step(0.05);
  }
  assert.deepEqual(order, BOT_ORDER);
  assert.equal(f.action('throwBot'), false);
  f.step(5);
  assert.ok(f.room.orbBots.filter((b) => b.ownerId === f.p.id).every((b) => b.mode === 'waiting'));
  assert.equal(f.bot.sequence, 1);
  assert.ok(gap(f.bot, f.p) > 6);
  assert.equal(gap(f.c, f.bot), 0);
  assert.equal(f.bot.y, botRestHeight('524', f.bot.x, f.bot.z));
});

for (const reason of ['walk', 'warp', 'boat', 'downed'])
  test(`deployed 524 waits through owner ${reason} until called`, () => {
    const f = fixture();
    f.recruit();
    assert.ok(f.action('throwBot', '524'));
    f.step(2);
    const spot = { x: f.bot.x, z: f.bot.z };
    if (reason === 'walk') {
      f.p.x += 80;
      f.bot.lastOwner = { x: f.p.x, z: f.p.z };
    }
    if (reason === 'warp') {
      f.p.x += 80;
      f.p.warpSequence = 1;
    }
    if (reason === 'boat') f.p.boatId = 'boat';
    if (reason === 'downed') f.p.downedUntil = f.now + 90000;
    f.step(15);
    assert.equal(f.bot.mode, 'waiting');
    assert.equal(gap(spot, f.bot), 0);
    assert.equal(gap(spot, f.c), 0);
    assert.equal(f.c.squadPlayerId, f.p.id);
    f.p.boatId = null;
    f.p.downedUntil = 0;
    assert.ok(f.action('recallBots'));
    f.step(20);
    assert.equal(f.bot.mode, 'following');
    assert.ok(gap(f.bot, f.p) < ORB_BOTS.pickupRange);
  });

test('held and airborne 524 cannot be petted or hit at a ground ghost position', () => {
  const f = fixture();
  f.recruit();
  assert.ok(f.action('throwBot', '524'));
  for (const phase of ['windup', 'airborne', 'landing']) {
    while (f.bot.mode !== phase) f.step(0.05);
    assert.equal(
      nearCompanion524({ ...f.q, x: f.c.x, z: f.c.z }, f.c, f.room.collision, f.now),
      false,
    );
    assert.ok(!damageableTargets(f.room).some((t) => t.kind === 'companion524'));
  }
  f.step(0.5);
  assert.equal(f.bot.mode, 'waiting');
  assert.ok(damageableTargets(f.room).some((t) => t.kind === 'companion524'));
  const before = { ...f.c };
  hitCompanion524(f.c, 1, 0, f.now);
  f.step(0.3);
  assert.ok(f.c.x > before.x + 0.4);
  assert.equal(f.bot.busy, true);
  f.step(1);
  assert.equal(f.bot.mode, 'waiting');
  assert.equal(gap(f.bot, f.c), 0);
});

test('a second completed pet transfers the same 524, while cancelling a pet keeps the first squad', () => {
  const f = fixture();
  f.recruit();
  const id = f.bot.id;
  Object.assign(f.q, { x: f.c.x, z: f.c.z + 1.5 });
  assert.ok(f.pet(f.q));
  f.step(0.5);
  assert.equal(f.bot.busy, true);
  assert.notEqual(nextOrbBot(f.room.orbBots, f.p, '524')?.kind, '524');
  f.q.x += 0.5;
  f.step(1);
  assert.equal(f.c.squadPlayerId, f.p.id);
  assert.equal(f.c.followPlayerId, f.p.id);
  Object.assign(f.q, { x: f.c.x, z: f.c.z + 1.5 });
  assert.ok(f.pet(f.q));
  f.step(5);
  assert.equal(f.bot.id, id);
  assert.equal(f.bot.ownerId, f.q.id);
  assert.equal(f.c.followPlayerId, f.q.id);
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === f.p.id).length, 9);
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === f.q.id).length, 10);
  assert.equal(f.action('throwBot', '524'), false);
});

test('a visitor disconnecting during a pet leaves 524 in the existing squad', () => {
  const f = fixture();
  f.recruit();
  Object.assign(f.q, { x: f.c.x, z: f.c.z + 1.5 });
  assert.ok(f.pet(f.q));
  f.step(0.3);
  f.room.players.delete(f.q.id);
  f.step(1);
  assert.equal(f.c.petPlayerId, null);
  assert.equal(f.c.squadPlayerId, f.p.id);
  assert.equal(f.bot.ownerId, f.p.id);
  f.p.z += 5;
  f.step(3);
  assert.ok(gap(f.bot, f.p) < ORB_BOTS.pickupRange);
  assert.equal(gap(f.c, f.bot), 0);
});

for (const reason of ['dismiss', 'disconnect', 'restore'])
  test(`${reason} removes only the recruited proxy and returns the original NPC`, () => {
    const f = fixture();
    f.recruit();
    assert.ok(f.action('throwBot', '524'));
    f.step(2);
    const pos = { x: f.c.x, z: f.c.z };
    if (reason === 'dismiss') assert.ok(handleCompanion524Action(f.room, f.p, 'dismiss524', f.now));
    if (reason === 'disconnect') f.room.players.delete(f.p.id);
    if (reason === 'restore') restoreCompanion524(f.room, structuredClone(f.c));
    f.step(0.05);
    assert.equal(f.bot, undefined);
    assert.equal(f.room.companion524.squadPlayerId, null);
    assert.ok(gap(f.room.companion524, pos) < 0.3);
    f.step(20);
    assert.equal(f.room.companion524.mode, 'idle');
    assert.ok(gap(f.room.companion524, f.c.home) < 0.01);
  });
