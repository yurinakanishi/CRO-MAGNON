import test from 'node:test';
import assert from 'node:assert/strict';
import { companionBehavior } from './companion-behavior.mjs';
import { mascotFixture, advanceMascots, distance } from './mascot-fixture.mjs';
import { damageableTargets } from '../dist/shared/combat.mjs';
companionBehavior('mae');
for (const held of ['mountId', 'boatId', 'carrierId', 'downedUntil'])
  test('mae hides while ' + held + ' and rejoins safely when the person returns to walking', () => {
    const { room, p, c } = mascotFixture('mae');
    p[held] = held === 'downedUntil' ? 30000 : 'transport';
    advanceMascots(room, 10000, 0.05);
    assert.equal(c.squadMode, 'stowed');
    assert.ok(!damageableTargets(room).some((hit) => hit.target === c));
    p[held] = null;
    p.x += 20;
    p.warpSequence++;
    advanceMascots(room, 10100, 0.05);
    assert.equal(c.squadMode, 'following');
    assert.ok(distance(c, p) < 2.5);
    assert.ok(room.collision.free(c, c.radius));
  });
