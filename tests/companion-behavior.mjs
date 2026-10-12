import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mascotFixture,
  person,
  distance,
  flatCollision,
  advanceMascots,
} from './mascot-fixture.mjs';
import {
  companionProfile,
  companionSnapshot,
  hitCompanion,
  nearCompanion,
  updateCompanions,
} from '../dist/shared/companions.mjs';
import { petMascot, chooseMascot, syncMascots } from '../dist/shared/mascot-selection.mjs';
import { startAttack, resolveAttack, updateProjectiles } from '../dist/shared/combat.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';

/** Shared contracts replace the removed per-character ownership implementations. */
export function companionBehavior(key) {
  const fixture = () => {
    const f = mascotFixture(key);
    Object.assign(f.c, { x: 50, z: 51.4 });
    if (f.b) Object.assign(f.b, { x: f.c.x, z: f.c.z });
    return f;
  };
  test(`${key}: arrives on a free surface and exposes no routing or pet planning`, () => {
    const { room, p, c } = mascotFixture(key);
    assert.equal(c.ownerId, p.id);
    assert.ok(room.collision.free(c, c.radius));
    assert.ok(distance(p, c) < 2.5);
    const snapshot = companionSnapshot(c);
    for (const field of ['path', 'goal', 'velocityX', 'velocityZ', 'petGoal', 'lastOwner'])
      assert.equal(field in snapshot, false, field);
    snapshot.x = 999;
    assert.notEqual(c.x, 999);
  });
  test(`${key}: a visitor may pet, approach and finish without moving the player or changing owner`, () => {
    const { room, p, c } = fixture();
    const visitor = person('visitor');
    room.players.set(visitor.id, visitor);
    const before = { x: visitor.x, z: visitor.z };
    assert.equal(petMascot(room, visitor, c.id, 10000), true);
    assert.equal(petMascot(room, p, c.id, 10001), false, 'one hand at a time');
    for (let now = 10050; now <= 12500 && !c.petContactAt; now += 50)
      updateCompanions(room, 0.05, now);
    assert.ok(c.petContactAt > 10000, 'walks to the offered hand before contact');
    assert.equal(c.ownerId, p.id);
    assert.deepEqual({ x: visitor.x, z: visitor.z }, before);
    const profile = companionProfile(key),
      contact = c.petContactAt;
    updateCompanions(room, 0.05, contact + profile.petStrokeMs + 1);
    assert.equal(c.petPlayerId, visitor.id, 'shared happy phase follows the stroke');
    updateCompanions(room, 0.05, contact + profile.petStrokeMs + profile.happyMs + 1);
    assert.equal(c.petPlayerId, null);
    assert.equal(c.ownerId, p.id);
    assert.equal(visitor.mascot, null);
  });
  test(`${key}: range, walls and incompatible activities reject petting authoritatively`, () => {
    const { room, p, c } = fixture();
    for (const patch of [
      { x: 80 },
      { mountId: 'm' },
      { boatId: 'b' },
      { carrierId: 'q' },
      { passengerId: 'q' },
      { downedUntil: 20000 },
      { cookingEndsAt: 20000 },
      { fishing: {} },
      { coastalActivity: {} },
      { jumpSequence: 1, jumpAt: 10000 },
      { attackSequence: 1, attackAt: 10000 },
    ]) {
      assert.equal(
        nearCompanion({ ...p, ...patch }, c, room.collision, 10010),
        false,
        JSON.stringify(patch),
      );
      assert.equal(petMascot(room, { ...p, ...patch }, c.id, 10010), false);
    }
    room.collision = flatCollision([
      { id: 'wall', type: 'box', x: 50, z: 50.7, hx: 2, hz: 0.1, c: 1, s: 0, height: 2 },
    ]);
    assert.equal(petMascot(room, p, c.id, 10010), false);
    assert.equal(c.petSequence, 0);
  });
  for (const reason of ['walk', 'hurt', 'character', 'disconnect'])
    test(`${key}: ${reason} interrupts a visitor's stroke without changing the owner's selection`, () => {
      const { room, p, c } = fixture();
      const visitor = person('visitor');
      room.players.set(visitor.id, visitor);
      assert.equal(petMascot(room, visitor, c.id, 10000), true);
      if (reason === 'walk') visitor.moving = true;
      if (reason === 'hurt') visitor.hurtAt = 10001;
      if (reason === 'character') visitor.species = 'bear';
      if (reason === 'disconnect') room.players.delete(visitor.id);
      updateCompanions(room, 0.05, 10050);
      assert.equal(c.petPlayerId, null);
      assert.equal(c.ownerId, p.id);
      assert.equal(p.mascot, key);
    });
  test(`${key}: melee and magic recoil without health, loot, death or ownership transfer`, () => {
    for (const species of ['cro', 'bear']) {
      const { room, p, c } = fixture();
      p.species = species;
      assert.equal(startAttack(room, p, {}, 10000).accepted, true);
      const impact = 10000 + attackProfile(p).impactMs;
      const result = resolveAttack(room, p, impact);
      const hit = species === 'bear' ? updateProjectiles(room, impact + 500)[0] : result;
      assert.equal(hit.target, c);
      assert.equal(hit.kind, 'companion');
      assert.equal(c.hitSequence, 1);
      assert.ok(c.velocityZ > 0);
      assert.equal(c.health, undefined);
      assert.equal(hit.killed, false);
      assert.equal(c.ownerId, p.id);
    }
  });
  test(`${key}: recoil is independent of tick rate and cannot cross a wall`, () => {
    const results = [];
    for (const dt of [0.025, 0.05, 0.1]) {
      const { room, c } = fixture();
      hitCompanion(c, 0, 1, 10000);
      for (let time = dt; time <= 0.5 + 1e-9; time += dt)
        updateCompanions(room, dt, 10000 + time * 1000);
      results.push(c.z);
    }
    assert.ok(Math.max(...results) - Math.min(...results) < 1e-8);
    const { room, c } = fixture();
    room.collision = flatCollision([
      { id: 'wall', type: 'box', x: 50, z: 52.2, hx: 2, hz: 0.1, c: 1, s: 0, height: 2 },
    ]);
    for (let i = 0; i < 20; i++) {
      hitCompanion(c, 0, 1, 10000 + i * 50);
      updateCompanions(room, 0.05, 10000 + i * 50);
    }
    assert.ok(room.collision.free(c, c.radius));
    assert.ok(c.z < 52.2 - 0.1 - c.radius + 1e-6);
  });
  test(`${key}: dismissal waves then removes the body and cannot be petted or revived by a visitor`, () => {
    const { room, p, c } = fixture();
    chooseMascot(room, p, null, 10000);
    assert.equal(c.leavingAt, 10000);
    assert.equal(petMascot(room, person('visitor'), c.id, 10010), false);
    syncMascots(room, 10999);
    assert.ok(room.companions.includes(c));
    syncMascots(room, 11000);
    assert.deepEqual(room.companions, []);
    assert.equal(p.mascot, null);
  });
  if (companionProfile(key).walks)
    test(`${key}: walking follows around an obstacle and facing a stopped owner never makes it flee`, () => {
      const { room, p, c } = fixture();
      p.z = 57;
      room.collision = flatCollision([{ id: 'rock', type: 'circle', x: 50, z: 54, radius: 0.7 }]);
      for (let i = 1; i <= 240; i++) {
        advanceMascots(room, 10000 + (i - 1) * 50, 0.05);
        assert.ok(room.collision.free(c, c.radius));
      }
      assert.ok(distance(c, p) < 3);
      const stopped = { x: c.x, z: c.z };
      for (const facing of [0, Math.PI, Math.PI / 2]) {
        p.facing = facing;
        advanceMascots(room, 23000, 1);
      }
      assert.ok(distance(c, stopped) < 0.1, 'turning does not orbit the companion');
    });
}
