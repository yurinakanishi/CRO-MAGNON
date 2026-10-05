import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, MotionInputAdapter } from '../dist/src/motion-input.js';
import { syntheticHand, syntheticHands } from './helpers/motion-hands.mjs';

function driver(hz = 15) {
  const input = new MotionInputAdapter();
  input.singleHand = true;
  input.autoHand = true;
  input.start();
  input.calibrate();
  let at = 0,
    id = 0;
  const frame = (hands, dt = 1000 / hz, extra = {}) => {
    at += dt;
    input.accept(
      {
        sessionId: input.sessionId,
        frameId: ++id,
        sampledAtMainMs: at,
        width: 640,
        height: 480,
        hands,
        ...extra,
      },
      at,
    );
    return input.read(at);
  };
  const hold = (hands, ms = 500) => {
    const end = at + ms;
    while (at < end - 0.001) frame(hands);
  };
  return {
    input,
    frame,
    hold,
    get at() {
      return at;
    },
  };
}
const only = (side, options) => ({ left: null, right: null, [side]: syntheticHand(side, options) });

for (const hz of [10, 15, 20, 30])
  for (const side of ['left', 'right']) {
    test(`${hz} Hz: ${side} alone is identified, calibrated and operates without a hand selection`, () => {
      const d = driver(hz);
      assert.equal(d.input.detectedHand, null);
      assert.equal(d.input.handsLabel, '片手');
      d.frame(only(side));
      assert.equal(d.input.detectedHand, null, 'one frame does not confirm a hand');
      d.hold(only(side), 3800);
      assert.equal(d.input.state, 'ACTIVE');
      assert.equal(d.input.detectedHand, side);
      assert.equal(d.input.actionHand, side);
      assert.equal(d.input.calibration[side === 'left' ? 'right' : 'left'], null);
      d.hold(only(side, { push: 0.4 }));
      assert.ok(d.input.forward > 0.6);
      d.hold(only(side));
      d.hold(only(side, { gun: true }), 240);
      assert.deepEqual(
        d.input.consumeActions(d.at).map((e) => e.action),
        ['attack'],
      );
      d.input.pause();
      d.input.resume();
      d.hold(only(side));
      assert.equal(d.input.state, 'ACTIVE');
      assert.equal(d.input.detectedHand, side);
    });

    test(`${hz} Hz: confirmed ${side} does not switch on loss, pause or another hand's appearance`, () => {
      const d = driver(hz),
        other = side === 'left' ? 'right' : 'left';
      d.hold(only(side), 3800);
      const baseline = d.input.calibration;
      d.hold({ ...only(side), [other]: syntheticHand(other, { gun: true }) });
      assert.deepEqual(d.input.consumeActions(d.at), []);
      d.hold(only(other, { push: 0.4 }), 1500);
      assert.equal(d.input.detectedHand, side);
      assert.equal(d.input.forward, 0);
      d.frame(null, MOTION.staleMs + 1);
      d.hold(only(other), 1500);
      assert.equal(d.input.detectedHand, side);
      assert.equal(d.input.forward, 0);
      d.input.pause();
      d.input.resume();
      d.hold(only(other), 1500);
      assert.equal(d.input.state, 'READY');
      d.hold(only(side));
      assert.equal(d.input.state, 'ACTIVE');
      assert.equal(d.input.calibration, baseline);
    });
  }

test('both visible initially uses the larger open palm and a later larger hand cannot steal calibration', () => {
  const d = driver();
  d.frame(syntheticHands({}, { push: 0.3 }));
  d.hold(syntheticHands({ push: 0.6 }, { push: 0.3 }), 3800);
  assert.equal(d.input.detectedHand, 'right');
  assert.equal(d.input.state, 'ACTIVE');
});

test('unstable handedness, low-confidence labels and closed hands cannot finish calibration', () => {
  const d = driver();
  for (let i = 0; i < 90; i++) d.frame(only(i % 2 ? 'right' : 'left'));
  assert.equal(d.input.detectedHand, null);
  assert.equal(d.input.calibration, null);
  for (const side of ['left', 'right']) {
    const weak = only(side);
    weak[side].handednessScore = 0.6;
    d.hold(weak, 3800);
    d.hold(only(side, { fold: true }), 3800);
    assert.equal(d.input.calibration, null);
  }
  d.hold(only('right'), 3800);
  assert.equal(d.input.detectedHand, 'right');
});

test('a different hand during setup restarts recognition and never mixes the two rest positions', () => {
  const d = driver();
  d.hold(only('left'), 800);
  assert.equal(d.input.detectedHand, 'left');
  d.frame(only('right'));
  assert.equal(d.input.detectedHand, null);
  assert.equal(d.input.calibrationStage, 'recognize');
  d.hold(only('right'), 3800);
  assert.equal(d.input.detectedHand, 'right');
  assert.equal(d.input.calibration.left, null);
});

test('recalibration and restarting detect either hand afresh and discard old actions', () => {
  const d = driver();
  d.hold(only('left'), 3800);
  d.hold(only('left', { gun: true }), 240);
  const oldSession = d.input.sessionId;
  d.input.calibrate();
  assert.equal(d.input.detectedHand, null);
  assert.deepEqual(d.input.consumeActions(d.at), []);
  d.frame(only('left'), 67, { sessionId: oldSession });
  assert.equal(d.input.detectedHand, null);
  d.hold(only('right'), 3800);
  assert.equal(d.input.detectedHand, 'right');
  d.input.stop();
  d.input.start();
  d.input.calibrate();
  d.hold(only('left'), 3800);
  assert.equal(d.input.detectedHand, 'left');
});

test('automatic selection keeps the chosen hand and its command while it is outside the image', () => {
  const d = driver();
  d.hold(only('left'), 3800);
  d.hold(only('left', { push: 0.4 }));
  const palm = [0, 5, 9, 13, 17].map((i) => only('left', { push: 0.4 }).left.landmarks[i]);
  const shift = 0.985 - Math.max(...palm.map((p) => p.x));
  for (let step = 1; step <= 10; step++) {
    const pair = only('left', { push: 0.4 });
    for (const p of pair.left.landmarks) p.x += (shift * step) / 10;
    d.hold(pair, 150);
  }
  const previous = [d.input.forward, d.input.turn];
  d.hold(only('right', { gun: true }), 2000);
  assert.equal(d.input.detectedHand, 'left');
  assert.equal(d.input.edgeHolding, true);
  assert.deepEqual([d.input.forward, d.input.turn], previous);
  assert.deepEqual(d.input.consumeActions(d.at), []);
  d.frame(only('left'));
  assert.deepEqual([d.input.forward, d.input.turn], [0, 0]);
});
