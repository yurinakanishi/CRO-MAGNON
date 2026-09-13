import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keyPrompts } from '../dist/src/screens.js';
import { helpTabsMarkup } from '../dist/src/help-content.js';

const root = new URL('../', import.meta.url);

test('button prompts follow the input device and the current mount options', () => {
  const keyboard = keyPrompts(false, { ride: false, boat: false });
  assert.deepEqual(
    keyboard.map((p) => p.key),
    ['ESC'],
  );
  const pad = keyPrompts(true, { ride: true, boat: true });
  assert.deepEqual(
    pad.map((p) => p.key),
    // 2026-09-12: jump on the top face button, mount / boat on the bottom one.
    ['×', '×', 'OPTIONS'],
  );
  assert.ok(!pad.some((p) => p.label === '話す'), 'chat needs a keyboard');
});

test('there is no pre-play tutorial; the help dialog keeps both device tabs', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const screens = await readFile(new URL('src/screens.ts', root), 'utf8');
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  assert.doesNotMatch(main, /screen-guide|guideMarkup|cro-skip-guide|showGuide|finishGuide/);
  assert.doesNotMatch(screens, /guideMarkup|'guide'/);
  assert.doesNotMatch(css, /\.guide-/);
  assert.match(main, /openHelp/, 'the help dialog stays reachable in game');
  const help = helpTabsMarkup('pc');
  assert.match(help, /W A S D/);
  assert.match(help, /左スティック/);
  assert.match(help, /data-help-tab="pc" aria-selected="true"/);
  assert.match(helpTabsMarkup('pad'), /data-help-tab="pad" aria-selected="true"/);
});

test('the interaction hint is a hidden text line that only names a real nearby action', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  assert.match(main, /id="interaction-hint" hidden><kbd>E<\/kbd><span><\/span>/);
  assert.doesNotMatch(main, /近くのものを調べる/);
  assert.match(main, /\$\('#interaction-hint'\)\.hidden = !target/);
  assert.match(main, /range: GATHER_RANGE/);
  assert.match(main, /renderer\.resourceVisible\?\.\(r\.id\)/);
  const help = await readFile(new URL('src/help-content.ts', root), 'utf8');
  assert.doesNotMatch(help, /近くのものを調べる/);
});

test('the map button, M and SHARE toggle the atlas closed when it is already open', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  assert.match(
    main,
    /function openMap\(\) \{\s*if \(\$\('#modal'\)\.open && \$\('#big-map'\)\) \{\s*\$\('#modal'\)\.close\(\);/,
  );
  assert.match(main, /\$\('#map-button'\)\.onclick = openMap/);
  assert.match(main, /if \(k === 'm'\) openMap\(\)/);
  assert.match(main, /case 'map':\s*openMap\(\)/);
  assert.match(main, /frame\.actions\.includes\('map'\) \? openMap\(\)/);
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

test('setup and in-game settings both offer easy, normal and hard difficulty', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  assert.match(main, /difficultyChoicesMarkup\(\)/);
  assert.match(main, /difficultySettingsMarkup\(\)/);
  assert.match(main, /data-difficulty=/);
  assert.match(main, /type: 'difficulty'/);
  assert.match(main, /cro-difficulty/);
  assert.match(css, /\.difficulty-choice-grid/);
});

test('the atlas is a full-bleed canvas with a pointer, a small card and zoom controls, without toolbar or list', async () => {
  const { mapScreen, MAP_EMPTY_PROMPT } = await import('../dist/src/map-screen.js');
  const html = mapScreen((name) => `<i class="icon-${name}"></i>`);
  for (const id of [
    'big-map',
    'warp-map-points',
    'map-self',
    'map-cursor',
    'map-card',
    'map-region',
    'map-destination',
    'map-selection',
    'map-warp',
    'map-warp-status',
    'map-pin-send',
    'map-pin-clear',
    'map-pin-status',
    'map-zoom-in',
    'map-zoom-level',
    'map-zoom-out',
    'map-center',
  ])
    assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, new RegExp(MAP_EMPTY_PROMPT));
  assert.match(html, /id="map-warp"[^>]*>○ ワープ<kbd>Enter<\/kbd>/);
  assert.match(html, /id="map-center"[^>]*>現在地へ<kbd>R3<\/kbd>/);
  for (const removed of [
    'earth-map-toolbar',
    'map-overview',
    'map-gulf',
    'map-local',
    'map-details',
    'map-pin-center',
    'map-list',
    'map-clusters',
    'data-map-pan',
    'earth-travel',
  ])
    assert.doesNotMatch(html, new RegExp(removed), `${removed} is gone`);
});
