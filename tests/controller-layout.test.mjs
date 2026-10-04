import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setControllerLayout, controllerMenuHint } from '../dist/src/controller-labels.js';
import { controlLabel, controllerDiagram } from '../dist/src/input-cues.js';
import { keyPrompts } from '../dist/src/screens.js';
import { mapScreen, mapEmptyPrompt } from '../dist/src/map-screen.js';
import { parseMultiplayerConfig } from '../dist/src/multiplayer-config.js';
import { GamepadInput } from '../dist/src/gamepad-input.js';
import { readSettings, readControllerLayout } from '../scripts/exhibition-config.mjs';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';

test('each controller uses its physical labels in the live diagram without changing input', () => {
  for (const [layout, right, bottom, left, top, trigger, menu] of [
    ['ps4', '○', '×', '□', '△', 'R2', 'OPTIONS'],
    ['switch-pro', 'A', 'B', 'Y', 'X', 'ZR', '＋'],
  ]) {
    setControllerLayout(layout);
    assert.equal(controlLabel('b1'), right);
    assert.equal(controlLabel('b2'), left);
    assert.equal(controlLabel('b7'), trigger);
    assert.equal(controlLabel('b3'), top);
    assert.equal(controlLabel('b0'), bottom);
    assert.ok(controllerMenuHint().includes(`${right} で決定 · ${bottom}（下のボタン）か ${menu}`));
    assert.deepEqual(keyPrompts(true), []);
    assert.deepEqual(keyPrompts(false), []);
    assert.deepEqual(keyPrompts(false, true), [
      { key: layout === 'ps4' ? 'SHARE / タッチパッド' : '−', label: '地図' },
    ]);
    const diagram = controllerDiagram(layout);
    assert.doesNotMatch(diagram, /W A S D|ESC/);
    assert.match(diagram, /data-pad-control="ls"/);
    assert.equal(mapEmptyPrompt(), '行き先を選ぶ');
    const map = mapScreen(() => '');
    assert.ok(map.includes('>ワープ</button>'));
    assert.ok(map.includes('>ここへ行こう</button>'));
    assert.ok(map.includes('4×'), 'zoom multiplier is not a controller label');
    assert.doesNotMatch(
      mapScreen(() => '', true),
      /<kbd>Enter<\/kbd>/,
    );
    if (layout === 'switch-pro') {
      assert.doesNotMatch(
        diagram.replace(/<[^>]*>/g, ''),
        /○|□|△|×|OPTIONS|SHARE|タッチパッド|DUALSHOCK|R[123]|L[12]/,
      );
      assert.doesNotMatch(map, /右スティック押し込み/);
    }
    for (const [mode, button, expected] of [
      ['game', 0, 'ride'],
      ['game', 1, 'confirm'],
      ['game', 2, 'attack'],
      ['game', 3, 'jump'],
      ['game', 7, 'attack'],
      ['game', 8, 'map'],
      ['game', 9, 'menu'],
      ['menu', 0, 'cancel'],
      ['menu', 1, 'confirm'],
      ['map', 0, 'cancel'],
      ['map', 2, 'pin'],
    ]) {
      const device = {
        id: layout,
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      const input = new GamepadInput();
      input.sample([device], mode, 0);
      device.buttons[button] = { pressed: true, value: 1 };
      assert.deepEqual(input.sample([device], mode, 20).actions, [expected]);
    }
  }
  setControllerLayout(undefined);
  assert.deepEqual(keyPrompts(true), []);
});

test('invalid profiles fail explicitly while older runtime configs retain PS4 labels', () => {
  assert.equal(parseMultiplayerConfig({ mode: 'online', serverUrl: '' }).controllerLayout, 'ps4');
  for (const controllerLayout of ['', null, 'switch', '<img>', '__proto__', 1]) {
    assert.throws(() => setControllerLayout(controllerLayout));
    assert.throws(() =>
      parseMultiplayerConfig({ mode: 'online', serverUrl: '', controllerLayout }),
    );
  }
});

test('PC1 and PC2 read independent labels and reload a local override without server restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-controller-labels-'));
  await writeFile(
    path.join(root, 'exhibition.env'),
    [
      'MULTIPLAYER_MODE=lan',
      'MULTIPLAYER_SERVER_URL=ws://10.10.10.1:8081',
      'CLIENT_PORT=4173',
      'EXHIBITION_ROOM=EXHIBITION',
      'OPEN_BROWSER=0',
      'PC1_CONTROLLER_LAYOUT=ps4',
      'PC2_CONTROLLER_LAYOUT=switch-pro',
    ].join('\n'),
  );
  assert.deepEqual((await readSettings(root, {})).controllerLayouts, {
    PC1: 'ps4',
    PC2: 'switch-pro',
  });
  const endpoints = [];
  for (const role of ['host', 'client']) {
    const client = createExhibitionClient({
      root,
      port: 0,
      config: { mode: 'lan', serverUrl: 'ws://10.10.10.1:8081', buildId: 'same-build' },
      getControllerLayout: () => readControllerLayout(root, role, {}),
    });
    t.after(() => client.close());
    const { port } = await client.listen();
    endpoints.push(`http://127.0.0.1:${port}`);
  }
  const layouts = async () =>
    Promise.all(
      endpoints.map(async (base) => {
        const response = await fetch(`${base}/multiplayer-config.json`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const config = parseMultiplayerConfig(await response.json());
        assert.equal(config.buildId, 'same-build');
        assert.equal(config.serverUrl, 'ws://10.10.10.1:8081');
        return config.controllerLayout;
      }),
    );
  assert.deepEqual(await layouts(), ['ps4', 'switch-pro']);
  await writeFile(path.join(root, 'exhibition.local.env'), 'PC2_CONTROLLER_LAYOUT=ps4');
  assert.deepEqual(await layouts(), ['ps4', 'ps4']);
  assert.equal(
    await readControllerLayout(root, 'client', { PC2_CONTROLLER_LAYOUT: 'switch-pro' }),
    'switch-pro',
  );
  await writeFile(path.join(root, 'exhibition.local.env'), 'PC2_CONTROLLER_LAYOUT=typo');
  assert.equal((await fetch(`${endpoints[1]}/multiplayer-config.json`)).status, 400);
  assert.equal((await fetch(`${endpoints[0]}/multiplayer-config.json`)).status, 200);
  assert.equal((await fetch(`${endpoints[1]}/api/status`)).status, 200);
  await assert.rejects(() => readSettings(root, {}));
  await assert.rejects(() => readControllerLayout(root, 'wrong-role', {}));
});
