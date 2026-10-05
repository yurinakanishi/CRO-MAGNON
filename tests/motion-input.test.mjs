import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION } from '../dist/src/motion-input.js';
import { motionDriver as driver } from './helpers/motion-driver.mjs';
import { syntheticHands as hands } from './helpers/motion-hands.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';

for (const hz of [10, 15, 20, 30])
  for (const swapped of [false, true]) {
    test(`${hz} Hz swapped=${swapped}: forward, reverse, rest and diagonal steering stay independent`, () => {
      const d = driver(hz, swapped);
      assert.ok(d.hold(d.pair({ push: 0.5 })).forward > 0.9);
      assert.equal(d.intent.turn, 0);
      assert.ok(d.hold(d.pair({ push: -0.28 })).forward < -0.8);
      assert.equal(d.intent.turn, 0);
      d.hold(d.pair());
      assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
      for (const push of [0.4, -0.27])
        for (const x of [-1, 1]) {
          const i = d.hold(d.pair({ push, x }));
          assert.equal(Math.sign(i.forward), Math.sign(push));
          assert.equal(Math.sign(i.turn), Math.sign(x));
          assert.ok(Math.abs(i.turn) > 0.15);
          assert.ok(Math.abs(i.forward) <= 1 && Math.abs(i.turn) <= 1);
        }
    });
  }

test('slight retreat in the resting pose does not creep backwards; lowered palm stops', () => {
  const d = driver();
  d.hold(hands({ push: -0.28 }));
  assert.ok(d.intent.forward < -0.8);
  assert.equal(d.hold(hands({ push: -0.13 })).forward, 0);
  d.hold(hands({ push: 0.4 }));
  d.frame(hands({ y: 0.65 }));
  assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
});
test('jitter does not steer, and a single hand-scale spike cannot start walking', () => {
  const d = driver();
  for (let k = 0; k < 30; k++) {
    const n = Math.sin(k);
    d.frame(hands({ x: n * 0.25, push: n * 0.04, yaw: n * 0.1, roll: n * 0.1 }));
    assert.equal(d.intent.forward, 0);
    assert.equal(d.intent.turn, 0);
  }
  d.frame(hands({ push: 0.5 }));
  assert.equal(d.intent.forward, 0);
  d.hold(hands());
  assert.equal(d.intent.forward, 0);
  d.hold(hands({ push: 0.8 }));
  assert.ok(d.intent.forward > 0.9);
  assert.equal(d.intent.turn, 0);
});
test('slight palm foreshortening during diagonal retreat does not latch movement off', () => {
  const d = driver(),
    i = d.hold(hands({ push: -0.2, flatness: 0.83, x: 1 }));
  assert.ok(i.forward < -0.5 && i.turn > 0.5);
});
test('lost palm stops immediately; a returning gesture needs several fresh frames', () => {
  const d = driver(),
    moving = hands({ push: 0.5 }),
    lost = hands();
  lost.left = null;
  d.hold(moving);
  d.frame(lost);
  assert.equal(d.input.state, 'ACTIVE');
  assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
  d.frame(moving);
  assert.equal(d.intent.forward, 0);
  d.hold(moving, 400);
  assert.ok(d.intent.forward > 0.9);
});
for (const gap of [300, 1050, 10000])
  test(`${gap} ms gap cannot retain movement or require recalibration`, () => {
    const d = driver(),
      baseline = d.input.calibration,
      session = d.input.sessionId;
    d.hold(hands({ push: 0.5 }));
    assert.equal(d.input.read(d.time + MOTION.staleMs).active, false);
    const p = hands({ push: 0.5 });
    p.right = null;
    d.frame(p, gap);
    assert.equal(d.intent.forward, 0);
    d.hold(p, 500);
    assert.equal(d.input.state, 'ACTIVE');
    assert.ok(d.intent.forward > 0.9);
    assert.equal(d.input.calibration, baseline);
    assert.equal(d.input.sessionId, session);
    assert.deepEqual(d.input.consumeActions(d.time), []);
  });
