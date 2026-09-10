// Real Chrome and game server; only controller input is simulated.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const output = process.argv[2] || 'output/playwright/gamepad-menus-20260910';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen();
const checks = [],
  errors = [];
const faces = [PAD.cross, PAD.circle, PAD.square, PAD.triangle];
let browser, page;
const passed = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Menu QA');
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
  await page.goto(`http://127.0.0.1:${address.port}/?room=PAD-MENU-QA`);
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
  // Edges never wrap, so walk in one direction until the selection stops moving, then turn.
  const select = async (selector) => {
    const reached = () =>
      page
        .locator(selector)
        .evaluateAll((els) => els.some((el) => el.classList.contains('gamepad-focus')));
    const focusedId = () =>
      page.evaluate(() => {
        const el = document.querySelector('.gamepad-focus') ?? document.activeElement;
        return el ? el.id || el.dataset?.controllerMenu || el.getAttribute('value') || el.className : '';
      });
    const walk = [PAD.down, PAD.left, PAD.up, PAD.right, PAD.down, PAD.right, PAD.up, PAD.left];
    for (const direction of walk) {
      let previous = '';
      for (let i = 0; i < 30; i++) {
        if (await reached()) return;
        const current = await focusedId();
        if (current === previous && i > 0) break;
        previous = current;
        await tap(direction);
      }
    }
    if (await reached()) return;
    throw new Error(`Controller cannot reach ${selector}`);
  };
  const screen = () => page.locator('body').getAttribute('data-screen');
  await input();
  for (const face of faces) {
    await select('#title-start');
    await tap(face);
    assert.equal(await screen(), 'setup');
    await select('#setup-back');
    assert.equal(await page.locator('#setup-back').innerText(), '戻る');
    await tap(face);
    assert.equal(await screen(), 'title');
  }
  passed('All four face buttons open Start and activate the visible setup Back button');
  await select('#title-start');
  await input(faces);
  await page.waitForTimeout(600);
  assert.equal(await screen(), 'setup');
  assert.equal(
    [...game.rooms.values()].reduce((n, room) => n + room.players.size, 0),
    0,
  );
  await input();
  passed('Holding all four face buttons advances one screen and does not join automatically');

  await select('#setup-submit');
  await tap(PAD.circle);
  await page.waitForSelector('#guide-start', { state: 'visible', timeout: 60000 });
  await select('#guide-back');
  await tap(PAD.square);
  assert.equal(await screen(), 'setup');
  await select('#setup-submit');
  await tap(PAD.triangle);
  await page.waitForSelector('#guide-start', { state: 'visible', timeout: 60000 });
  await select('#guide-start');
  await tap(PAD.circle);
  assert.equal(await screen(), null);
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  passed('Guide Back returns to setup, and circle starts the adventure');
  const player = () => [...game.rooms.get('PAD-MENU-QA').players.values()][0];

  for (const face of faces) {
    await tap(PAD.options);
    await select('[data-controller-menu="inventory"]');
    await tap(face);
    assert.equal(await page.locator('#modal-craft').count(), 1);
    await select('#modal-close');
    assert.equal(await page.locator('#modal-close').innerText(), '戻る');
    const attack = player().attackSequence;
    await input([face]);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
    assert.equal(player().attackSequence, attack);
    assert.ok(!player().mountId && !player().boatId);
    await input();
  }
  passed('All four buttons open inventory and confirm Back; held presses do not attack or mount');

  // Keyboard users open the menu; pointer and keyboard users use the same visible Back button.
  await page.keyboard.press('Escape');
  await page.locator('#modal-close').click();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  await page.keyboard.press('Escape');
  await page.locator('#modal-close').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  await input();
  passed('Keyboard can open the menu and activate the visible Back button');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await tap(PAD.options);
    await select('[data-controller-menu="help"]');
    await tap(PAD.triangle);
    await input([], [0, 0, 0, 1]);
    await page.waitForTimeout(1200);
    await input();
    assert.ok(await page.locator('.pause-panels').evaluate((el) => el.scrollTop > 0));
    const back = await page.locator('#modal-close').evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        right: box.right,
        left: box.left,
        clickable: el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        ),
      };
    });
    assert.ok(back.top >= 0 && back.bottom <= viewport.height);
    assert.ok(back.left >= 0 && back.right <= viewport.width && back.clickable);
    await page.screenshot({
      path: `${output}/back-${viewport.width}x${viewport.height}.png`,
      animations: 'disabled',
    });
    await select('#modal-close');
    await tap(PAD.down);
    assert.ok(
      await page.locator('#modal-body').evaluate((body) => {
        const focused = document.activeElement;
        return (
          body.contains(focused) &&
          focused.getBoundingClientRect().top >=
            document.querySelector('.modal-top').getBoundingClientRect().bottom
        );
      }),
      'Menu focus stays below the sticky Back header',
    );
    await tap(PAD.up);
    await tap(PAD.circle);
  }
  passed('Back and focused menu items stay visible while help scrolls at 390×844 and 844×390');
  await tap(PAD.options);
  await select('[data-controller-menu="title"]');
  await tap(PAD.square);
  assert.equal(await screen(), 'title');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    // The title screen no longer prints key hints; the menu itself must fit instead.
    const hint = await page.locator('.title-menu').boundingBox();
    assert.ok(hint.x >= 0 && hint.x + hint.width <= viewport.width);
    assert.ok(hint.y >= 0 && hint.y + hint.height <= viewport.height);
    await page.screenshot({
      path: `${output}/title-${viewport.width}x${viewport.height}.png`,
      animations: 'disabled',
    });
  }
  assert.deepEqual(errors, []);
  passed('Title menu fits both mobile sizes; browser reports no errors');
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, errors, physicalController: false }, null, 2),
  );
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ checks, errors, failure: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await game.close();
}
