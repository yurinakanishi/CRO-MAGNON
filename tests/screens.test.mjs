import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keyPrompts } from '../dist/src/screens.js';
import { helpTabsMarkup } from '../dist/src/help-content.js';

const root = new URL('../', import.meta.url);

test('button prompts follow the input device and never repeat a contextual button', async () => {
  assert.deepEqual(keyPrompts(false), [{ key: 'ESC', label: 'メニュー' }]);
  assert.deepEqual(keyPrompts(true), [{ key: 'OPTIONS', label: 'メニュー' }]);
  // 2026-09-21: riding and boarding are announced once, by their own key-labelled button.
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const boat = await readFile(new URL('src/boat-ui.ts', root), 'utf8');
  assert.doesNotMatch(main + boat, /を押すと(マンモス|船)に乗れます/);
  assert.doesNotMatch(main + boat, /[R×B] ?で(降りる|降ろす|肩に乗る)|岸で [B×]/);
  assert.match(main, /\$\('#riding-hint'\)\.hidden = !ridingHint/);
  assert.match(boat, /\$\('#boat-hint'\)\.hidden = !hint/);
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

test('the mage recharge is a continuous bar without a numbered countdown', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  assert.match(main, /id="magic-cooldown-progress"/);
  assert.match(main, /magicCooldownProgress\.value = metered \? cooldownLeft : 0/);
  assert.doesNotMatch(main, /魔法 あと|Math\.ceil\(cooldownLeft/);
  assert.match(css, /#magic-cooldown progress/);
});

test('pause tab focus stays inside the scrollport for keyboard and controller navigation', async () => {
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  const rule = css.match(
    /\.pause-tab\.gamepad-focus,\s*\.pause-tab:focus-visible\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(rule, 'both input devices share the pause-tab focus rule');
  assert.match(rule, /outline: 3px solid #[\da-f]+ !important/);
  assert.match(rule, /outline-offset: -3px !important/);
  assert.match(
    rule,
    /box-shadow: none !important/,
    'the global outside controller halo must not leak back in',
  );
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

test('setup asks character → difficulty → final はい with no fixed launch button', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const flow = await readFile(new URL('src/setup-flow.ts', root), 'utf8');
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  assert.match(main, /bindSetupFlow\(\{/);
  assert.match(main, /difficultySettingsMarkup\(\)/);
  assert.match(main, /data-difficulty=/);
  assert.match(main, /type: 'difficulty'/);
  assert.match(main, /cro-difficulty/);
  assert.match(main, /敵の動きと攻撃時間は(?:仲間)?全員で共通です/);
  assert.doesNotMatch(main, /setup-submit|この谷へ出発する|difficultyChoicesMarkup/);
  assert.match(flow, /難易度はどれにしますか/);
  assert.match(flow, /これでいいですか/);
  assert.match(flow, /data-choose-difficulty=/);
  assert.doesNotMatch(flow, /\.description/, 'difficulty buttons show only the label');
  assert.match(flow, /id="setup-flow-yes"[^>]*type="submit"/);
  assert.match(css, /\.setup-flow-choices/);
  assert.doesNotMatch(css, /\.difficulty-choice-grid|\.setup-launch/);
});

test('the atlas is a full-bleed canvas with a pointer, a small card and zoom controls, without toolbar or list', async () => {
  const { mapScreen, mapEmptyPrompt } = await import('../dist/src/map-screen.js');
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
  assert.match(html, new RegExp(mapEmptyPrompt()));
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
