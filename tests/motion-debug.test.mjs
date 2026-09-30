import test from 'node:test';
import assert from 'node:assert/strict';
import {
  debugLandmarks,
  debugQuality,
  describeMotionDebug,
  projectDebugPoint,
  HAND_CONNECTIONS,
} from '../dist/src/motion-debug.js';
import { syntheticHands } from './helpers/motion-hands.mjs';
const frame = (landmarks = debugLandmarks(syntheticHands())) => ({
  frameId: 1,
  sampledAtMainMs: 100,
  receivedAtMainMs: 180,
  width: 640,
  height: 480,
  landmarks,
});
test('debug copies only hand XY and discards body and estimated depth', () => {
  const hands = syntheticHands();
  for (const hand of Object.values(hands))
    for (const p of hand.landmarks)
      Object.defineProperty(p, 'z', {
        get() {
          throw Error('depth');
        },
      });
  Object.defineProperty(hands, 'shoulders', {
    get() {
      throw Error('body');
    },
  });
  const copied = debugLandmarks(hands);
  assert.equal(copied.length, 42);
  assert.deepEqual(Object.keys(copied[0]), ['x', 'y']);
  hands.left.landmarks[0].x = 0.1;
  assert.equal(copied[0].x, 0.62);
  assert.equal(debugLandmarks(null), null);
  assert.equal(debugLandmarks({ left: null, right: null }), null);
  assert.ok(HAND_CONNECTIONS.every(([a, b]) => a < 21 && b < 21));
});
test('hand overlay mirrors once and missing or cropped points never look tracked', () => {
  assert.deepEqual(projectDebugPoint({ x: 0.25, y: 0.4 }, 640, 480), { x: 480, y: 192 });
  assert.equal(debugQuality({ x: 0.5, y: 0.5 }), 'tracked');
  assert.equal(debugQuality({ x: 1.1, y: 0.5 }), 'missing');
  assert.equal(debugQuality({ x: NaN, y: 0.5 }), 'missing');
  assert.equal(debugQuality(null), 'missing');
});
test('no result, no hands and stale result remain distinct and stale skeletons disappear', () => {
  assert.equal(describeMotionDebug(null, 200).ageMs, null);
  assert.equal(describeMotionDebug(frame(null), 200).detected, false);
  assert.deepEqual(describeMotionDebug(frame(), 329).missingInput, []);
  const stale = describeMotionDebug(frame(), 330);
  assert.equal(stale.detected, false);
  assert.ok(stale.points.every((p) => !p.point && p.status === '更新待ち'));
  assert.equal(describeMotionDebug(frame(), 99).fresh, false);
});
test('one hand is visible without a face, shoulder or second hand', () => {
  const hands = syntheticHands();
  hands.left = null;
  const view = describeMotionDebug(frame(debugLandmarks(hands)), 200);
  assert.deepEqual(view.missingInput, ['左手']);
  assert.equal(view.points.filter((p) => p.quality === 'tracked').length, 21);
});
