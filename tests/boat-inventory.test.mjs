import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { BOATING, handleBoatAction, initializeBoats } from '../dist/shared/boats.mjs';

function fixture() {
  const p = {
    id: 'self',
    species: 'cro',
    gender: 'female',
    x: 138,
    z: 112,
    radius: 0.32,
    inventory: { wood: 24, boat: 0 },
    path: [],
  };
  const room = {
    p,
    collision: new CollisionWorld(),
    players: new Map([[p.id, p]]),
    animals: [],
    enemies: [],
  };
  initializeBoats(room);
  return room;
}
const act = (room, action, targetId) => handleBoatAction(room, room.p, { action, targetId }, 10000);
function launch(room) {
  assert.equal(act(room, 'craftBoat').changed, true);
  assert.equal(act(room, 'launchBoat').changed, true);
  return room.boats[0];
}

test('landing then recovery removes the hull and returns exactly one reusable boat to inventory', () => {
  const r = fixture(),
    boat = launch(r);
  assert.equal(act(r, 'boardBoat').changed, true);
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  assert.equal(act(r, 'boardBoat').changed, true);
  assert.equal(act(r, 'recoverBoat', boat.id).changed, true);
  assert.equal(r.boats.length, 0);
  assert.deepEqual(r.p.inventory, { wood: 12, boat: 1 });
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  assert.equal(r.p.inventory.boat, 1);
  assert.equal(act(r, 'launchBoat').changed, true);
  assert.equal(r.boats.length, 1);
  assert.deepEqual(r.p.inventory, { wood: 12, boat: 0 });
});

test('recovery rejects occupied, missing, distant, obstructed and full-inventory boats', () => {
  const r = fixture(),
    boat = launch(r);
  boat.riderId = 'other';
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  boat.riderId = null;
  assert.equal(act(r, 'recoverBoat', 'missing').changed, false);
  assert.equal(act(r, 'recoverBoat', 7).changed, false);
  const x = r.p.x;
  r.p.x = 50;
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  r.p.x = x;
  const clear = r.shoreCollision.segmentFree;
  r.shoreCollision.segmentFree = () => false;
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  r.shoreCollision.segmentFree = clear;
  r.p.inventory.boat = BOATING.inventoryLimit;
  assert.equal(act(r, 'recoverBoat', boat.id).changed, false);
  assert.equal(act(r, 'craftBoat').changed, false);
  assert.equal(r.p.inventory.wood, 12);
  assert.equal(r.boats.length, 1);
});

test('all boat transfers reject unavailable players without spending materials or changing hulls', () => {
  for (const state of [
    { downedUntil: 1 },
    { mountId: 'm' },
    { carrierId: 'c' },
    { passengerId: 'p' },
    { cookingEndsAt: 1 },
    { fishing: {} },
    { coastalActivity: {} },
    { jumpAt: 9900, jumpSequence: 1 },
    { attackSequence: 1, attackAt: 9900 },
  ]) {
    const r = fixture();
    launch(r);
    act(r, 'craftBoat');
    Object.assign(r.p, state);
    const before = structuredClone(r.p.inventory);
    for (const action of ['craftBoat', 'launchBoat', 'recoverBoat']) {
      assert.equal(act(r, action).changed, false, `${action}: ${JSON.stringify(state)}`);
      assert.deepEqual(r.p.inventory, before);
      assert.equal(r.boats.length, 1);
    }
  }
});

test('a legacy shared hull can be recovered when the old inventory has no boat field', () => {
  const r = fixture(),
    boat = launch(r);
  delete r.p.inventory.boat;
  assert.equal(act(r, 'recoverBoat', boat.id).changed, true);
  assert.equal(r.p.inventory.boat, 1);
  assert.equal(r.boats.length, 0);
});
