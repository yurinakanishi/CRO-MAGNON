import test from 'node:test';
import assert from 'node:assert/strict';
import { caveFireInteraction, toggleCaveFire } from '../dist/shared/cave-fire.mjs';
import { CAVE_HEARTH } from '../dist/shared/camp-cave-layout.mjs';
import { CAMP } from '../dist/shared/world.mjs';

test('the existing outdoor camp stays fixed; the cave hearth is separate', () => {
  assert.equal(CAMP.x, 50);
  assert.equal(CAMP.z, 50);
  assert.ok(CAVE_HEARTH.z > CAMP.z + 10);
  assert.equal(CAMP.caveFireLit, false);
});
test('a nearby standing player can light and extinguish the shared cave hearth', () => {
  const room = { camp: { ...CAMP }, collision: { segmentFree: () => true } };
  const player = { x: CAVE_HEARTH.x + 1, z: CAVE_HEARTH.z };
  assert.equal(caveFireInteraction(room, player, room.collision).label, '洞窟の火を灯す');
  assert.equal(toggleCaveFire(room, player), true);
  assert.equal(room.camp.caveFireLit, true);
  assert.equal(caveFireInteraction(room, player, room.collision).label, '洞窟の火を消す');
  assert.equal(toggleCaveFire(room, player), true);
  assert.equal(room.camp.caveFireLit, false);
});
test('distance, a wall, and busy states cannot toggle the cave hearth', () => {
  const room = { camp: { ...CAMP }, collision: { segmentFree: () => true } };
  const player = { x: CAVE_HEARTH.x + 1, z: CAVE_HEARTH.z };
  for (const state of [
    { x: CAVE_HEARTH.x + 4 },
    { downedUntil: 10 },
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'p' },
    { passengerId: 'p' },
    { cookingEndsAt: 10 },
    { fishing: {} },
    { coastalActivity: {} },
  ]) {
    assert.equal(toggleCaveFire(room, { ...player, ...state }), false);
    assert.equal(room.camp.caveFireLit, false);
  }
  room.collision.segmentFree = () => false;
  assert.equal(toggleCaveFire(room, player), false);
  assert.equal(room.camp.caveFireLit, false);
});
