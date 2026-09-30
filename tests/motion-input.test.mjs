import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionInputAdapter, MotionNavigation, MOTION } from '../dist/src/motion-input.js';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';

import { syntheticHands as hands } from './helpers/motion-hands.mjs';
function driver(hz = 15, swapped = false) {
  const input = new MotionInputAdapter();
  let time = 0,
    id = 0;
  input.start();
  input.calibrate(swapped ? 'right' : 'left');
  const frame = (p = hands(undefined, undefined, swapped), dt = 1000 / hz, extra = {}) => {
    time += dt;
    const f = {
      sessionId: input.sessionId,
      frameId: ++id,
      sampledAtMainMs: time,
      width: 640,
      height: 480,
      hands: p,
      ...extra,
    };
    input.accept(f, time);
    return f;
  };
  const hold = (p, ms) => {
    const until = time + ms;
    while (time < until - 0.001) frame(p);
  };
  hold(hands(undefined, undefined, swapped), 2000);
  assert.equal(input.state, 'ACTIVE');
  return {
    input,
    frame,
    hold,
    get time() {
      return time;
    },
  };
}
import { movementFromCamera } from '../dist/shared/terrain.mjs';
test('movement and gun attack coexist without camera or character turning', () => {
  const d = driver();
  d.hold(hands({ roll: -0.5, push: 0.55 }, { gun: true }), 250);
  const events = d.input.consumeActions(d.time);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'attack');
  assert.ok(d.input.read(d.time).forward > 0);
  assert.ok(d.input.read(d.time).strafe > 0);
  for (let i = 0; i < 20; i++) assert.equal(d.input.consumeActions(d.time + i).length, 0);
});
for (const hz of [10, 15, 20, 30])
  for (const swapped of [false, true])
    test(`${hz} Hz swapped=${swapped}: left/control hand rises for 200ms to jump, right hand remains a camera`, () => {
      const d = driver(hz, swapped);
      d.hold(hands(undefined, { y: -0.33 }, swapped), 350);
      assert.deepEqual(d.input.consumeActions(d.time), []);
      const p = hands({ y: -0.33 }, undefined, swapped);
      d.frame(p);
      const start = d.time;
      while (d.time - start < 200 - 1000 / hz - 0.01) {
        d.frame(p);
        assert.deepEqual(d.input.consumeActions(d.time), []);
      }
      d.hold(p, (1000 / hz) * 2);
      assert.equal(d.input.consumeActions(d.time)[0].action, 'jump');
      d.hold(p, 500);
      assert.deepEqual(d.input.consumeActions(d.time), []);
      d.hold(hands(undefined, undefined, swapped), 220);
      d.hold(p, 300);
      assert.equal(d.input.consumeActions(d.time)[0].action, 'jump');
    });
test('uncertain action hand cancels a pending gun while valid movement remains', () => {
  const d = driver();
  const p = hands({ push: 0.55 }, { gun: true });
  d.frame(p);
  p.right.handednessScore = 0.1;
  d.hold(p, 300);
  assert.ok(d.input.read(d.time).forward > 0);
  assert.deepEqual(d.input.consumeActions(d.time), []);
  p.right.handednessScore = 0.98;
  d.hold(p, 200);
  assert.deepEqual(d.input.consumeActions(d.time), []);
  d.hold(hands(), 220);
  d.hold(hands(undefined, { gun: true }), 200);
  assert.equal(d.input.consumeActions(d.time).length, 1);
});
test('loss away from the edge stops movement only; a returning hand controls it without global recovery', () => {
  const d = driver();
  d.frame(hands({ x: 0, y: -0.3, push: 0.55 }));
  const p = hands();
  p.left.handednessScore = 0;
  d.frame(p);
  assert.equal(d.input.state, 'ACTIVE');
  assert.equal(d.input.read(d.time).forward, 0);
  d.hold(hands({ x: 0, y: -0.3, push: 0.55 }), 1500);
  assert.equal(d.input.state, 'ACTIVE');
  assert.ok(d.input.read(d.time).forward > 0);
  d.hold(hands(), 400);
  assert.equal(d.input.state, 'ACTIVE');
});

