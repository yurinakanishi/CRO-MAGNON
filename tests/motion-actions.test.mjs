import test from 'node:test';
import assert from 'node:assert/strict';
import { motionDriver } from './helpers/motion-driver.mjs';

for (const hz of [10, 15, 20])
  for (const swapped of [false, true]) {
    test(`${hz} Hz swapped=${swapped}: movement and attack coexist; held/reacquired gun never repeats`, () => {
      const d = motionDriver(hz, swapped);
      d.hold(d.pair({ push: 0.4 }, { gun: true }), 300);
      assert.deepEqual(
        d.input.consumeActions(d.time).map((e) => e.action),
        ['attack'],
      );
      assert.ok(d.intent.forward > 0.6);
      d.hold(d.pair({}, { gun: true }));
      assert.deepEqual(d.input.consumeActions(d.time), []);
      const p = d.pair();
      p[swapped ? 'left' : 'right'] = null;
      d.frame(p);
      d.hold(d.pair({}, { gun: true }));
      assert.deepEqual(d.input.consumeActions(d.time), []);
      d.hold(d.pair());
      d.hold(d.pair({}, { gun: true }), 300);
      assert.deepEqual(
        d.input.consumeActions(d.time).map((e) => e.action),
        ['attack'],
      );
    });
    test(`${hz} Hz swapped=${swapped}: only raised action hand jumps, once until lowered`, () => {
      const d = motionDriver(hz, swapped);
      d.hold(d.pair({ y: -0.4 }));
      assert.deepEqual(d.input.consumeActions(d.time), []);
      d.hold(d.pair({}, { y: -0.4 }), 300);
      assert.deepEqual(
        d.input.consumeActions(d.time).map((e) => e.action),
        ['jump'],
      );
      d.hold(d.pair({}, { y: -0.4 }));
      assert.deepEqual(d.input.consumeActions(d.time), []);
      d.frame(null);
      d.hold(d.pair({}, { y: -0.4 }));
      assert.deepEqual(d.input.consumeActions(d.time), []);
      d.hold(d.pair());
      d.hold(d.pair({}, { y: -0.4 }), 300);
      assert.deepEqual(
        d.input.consumeActions(d.time).map((e) => e.action),
        ['jump'],
      );
    });
    test(`${hz} Hz swapped=${swapped}: low open-hand sweep interacts; chest sweep does not`, () => {
      const d = motionDriver(hz, swapped),
        events = [];
      for (const y of [0, 0.5]) {
        d.hold(d.pair({}, { y }), 400);
        for (let i = 1; i <= 8; i++) {
          d.frame(d.pair({}, { y, x: i * 0.055 }));
          events.push(...d.input.consumeActions(d.time).map((e) => e.action));
        }
        assert.deepEqual(events, y ? ['interact'] : []);
      }
      assert.equal(d.intent.forward, 0);
      assert.equal(d.intent.turn, 0);
    });
  }
test('single-frame, high and low gun poses cannot fire', () => {
  const d = motionDriver();
  d.frame(d.pair({}, { gun: true }));
  d.hold(d.pair());
  assert.deepEqual(d.input.consumeActions(d.time), []);
  for (const y of [-0.4, 0.5]) {
    d.hold(d.pair({}, { gun: true, y }));
    assert.deepEqual(d.input.consumeActions(d.time), []);
  }
});
test('losing action hand discards an event while valid movement continues', () => {
  const d = motionDriver();
  d.hold(d.pair({ push: 0.5 }, { gun: true }), 300);
  const p = d.pair({ push: 0.5 });
  p.right = null;
  d.frame(p);
  assert.deepEqual(d.input.consumeActions(d.time), []);
  assert.ok(d.intent.forward > 0.9);
});
