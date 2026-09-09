import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { movePlayer, moveActor } from '../dist/shared/movement.mjs';
import {
  canMount,
  RIDING,
  handleRidingAction,
  updateRiddenAnimal,
} from '../dist/shared/riding.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';

const actor = () => ({
  id: 'p',
  species: 'cro',
  x: 20,
  z: 20,
  radius: 0.32,
  dx: 0,
  dz: 0,
  lastInput: 1000,
  path: [],
  target: null,
  energy: 100,
});
const route = (p) => ({
  target: { x: p.x + 4, z: p.z },
  path: [{ x: p.x + 5, z: p.z }],
  navigationGoal: { x: p.x + 6, z: p.z },
});
test('retired destination and expedition commands cannot change gameplay; directional input still decodes', () => {
  for (const type of ['target', 'expedition'])
    for (const extras of [
      {},
      { x: 25, z: 20, running: true, destination: 'grassland' },
      { x: -2753, z: 693, destination: 'gulf-hearth' },
    ])
      assert.equal(decodeCommand(JSON.stringify({ type, ...extras })), null);
  assert.deepEqual(decodeCommand('{"type":"move","dx":1,"dz":0,"running":true}'), {
    type: 'move',
    dx: 1,
    dz: 0,
    running: true,
  });
});
test('player movement discards legacy routes, obeys direction and stops after input expires', () => {
  for (const speed of [undefined, 0.7, 4]) {
    const p = actor();
    Object.assign(p, route(p));
    movePlayer(p, 0.1, 1000, undefined, speed);
    assert.deepEqual([p.x, p.z], [20, 20]);
    assert.equal(p.target, null);
    assert.deepEqual(p.path, []);
    assert.equal(p.navigationGoal, null);
    Object.assign(p, route(p), { dx: -1, lastInput: 1000 });
    movePlayer(p, 0.1, 1000, undefined, speed);
    assert.ok(p.x < 20);
    const x = p.x;
    movePlayer(p, 0.1, 1600, undefined, speed);
    assert.equal(p.x, x);
    assert.equal(p.moving, false);
  }
  const npc = actor();
  Object.assign(npc, route(npc));
  moveActor(npc, 0.1, 1000);
  assert.ok(npc.x > 20, 'resident/animal AI routes still function');
});
test('mount prompt eligibility matches range, line of sight, occupancy and activity without moving or mounting', () => {
  const p = actor(),
    a = { id: 'm', x: 24, z: 20, radius: 2.9, phase: 'alive', health: 100, hitUntil: 0 };
  const collision = new CollisionWorld([], { coast: false });
  const before = structuredClone({ p, a });
  assert.equal(canMount(p, a, collision, 1000), true);
  assert.deepEqual({ p, a }, before);
  for (const change of [
    { x: 40 },
    { boatId: 'b' },
    { mountId: 'm' },
    { downedUntil: 2000 },
    { attackAt: 1000, attackSequence: 1 },
    { jumpAt: 1000, jumpSequence: 1 },
  ])
    assert.equal(canMount({ ...p, ...change }, a, collision, 1000), false);
  for (const change of [{ riderId: 'other' }, { phase: 'meat' }, { health: 0 }, { hitUntil: 1500 }])
    assert.equal(canMount(p, { ...a, ...change }, collision, 1000), false);
  assert.equal(canMount(p, a, { segmentFree: () => false }, 1000), false);
  const edge = { ...p, x: a.x - a.radius - p.radius - RIDING.reach + 0.0001 };
  assert.equal(canMount(edge, a, collision, 1000), true);
  edge.x -= 0.001;
  assert.equal(canMount(edge, a, collision, 1000), false);
});
test('explicit mounting remains still until input, ignores leftover mount routes and safely dismounts', () => {
  const p = actor(),
    a = {
      ...actor(),
      id: 'm',
      x: 24,
      radius: 2.9,
      scale: 1,
      phase: 'alive',
      health: 100,
      hitUntil: 0,
    };
  const r = {
    players: new Map([[p.id, p]]),
    animals: [a],
    enemies: [],
    collision: new CollisionWorld([], { coast: false }),
  };
  assert.equal(handleRidingAction(r, p, { action: 'ride', targetId: a.id }, 1000).changed, true);
  Object.assign(a, route(a));
  const origin = [p.x, p.z];
  updateRiddenAnimal(r, a, 0.1, 1100);
  assert.deepEqual([p.x, p.z], origin);
  Object.assign(a, { dx: 1, dz: 0, lastInput: 1200 });
  updateRiddenAnimal(r, a, 0.1, 1200);
  assert.ok(p.x > origin[0]);
  assert.equal(p.x, a.x);
  assert.equal(handleRidingAction(r, p, { action: 'ride' }, 2000).changed, true);
  assert.equal(p.mountId, null);
  assert.equal(a.riderId, null);
});
test('LAN prediction cannot resume a route in received or stale local state', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  const p = actor();
  Object.assign(p, route(p));
  prediction.receive(p, 1000);
  Object.assign(prediction.actor, route(p));
  prediction.target = { x: 25, z: 20 };
  const free = { move: (a, dx, dz) => ({ x: a.x + dx, z: a.z + dz }) };
  assert.equal(prediction.step(0.02, 1020, 1020, free, []).x, 20);
  prediction.setInput(-1, 0, true, 1020);
  assert.ok(prediction.step(0.02, 1040, 1040, free, []).x < 20);
  prediction.stop();
  const x = prediction.actor.x;
  assert.equal(prediction.step(0.02, 1060, 1060, free, []).x, x);
});