test('action-hand loss removes even a confirmed event that has not yet been consumed', () => {
  const d = driver();
  d.hold(hands(undefined, { gun: true }), 320);
  const p = hands();
  p.right.handednessScore = 0;
  d.frame(p);
  assert.equal(d.input.consumeActions(d.time).length, 0);
  assert.equal(d.input.state, 'ACTIVE');
});

test('unseen elbows never block calibration, movement or a translated gun pose', () => {
  const d = driver(20);
  d.input.calibrate();
  const neutral = hands();
  Object.defineProperty(neutral, 'leftElbow', {
    get() {
      throw Error('elbow input');
    },
  });
  d.hold(neutral, 2100);
  assert.equal(d.input.state, 'ACTIVE');
  const attacking = hands({ x: 0, y: 0, push: 0.55 }, { x: 0.12, y: -0.1, gun: true });
  Object.defineProperty(attacking, 'rightElbow', {
    get() {
      throw Error('elbow input');
    },
  });
  d.hold(attacking, 300);
  assert.equal(d.input.consumeActions(d.time)[0].action, 'attack');
  assert.ok(d.input.read(d.time).forward > 0);
  d.hold(attacking, 1200);
  assert.deepEqual(d.input.consumeActions(d.time), []);
});

test('invalid hands and discontinuous hand position stop safely', () => {
  for (const mutate of [
    (p) => {
      p.left.landmarks[0].x = NaN;
    },
    (p) => {
      p.left.landmarks = [];
    },
    (p) => {
      for (const v of p.left.landmarks) v.x += 0.22;
    },
  ]) {
    const d = driver();
    const p = hands();
    mutate(p);
    d.frame(p);
    assert.equal(d.input.state, 'ACTIVE');
    assert.equal(d.input.read(d.time).forward, 0);
  }
});

test('stale frames stop within 230ms; old frames and sessions never produce delayed actions', () => {
  const d = driver();
  d.frame(hands({ x: 0, y: -0.3, push: 0.55 }));
  assert.equal(d.input.read(d.time + MOTION.staleMs).active, false);
  const oldSession = d.input.sessionId;
  d.input.calibrate();
  assert.equal(
    d.input.accept(
      {
        sessionId: oldSession,
        frameId: 999,
        sampledAtMainMs: d.time + 10,
        width: 640,
        height: 480,
        hands: hands(),
      },
      d.time + 10,
    ),
    false,
  );
  assert.equal(d.input.consumeActions(d.time + 10).length, 0);
});
test('out-of-order, nonfinite and expired frame time are rejected; events expire', () => {
  const d = driver();
  const f = d.frame(hands());
  assert.equal(d.input.accept(f, d.time), false);
  for (const at of [NaN, Infinity, d.time + 1, d.time - 400])
    assert.equal(
      d.input.accept({ ...f, frameId: f.frameId + 1, sampledAtMainMs: at }, d.time),
      false,
    );
  d.hold(hands(undefined, { gun: true }), 350);
  assert.equal(d.input.consumeActions(d.time + 300).length, 0);
});
test('optional idle facing uses existing movement expiry, prediction and protocol validation', () => {
  const p = {
    species: 'cro',
    gender: 'female',
    x: 0,
    z: 0,
    facing: 0,
    dx: 0,
    dz: 0,
    lastInput: 1000,
    inputFacing: 1.2,
    path: [],
    target: null,
  };
  movePlayer(p, 0.02, 1100);
  assert.equal(p.facing, 1.2);
  assert.equal(p.x, 0);
  assert.equal(p.z, 0);
  p.inputFacing = 2;
  movePlayer(p, 0.02, 1600);
  assert.equal(p.facing, 1.2);
  p.dx = 0.5;
  p.lastInput = 1600;
  movePlayer(p, 0.02, 1600);
  assert.equal(p.facing, Math.PI / 2);
  for (const facing of ['1', null, 4, -4])
    assert.equal(decodeCommand(JSON.stringify({ type: 'move', dx: 0, dz: 0, facing })), null);
  assert.equal(decodeCommand('{"type":"move","dx":0,"dz":0,"facing":1.2}').facing, 1.2);
  const prediction = new LocalPrediction();
  prediction.setInput(0, 0, false, 20, 1);
  assert.equal(prediction.input.facing, 1);
  prediction.stop();
  assert.equal(prediction.input.facing, undefined);
});

