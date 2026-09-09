import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keyPrompts, guideMarkup } from '../dist/src/screens.js';

const root = new URL('../', import.meta.url);

test('button prompts follow the input device and the current mount options', () => {
  const keyboard = keyPrompts(false, { ride: false, boat: false });
  assert.deepEqual(
    keyboard.map((p) => p.key),
    ['E', 'F', 'Space', 'Enter', 'ESC'],
  );
  const pad = keyPrompts(true, { ride: true, boat: true });
  assert.deepEqual(
    pad.map((p) => p.key),
    ['×', '□', 'L2', '△', '△', 'OPTIONS'],
  );
  assert.ok(!pad.some((p) => p.label === '話す'), 'chat needs a keyboard');
});

test('the pre-play guide explains the device in use and the first objective', () => {
  const keyboard = guideMarkup({ gamepad: false, skipChecked: false });
  assert.match(keyboard, /W A S D/);
  assert.match(keyboard, /id="guide-start"/);
  assert.match(keyboard, /id="guide-skip"(?! checked)/);
  assert.match(keyboard, /石斧/);
  const pad = guideMarkup({ gamepad: true, skipChecked: true });
  assert.match(pad, /左スティック/);
  assert.match(pad, /OPTIONS/);
  assert.match(pad, /id="guide-skip" checked/);
  assert.doesNotMatch(pad, /W A S D/);
});

test('the game opens on a title screen and only joins after Start or ?autostart=1', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  assert.match(main, /id="screen-title"/);
  assert.match(main, /id="title-start"/);
  assert.match(main, /id="setup-form"/);
  assert.match(main, /query\.get\('autostart'\) === '1'/);
  assert.match(main, /\} else showTitle\(\);\s*$/);
  assert.doesNotMatch(main, /\nconnect\(\);\s*$/);
  assert.doesNotMatch(main, /class="brand"/, 'no persistent web-app brand header');
  assert.doesNotMatch(main, /data-panel=/, 'no top navigation dock');
});
