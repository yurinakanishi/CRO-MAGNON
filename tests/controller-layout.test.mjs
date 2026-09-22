import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setControllerLayout, controllerMenuHint } from '../dist/src/controller-labels.js';
import { padHelp, helpTabsMarkup, PC_HELP } from '../dist/src/help-content.js';
import { keyPrompts } from '../dist/src/screens.js';
import { mapScreen, mapEmptyPrompt } from '../dist/src/map-screen.js';
import { parseMultiplayerConfig } from '../dist/src/multiplayer-config.js';
import { GamepadInput } from '../dist/src/gamepad-input.js';
import { readSettings, readControllerLayout } from '../scripts/exhibition-config.mjs';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';

test('each controller uses its physical labels in help, menus and the map without changing input', () => {
  const keyboard = JSON.stringify(PC_HELP);
  for (const [layout, right, bottom, left, top, trigger, menu] of [
    ['ps4', '○', '×', '□', '△', 'R2', 'OPTIONS'],
    ['switch-pro', 'A', 'B', 'Y', 'X', 'ZR', '＋'],
  ]) {
    setControllerLayout(layout);
    const cards = padHelp();
    assert.equal(cards.find((card) => card.title === '調べる・採集').key, right);
    assert.equal(cards.find((card) => card.title === '攻撃').key, `${left} / ${trigger}`);
    assert.equal(cards.find((card) => card.title === 'ジャンプ').key, `${top}（上）`);
    assert.equal(cards.find((card) => card.title.startsWith('撫でる')).key, `${bottom}（下）`);
    assert.ok(controllerMenuHint().includes(`${right} で決定 · ${bottom}（下のボタン）か ${menu}`));
    assert.equal(keyPrompts(true)[0].key, menu);
    assert.equal(keyPrompts(false)[0].key, 'ESC');
    assert.ok(mapEmptyPrompt().endsWith(right));
    const map = mapScreen(() => '');
    assert.ok(map.includes(`${right} ワープ`));
    assert.ok(map.includes(`${left} ここへ行こう`));
    assert.ok(map.includes('4×'), 'zoom multiplier is not a controller label');
    if (layout === 'switch-pro') {
      assert.doesNotMatch(
        helpTabsMarkup('pad'),
        /○|□|△|×|OPTIONS|SHARE|タッチパッド|DUALSHOCK|R[123]|L[12]/,
      );
      assert.match(map, /右スティック押し込み/);
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
  assert.equal(JSON.stringify(PC_HELP), keyboard);
  setControllerLayout(undefined);
  assert.equal(keyPrompts(true)[0].key, 'OPTIONS');
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