for (const hz of [10, 15, 20])
  for (const swapped of [false, true]) {
    test(`${hz} Hz swapped=${swapped}: recording regression, 167% palm plus lowered wrist still walks`, () => {
      const d = driver(hz, swapped);
      d.hold(hands({ push: 0.67, y: 0.45 }, undefined, swapped), 300);
      assert.ok(d.input.read(d.time).forward > 0.8);
      d.frame(hands(undefined, undefined, swapped));
      assert.equal(d.input.read(d.time).forward, 0);
      d.hold(hands({ push: 0.4, roll: -0.5 }, undefined, swapped), 300);
      const diagonal = d.input.read(d.time);
      assert.ok(diagonal.forward > 0.4 && diagonal.strafe > 0.4);
      assert.ok(Math.hypot(diagonal.forward, diagonal.strafe) <= 1.000001);
      assert.equal(diagonal.cameraYaw, 0);
    });
    test(`${hz} Hz swapped=${swapped}: pull back or lower for reverse; no rest latch`, () => {
      const d = driver(hz, swapped);
      for (const gesture of [{ push: -0.25 }, { y: 0.5 }]) {
        d.hold(hands(gesture, undefined, swapped), 300);
        assert.ok(d.input.read(d.time).forward < -0.5);
        d.hold(hands({ push: 0.4, y: 0.5 }, undefined, swapped), 300);
        assert.ok(d.input.read(d.time).forward > 0.7);
        d.frame(hands(undefined, undefined, swapped));
        assert.equal(d.input.read(d.time).forward, 0);
      }
    });
  }
test('left palm yaw no longer moves the view; roll still strafes', () => {
  const d = driver();
  d.hold(hands({ yaw: -0.6 }), 300);
  let i = d.input.read(d.time);
  assert.equal(i.cameraYaw, 0);
  assert.equal(i.forward, 0);
  assert.equal(i.strafe, 0);
  d.hold(hands({ yaw: 0.6 }), 300);
  assert.equal(d.input.read(d.time).cameraYaw, 0);
  d.hold(hands({ x: 0.5, y: -0.3 }), 300);
  i = d.input.read(d.time);
  assert.equal(i.forward, 0);
  assert.equal(i.strafe, 0);
  assert.equal(i.cameraYaw, 0);
  d.hold(hands({ roll: 0.5 }), 300);
  i = d.input.read(d.time);
  assert.ok(i.strafe < -0.5);
  assert.equal(i.cameraYaw, 0);
  assert.equal(i.forward, 0);
});
test('orientation and scale jitter inside dead zones do not drift the player or camera', () => {
  const d = driver();
  for (let k = 0; k < 40; k++) {
    const n = Math.sin(k);
    d.frame(hands({ x: n * 0.04, y: n * 0.04, push: n * 0.04, roll: n * 0.1, yaw: n * 0.1 }));
    const i = d.input.read(d.time);
    assert.equal(i.forward, 0);
    assert.equal(i.strafe, 0);
    assert.equal(i.cameraYaw, 0);
  }
});
test('a single hand-scale or orientation spike cannot launch movement', () => {
  const d = driver();
  d.frame(hands({ push: 0.7, roll: -0.7, yaw: -0.7 }));
  assert.equal(d.input.read(d.time).forward, 0);
  assert.equal(d.input.read(d.time).strafe, 0);
  assert.equal(d.input.read(d.time).cameraYaw, 0);
  d.hold(hands(), 300);
  assert.equal(d.input.read(d.time).forward, 0);
});
test('clipped fingertips keep a visible palm usable for a push', () => {
  const d = driver();
  const p = hands({ push: 0.5 });
  p.left.landmarks[12].y = -0.1;
  d.hold(p, 300);
  assert.ok(d.input.read(d.time).forward > 0.8);
  assert.equal(d.input.fingerRatio, null);
});
test('folding fingers and extending fingers alone cannot move forward or calibrate', () => {
  for (const settings of [{ fold: true }, { flatness: 0.25 }, { onlyFingers: 1.5 }]) {
    const d = driver();
    d.hold(hands(settings), 500);
    assert.equal(d.input.read(d.time).forward, 0);
    if (settings.fold || settings.flatness) {
      d.input.calibrate();
      d.hold(hands(settings), 2000);
      assert.equal(d.input.state, 'CALIBRATING');
      d.hold(hands(), 2000);
      assert.equal(d.input.state, 'ACTIVE');
    }
  }
});
for (const gap of [300, 1050, 10000])
  test(`${gap} ms loss resumes a visible held movement without a center visit`, () => {
    const d = driver();
    const session = d.input.sessionId,
      baseline = d.input.calibration;
    d.hold(hands({ push: 0.5, y: 0.4 }, { push: 0.4 }), 200);
    d.input.consumeActions(d.time);
    assert.equal(d.input.read(d.time + MOTION.staleMs).active, false);
    d.frame(hands({ push: 0.5, y: 0.4 }, { push: 0.4 }), gap);
    assert.equal(d.input.read(d.time).active, false);
    d.hold(hands({ push: 0.5, y: 0.4 }, { push: 0.4 }), 150);
    assert.equal(d.input.state, 'ACTIVE');
    assert.ok(d.input.read(d.time).forward > 0.8);
    assert.deepEqual(d.input.consumeActions(d.time), []);
    assert.equal(d.input.sessionId, session);
    assert.equal(d.input.calibration, baseline);
  });
