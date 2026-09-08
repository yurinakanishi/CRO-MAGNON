import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput, PAD, STICK, readStick, combineMovement } from '../dist/src/gamepad-input.js';
import { movementFromCamera } from '../dist/shared/terrain.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { MovementCommands } from '../dist/src/combat-input.js';

const device = (overrides = {}) => ({
  id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  index: 2,
  connected: true,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  ...overrides,
});
function setup(mode = 'game') {
  const input = new GamepadInput(),
    pad = device();
  let time = 0;
  const sample = (nextMode = mode, elapsed = 16) =>
    input.sample([null, null, pad], nextMode, (time += elapsed));
  const press = (index, held = true) => {
    pad.buttons[index] = { pressed: held, value: held ? 1 : 0 };
  };
  sample();
  return { input, pad, sample, press };
}

test('stick drift is neutral and analog magnitude survives camera rotation and server movement', () => {
  assert.deepEqual(readStick(0.08, -0.1), { x: 0, y: 0, magnitude: 0 });
  assert.deepEqual(readStick(NaN, Infinity), { x: 0, y: 0, magnitude: 0 });
  for (const strength of [0.3, 0.5, 0.75, 1]) {
    const { pad, sample } = setup();
    pad.axes[1] = -strength;
    const { move } = sample();
    const magnitude = (strength - STICK.deadzone) / (1 - STICK.deadzone);
    assert.ok(Math.abs(Math.hypot(move.x, move.y) - magnitude) < 1e-10);
    for (const yaw of [0, 0.76, Math.PI / 2, Math.PI]) {
      const direction = movementFromCamera(move.x, move.y, yaw);
      const p = {
        x: 40,
        z: 50,
        ...direction,
        lastInput: 1000,
        target: null,
        runningRequested: move.running,
      };
      movePlayer(p, 0.1, 1000);
      const speed = move.running ? WORLD.runSpeed : WORLD.walkSpeed;
      assert.ok(Math.abs(Math.hypot(p.x - 40, p.z - 50) - magnitude * speed * 0.1) < 1e-10);
    }
  }
});

test('deep tilt runs immediately, hysteresis avoids chatter, and easing or releasing walks/stops', () => {
  const { pad, sample } = setup();
  for (const [tilt, running] of [
    [0.5, false],
    [0.77, false],
    [0.8, true],
    [0.74, true],
    [0.69, true],
    [0.67, false],
    [0.74, false],
    [1, true],
    [0, false],
  ]) {
    pad.axes[0] = tilt;
    assert.equal(sample().move.running, running, `tilt ${tilt}`);
  }
  // Neither a double flick nor L3 is a run toggle.
  for (let i = 0; i < 3; i++) {
    pad.axes[0] = 0;
    sample();
    pad.axes[0] = 0.5;
    pad.buttons[10] = { pressed: true, value: 1 };
    assert.equal(sample().move.running, false);
  }
});

test('diagonals are capped, including over-range device axes, and right stick never moves the player', () => {
  const { pad, sample } = setup();
  for (const [x, y] of [
    [1, 0],
    [0.71, -0.71],
    [1, 1],
    [20, -20],
  ]) {
    pad.axes = [x, y, 0, 0];
    const frame = sample();
    assert.ok(Math.hypot(frame.move.x, frame.move.y) <= 1 + 1e-10);
    assert.equal(frame.move.running, true);
  }
  pad.axes = [0, 0, 0.7, -0.5];
  const frame = sample();
  assert.deepEqual(frame.move, { x: 0, y: 0, running: false });
  assert.ok(frame.look.x > 0 && frame.look.y < 0);
});

test('mapped buttons fire once per press and simultaneous attack buttons produce one attack', () => {
  const { sample, press } = setup();
  for (const [button, action] of [
    [PAD.cross, 'confirm'],
    [PAD.circle, 'cancel'],
    [PAD.triangle, 'ride'],
    [PAD.options, 'menu'],
    [PAD.touchpad, 'map'],
    [PAD.share, 'map'],
    [PAD.l1, 'zoomOut'],
    [PAD.r1, 'zoomIn'],
    [PAD.r3, 'center'],
  ]) {
    press(button);
    assert.deepEqual(sample().actions, [action]);
    assert.deepEqual(sample().actions, []);
    press(button, false);
    sample();
  }
  press(PAD.square);
  press(PAD.r2);
  assert.deepEqual(sample().actions, ['attack']);
});

test('each face button confirms menus once per press without gameplay actions', () => {
  const { sample, press } = setup('menu');
  for (const button of [PAD.cross, PAD.circle, PAD.square, PAD.triangle]) {
    press(button);
    assert.deepEqual(sample().actions, ['confirm']);
    assert.deepEqual(sample('menu', 1000).actions, [], 'holding does not repeat a decision');
    press(button, false);
    sample();
  }
  for (const button of [PAD.r2, PAD.share, PAD.touchpad, PAD.l1, PAD.r1, PAD.r3]) {
    press(button);
    assert.deepEqual(sample().actions, [], 'other gameplay buttons do not activate a menu item');
    press(button, false);
    sample();
  }
  press(PAD.options);
  assert.deepEqual(sample().actions, ['menu']);
});

