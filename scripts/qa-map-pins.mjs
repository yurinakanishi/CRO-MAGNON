import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = 'output/playwright/map-pins';
await mkdir(output, { recursive: true });
const core = createGameCore();
const game = createGameServer({ core, host: '127.0.0.1', port: 0 });
const address = await game.listen();
const url = `http://127.0.0.1:${address.port}/?room=PIN-QA`;
const errors = [],
  checks = [];
const passed = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => errors.push(e.stack || String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(
      (name) => {
        localStorage.setItem('cro-name', name);
        localStorage.setItem('cro-skip-guide', '1');
        window.qaPinPad = {
          id: 'Wireless Controller',
          index: 0,
          connected: true,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
        };
        Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPinPad] });
      },
      `Pin QA ${i + 1}`,
    );
    await page.goto(url);
    await page.locator('#title-start').click();
    await page.locator('#setup-submit').click();
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 90000,
    });
  }
  const [page, other] = pages;
  const room = core.rooms.get('PIN-QA');
  const positions = [...room.players.values()].map((p) => ({
    id: p.id,
    x: p.x,
    z: p.z,
    inventory: { ...p.inventory },
  }));
  await page.keyboard.press('m');
  const map = page.locator('#big-map');
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.35, y: box.height * 0.45 } });
  assert.equal((room.mapPins ?? []).length, 0);
  assert.equal(await page.locator('#map-warp').isDisabled(), true);
  await page.locator('#map-pin-send').click();
  await other.waitForFunction(
    () => document.querySelector('#minimap')?.dataset.mapPinCount === '1',
  );
  assert.ok((await other.locator('body').innerText()).includes('Pin QA 1：ここへ行こう'));
  await other.keyboard.press('m');
  await other.waitForSelector('[data-map-pin-id]');
  assert.equal(await other.locator('[data-map-pin-id]').count(), 1);
  await other.locator('[data-map-pin-id]').click();
  await other.screenshot({ path: `${output}/friend-desktop.png` });
  passed(
    'Map click selects without sending; confirmation reaches a second browser with named notice, map and minimap pin',
  );
  const firstId = room.mapPins[0].id;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.up();
  assert.equal(room.mapPins[0].id, firstId);
  await page.locator('#map-pin-center').click();
  await page.waitForFunction(() => !document.querySelector('#map-pin-send').disabled);
  await page.locator('#map-pin-send').focus();
  await page.keyboard.press('Enter');
  await other.waitForFunction(
    (old) => document.querySelector('[data-map-pin-id]')?.dataset.mapPinId !== old,
    firstId,
  );
  assert.equal(room.mapPins.length, 1);
  passed('Drag does not send; keyboard confirms center point and replaces the previous pin');
  await other.locator('#map-pin-center').click();
  await other.locator('#map-pin-send').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-map-pin-id]').length === 2);
  await page.locator('#map-pin-clear').click();
  await other.waitForFunction(() => document.querySelectorAll('[data-map-pin-id]').length === 1);
  assert.equal(room.mapPins[0].name, 'Pin QA 2');
  passed('Each player owns a separate pin; clear removes only the sender pin');
  // Controller API is the only input fixture; clicks/focus use ordinary UI handlers.
  await page.bringToFront();
  await page.waitForFunction(() => !document.querySelector('#map-pin-send').disabled);
  await page.keyboard.press('Tab');
  await page.locator('#map-pin-center').focus();
  const tap = async () => {
    for (const down of [true, false])
      await page.evaluate(async (down) => {
        window.qaPinPad.buttons[0] = { pressed: down, value: Number(down) };
        for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
      }, down);
  };
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
  });
  await tap();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'map-pin-send');
  await tap();
  await other.waitForFunction(() => document.querySelectorAll('[data-map-pin-id]').length === 2);
  passed('Simulated controller confirm selects and shares a center pin');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#map-pin-center').click();
    await page.waitForFunction(() => !document.querySelector('#map-pin-send').disabled);
    await page.locator('#map-pin-send').click();
    assert.equal(
      await page.locator('.atlas').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    const sendBox = await page.locator('#map-pin-send').boundingBox();
    assert.ok(
      sendBox.x >= 0 &&
        sendBox.x + sendBox.width <= width + 1 &&
        sendBox.y >= 0 &&
        sendBox.y + sendBox.height <= height + 1,
    );
    await page.screenshot({ path: `${output}/${width}x${height}.png` });
  }
  passed('Shared pin actions fit and send at phone portrait and landscape sizes');
  assert.deepEqual(
    [...room.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      inventory: { ...p.inventory },
    })),
    positions,
  );
  assert.deepEqual(errors, []);
  passed('Player positions and inventories unchanged; browser errors zero');
  await writeFile(`${output}/summary.json`, JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser?.close();
  await game.close();
}
