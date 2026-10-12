import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotFixture, mascotCore, person, distance, advanceMascots } from './mascot-fixture.mjs';
import { handleOrbBotAction, ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import { petMascot, chooseMascot, activeMascot } from '../dist/shared/mascot-selection.mjs';
import { damageableTargets } from '../dist/shared/combat.mjs';

export function throwableMascot(key) {
  test(`${key}: one selected body has one proxy; holding and flight have no ground interaction ghost`, () => {
    const { room, p, c, b } = mascotFixture(key);
    assert.equal(b.companionId, c.id);
    assert.equal(room.companions.length, 1);
    assert.equal(room.orbBots.length, 1);
    assert.equal(handleOrbBotAction(room, p, 'throwBot', key, 10000), true);
    for (const now of [10100, 10300]) {
      advanceMascots(room, now - 50, 0.05);
      assert.ok(['windup', 'airborne'].includes(b.mode));
      assert.equal(c.squadMode, b.mode);
      assert.equal(petMascot(room, p, c.id, now), false);
      assert.ok(!damageableTargets(room).some((t) => t.target === c));
    }
    advanceMascots(room, 10300, 2);
    assert.equal(b.mode, 'waiting');
    assert.equal(c.squadMode, 'waiting');
    assert.ok(distance(c, b) < 1e-9);
    assert.ok(damageableTargets(room).some((t) => t.target === c));
  });
  test(`${key}: deployed body waits through walking, warp, mounting and recovery until its owner calls`, () => {
    const { room, p, c, b } = mascotFixture(key);
    assert.equal(handleOrbBotAction(room, p, 'throwBot', key, 10000), true);
    advanceMascots(room, 10000, 3);
    const landed = { x: c.x, z: c.z };
    assert.equal(b.mode, 'waiting');
    for (const patch of [
      { x: 80, warpSequence: 1 },
      { mountId: 'm' },
      { mountId: null, boatId: 'b' },
      { boatId: null, downedUntil: 30000 },
      { downedUntil: 0, x: 50, z: 50, warpSequence: 2 },
    ]) {
      Object.assign(p, patch);
      advanceMascots(room, 14000, 0.5);
      assert.equal(b.mode, 'waiting');
      assert.ok(distance(c, landed) < 1e-9);
    }
    const other = person('other');
    room.players.set(other.id, other);
    handleOrbBotAction(room, other, 'recallBots', null, 15000);
    advanceMascots(room, 15000, 0.2);
    assert.equal(b.mode, 'waiting');
    handleOrbBotAction(room, p, 'recallBots', null, 16000);
    advanceMascots(room, 16000, 12);
    assert.equal(b.mode, 'following');
    assert.ok(distance(c, p) < ORB_BOTS.pickupRange);
    assert.equal(c.ownerId, p.id);
  });
  test(`${key}: a visitor may pet a landed body without recruiting it or returning it`, () => {
    const { room, p, c, b } = mascotFixture(key);
    handleOrbBotAction(room, p, 'throwBot', key, 10000);
    advanceMascots(room, 10000, 3);
    const visitor = person('visitor', { x: c.x, z: c.z - 1.3 });
    room.players.set(visitor.id, visitor);
    assert.equal(petMascot(room, visitor, c.id, 14000), true);
    advanceMascots(room, 14000, 5);
    assert.equal(c.ownerId, p.id);
    assert.equal(visitor.mascot, null);
    assert.equal(c.petPlayerId, null);
    assert.equal(b.mode, 'waiting');
  });
  test(`${key}: a busy pet prevents a throw; choosing another mascot never borrows someone else's body`, () => {
    const { room, p, c, b } = mascotFixture(key);
    Object.assign(p, { x: c.x, z: c.z - 1.3 });
    assert.equal(petMascot(room, p, c.id, 10000), true);
    assert.equal(handleOrbBotAction(room, p, 'throwBot', key, 10001), false);
    const other = person('other', { x: 56 });
    room.players.set(other.id, other);
    chooseMascot(room, other, key, 10010);
    const theirs = activeMascot(room, other.id);
    assert.notEqual(theirs.id, c.id);
    chooseMascot(room, p, 'blue', 10500);
    assert.equal(c.petPlayerId, null);
    assert.ok(c.leavingAt);
    assert.ok(!room.orbBots.includes(b));
    assert.equal(activeMascot(room, other.id), theirs);
    assert.equal(theirs.ownerId, other.id);
  });
  for (const phase of ['following', 'windup', 'airborne', 'waiting'])
    test(`${key}: disconnect during ${phase} removes only that person's body and proxy`, (t) => {
      const w = mascotCore(t),
        a = w.join('A'),
        b = w.join('B', '', { x: 56, z: 50 });
      for (const who of [a, b]) w.act(who, 'selectMascot', key);
      const first = w.active(a),
        other = w.active(b);
      if (phase !== 'following') {
        w.act(a, 'throwBot', key);
        if (phase === 'airborne') w.step(50, 6);
        if (phase === 'waiting') w.step(50, 50);
      }
      assert.equal(first.squadMode, phase);
      a.socket.close();
      w.step();
      assert.ok(!w.room().companions.some((c) => c.ownerId === a.id));
      assert.ok(!w.room().orbBots.some((c) => c.ownerId === a.id));
      assert.equal(w.active(b), other);
      const back = w.join('A', a.session, null),
        fresh = w.active(back);
      assert.notEqual(fresh.id, first.id);
      assert.ok(distance(fresh, back.player()) < 2.5);
      assert.equal(fresh.squadMode, 'following');
      assert.equal(w.room().orbBots.filter((c) => c.companionId === fresh.id).length, 1);
    });
}
