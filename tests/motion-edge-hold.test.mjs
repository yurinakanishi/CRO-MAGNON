import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION } from '../dist/src/motion-input.js';
import { motionDriver } from './helpers/motion-driver.mjs';

function approachEdge(d, edge = 'right', push = 0.4) {
  d.hold(d.pair({ push }));
  const side = d.input.movementHand;
  const palm = [0, 5, 9, 13, 17].map((i) => d.pair({ push })[side].landmarks[i]);
  const axis = ['left', 'right'].includes(edge) ? 'x' : 'y';
  const low = ['left', 'top'].includes(edge);
  const shift = low
    ? 0.015 - Math.min(...palm.map((p) => p[axis]))
    : 0.985 - Math.max(...palm.map((p) => p[axis]));
  let pair;
  for (let step = 1; step <= 10; step++) {
    pair = d.pair({ push });
    for (const p of pair[side].landmarks) p[axis] += (shift * step) / 10;
    d.hold(pair, 150);
  }
  assert.ok(Math.abs(d.input.forward) > 0.5, 'accepted movement reaches the image edge');
  return pair;
}

for (const hz of [10, 15, 20, 30])
  for (const swapped of [false, true])
    test(`${hz} Hz swapped=${swapped}: edge loss holds forward/reverse and steering until return`, () => {
      for (const push of [0.4, -0.27]) {
        const d = motionDriver(hz, swapped);
        approachEdge(d, swapped ? 'left' : 'right', push);
        const previous = { forward: d.input.forward, turn: d.input.turn };
        const losses = d.input.trackingLosses;
        assert.ok(Math.abs(previous.turn) > 0.3);
        // Both hands can be absent. No arbitrary timeout while video results are fresh.
        for (let i = 0; i < hz * 4; i++) {
          d.frame(null);
          assert.equal(d.input.state, 'ACTIVE');
          assert.equal(d.input.edgeHolding, true);
          assert.equal(d.input.forward, previous.forward);
          assert.equal(d.input.turn, previous.turn);
          assert.ok(Math.sign(d.intent.forward) === Math.sign(push));
          assert.deepEqual(d.input.consumeActions(d.time), []);
        }
        assert.equal(d.input.trackingLosses, losses);
        d.frame(d.pair());
        assert.equal(d.input.edgeHolding, false);
        assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
      }
    });

for (const [edge, push] of [
  ['left', 0.4],
  ['right', 0.4],
  ['top', 0.4],
  ['bottom', 1.2],
])
  test(`${edge}: partial palm clipping holds the accepted command without using clipped coordinates`, () => {
    const d = motionDriver();
    const pair = approachEdge(d, edge, push);
    const previous = [d.input.forward, d.input.turn];
    const clipped = structuredClone(pair);
    const axis = ['left', 'right'].includes(edge) ? 'x' : 'y';
    const shift = ['left', 'top'].includes(edge) ? -0.05 : 0.05;
    for (const p of clipped.left.landmarks) p[axis] += shift;
    d.hold(clipped, 500);
    assert.equal(d.input.edgeHolding, true);
    assert.deepEqual([d.input.forward, d.input.turn], previous);
    d.hold(null, 1800);
    const beforeReturn = d.intent;
    d.frame(pair);
    assert.equal(d.input.edgeHolding, false);
    assert.ok(Math.abs(d.intent.forward - beforeReturn.forward) < 0.02);
    assert.ok(Math.abs(d.intent.turn - beforeReturn.turn) < 0.02);
  });

test('returning with a different moving pose blends to it without replaying the old edge measurements', () => {
  const d = motionDriver();
  approachEdge(d);
  d.hold(null, 1800);
  const before = d.intent;
  d.frame(d.pair({ push: 0.25, x: -0.9 }));
  assert.equal(d.input.edgeHolding, false);
  assert.ok(d.intent.forward > 0 && d.intent.forward < before.forward);
  assert.ok(d.intent.turn < 0 && d.intent.turn > before.turn);
});

test('central disappearance, a lowered/closed/uncertain visible hand, and a stale frame stop edge holding', () => {
  const central = motionDriver();
  central.hold(central.pair({ push: 0.4 }));
  central.frame(null);
  assert.equal(central.input.edgeHolding, false);
  assert.equal(central.intent.forward, 0);
  for (const returning of [{ y: 0.65 }, { fold: true }, { yaw: 0.9 }]) {
    const d = motionDriver();
    approachEdge(d);
    d.hold(null, 1000);
    d.frame(d.pair(returning));
    assert.equal(d.input.edgeHolding, false);
    assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
    d.frame(null);
    assert.equal(d.intent.forward, 0);
  }
  const stale = motionDriver();
  approachEdge(stale);
  stale.hold(null, 1000);
  assert.equal(stale.input.read(stale.time + MOTION.staleMs).active, false);
  assert.equal(stale.input.edgeHolding, false);
  stale.frame(null, 300);
  assert.equal(stale.intent.forward, 0);
});

test('lowering a visible hand near the edge cancels holding before it leaves the image', () => {
  const d = motionDriver();
  const pair = approachEdge(d);
  for (const p of pair.left.landmarks) p.y += 0.25;
  d.frame(pair);
  assert.equal(d.intent.forward, 0);
  d.hold(null, 1000);
  assert.equal(d.input.edgeHolding, false);
  assert.equal(d.intent.forward, 0);
});

for (const action of ['pause', 'stop', 'calibrate', 'fail'])
  test(`${action} discards edge holding and cannot be undone by another missing-hand frame`, () => {
    const d = motionDriver();
    approachEdge(d);
    d.hold(null, 1000);
    d.input[action]();
    assert.equal(d.input.edgeHolding, false);
    d.frame(null);
    assert.equal(d.intent.forward, 0);
    assert.equal(d.intent.turn, 0);
    assert.deepEqual(d.input.consumeActions(d.time), []);
  });
