import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { moveActor, movePlayer } from '../dist/shared/movement.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';

const wall = { id: 'wall', type: 'box', x: 10, z: 10, hx: 1, hz: 8, c: 1, s: 0 };
const world = new CollisionWorld([wall], { coast: false });
const actor = () => ({
  id: 'p',
  species: 'cro',
  x: 8.68,
  z: 10,
  radius: 0.32,
  dx: 1,
  dz: 1,
  facing: 0,
  lastInput: 1000,
  runningRequested: false,
});
const move = (p, dx, dz) => world.move(p, dx, dz, p.radius);

test('wall sliding preserves input facing across repeated walking and running ticks', () => {
  for (const runningRequested of [false, true]) {
    const p = { ...actor(), runningRequested };
    // Thirty ticks: a runner (5.6 m/s) must still be alongside the 16 m wall.
    for (let i = 0; i < 30; i++) {
      p.lastInput = 1000 + i * 50;
      movePlayer(p, 0.05, p.lastInput, move);
      assert.equal(p.facing, Math.PI / 4);
      assert.equal(overlap(p, p.radius, wall), null);
    }
    assert.ok(p.x < 8.681 && p.z > 11);
    assert.equal(p.moving, true);
  }
});

test('a blocked player can face the requested direction and turn away from the wall', () => {
  const p = { ...actor(), dz: 0 };
  for (let i = 0; i < 10; i++) movePlayer(p, 0.05, 1000, move);
  assert.equal(p.facing, Math.PI / 2);
  assert.equal(p.moving, false);
  p.dx = -1;
  movePlayer(p, 0.05, 1000, move);
  assert.equal(p.facing, -Math.PI / 2);
  assert.ok(p.x < 8.65);
});

test('enemy collision push keeps idle or expired-input facing while still resolving overlap', () => {
  const empty = new CollisionWorld([], { coast: false });
  const enemy = { id: 'enemy', type: 'circle', x: 11, z: 10, radius: 1 };
  for (const input of [
    { dx: 0, dz: 0, lastInput: 1000 },
    { dx: 1, dz: 1, lastInput: 0 },
  ]) {
    const p = { ...actor(), ...input, x: 10, facing: 0.7 };
    movePlayer(p, 0.05, 1000, (a, dx, dz) => empty.move(a, dx, dz, a.radius, [enemy]));
    assert.ok(p.x < 10, 'enemy pushes the player sideways');
    assert.equal(overlap(p, p.radius, enemy), null);
    assert.equal(p.facing, 0.7);
  }
});

test('local prediction and server movement agree on facing at a wall and after release', () => {
  const p = actor();
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  prediction.receive(p, 1000);
  prediction.setInput(1, 1, false, 1000);
  movePlayer(p, 0.05, 1050, move);
  const predicted = prediction.step(0.05, 1050, 1050, world, []);
  assert.equal(predicted.facing, Math.PI / 4);
  assert.equal(predicted.facing, p.facing);
  assert.equal(predicted.x, p.x);
  assert.equal(predicted.z, p.z);
  prediction.receive({ ...p }, 1100);
  prediction.stop();
  assert.equal(prediction.step(0.05, 1150, 1150, world, []).facing, Math.PI / 4);
});

test('AI actors still face their actual travel direction when sliding', () => {
  const npc = { ...actor(), target: { x: 12, z: 15 } };
  const before = { x: npc.x, z: npc.z };
  moveActor(npc, 0.05, 1000, move);
  assert.equal(npc.facing, Math.atan2(npc.x - before.x, npc.z - before.z));
});
