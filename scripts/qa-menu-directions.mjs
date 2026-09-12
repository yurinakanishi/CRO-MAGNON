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
const output = process.argv[2] || 'output/playwright/menu-directions-20260910';
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
const species = (value) =>
  `#setup-form input[name="character"][value="${value}-${value === 'ape' ? 'male' : 'female'}"]`;
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
  await focused('#title-fullscreen');
  await tap(PAD.up);
  await focused('#title-fullscreen');
  await arm('#title-start');
  await tap(PAD.circle);
  await page.waitForSelector('#setup-submit', { state: 'visible' });
  passed(
    'Title: Up reaches the fullscreen toggle and stops at the top edge; circle confirms Start',
  );

  // Character cards: seven in a row on a PC, four columns at 1000px and below, two at 430px and below.
  const card = (value) => `#setup-form input[name="character"][value="${value}"]`;
  const field = (name) => `#setup-form input[name="${name}"]`;
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const columns = viewport.width <= 430 ? 2 : viewport.width <= 1000 ? 4 : 7;
    // Below the first card: the next row, or the Back button once the row holds every card.
    const belowFirst =
      columns === 7 ? '#setup-back' : card(columns === 4 ? 'cat-female' : 'nea-female');
    const belowSecond =
      columns === 7 ? '#setup-submit' : card(columns === 4 ? 'bear-female' : 'nea-male');
    // The identity fields stack at phone width, so the room field sits right above the cards.
    const above = field(viewport.width <= 640 ? 'room' : 'name');
    await arm(card('cro-female'));
    await tap(PAD.down);
    await focused(belowFirst);
    await tap(PAD.up);
    await focused(card('cro-female'));
    await tap(PAD.up);
    await focused(above);
    await arm(card('cro-female'));
    await tap(PAD.right);
    await focused(card('cro-male'));
    await tap(PAD.down);
    await focused(belowSecond);
    await tap(PAD.up);
    // The wide launch button climbs back to the card nearest its centre.
    await focused(card(columns === 7 ? 'nea-male' : 'cro-male'));
    await arm(card('cro-male'));
    await tap(PAD.left);
    await focused(card('cro-female'));
    await arm(card('cro-female'));
    await stick(0, 1);
    await focused(belowFirst);
    await page.locator(card('cro-female')).focus();
    await page.keyboard.press('ArrowDown');
    await focused(belowFirst);
    await page.keyboard.press('ArrowUp');
    await focused(card('cro-female'));
    await page.screenshot({ path: `${output}/setup-${viewport.width}x${viewport.height}.png` });
    passed(
      `Character cards: D-pad, left stick and keyboard follow the visible ${columns} columns at ${viewport.width}x${viewport.height}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#setup-form input[name="name"]').fill('Direction QA');
  await page.keyboard.press('ArrowLeft');
  await focused('#setup-form input[name="name"]');
  await arm('#setup-submit');
  await tap(PAD.square);
  // 2026-09-12: the start tutorial was removed; the decision button joins directly.
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  passed('Name editing remains native and the decision button starts the adventure directly');

  // Pause menu: a vertical tab rail on a PC, a horizontal tab strip at 860px and below.
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await tap(PAD.options);
    const rail = viewport.width > 860;
    // 2026-09-12: three tabs (bag, info, settings); below the strip sits the character change.
    const belowStrip = 'character';
    await arm(item('inventory'));
    await tap(PAD.down);
    await focused(item(rail ? 'crafting' : belowStrip));
    await tap(PAD.up);
    // In landscape, the centre of the wide exit is beneath the crafting tab.
    await focused(item(viewport.width === 844 ? 'crafting' : 'inventory'));
    await arm(item('inventory'));
    if (rail) {
      await tap(PAD.down);
      await tap(PAD.down);
      await tap(PAD.down);
      await focused(item('settings'));
      await tap(PAD.up);
      await focused(item('info'));
    } else {
      await tap(PAD.right);
      await focused(item('crafting'));
      await tap(PAD.left);
      await focused(item('inventory'));
    }
    await arm(item('inventory'));
    await stick(0, 1);
    await focused(item(rail ? 'crafting' : belowStrip));
    await page.keyboard.press('Tab');
    await page.locator(item('inventory')).focus();
    await page.keyboard.press('ArrowDown');
    await focused(item(rail ? 'crafting' : belowStrip));
    await page.keyboard.press('ArrowUp');
    await focused(item(viewport.width === 844 ? 'crafting' : 'inventory'));
    if (!rail) {
      await page.locator(item('inventory')).focus();
      await page.keyboard.press('ArrowRight');
      await focused(item('crafting'));
    }
    await page.screenshot({ path: `${output}/menu-${viewport.width}x${viewport.height}.png` });
    passed(
      `Pause menu: tabs follow the ${rail ? 'vertical rail' : 'horizontal strip'}; D-pad, left stick and keyboard agree at ${viewport.width}x${viewport.height}`,
    );
    // Selecting the inventory tab shows its panel; the panel's buttons become reachable.
    await arm(item('inventory'));
    await tap(PAD.square);
    assert.equal(
      await page.locator('[data-pause-panel="inventory"]').evaluate((el) => !el.hidden),
      true,
    );
    await page.waitForSelector('.inventory-grid', { state: 'visible' });
    await arm('#modal-close');
    await tap(PAD.circle);
    assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
    await input();
  }

  // Keyboard: Enter selects a tab, ESC closes the menu, and the closed dialog leaves the screen.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  await page.locator(item('settings')).focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.locator('[data-pause-panel="settings"]').evaluate((el) => !el.hidden),
    true,
  );
  await page.keyboard.press('ArrowRight');
  assert.ok(
    await page.evaluate(() =>
      document.querySelector('[data-pause-panel="settings"]').contains(document.activeElement),
    ),
    'Right from the settings tab enters the settings panel',
  );
  await page.locator(item('info')).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-pause-panel="info"]').evaluate((el) => !el.hidden), true);
  await page.locator(item('sub-world')).focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.locator('[data-pause-subpanel="world"]').evaluate((el) => !el.hidden),
    true,
  );
  await page.locator(item('journal')).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.pause-menu').count(), 0, 'Enter opens the journal');
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  assert.equal(await page.locator('#modal').evaluate((el) => getComputedStyle(el).display), 'none');
  await page.keyboard.press('Escape');
  // 2026-09-12: the menu always reopens on the bag.
  assert.equal(
    await page.locator('.pause-tab[aria-selected="true"]').getAttribute('data-pause-tab'),
    'inventory',
  );
  await page.locator('#modal-close').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  passed(
    'Keyboard: Enter picks a tab and a panel button, ESC/Enter on Back close and hide the dialog, the bag is always first',
  );

  // Held Down repeats through the rail and the right stick scrolls the panel, keeping Back visible.
  await page.setViewportSize({ width: 844, height: 390 });
  // A dialog closed by keyboard waits for a neutral controller frame before new presses count.
  await input();
  await tap(PAD.options);
  await arm(item('info'));
  await tap(PAD.square);
  await arm(item('sub-help'));
  await tap(PAD.square);
  await input([], [0, 0, 0, 1]);
  await page.waitForTimeout(1200);
  await input();
  assert.ok(await page.locator('.pause-panels').evaluate((el) => el.scrollTop > 0));
  await arm(item('sub-objectives'));
  await input([PAD.down]);
  await page.waitForTimeout(780);
  await input();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  const held = await page.evaluate(() => ({
    item: document.activeElement.dataset.controllerMenu ?? document.activeElement.className,
    box: document.activeElement.getBoundingClientRect().toJSON(),
    back: document.querySelector('#modal-close').getBoundingClientRect().toJSON(),
  }));
  assert.notEqual(held.item, 'sub-objectives', JSON.stringify(held));
  assert.ok(held.box.top >= 0 && held.box.bottom <= 390, JSON.stringify(held));
  assert.ok(held.back.top >= 0 && held.back.bottom <= 390 && held.back.right <= 844);
  await page.screenshot({ path: `${output}/held-down-scroll.png` });
  await arm('#modal-close');
  await tap(PAD.triangle);
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  passed(
    'Held Down repeats, the right stick scrolls the panel, and Back stays on screen at 844x390',
  );
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
