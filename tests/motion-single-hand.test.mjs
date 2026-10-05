import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, MotionInputAdapter } from '../dist/src/motion-input.js';
import { motionDriver } from './helpers/motion-driver.mjs';
import { syntheticHand } from './helpers/motion-hands.mjs';

const actions = (d) => d.input.consumeActions(d.time).map((e) => e.action);
const stopped = (d) => assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);

for (const hz of [10, 15, 20, 30])
  for (const right of [false, true]) {
    const side = right ? 'right' : 'left';
    test(`${hz} Hz ${side} only: calibration, movement and resuming need just the selected hand`, () => {
      const d = motionDriver(hz, right, true);
      assert.equal(d.input.actionHand, side);
      assert.equal(d.input.calibration[right ? 'left' : 'right'], null);
      for (const push of [0.4, -0.27]) {
        d.hold(d.pair({ push }));
        assert.equal(Math.sign(d.intent.forward), Math.sign(push));
        assert.equal(d.intent.turn, 0);
        assert.deepEqual(actions(d), [], 'pushing/pulling never jumps or strokes');
        for (const x of [-1, 1]) {
          d.hold(d.pair({ push, x }));
          assert.equal(Math.sign(d.intent.turn), Math.sign(x));
          assert.equal(Math.sign(d.intent.forward), Math.sign(push));
          assert.deepEqual(actions(d), []);
        }
      }
      d.input.pause();
      d.input.resume();
      d.hold(d.pair({ push: 0.5 }));
      assert.equal(d.input.state, 'READY');
      stopped(d);
      d.hold(d.pair());
      assert.equal(d.input.state, 'ACTIVE');
      stopped(d);
    });

    test(`${hz} Hz ${side} only: attack/jump stop steering, fire once, then require rest before walking`, () => {
      for (const [pose, action] of [
        [{ gun: true }, 'attack'],
        [{ y: -0.4 }, 'jump'],
      ]) {
        const d = motionDriver(hz, right, true);
        d.hold(d.pair({ push: 0.4, x: right ? -0.8 : 0.8 }));
        assert.ok(d.intent.forward > 0 && Math.abs(d.intent.turn) > 0);
        // Pass through rest instead of teleporting across the image in one frame.
        d.hold(d.pair(), 200);
        d.frame(d.pair(pose));
        stopped(d);
        d.hold(d.pair(pose), 240);
        assert.deepEqual(actions(d), [action]);
        d.hold(d.pair(pose));
        stopped(d);
        assert.deepEqual(actions(d), []);
        d.hold(d.pair({ push: 0.4, x: 0.8 }));
        stopped(d);
        d.hold(d.pair());
        d.hold(d.pair({ push: 0.4 }));
        assert.ok(d.intent.forward > 0.6);
        assert.deepEqual(actions(d), []);
      }
    });

    test(`${hz} Hz ${side} only: low sweep interacts without walking or turning`, () => {
      const d = motionDriver(hz, right, true),
        events = [];
      d.hold(d.pair({ push: 0.4 }));
      d.frame(d.pair({ y: 0.28 }));
      stopped(d);
      d.hold(d.pair({ y: 0.28 }));
      for (let i = 1; i <= 8; i++) {
        d.frame(d.pair({ y: 0.28, x: i * 0.055 }));
        stopped(d);
        events.push(...actions(d));
      }
      assert.deepEqual(events, ['interact']);
      d.frame(null);
      d.hold(d.pair({ gun: true }));
      assert.deepEqual(actions(d), [], 'a returning gun cannot fire');
    });
  }

for (const right of [false, true]) {
  test(`selected ${right ? 'right' : 'left'} only: pushing with incidental vertical motion cannot enter an action`, () => {
    const d = motionDriver(15, right, true);
    for (const y of [-0.4, 0.6]) {
      d.hold(d.pair({ push: 0.6, y }));
      assert.ok(d.intent.forward > 0.9);
      assert.equal(d.input.returningFromAction, false);
      assert.deepEqual(actions(d), []);
      d.hold(d.pair());
    }
  });

  test(`selected ${right ? 'right' : 'left'} only: other hand cannot calibrate, move or trigger an action`, () => {
    const d = motionDriver(15, right, true);
    const other = right ? 'left' : 'right';
    d.hold({ ...d.pair(), [other]: syntheticHand(other, { gun: true }) });
    stopped(d);
    assert.deepEqual(actions(d), []);
    const wrong = { left: null, right: null, [other]: syntheticHand(other, { push: 0.4 }) };
    d.hold(wrong);
    stopped(d);
    d.input.calibrate();
    d.hold(wrong, 4000);
    assert.equal(d.input.state, 'CALIBRATING');
    assert.equal(d.input.calibration, null);
    d.hold(d.pair(), 3800);
    assert.equal(d.input.state, 'ACTIVE');
  });

  test(`selected ${right ? 'right' : 'left'} only: edge holding continues without either hand and clears on rest/stale`, () => {
    const d = motionDriver(15, right, true);
    const side = d.input.movementHand;
    d.hold(d.pair({ push: 0.4 }));
    const palm = [0, 5, 9, 13, 17].map((i) => d.pair({ push: 0.4 })[side].landmarks[i]);
    const shift = right
      ? 0.015 - Math.min(...palm.map((p) => p.x))
      : 0.985 - Math.max(...palm.map((p) => p.x));
    let edge;
    for (let step = 1; step <= 10; step++) {
      edge = d.pair({ push: 0.4 });
      for (const p of edge[side].landmarks) p.x += (shift * step) / 10;
      d.hold(edge, 150);
    }
    const previous = [d.input.forward, d.input.turn];
    assert.ok(previous[0] > 0.6);
    d.hold(null, 3000);
    assert.equal(d.input.edgeHolding, true);
    assert.deepEqual([d.input.forward, d.input.turn], previous);
    assert.deepEqual(actions(d), []);
    d.frame(d.pair());
    stopped(d);
    d.hold(edge);
    d.hold(null);
    assert.equal(d.input.read(d.time + MOTION.staleMs).active, false);
    assert.equal(d.input.edgeHolding, false);
  });
}

test('changing the selected hand recalibrates and discards old movement and queued action', () => {
  const d = motionDriver(15, false, true);
  d.hold(d.pair({ gun: true }), 240);
  const oldSession = d.input.sessionId;
  d.input.calibrate('right');
  assert.notEqual(d.input.sessionId, oldSession);
  assert.equal(d.input.calibration, null);
  assert.deepEqual(actions(d), []);
  d.frame(d.pair({ push: 0.4 }));
  stopped(d);
  assert.equal(d.input.state, 'CALIBRATING');
  assert.ok(
    new MotionInputAdapter().requiredHands.length === 2,
    'legacy adapter callers keep their two-hand contract',
  );
});