test('simultaneous face buttons produce one decision, including circle', () => {
  const { sample, press } = setup('menu');
  for (const button of [PAD.cross, PAD.circle, PAD.square, PAD.triangle]) press(button);
  assert.deepEqual(sample().actions, ['confirm']);
  assert.deepEqual(sample('menu', 1000).actions, []);
});

test('a held menu decision cannot activate the next screen or leak into gameplay', () => {
  for (const [button, gameplayAction] of [
    [PAD.cross, 'confirm'],
    [PAD.circle, 'cancel'],
    [PAD.square, 'attack'],
    [PAD.triangle, 'ride'],
  ]) {
    const { input, sample, press } = setup('menu');
    press(button);
    assert.deepEqual(sample().actions, ['confirm']);
    input.suspend(); // A second screen can have the same input mode.
    assert.deepEqual(sample().actions, []);
    assert.deepEqual(sample('game').actions, []);
    press(button, false);
    sample('game');
    press(button);
    assert.deepEqual(sample('game').actions, [gameplayAction]);
  }
});

test('menu and focus transitions consume held controls until neutral and never leak movement or attack', () => {
  const { pad, sample, press } = setup();
  pad.axes[0] = 1;
  press(PAD.square);
  assert.equal(sample().move.running, true);
  for (const mode of ['menu', 'blocked', 'game']) {
    const frame = sample(mode);
    assert.deepEqual(frame.move, { x: 0, y: 0, running: false });
    assert.deepEqual(frame.actions, []);
    assert.deepEqual(sample(mode).actions, []);
  }
  pad.axes[0] = 0;
  press(PAD.square, false);
  sample();
  press(PAD.square);
  assert.deepEqual(sample().actions, ['attack']);
});

test('connection, disconnection and index reuse require neutral controls, with null array slots supported', () => {
  const { input, pad, sample } = setup();
  pad.axes[0] = 1;
  assert.ok(sample().move.x);
  assert.equal(input.sample([], 'game', 50).status, 'disconnected');
  assert.equal(sample().move.x, 0);
  pad.axes[0] = 0;
  sample();
  pad.axes[0] = 1;
  assert.ok(sample().move.x);
  pad.id = 'Different controller';
  assert.equal(sample().move.x, 0);
});

test('unmapped or malformed devices do not guess the attack button and a second pad cannot hijack input', () => {
  const { input, pad, sample } = setup();
  for (const invalid of [
    device({ mapping: '' }),
    device({ axes: [0, 0] }),
    device({ buttons: [] }),
  ]) {
    assert.equal(input.sample([invalid], 'game', 0).status, 'unsupported');
  }
  sample();
  const second = device({ index: 3, axes: [1, 0, 0, 0] });
  const frame = input.sample([null, null, pad, second], 'game', 100);
  assert.equal(frame.index, 2);
  assert.equal(frame.move.x, 0);
});

test('menu navigation repeats after a delay; gameplay menu shortcuts do not repeat', () => {
  const { sample, press } = setup('menu');
  press(PAD.down);
  assert.equal(sample().navigation, 'down');
  assert.equal(sample('menu', 200).navigation, null);
  assert.equal(sample('menu', 180).navigation, 'down');
  assert.equal(sample('menu', 150).navigation, 'down');
  press(PAD.down, false);
  sample('game');
  press(PAD.down);
  assert.deepEqual(sample('game').actions, ['menu']);
  assert.deepEqual(sample('game', 1000).actions, []);
});

test('keyboard run toggles cannot make a shallow stick run or a deep stick walk', () => {
  const shallow = { x: 0.5, y: 0, running: false },
    deep = { x: 1, y: 0, running: true };
  assert.deepEqual(combineMovement(0, 0, true, shallow), shallow);
  assert.deepEqual(combineMovement(0, 0, false, deep), deep);
  assert.deepEqual(combineMovement(0, -1, false, deep), { x: 0, y: -1, running: false });
  assert.equal(
    combineMovement(0, 0, true, { x: 0, y: 0, running: false }).running,
    true,
    'map click run mode stays intact',
  );
});

test('releasing the stick emits a stop, while idle polling preserves a newly selected map route', () => {
  const commands = new MovementCommands();
  commands.next({ dx: 0.7, dz: 0, running: false });
  assert.deepEqual(commands.next({ dx: 0, dz: 0, running: false }), {
    type: 'move',
    dx: 0,
    dz: 0,
    running: false,
  });
  commands.reset();
  assert.equal(commands.next({ dx: 0, dz: 0, running: true }), null);
});