test('a late result also recovers when the render read has not run', () => {
  const d = driver();
  d.frame(hands({ push: 0.4 }), 300);
  assert.equal(d.input.state, 'RECOVERING');
  d.hold(hands({ push: 0.4 }), 150);
  assert.equal(d.input.state, 'ACTIVE');
  assert.ok(d.input.read(d.time).forward > 0.7);
});
test('recovery needs only the hand being used, not both at their original positions', () => {
  const d = driver();
  d.frame(null);
  const p = hands({ push: 0.4, x: 0.35, y: 0.4 });
  p.right = null;
  d.hold(p, 200);
  assert.equal(d.input.state, 'ACTIVE');
  assert.ok(d.input.read(d.time).forward > 0.7);
  d.frame(null);
  const q = hands(undefined, { x: 0.3, y: 0.1 });
  q.left = null;
  d.hold(q, 200);
  assert.equal(d.input.state, 'ACTIVE');
  q.right = hands(undefined, { x: 0.3, y: 0.1, gun: true }).right;
  d.hold(q, 200);
  assert.equal(d.input.consumeActions(d.time)[0]?.action, 'attack');
});
test('repeated scheduling hiccups do not enter a neutral/recalibration trap', () => {
  const d = driver();
  const baseline = d.input.calibration;
  for (let k = 0; k < 5; k++) {
    d.frame(hands({ push: 0.4, y: 0.4 }), 300);
    assert.equal(d.input.state, 'RECOVERING');
    d.hold(hands({ push: 0.4, y: 0.4 }), 150);
    assert.ok(d.input.read(d.time).forward > 0.7);
    assert.equal(d.input.calibration, baseline);
  }
  assert.equal(d.input.briefInterruptions, 5);
});
test('pause blocks fresh frames until game focus resumes, then visible movement continues', () => {
  const d = driver();
  d.input.pause();
  d.hold(hands({ push: 0.4 }), 500);
  assert.equal(d.input.state, 'PAUSED');
  assert.equal(d.input.read(d.time).forward, 0);
  d.input.resume();
  d.hold(hands({ push: 0.4 }), 200);
  assert.equal(d.input.state, 'ACTIVE');
  assert.ok(d.input.read(d.time).forward > 0.7);
});
test('pause, recalibration and shutdown discard confirmed but unconsumed actions', () => {
  for (const method of ['pause', 'calibrate', 'stop']) {
    const d = driver();
    d.hold(hands(undefined, { gun: true }), 200);
    d.input[method]();
    assert.deepEqual(d.input.consumeActions(d.time), []);
  }
});
function leaveEdge(d, swapped = false) {
  const pose = hands({ push: 0.9, y: -0.35, yaw: -0.4 }, undefined, swapped);
  d.hold(pose, 350);
  assert.ok(d.input.read(d.time).forward > 0.8);
  pose[swapped ? 'right' : 'left'] = null;
  d.frame(pose);
  assert.equal(d.input.holdingMovement, true);
  return pose;
}
for (const swapped of [false, true])
  test(`swapped=${swapped}: edge holds translation 600ms then fades 300ms, never camera orbit`, () => {
    const d = driver(20, swapped);
    const missing = leaveEdge(d, swapped);
    assert.equal(d.input.read(d.time).forward, 1);
    assert.equal(d.input.read(d.time).cameraYaw, 0);
    d.hold(missing, 600);
    assert.equal(d.input.read(d.time).forward, 1);
    d.hold(missing, 150);
    assert.ok(Math.abs(d.input.read(d.time).forward - 0.5) < 1e-9);
    d.hold(missing, 150);
    assert.equal(d.input.read(d.time).forward, 0);
    assert.equal(d.input.state, 'ACTIVE');
  });
