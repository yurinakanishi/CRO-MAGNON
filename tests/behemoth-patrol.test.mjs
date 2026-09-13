import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { BEHEMOTH as R } from '../dist/shared/behemoth-rules.mjs';
import { createBehemoth, updateBehemoths } from '../dist/shared/violet-behemoth.mjs';

function fixture() {
  const collision = new CollisionWorld([], { river: false });
  const e = createBehemoth(collision, [], 1000);
  const room = { collision, enemies: [e], players: new Map(), animals: [] };
  return { e, room, tick: (now, dt = 0.05) => updateBehemoths(room, dt, now, () => {}) };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('without a target the behemoth walks, rests briefly and explores inside its territory', () => {
  for (const dt of [0.05, 0.1]) {
    const { e, room, tick } = fixture();
    let total = 0,
      farthest = 0,
      rest = 0,
      longestRest = 0,
      walking = 0;
    for (let now = 1050; now < 181000; now += dt * 1000) {
      const before = { ...e };
      tick(now, dt);
      total += distance(e, before);
      farthest = Math.max(farthest, distance(e, e.home));
      assert.ok(distance(e, e.home) + e.radius <= R.territoryRadius - 0.99);
      assert.ok(room.collision.free(e, e.radius));
      assert.ok(e.speed <= 1.051, 'slow walking, never combat speed');
      const yaw = Math.atan2(
        Math.sin(e.facing - before.facing),
        Math.cos(e.facing - before.facing),
      );
      assert.ok(Math.abs(yaw) <= 0.701 * dt, 'turns gradually with the heavy body');
      if (e.moving) {
        walking++;
        rest = 0;
        assert.equal(e.clip, 'Walk_Loop');
        assert.equal(e.running, false);
      } else {
        rest += dt;
        longestRest = Math.max(longestRest, rest);
      }
    }
    assert.ok(total > 95, `patrol travelled ${total} metres`);
    assert.ok(farthest > 12, `explored ${farthest} metres from home`);
    assert.ok(e.patrolStep >= 8, 'chooses successive destinations');
    assert.ok(longestRest < 5, `no prolonged freeze: ${longestRest}s`);
    assert.ok(walking > 100);
  }
});

test('a blocked patrol retries, walks again after clearance and avoids a new obstacle', () => {
  const { e, room, tick } = fixture();
  const fence = Array.from({ length: 16 }, (_, i) => ({
    id: `fence-${i}`,
    type: 'circle',
    radius: 1,
    x: e.x + Math.sin((i * Math.PI) / 8) * 7,
    z: e.z + Math.cos((i * Math.PI) / 8) * 7,
  }));
  room.collision = new CollisionWorld(fence, { river: false });
  for (let now = 1050; now < 5000; now += 50) tick(now);
  assert.equal(e.patrolGoal, null);
  assert.ok(e.patrolStep >= 2, 'blocked routes are retried');
  room.collision = new CollisionWorld([], { river: false });
  for (let now = 5000; now < 9000; now += 50) tick(now);
  assert.ok(distance(e, e.home) > 1, 'resumes without a player entering');
  const obstacle = { id: 'fallen-rock', type: 'circle', radius: 1, ...e.patrolGoal };
  room.collision = new CollisionWorld([obstacle], { river: false });
  const step = e.patrolStep,
    before = { ...e };
  for (let now = 9000; now < 49000; now += 50) {
    tick(now);
    assert.ok(room.collision.free(e, e.radius), 'never walks through the obstacle');
  }
  assert.ok(e.patrolStep > step, 'abandons the obstructed goal');
  assert.ok(distance(e, before) > 3, 'continues elsewhere');
});

test('rear footsteps interrupt a walk and returning resumes patrol after a short rest', () => {
  const { e, room, tick } = fixture();
  for (let now = 1050; now < 5000; now += 50) tick(now);
  assert.equal(e.clip, 'Walk_Loop');
  const p = {
    id: 'p',
    radius: 0.76,
    energy: 100,
    moving: true,
    x: e.x - Math.sin(e.facing) * 10,
    z: e.z - Math.cos(e.facing) * 10,
  };
  room.players.set(p.id, p);
  tick(5000);
  assert.equal(e.targetId, p.id);
  assert.equal(e.clip, 'Roar');
  assert.equal(e.speed, 0);
  assert.equal(e.patrolGoal, null);
  Object.assign(p, { x: e.home.x, z: e.home.z + R.territoryRadius + 2, moving: false });
  let returnedAt = null,
    movedAgain = false;
  for (let now = 5050; now < 25000; now += 50) {
    tick(now);
    if (!e.returning && distance(e, e.home) < 0.001) returnedAt ??= now;
    if (returnedAt && e.behavior === 'patrol') movedAgain = true;
    assert.equal(e.targetId, null);
  }
  assert.ok(returnedAt);
  assert.ok(movedAgain);
});
