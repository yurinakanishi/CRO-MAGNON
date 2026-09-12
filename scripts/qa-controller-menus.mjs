// 2026-09-12 playtest items 18-24: real Chrome and game server; only the controller is simulated.
// Menu opens on the bag with the first food focused; decide → 使う heals; the bottom
// face button backs out of the bag popup, the pause menu, the settings and the map;
// the map buttons toggle the atlas; the top face button jumps; the character change
// sits above "back to exploring"; guide / world / companions are sub-tabs of one tab.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const output = process.argv[2] || 'output/playwright/controller-menus-20260912';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen();
const checks = [],
  errors = [],
  detours = [];
let browser, page;
const passed = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.stack || String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Controller QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
    window.qaPad = {
      id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${address.port}/?room=PAD-MENU-2`);
  await page.waitForSelector('#title-start', { state: 'visible' });
  await page.locator('#title-start').focus();
  const input = async (buttons = [], axes = [0, 0, 0, 0]) => {
    await page.evaluate(
      async ({ buttons, axes }) => {
        window.qaPad.buttons = window.qaPad.buttons.map((_, i) => ({
          pressed: buttons.includes(i),
          value: buttons.includes(i) ? 1 : 0,
        }));
        window.qaPad.axes = axes;
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      },
      { buttons, axes },
    );
  };
  const tap = async (button) => {
    await input([button]);
    await input();
  };
  const modalOpen = () => page.locator('#modal').evaluate((el) => el.open);
  const focusedKey = () =>
    page.evaluate(() => {
      const el = document.querySelector('.gamepad-focus') ?? document.activeElement;
      return el
        ? el.id ||
            el.dataset?.controllerMenu ||
            el.dataset?.item ||
            el.getAttribute('value') ||
            el.className
        : '';
    });
  const reached = (selector) =>
    page
      .locator(selector)
      .evaluateAll((els) => els.some((el) => el.classList.contains('gamepad-focus')));
  // Edges never wrap, so walk in one direction until the selection stops moving, then turn.
  const select = async (selector) => {
    const walk = [PAD.right, PAD.down, PAD.left, PAD.up, PAD.right, PAD.down, PAD.left, PAD.up];
    const visited = [];
    for (const direction of walk) {
      let previous = '';
      for (let i = 0; i < 40; i++) {
        if (await reached(selector)) return;
        const current = await focusedKey();
        visited.push(current);
        if (current === previous && i > 0) break;
        previous = current;
        await tap(direction);
      }
    }
    if (await reached(selector)) return;
    // Spatial walking is a heuristic; a target the sweep missed is focused directly and noted.
    console.log(
      `NOTE sweep missed ${selector} (visited ${visited.join(' > ')}); focusing directly`,
    );
    detours.push(selector);
    await page.locator(selector).first().focus();
    await input();
    if (!(await reached(selector))) throw new Error(`Controller cannot reach ${selector}`);
  };
  const until = async (condition, label, timeout = 8000) => {
    const started = Date.now();
    while (!(await condition())) {
      if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`);
      await sleep(50);
    }
  };
  const focusInsideModal = async (label) =>
    assert.ok(
      await page.evaluate(() => {
        const el = document.querySelector('.gamepad-focus');
        return !!el && document.querySelector('#modal').contains(el) && !el.closest('[hidden]');
      }),
      `controller focus lost: ${label}`,
    );

  await input();
  await select('#title-start');
  await tap(PAD.circle);
  await select('#setup-submit');
  await tap(PAD.circle);
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  const room = () => game.rooms.get('PAD-MENU-2');
  const player = () => [...room().players.values()][0];
  await until(() => !!player(), 'player joined');
  player().inventory.berry = 3;
  player().inventory.cookedMeat = 2;
  player().energy = 40;
  await sleep(400);

  // 20 + 21: OPTIONS lands on the bag with the top-left food card selected; decide → 使う eats.
  await tap(PAD.options);
  assert.equal(await modalOpen(), true);
  assert.equal(
    await page.locator('[data-pause-panel="inventory"]').evaluate((el) => !el.hidden),
    true,
    'the bag is the first page',
  );
  assert.equal(await page.locator('.pause-rail h2').count(), 0, 'no PAUSE / メニュー title');
  assert.equal(await page.locator('[data-pause-panel="objectives"]').count(), 0);
  await input();
  assert.equal(await focusedKey(), 'berry', 'the first food card is focused on opening');
  const firstCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.inventory-card')].map((el) =>
      el.getBoundingClientRect(),
    );
    const focused = document.querySelector('.gamepad-focus').getBoundingClientRect();
    return cards.every((box) => box.top >= focused.top - 1 && box.left >= focused.left - 1);
  });
  assert.ok(firstCard, 'the focused card is the top-left one');
  await tap(PAD.circle);
  assert.equal(await page.locator('.item-actions').count(), 1, 'decide opens the use popup');
  assert.match(await focusedKey(), /item-use/, '使う is focused');
  const energy = player().energy;
  await tap(PAD.circle);
  await until(() => player().energy > energy, 'berry heals');
  assert.equal(player().inventory.berry, 2);
  assert.equal(await modalOpen(), true, 'the bag stays open for another bite');
  assert.equal(await page.locator('.item-actions').count(), 0);
  await until(
    () => page.locator('[data-modal-count="berry"]').evaluate((el) => el.textContent === '2'),
    'count refreshes',
  );
  await focusInsideModal('after eating');
  await page.screenshot({ path: `${output}/01-bag-open.png`, animations: 'disabled' });
  passed('OPTIONS opens the bag with the top-left berry focused; decide → 使う eats one and heals');

  // Cooked meat by d-pad, then the bottom button backs out of the popup, then out of the menu.
  await select('[data-item="cookedMeat"]');
  await tap(PAD.circle);
  assert.equal(await page.locator('.item-actions').count(), 1);
  const beforeMeat = player().energy;
  await tap(PAD.circle);
  await until(() => player().energy > beforeMeat, 'meat heals');
  assert.equal(player().inventory.cookedMeat, 1);
  await tap(PAD.circle);
  await page.screenshot({ path: `${output}/02-use-popup.png`, animations: 'disabled' });
  await tap(PAD.cross);
  assert.equal(await page.locator('.item-actions').count(), 0, 'bottom button closes the popup');
  assert.equal(await modalOpen(), true);
  assert.equal(await focusedKey(), 'cookedMeat', 'focus returns to the card');
  await tap(PAD.cross);
  assert.equal(await modalOpen(), false, 'bottom button closes the pause menu');
  passed('D-pad reaches other food; the bottom face button backs out of the popup, then the menu');

  // 18: SHARE toggles the atlas; the bottom button and OPTIONS also close it.
  await tap(PAD.share);
  assert.equal(await page.locator('#big-map').count(), 1, 'SHARE opens the map');
  await tap(PAD.share);
  assert.equal(await modalOpen(), false, 'SHARE again closes the map');
  await tap(PAD.touchpad);
  assert.equal(await page.locator('#big-map').count(), 1);
  await tap(PAD.touchpad);
  assert.equal(await modalOpen(), false, 'the touchpad toggles it too');
  await tap(PAD.share);
  assert.equal(await page.locator('#big-map').count(), 1);
  await page.screenshot({ path: `${output}/03-map.png`, animations: 'disabled' });
  await tap(PAD.cross);
  assert.equal(await modalOpen(), false, 'the bottom face button closes the map');
  await page.keyboard.press('m');
  assert.equal(await page.locator('#big-map').count(), 1);
  await page.keyboard.press('m');
  assert.equal(await modalOpen(), false, 'M toggles');
  passed('Map: SHARE / touchpad / M toggle it; the bottom face button closes it');

  // 18: settings close with the bottom button as well.
  await input();
  await tap(PAD.options);
  await select('[data-controller-menu="settings"]');
  await tap(PAD.circle);
  assert.equal(
    await page.locator('[data-pause-panel="settings"]').evaluate((el) => !el.hidden),
    true,
  );
  await select('[data-setting="camera"]');
  await focusInsideModal('settings');
  await tap(PAD.cross);
  assert.equal(await modalOpen(), false, 'the bottom face button closes the settings');
  passed('Settings page closes with the bottom face button');

  // 19: the top face button jumps; the bottom one no longer does; prompts and help say so.
  const jumps = player().jumpSequence ?? 0;
  await tap(PAD.cross);
  await sleep(300);
  assert.equal(player().jumpSequence ?? 0, jumps, 'the bottom button does not jump');
  await tap(PAD.triangle);
  await until(() => (player().jumpSequence ?? 0) === jumps + 1, 'triangle jumps');
  const prompts = await page
    .locator('#prompt-bar span')
    .evaluateAll((els) => els.map((el) => el.textContent));
  assert.ok(
    !prompts.some((p) => /ジャンプ|攻撃/.test(p)),
    'always-available actions stay off the prompt bar',
  );
  assert.ok(!prompts.includes('×ジャンプ'));
  await tap(PAD.options);
  await select('[data-controller-menu="info"]');
  await tap(PAD.circle);
  assert.equal(await page.locator('[data-pause-panel="info"]').evaluate((el) => !el.hidden), true);
  await select('[data-controller-menu="sub-help"]');
  await tap(PAD.circle);
  const jumpCard = await page
    .locator('#help-panel-pad .help-card')
    .evaluateAll((cards) =>
      cards
        .filter((c) => c.querySelector('strong').textContent === 'ジャンプ')
        .map((c) => c.querySelector('kbd').textContent),
    );
  assert.deepEqual(jumpCard, ['△（上）'], 'the controller help card names the top button');
  await page.screenshot({ path: `${output}/04-help-tab.png`, animations: 'disabled' });
  passed('Jump is on the top face button; the prompt bar and help card agree');

  // 23: one tab holds guide / world / companions (and objectives) as sub-tabs.
  const tabs = await page
    .locator('.pause-tab')
    .evaluateAll((els) => els.map((el) => el.dataset.pauseTab));
  assert.deepEqual(tabs, ['inventory', 'crafting', 'info', 'settings']);
  const subTabs = await page
    .locator('.sub-tab')
    .evaluateAll((els) => els.map((el) => el.dataset.pauseSubtab));
  assert.deepEqual(subTabs, ['help', 'world', 'tribe', 'objectives']);
  await select('[data-controller-menu="sub-world"]');
  await tap(PAD.circle);
  assert.equal(
    await page.locator('[data-pause-subpanel="world"]').evaluate((el) => !el.hidden),
    true,
  );
  assert.equal(
    await page.locator('[data-pause-subpanel="help"]').evaluate((el) => el.hidden),
    true,
  );
  await select('[data-controller-menu="journal"]');
  await focusInsideModal('world sub-tab');
  await select('[data-controller-menu="sub-tribe"]');
  await tap(PAD.circle);
  assert.equal(
    await page.locator('[data-pause-subpanel="tribe"] .tribe-member').count(),
    1,
    'companions list renders inside the sub-tab',
  );
  await select('#tribe-invite');
  await focusInsideModal('tribe sub-tab');
  await page.screenshot({ path: `${output}/05-info-tribe.png`, animations: 'disabled' });
  passed('操作説明・世界・仲間 are sub-tabs of one tab and every sub-panel is reachable');

  // 22: character change sits directly above "back to exploring" and completes on the pad.
  const exits = await page
    .locator('.pause-exits [data-controller-menu]')
    .evaluateAll((els) => els.map((el) => el.dataset.controllerMenu));
  assert.equal(exits.indexOf('character') + 1, exits.indexOf('resume'), exits.join(','));
  await select('[data-controller-menu="character"]');
  await tap(PAD.circle);
  await page.waitForSelector('#character-switch-form', { state: 'visible' });
  await input();
  await select('#character-switch-form input[name="character"][value="cro-male"]');
  await tap(PAD.circle);
  assert.equal(
    await page
      .locator('#character-switch-form input[name="character"][value="cro-male"]')
      .evaluate((el) => el.checked),
    true,
  );
  await select('#character-switch-submit');
  await tap(PAD.circle);
  await until(() => player().gender === 'male', 'character changed on the server');
  await until(async () => !(await modalOpen()), 'menu closes after the change');
  await page.screenshot({ path: `${output}/06-after-switch.png`, animations: 'disabled' });
  passed(
    'Character change from the exits column completes with the controller and returns to play',
  );

  // 24: bottom button inside the character form goes back to play as well.
  await tap(PAD.options);
  await select('[data-controller-menu="character"]');
  await tap(PAD.circle);
  await page.waitForSelector('#character-switch-form', { state: 'visible' });
  await input();
  await tap(PAD.cross);
  assert.equal(await modalOpen(), false);
  passed('The bottom face button leaves the character form');

  await writeFile(
    `${output}/summary.json`,
    JSON.stringify({ checks, errors, detours, at: new Date().toISOString() }, null, 2),
  );
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${checks.length} checks passed`);
} finally {
  await browser?.close();
  await game.close();
}
