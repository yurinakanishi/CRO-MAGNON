// Real Chrome and ordinary game UI. Only controller input and profile choices are fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const build =
  process.env.GAME_QA_BUILD ||
  new URL('../output/menu-navigation/preview/dist/', import.meta.url).href;
const { createGameServer } = await import(build + 'server.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || 'output/playwright/menu-directions-20260909';
await mkdir(output, { recursive: true });
const game = process.env.GAME_QA_URL ? null : createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game?.listen();
const url = process.env.GAME_QA_URL || `http://127.0.0.1:${address.port}/`;
const checks = [],
  errors = [];
let browser, page;
const passed = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const species = (value) => `#setup-form input[name="character"][value="${value}-${value === 'ape' ? 'male' : 'female'}"]`;
const item = (value) => `[data-controller-menu="${value}"]`;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Direction QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'room=MENU-DIR-QA');
  await page.waitForSelector('#title-start', { state: 'visible' });
  const input = async (buttons = [], axes = [0, 0, 0, 0]) => {
    await page.evaluate(
      async ({ buttons, axes }) => {
        window.qaPad.axes = axes;
        window.qaPad.buttons = window.qaPad.buttons.map((_, i) => ({
          pressed: buttons.includes(i),
          value: buttons.includes(i) ? 1 : 0,
        }));
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      },
      { buttons, axes },
    );
  };
  const tap = async (button) => {
    await input([button]);
    await input();
  };
  const stick = async (x, y) => {
    await input([], [x, y, 0, 0]);
    await input();
  };
  const focused = async (selector) =>
    assert.equal(
      await page.locator(selector).evaluate((el) => el === document.activeElement),
      true,
      `focus: ${selector}`,
    );
  // Establish the start of each independent directional check; all tested moves use real input handlers.
  const arm = async (selector) => {
    await page.keyboard.press('Tab');
    await page.locator(selector).focus();
    await input();
    await input([], [0, 0, 0.4, 0]);
    await input();
    await focused(selector);
  };
  await input();
  await arm('#title-start');
  await tap(PAD.up);
  await focused('#title-start');
  await tap(PAD.circle);
  await page.waitForSelector('#setup-submit', { state: 'visible' });
  passed('Title top edge stays put; circle confirms Start');

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const single = viewport.width <= 520;
    await arm(species('cro'));
    await tap(PAD.down);
    await focused(species(single ? 'nea' : 'cat'));
    await tap(PAD.up);
    await focused(species('cro'));
    await tap(PAD.right);
    await focused(species(single ? 'cro' : 'nea'));
    if (!single) {
      await tap(PAD.down);
      await focused(species('bear'));
      await tap(PAD.left);
      await focused(species('cat'));
    }
    await arm(species('cro'));
    await stick(0, 1);
    await focused(species(single ? 'nea' : 'cat'));
    await page.locator(species('cro')).focus();
    await page.keyboard.press('ArrowDown');
    await focused(species(single ? 'nea' : 'cat'));
    await page.keyboard.press('ArrowUp');
    await focused(species('cro'));
    await page.screenshot({ path: `${output}/setup-${viewport.width}x${viewport.height}.png` });
    passed(
      `Character cards: D-pad, left stick and keyboard follow the visible ${single ? 'one' : 'two'} columns at ${viewport.width}x${viewport.height}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#setup-form input[name="name"]').fill('Direction QA');
  await page.keyboard.press('ArrowLeft');
  await focused('#setup-form input[name="name"]');
  await arm('#setup-submit');
  await tap(PAD.square);
  await page.waitForSelector('#guide-start', { state: 'visible', timeout: 60000 });
  await arm('#guide-back');
  await tap(PAD.right);
  await focused('#guide-start');
  await tap(PAD.left);
  await focused('#guide-back');
  await tap(PAD.triangle);
  await page.waitForSelector('#setup-submit', { state: 'visible' });
  await arm('#setup-submit');
  await tap(PAD.cross);
  await page.waitForSelector('#guide-start', { state: 'visible', timeout: 60000 });
  await arm('#guide-start');
  await tap(PAD.circle);
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  passed(
    'Name editing remains native; guide buttons move horizontally, Back and all four decision buttons work',
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await tap(PAD.options);
    const single = viewport.width <= 520;
    await arm(item('inventory'));
    await tap(PAD.down);
    await focused(item(single ? 'map' : 'journal'));
    await tap(PAD.up);
    await focused(item('inventory'));
    await tap(PAD.right);
    await focused(item(single ? 'inventory' : 'map'));
    if (!single) {
      await tap(PAD.down);
      await focused(item('gulf'));
      await tap(PAD.left);
      await focused(item('journal'));
    }
    await arm(item('inventory'));
    await stick(0, 1);
    await focused(item(single ? 'map' : 'journal'));
    await page.keyboard.press('Tab');
    await page.locator(item('inventory')).focus();
    await page.keyboard.press('ArrowDown');
    await focused(item(single ? 'map' : 'journal'));
    await page.keyboard.press('ArrowUp');
    await focused(item('inventory'));
    await page.keyboard.press('ArrowRight');
    await focused(item(single ? 'inventory' : 'map'));
    await arm(item('inventory'));
    await tap(PAD.down);
    await page.screenshot({ path: `${output}/menu-${viewport.width}x${viewport.height}.png` });
    passed(
      `Pause menu: Down stays in its column, all four directions/left stick/keyboard work at ${viewport.width}x${viewport.height}`,
    );
    await arm(item('inventory'));
    await tap(PAD.square);
    await page.waitForSelector('#modal-craft');
    await arm('#modal-close');
    await tap(PAD.circle);
    assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
    await input();
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await tap(PAD.options);
  await arm(item('inventory'));
  await input([PAD.down]);
  await page.waitForTimeout(780);
  await input();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  const held = await page.evaluate(() => ({
    item: document.activeElement.dataset.controllerMenu,
    box: document.activeElement.getBoundingClientRect().toJSON(),
    headerBottom: document.querySelector('.modal-top').getBoundingClientRect().bottom,
  }));
  assert.ok(
    ['fishing', 'residents', 'help', 'ride', 'profile'].includes(held.item),
    JSON.stringify(held),
  );
  assert.ok(held.box.top >= held.headerBottom - 1 && held.box.bottom <= 390);
  await page.screenshot({ path: `${output}/held-down-scroll.png` });
  await arm('#modal-close');
  await tap(PAD.triangle);
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  passed('Held Down repeats vertically and scrolls the selected item into view below Back');
  await page.reload();
  await page.waitForSelector('#title-start', { state: 'visible' });
  await arm('#title-start');
  await tap(PAD.down);
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'title-start');
  passed('Navigation remains available after reload; no browser errors');
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        url,
        checks,
        errors,
        fixtures: [
          'Profile choices',
          'Gamepad API values',
          'DOM focus to set up independent navigation checks',
        ],
        physicalController: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ checks, errors, error: String(error), stack: error.stack }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await game?.close();
}
