import test from 'node:test';
import assert from 'node:assert/strict';
import {
  touchStick,
  touchActions,
  touchLayout,
  touchSkillSlots,
  touchIcon,
  touchWeaponIcon,
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
  // The player's one companion is thrown and called back by name-free labels.
  assert.equal(actions.find((a) => a.action === 'recall').label, '呼び戻す');
  assert.equal(actions.find((a) => a.action === 'throw').label, '投げる');
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

test('the phone shows at most three prompts, nearest-the-thumb first; abilities keep fixed slots', () => {
  const crowded = touchLayout({
    pet: '撫でる',
    interaction: '木材を採集する',
    ride: 'マンモスに乗る',
    board: '船に乗る',
    inspect: '524',
    recall: true,
    throw: true,
    cook: '肉を焼く',
  });
  assert.deepEqual(
    crowded.prompts.map((a) => a.action),
    ['pet', 'interact', 'cook'],
  );
  assert.deepEqual(
    crowded.skills.map((a) => a.action),
    ['recall', 'throw'],
  );
  assert.deepEqual(
    [...touchSkillSlots(crowded.skills)],
    [
      ['recall', 'far'],
      ['throw', 'near'],
    ],
  );
  // A cave allows only the torch, which takes the place nearest the thumb.
  const cave = touchLayout({ torch: '松明を消す', recall: true, interaction: '焚き火で暖まる' });
  assert.deepEqual(
    [...touchSkillSlots(cave.skills)],
    [
      ['recall', 'far'],
      ['torch', 'near'],
    ],
  );
  assert.deepEqual(
    cave.prompts.map((a) => a.action),
    ['interact'],
  );
  assert.deepEqual(
    [...touchSkillSlots([{ action: 'throw' }, { action: 'torch' }, { action: 'recall' }])].map(
      ([, slot]) => slot,
    ),
    ['near', 'far', 'high'],
  );
  // Each hotbar button reaches the phone when it can be used; ride and boarding stay reachable.
  assert.deepEqual(
    touchLayout({ launch: '船を出す', recover: '船を回収', board: '船に乗る' }).prompts.map(
      (a) => a.action,
    ),
    ['board', 'recover', 'launch'],
  );
  assert.deepEqual(
    touchLayout({ ride: '肩に乗る', decline: '断る' }).prompts.map((a) => a.action),
    ['ride', 'decline'],
  );
  // A task or a close-up view offers only its own controls.
  assert.deepEqual(touchLayout({ busy: true, cook: '肉を焼く', recall: true }), {
    prompts: [{ action: 'cancel', label: 'やめる' }],
    skills: [],
  });
  assert.deepEqual(
    touchLayout({ viewing: true, inspect: '524', launch: '船を出す' }).prompts.map((a) => a.action),
    ['endInspect'],
  );
  assert.deepEqual(touchLayout({ jump: true, attack: true }), { prompts: [], skills: [] });
});

test('every touch action and weapon has a glyph; targets come from the label', () => {
  for (const [label, glyph] of [
    ['木材を採集する', 'wood'],
    ['黒曜石を採掘する', 'stone'],
    ['ベリーを採集する', 'berry'],
    ['焚き火に資材を届ける', 'flame'],
    ['貝を探す', 'shell'],
    ['村人と話す', 'hand'],
  ])
    assert.equal(touchIcon('interact', label), glyph, label);
  assert.equal(touchIcon('ride', 'マンモスに乗る'), 'mammoth');
  assert.equal(touchIcon('ride', 'たろうを担ぐ'), 'people');
  for (const action of [
    'pet',
    'board',
    'launch',
    'recover',
    'cook',
    'decline',
    'inspect',
    'recall',
    'throw',
    'torch',
    'cancel',
    'zoomIn',
    'zoomOut',
    'endInspect',
  ])
    assert.notEqual(touchIcon(action), 'hand', action);
  for (const weapon of ['spear', 'katana', 'magic', 'science', 'unarmed', 'tentacle'])
    assert.equal(touchWeaponIcon(weapon), weapon);
  assert.equal(touchWeaponIcon('obsidianSpear'), 'spear');
  assert.equal(touchWeaponIcon(undefined), 'spear');
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
