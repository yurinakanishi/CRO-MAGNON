import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keyPrompts, guideMarkup } from '../dist/src/screens.js';

const root = new URL('../', import.meta.url);

test('button prompts follow the input device and the current mount options', () => {
  const keyboard = keyPrompts(false, { ride: false, boat: false });
  assert.deepEqual(
    keyboard.map((p) => p.key),
    ['E', 'F', 'Space', 'Enter', 'Tab', 'ESC'],
  );
  const pad = keyPrompts(true, { ride: true, boat: true });
  assert.deepEqual(
    pad.map((p) => p.key),
    ['○', '□', '×', '△', '△', 'L3', 'OPTIONS'],
  );
  assert.ok(!pad.some((p) => p.label === '話す'), 'chat needs a keyboard');
});

test('the pre-play guide shows PC and controller tabs, opening on the device in use', () => {
  const keyboard = guideMarkup({ gamepad: false, skipChecked: false });
  assert.match(keyboard, /W A S D/);
  assert.match(keyboard, /左スティック/);
  assert.match(keyboard, /data-help-tab="pc" aria-selected="true"/);
  assert.match(keyboard, /data-help-panel="pad" hidden/);
  assert.match(keyboard, /id="guide-start"/);
  assert.match(keyboard, /id="guide-skip"(?! checked)/);
  assert.doesNotMatch(keyboard, /石斧|最初の目標/, 'no starter objective in the guide');
  const pad = guideMarkup({ gamepad: true, skipChecked: true });
  assert.match(pad, /OPTIONS/);
  assert.match(pad, /data-help-tab="pad" aria-selected="true"/);
  assert.match(pad, /data-help-panel="pc" hidden/);
  assert.match(pad, /id="guide-skip" checked/);
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