test('invalid/discontinuous palm or uncertain orientation stops walking', () => {
  for (const mutate of [
    (p) => (p.left.landmarks[0].x = NaN),
    (p) => (p.left.landmarks = []),
    (p) => p.left.landmarks.forEach((v) => (v.x += 0.25)),
    (p) => (p.left.handednessScore = 0.2),
  ]) {
    const d = driver();
    d.hold(hands({ push: 0.5 }));
    const p = hands();
    mutate(p);
    d.frame(p);
    assert.deepEqual([d.intent.forward, d.intent.turn], [0, 0]);
  }
  const d = driver();
  d.hold(hands({ push: 0.5, yaw: 0.8 }));
  assert.equal(d.intent.forward, 0);
});
test('cropped fingertips preserve movement; a palm suddenly jumping outside from the center stops', () => {
  const d = driver(),
    p = hands({ push: 0.5 });
  p.left.landmarks[12].y = -0.1;
  d.hold(p);
  assert.ok(d.intent.forward > 0.9);
  assert.equal(d.input.fingerRatio, null);
  p.left.landmarks[17].x = 1.01;
  d.frame(p);
  assert.equal(d.intent.forward, 0);
});
test('finger spreading or folding cannot move; calibration needs stable open palms', () => {
  const d = driver();
  for (const config of [{ onlyFingers: 1.5 }, { fold: true }, { flatness: 0.25 }]) {
    d.hold(hands(config));
    assert.equal(d.intent.forward, 0);
  }
  d.input.calibrate();
  d.hold(hands({ fold: true }), 4000);
  assert.equal(d.input.state, 'CALIBRATING');
  d.hold(hands(), 3800);
  assert.equal(d.input.state, 'ACTIVE');
});
test('render reads smooth speed once per time; neutral and tracking loss have no coast', () => {
  const d = driver(),
    p = hands({ push: 0.5 });
  d.frame(p);
  d.frame(p);
  d.frame(p);
  const a = d.input.read(d.time);
  assert.deepEqual(d.input.read(d.time), a);
  const b = d.input.read(d.time + 16);
  assert.ok(b.forward >= a.forward && b.forward <= 1 && b.forward - a.forward < 0.3);
  d.frame(hands());
  d.frame(hands());
  assert.equal(d.intent.forward, 0);
  d.hold(p);
  d.frame(null);
  assert.equal(d.intent.forward, 0);
});
test('stale, future, duplicate and old-session results cannot revive inputs or actions', () => {
  const d = driver(),
    f = d.frame();
  assert.equal(d.input.accept(f, d.time), false);
  for (const at of [NaN, Infinity, d.time + 1, d.time - 400])
    assert.equal(
      d.input.accept({ ...f, frameId: f.frameId + 1, sampledAtMainMs: at }, d.time),
      false,
    );
  d.hold(hands(undefined, { gun: true }));
  assert.deepEqual(d.input.consumeActions(d.time + 300), []);
  d.input.calibrate();
  assert.equal(
    d.input.accept({ ...f, frameId: 999, sampledAtMainMs: d.time + 1 }, d.time + 1),
    false,
  );
});
test('manual pause still requires neutral; stop discards pending actions', () => {
  const d = driver();
  d.hold(hands({ push: 0.5 }));
  d.input.pause();
  d.hold(hands({ push: 0.5 }));
  assert.equal(d.intent.forward, 0);
  assert.equal(d.input.state, 'PAUSED');
  d.input.resume();
  d.hold(hands({ push: 0.5 }));
  assert.equal(d.input.state, 'READY');
  assert.equal(d.intent.forward, 0);
  d.hold(hands(), 500);
  assert.equal(d.input.state, 'ACTIVE');
  d.hold(hands(undefined, { gun: true }));
  d.input.stop();
  assert.deepEqual(d.input.consumeActions(d.time), []);
});
test('explicit steering facing is preserved during reverse and expires with movement', () => {
  const p = {
    species: 'cro',
    gender: 'female',
    x: 0,
    z: 0,
    facing: 0,
    dx: 0,
    dz: -1,
    lastInput: 1000,
    inputFacing: 0,
    path: [],
    target: null,
  };
  movePlayer(p, 0.02, 1100);
  assert.equal(p.facing, 0);
  assert.ok(p.z < 0);
  p.inputFacing = 2;
  p.dx = p.dz = 0;
  movePlayer(p, 0.02, 1600);
  assert.equal(p.facing, 0);
  p.inputFacing = undefined;
  p.dx = 0.5;
  p.lastInput = 1600;
  movePlayer(p, 0.02, 1600);
  assert.equal(p.facing, Math.PI / 2);
  for (const facing of ['1', null, 4, -4])
    assert.equal(decodeCommand(JSON.stringify({ type: 'move', dx: 0, dz: 0, facing })), null);
  assert.equal(decodeCommand('{"type":"move","dx":0,"dz":0,"facing":1.2}').facing, 1.2);
  const prediction = new LocalPrediction();
  prediction.setInput(0, -1, false, 20, 0);
  assert.equal(prediction.input.facing, 0);
  prediction.stop();
  assert.equal(prediction.input.facing, undefined);
});
