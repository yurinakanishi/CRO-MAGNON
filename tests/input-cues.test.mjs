import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contextCues, pressedControls, controllerDiagram } from '../dist/src/input-cues.js';
import {
  detectControllerLayout,
  setControllerLayout,
  setConnectedController,
  controllerKind,
  controllerLabels,
} from '../dist/src/controller-labels.js';

test('context only suggests one meaning for the shared bottom button', () => {
  for (const pet of ['りもねこを撫でる', '524を撫でる', 'maeを撫でる', 'botたちを撫でる']) {
    const context = {
      pet,
      interaction: '木材を採集する',
      board: '船に乗る',
      ride: '肩に乗る',
      jump: true,
    };
    const pad = contextCues(context, true);
    assert.deepEqual(
      pad.filter((cue) => cue.controls.includes('b0')).map((cue) => cue.action),
      ['pet'],
    );
    assert.equal(pad.find((cue) => cue.action === 'interact').controls[0], 'b1');
    assert.ok(contextCues(context, false).some((cue) => cue.action === 'board' && cue.key === 'B'));
  }
  assert.deepEqual(contextCues({}, true), []);
  assert.deepEqual(contextCues({ busy: true, pet: '撫でる' }, false), []);
  assert.deepEqual(
    contextCues({ busy: true, pet: '撫でる' }, true).map((c) => c.controls),
    [['b6']],
  );
});

test('nearby companions offer a direct closeup and inspection shows matching zoom and return controls', () => {
  for (const pad of [false, true]) {
    const cues = contextCues({ inspect: 'りもねこ', pet: 'りもねこを撫でる', jump: true }, pad);
    assert.equal(cues.find((c) => c.action === 'inspect').label, 'りもねこを見る');
    assert.equal(cues.find((c) => c.action === 'inspect').key, 'X');
    assert.deepEqual(cues.find((c) => c.action === 'inspect').controls, ['b5']);
    const viewing = contextCues(
      { viewing: true, inspect: 'りもねこ', pet: '撫でる', jump: true },
      pad,
    );
    assert.deepEqual(
      viewing.map((c) => c.action),
      ['zoomIn', 'zoomOut', 'endInspect'],
    );
    assert.deepEqual(
      viewing.map((c) => c.controls),
      [['b5'], ['b4'], ['b11', 'b6']],
    );
  }
});

test('deployed companions and food needs take priority over a generic jump hint', () => {
  assert.deepEqual(
    contextCues({ recall: true, throw: true, needsFood: true, jump: true }, false).map((c) => [
      c.action,
      c.key,
    ]),
    [
      ['recall', 'Q'],
      ['throw', 'C'],
      ['bag', 'I'],
    ],
  );
  assert.deepEqual(
    contextCues({ jump: true }, true).map((c) => c.controls),
    [['b3']],
  );
  assert.ok(
    contextCues({ torch: '松明をしまう' }, true).length === 0,
    'no invented pad torch binding',
  );
});

test('a nearby invitation keeps the whistle visible among the three contextual actions', () => {
  for (const pad of [false, true]) {
    const cues = contextCues(
      {
        recall: true,
        pet: '撫でる',
        inspect: 'りもねこ',
        interaction: '採集する',
        attack: true,
        jump: true,
      },
      pad,
    );
    assert.equal(cues.length, 3);
    assert.deepEqual(cues.find((c) => c.action === 'recall').controls, ['b12']);
  }
});

test('device detection is client-local and exhibition configuration can override it', () => {
  for (const [id, kind] of [
    ['Nintendo Switch Pro Controller (Vendor: 057e)', 'switch-pro'],
    ['Wireless Controller (Vendor: 054c)', 'ps4'],
    ['DualSense Wireless Controller', 'ps4'],
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox'],
    ['Xbox Wireless Controller (XInput)', 'xbox'],
    ['Unidentified USB Gamepad', 'generic'],
  ]) {
    assert.equal(detectControllerLayout(id), kind);
    setConnectedController(id);
    assert.equal(controllerKind(), kind);
    const svg = controllerDiagram(kind);
    for (const control of ['ls', 'rs', ...Array.from({ length: 16 }, (_, i) => `b${i}`)])
      assert.equal(svg.split(`data-pad-control="${control}"`).length - 1, 1, control);
    assert.match(svg, /viewBox="0 0 340 238"/);
  }
  setControllerLayout('switch-pro');
  setConnectedController('Unidentified USB Gamepad', true);
  assert.equal(controllerLabels().rightTrigger, 'ZR');
  setConnectedController(null);
  setControllerLayout('ps4');
});

test('button, trigger and stick feedback respects deadzones and does not accept unmapped devices', () => {
  const pad = {
    id: 'Pro Controller',
    connected: true,
    mapping: 'standard',
    index: 0,
    axes: [0.1, -0.1, 0.15, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  };
  assert.deepEqual([...pressedControls(pad)], []);
  pad.axes = [0.8, 0, 0, -0.9];
  pad.buttons[7].value = 0.7;
  pad.buttons[0].pressed = true;
  assert.deepEqual([...pressedControls(pad)], ['b0', 'b7', 'ls', 'rs']);
  assert.deepEqual([...pressedControls({ ...pad, mapping: '' })], []);
  assert.deepEqual([...pressedControls(null)], []);
});

test('menu manuals and expandable world explanations are removed at the source', async () => {
  for (const file of [
    'main',
    'orb-bot-ui',
    'gulf-ui',
    'coastal-ui',
    'fishing-ui',
    'maritime-ui',
    'crop-food-ui',
  ]) {
    const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /helpTabsMarkup|openHelp|title-howto|<summary>この世界|gulf-lore|コントローラーの下ボタン|C ／ 左スティック押し込み/,
    );
  }
});