test('edge return accepts the hand immediately; neutral return stops without filter lag', () => {
  const d = driver(20);
  const missing = leaveEdge(d);
  d.hold(missing, 350);
  d.frame(hands());
  assert.equal(d.input.read(d.time).forward, 0);
  assert.equal(d.input.holdingMovement, false);
  d.hold(hands({ push: 0.4, roll: -0.4 }), 200);
  assert.ok(d.input.read(d.time).forward > 0.6);
  assert.ok(d.input.read(d.time).strafe > 0.4);
});
test('stale inference, both hands lost, pause, stop and recalibration all end edge holds', () => {
  for (const cause of ['stale', 'missing', 'pause', 'stop', 'calibrate']) {
    const d = driver(20);
    leaveEdge(d);
    if (cause === 'stale') d.input.read(d.time + 230);
    else if (cause === 'missing') d.frame(null);
    else d.input[cause]();
    assert.equal(d.input.read(d.time).forward, 0);
    assert.equal(d.input.holdingMovement, false);
    assert.deepEqual(d.input.consumeActions(d.time), []);
  }
});
test('cumulative camera strokes survive skipped renders, are consumed once and never turn an idle avatar', () => {
  for (const hz of [10, 15, 30, 60, 120]) {
    const navigation = new MotionNavigation();
    navigation.reset(0);
    let yaw = 0.8,
      pitch = 0;
    const p = {
      species: 'cro',
      gender: 'female',
      x: 0,
      z: 0,
      facing: 1.2,
      dx: 0,
      dz: 0,
      lastInput: 0,
      path: [],
      target: null,
    };
    const command = (t, x, y) => ({
      active: true,
      forward: 0,
      strafe: 0,
      cameraYaw: x,
      cameraPitch: y,
      cameraDragging: true,
      sampledAtMainMs: t,
      sessionId: 1,
    });
    navigation.step(command(0, 0, 0), 0);
    for (let n = 1; n <= hz * 1.3; n++) {
      const at = (n * 1000) / hz;
      const sample = Math.min(1000, Math.floor(at / 50) * 50);
      const nav = navigation.step(command(sample, sample * 0.0015, sample * -0.0005), at);
      yaw -= nav.cameraDelta;
      pitch += nav.cameraPitchDelta;
      Object.assign(p, movementFromCamera(nav.sx, nav.sy, yaw), { lastInput: at });
      movePlayer(p, 1 / hz, at);
    }
    assert.ok(Math.abs(yaw + 0.7) < 1e-10, `${hz} Hz yaw ${yaw}`);
    assert.ok(Math.abs(pitch + 0.5) < 1e-10);
    assert.equal(p.facing, 1.2);
    assert.equal(p.x, 0);
    assert.equal(p.z, 0);
  }
});
test('diagonal movement follows the view without accelerating or automatically moving it', () => {
  const nav = new MotionNavigation();
  nav.reset(0);
  const command = nav.step(
    {
      active: true,
      forward: 1,
      strafe: 1,
      cameraYaw: 0,
      cameraPitch: 0,
      cameraDragging: false,
      sampledAtMainMs: 50,
      sessionId: 1,
    },
    50,
  );
  assert.equal(command.cameraDelta, 0);
  for (const yaw of [0, 1.2, -2]) {
    const move = movementFromCamera(command.sx, command.sy, yaw);
    assert.ok(Math.abs(Math.hypot(move.dx, move.dz) - 1) < 1e-10);
    const forward = movementFromCamera(0, -1, yaw),
      right = movementFromCamera(1, 0, yaw);
    assert.ok(Math.abs(move.dx - (forward.dx + right.dx) / Math.sqrt(2)) < 1e-10);
    assert.ok(Math.abs(move.dz - (forward.dz + right.dz) / Math.sqrt(2)) < 1e-10);
  }
});

