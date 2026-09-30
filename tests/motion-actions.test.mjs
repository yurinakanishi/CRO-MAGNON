import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionInputAdapter } from '../dist/src/motion-input.js';
import { syntheticHands as hands } from './helpers/motion-hands.mjs';

function driver(hz = 15, swapped = false) {
  const input = new MotionInputAdapter();
  let time = 0,
    id = 0;
  const events = [];
  input.start();
  input.calibrate(swapped ? 'right' : 'left');
  const frame = (move = {}, act = {}, missing = null) => {
    time += 1000 / hz;
    const pair = hands(move, act, swapped);
    if (missing) pair[missing] = null;
    input.accept(
      {
        sessionId: input.sessionId,
        frameId: ++id,
        sampledAtMainMs: time,
        width: 640,
        height: 480,
        hands: pair,
      },
      time,
    );
    events.push(...input.consumeActions(time).map((e) => e.action));
  };
  for (let i = 0; i < hz * 2.1; i++) frame();
  assert.equal(input.state, 'ACTIVE');
  return { input, frame, events };
}
for (const hz of [10, 15, 20])
  for (const swapped of [false, true]) {
    const label = `${hz} Hz swapped=${swapped}`;
    const hold = (d, move, act, count = Math.ceil(hz * 0.3), missing = null) => {
      for (let i = 0; i < count; i++) d.frame(move, act, missing);
    };
    test(`${label}: gun pose fires once, a sustained finger release permits the next attack`, () => {
      const d = driver(hz, swapped);
      hold(d, { push: 0.4 }, { gun: true, x: 0.3, y: 0.1 });
      assert.deepEqual(d.events, ['attack']);
      assert.ok(d.input.forward > 0.7);
      hold(d, {}, { gun: true }, hz);
      assert.deepEqual(d.events, ['attack']);
      d.frame(); // One detection flicker is not a release.
      hold(d, {}, { gun: true });
      assert.deepEqual(d.events, ['attack']);
      hold(d, {}, {});
      hold(d, {}, { gun: true });
      assert.deepEqual(d.events, ['attack', 'attack']);
    });
    test(`${label}: open hand drags both camera axes, stops at rest, never attacks or waves`, () => {
      const d = driver(hz, swapped);
      for (let i = 1; i <= hz; i++) d.frame({}, { x: (i * 0.6) / hz, y: (-i * 0.4) / hz });
      const yaw = d.input.cameraDelta.x;
      assert.ok(yaw > 0);
      assert.ok(d.input.cameraDelta.y < 0);
      hold(d, {}, { x: 0.6, y: -0.4, push: 0.45 }, hz);
      assert.equal(d.input.cameraDelta.x, 0);
      assert.equal(d.input.cameraDelta.y, 0);
      assert.deepEqual(d.events, []);
      assert.equal(d.input.forward, 0);
      assert.equal(d.input.strafe, 0);
    });
    test(`${label}: a horizontal palm stroke interacts without a return stroke or camera motion`, () => {
      const d = driver(hz, swapped);
      hold(d, {}, { pitch: 1.3 });
      for (let i = 1; i <= 6; i++) d.frame({}, { pitch: 1.3, x: i * 0.07 });
      assert.deepEqual(d.events, ['interact']);
      assert.equal(d.input.cameraDelta.x, 0);
      assert.equal(d.input.cameraDelta.y, 0);
      hold(d, {}, { pitch: 1.3, x: 0.42 }, hz);
      assert.deepEqual(d.events, ['interact']);
      for (let i = 1; i <= 6; i++) d.frame({}, { pitch: 1.3, x: 0.42 - i * 0.07 });
      assert.deepEqual(d.events, ['interact', 'interact']);
    });
    test(`${label}: closing the hand clutches the view and reopening anchors at the new position`, () => {
      const d = driver(hz, swapped);
      for (const x of [0.1, 0.2, 0.3]) d.frame({}, { x });
      assert.ok(d.input.cameraDelta.x > 0);
      hold(d, {}, { fold: true, x: -0.4, y: -0.3 });
      assert.equal(d.input.cameraDelta.x, 0);
      hold(d, {}, { x: -0.4, y: -0.3 });
      assert.equal(d.input.cameraDelta.x, 0);
      assert.equal(d.input.cameraDelta.y, 0);
      d.frame({}, { x: -0.3, y: -0.3 });
      assert.ok(d.input.cameraDelta.x > 0);
      assert.deepEqual(d.events, []);
    });
    test(`${label}: reacquiring a held gun cannot fire, and missing the movement hand does not block a new gun`, () => {
      const d = driver(hz, swapped),
        moveSide = swapped ? 'right' : 'left',
        actSide = swapped ? 'left' : 'right';
      d.frame({}, { gun: true });
      hold(d, {}, {}, 4, actSide);
      hold(d, {}, { gun: true });
      assert.deepEqual(d.events, []);
      hold(d, {}, {}, undefined, moveSide);
      hold(d, {}, { gun: true }, undefined, moveSide);
      assert.equal(d.input.state, 'ACTIVE');
      assert.deepEqual(d.events, ['attack']);
    });
  }
test('right-hand push, upright waving, wrist rocking and raising are camera gestures, not game actions', () => {
  const d = driver();
  for (const pose of [
    { push: 0.6 },
    { roll: 0.5 },
    { roll: -0.5 },
    { x: 0.3 },
    { x: -0.3 },
    { y: -0.4 },
  ])
    for (let i = 0; i < 7; i++) d.frame({}, pose);
  assert.deepEqual(d.events, []);
});
test('one gun frame and small or vertical movements of a horizontal palm do not fire actions', () => {
  const d = driver();
  d.frame({}, { gun: true });
  d.frame();
  for (let i = 0; i < 30; i++) d.frame({}, { pitch: 1.3, x: Math.sin(i) * 0.035, y: i * 0.02 });
  assert.deepEqual(d.events, []);
});
