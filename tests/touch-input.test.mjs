import test from 'node:test';
import assert from 'node:assert/strict';
import {
  touchStick,
  touchActions,
  TouchCameraFollow,
  touchFieldOfView,
} from '../dist/src/touch-input.js';

test('thumb resting, radial clamp, diagonal movement and gait hysteresis', () => {
  assert.deepEqual(touchStick(0, 0, 40), { x: 0, y: 0, running: false });
  assert.deepEqual(touchStick(4, 4, 40), { x: 0, y: 0, running: false });
  const walk = touchStick(0, -22, 40);
  assert.ok(walk.y < 0 && walk.y > -1 && !walk.running);
  assert.equal(touchStick(0, -33, 40).running, true);
  assert.equal(touchStick(0, -28, 40, true).running, true);
  assert.equal(touchStick(0, -24, 40, true).running, false);
  const diagonal = touchStick(200, -200, 40);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
  assert.deepEqual(touchStick(NaN, 0, 40), { x: 0, y: 0, running: false });
});

test('touch can reach pet, interaction, boarding, throwing, recall and torch together', () => {
  const actions = touchActions({
    pet: '撫でる',
    interaction: '拾う',
    ride: '肩に乗る',
    board: '船に乗る',
    recall: true,
    throw: true,
    torch: '松明を持つ',
    inspect: '524',
  });
  assert.deepEqual(
    actions.map((a) => a.action),
    ['pet', 'interact', 'ride', 'board', 'inspect', 'recall', 'throw', 'torch'],
  );
  assert.deepEqual(touchActions({ busy: true, pet: '撫でる' }), [
    { action: 'cancel', label: 'やめる' },
  ]);
  assert.equal(
    touchActions({
      automaticCamera: true,
      inspect: '524',
      viewing: true,
      torch: '松明を持つ',
    }).some((a) => a.action === 'inspect'),
    false,
  );
});

test('touch camera yields throughout a swipe and its grace interval, resumes smoothly while moving', () => {
  const camera = new TouchCameraFollow();
  camera.enabled = true;
  camera.movement(1, 0);
  camera.hold(1000);
  assert.equal(camera.step(0, 2000, 0.016, false), 0);
  assert.equal(camera.step(0, 5000, 0.016, true), 0);
  const yaw = camera.step(0, 3300, 0.016, false);
  assert.ok(yaw < 0 && yaw > -0.1);
  camera.movement(0, 0);
  assert.equal(camera.step(yaw, 9000, 0.016, false), yaw);
  camera.reset();
  assert.equal(camera.step(yaw, 10000, 1, false), yaw);
});

test('touch camera follows across the angle wrap along the shorter arc', () => {
  const camera = new TouchCameraFollow();
  camera.enabled = true;
  camera.movement(-0.1, 1);
  const start = -Math.PI + 0.1,
    yaw = camera.step(start, 5000, 0.016, false);
  assert.ok(Math.abs(yaw - start) < 0.01);
});

test('portrait touch field of view widens without changing desktop or landscape framing', () => {
  assert.equal(touchFieldOfView(390 / 844, false), 57);
  assert.equal(touchFieldOfView(844 / 390, true), 57);
  assert.ok(touchFieldOfView(390 / 844, true) > 57);
  assert.ok(touchFieldOfView(320 / 900, true) <= 88);
});