test('a single orientation spike on reacquisition cannot start camera orbit or strafing', () => {
  const d = driver();
  d.input.read(d.time + 230);
  d.frame(hands({ roll: -0.7, yaw: -0.7 }), 300);
  d.frame(hands());
  const i = d.input.read(d.time);
  assert.equal(i.strafe, 0);
  assert.equal(i.cameraYaw, 0);
});
test('a single downward wrist spike cannot retreat; a neutral wrist stops retreat immediately', () => {
  const d = driver();
  d.frame(hands({ y: 0.5 }));
  assert.equal(d.input.read(d.time).forward, 0);
  d.frame(hands());
  assert.equal(d.input.read(d.time).forward, 0);
  d.hold(hands({ y: 0.5 }), 250);
  assert.ok(d.input.read(d.time).forward < 0);
  d.frame(hands());
  assert.equal(d.input.read(d.time).forward, 0);
});
test('initial calibration still needs continuous stable open hands and preserves the chosen baseline', () => {
  const d = driver();
  d.input.calibrate();
  d.hold(hands(), 1000);
  d.frame(null);
  d.hold(hands(), 1000);
  assert.equal(d.input.state, 'CALIBRATING');
  d.frame(hands(), 300);
  assert.equal(d.input.calibrationProgress, 0);
  d.hold(hands(), 1700);
  assert.equal(d.input.state, 'ACTIVE');
  const baseline = d.input.calibration;
  d.hold(hands({ push: 0.5, y: 0.5 }), 1500);
  assert.equal(d.input.calibration, baseline);
  assert.ok(d.input.read(d.time).forward > 0.8);
});

test('right-hand camera remains independent while the left hand is missing and its edge hold expires', () => {
  const d = driver(20),
    missing = leaveEdge(d),
    nav = new MotionNavigation();
  nav.reset(d.time);
  nav.step(d.input.read(d.time), d.time);
  let yaw = 0;
  for (let k = 1; k <= 24; k++) {
    missing.right = hands(undefined, { x: k * 0.025 }).right;
    d.frame(missing);
    yaw += nav.step(d.input.read(d.time), d.time).cameraDelta;
  }
  assert.ok(yaw > 0.4);
  assert.equal(d.input.read(d.time).forward, 0);
  assert.equal(d.input.state, 'ACTIVE');
});
test('camera reacquisition anchors at the current hand, and loses its remaining blend immediately', () => {
  const d = driver(),
    nav = new MotionNavigation();
  nav.reset(d.time);
  nav.step(d.input.read(d.time), d.time);
  d.frame(hands(undefined, { x: 0.3, y: -0.2 }));
  const active = d.input.read(d.time);
  assert.ok(nav.step(active, d.time).cameraDelta > 0);
  const lost = hands();
  lost.right = null;
  d.frame(lost);
  const stopped = nav.step(d.input.read(d.time), d.time);
  assert.equal(stopped.cameraDelta, 0);
  assert.equal(stopped.cameraPitchDelta, 0);
  for (let k = 0; k < 5; k++) {
    d.frame(hands(undefined, { x: -0.5, y: 0.2 }));
    const fresh = nav.step(d.input.read(d.time), d.time);
    assert.equal(fresh.cameraDelta, 0);
    assert.equal(fresh.cameraPitchDelta, 0);
  }
  d.frame(hands(undefined, { x: -0.4, y: 0.1 }));
  assert.ok(nav.step(d.input.read(d.time), d.time).cameraDelta > 0);
});
test('returning from lowered retreat does not jump, and a raised hand after loss is not a new jump', () => {
  const d = driver();
  d.hold(hands({ y: 0.5 }), 350);
  d.hold(hands(), 350);
  assert.deepEqual(d.input.consumeActions(d.time), []);
  d.frame(hands({ y: -0.34 }));
  const missing = hands();
  missing.left = null;
  d.frame(missing);
  d.hold(hands({ y: -0.34 }), 350);
  assert.deepEqual(d.input.consumeActions(d.time), []);
  d.hold(hands(), 250);
  d.hold(hands({ y: -0.34 }), 300);
  assert.equal(d.input.consumeActions(d.time)[0].action, 'jump');
});
