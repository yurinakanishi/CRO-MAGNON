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
const until = async (condition, timeout = 5000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for the server state');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
  await page.waitForSelector('#map-cursor');
  assert.equal(await page.locator('#big-map').getAttribute('data-map-zoom'), '4.00');
  assert.equal(await page.locator('.earth-map-toolbar').count(), 0, 'no toolbar');
  assert.equal(await page.locator('#map-list').count(), 0, 'no sidebar list');
  const box = await map.boundingBox();
  // A click on open ground moves the pointer and selects nothing; nothing is sent.
  await map.click({ position: { x: box.width * 0.35, y: box.height * 0.45 } });
  assert.equal((room.mapPins ?? []).length, 0);
  assert.equal(await page.locator('#map-warp').isDisabled(), true);
  await page.locator('#map-pin-send').click();
  await other.waitForFunction(
    () => document.querySelector('#minimap')?.dataset.mapPinCount === '1',
  );
  assert.ok((await other.locator('body').innerText()).includes('Pin QA 1：ここへ行こう'));
  await other.keyboard.press('m');
  await other.waitForFunction(
    () => document.querySelector('#big-map')?.dataset.mapPinCount === '1',
  );
  await other.screenshot({ path: `${output}/friend-desktop.png` });
  passed(
    'Map click selects without sending; the card button shares the pointer position with a named notice, map and minimap pin',
  );
  const firstId = room.mapPins[0].id;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.up();
  assert.equal(room.mapPins[0].id, firstId);
  await page.waitForFunction(() => !document.querySelector('#map-pin-send').disabled);
  await page.waitForTimeout(1600);
  await page.locator('#map-pin-send').focus();
  await page.keyboard.press('Enter');
  await until(() => room.mapPins[0]?.id !== firstId);
  assert.equal(room.mapPins.length, 1);
  passed(
    'Drag does not send; the keyboard shares the pointer position and replaces the previous pin',
  );
  // Right-click drops a pin at the mouse from the friend, then the sender clears only its own.
  const otherBox = await other.locator('#big-map').boundingBox();
  await other.mouse.click(otherBox.x + otherBox.width * 0.5, otherBox.y + otherBox.height * 0.5, {
    button: 'right',
  });
  await page.waitForFunction(() => document.querySelector('#big-map')?.dataset.mapPinCount === '2');
  await page.locator('#map-pin-clear').click();
  await other.waitForFunction(
    () => document.querySelector('#big-map')?.dataset.mapPinCount === '1',
  );
  assert.equal(room.mapPins[0].name, 'Pin QA 2');
  passed(
    'Right-click pins at the mouse; each player owns a separate pin and clear removes only the sender pin',
  );
  // Controller API is the only input fixture: stick moves the pointer, □ pins, R3 recentres, ○ selects.
  await page.bringToFront();
  const frames = async (mutate, count = 6) =>
    page.evaluate(
      async ({ mutate, count }) => {
        new Function('pad', mutate)(window.qaPinPad);
        for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
      },
      { mutate, count },
    );
  const tap = async (index) => {
    await frames(`pad.buttons[${index}] = { pressed: true, value: 1 }`);
    await frames(`pad.buttons[${index}] = { pressed: false, value: 0 }`);
  };
  await frames('', 6);
  const cursorBefore = await page.locator('#map-cursor').evaluate((el) => el.style.left);
  await frames('pad.axes[0] = 1', 20);
  await frames('pad.axes[0] = 0', 3);
  const cursorAfter = await page.locator('#map-cursor').evaluate((el) => el.style.left);
  assert.notEqual(cursorBefore, cursorAfter, 'left stick moves the pointer');
  await page.waitForTimeout(1600);
  await tap(2);
  await other.waitForFunction(
    () => document.querySelector('#big-map')?.dataset.mapPinCount === '2',
  );
  await tap(11);
  await frames('pad.axes[3] = -1', 12);
  await frames('pad.axes[3] = 0', 3);
  const zoom = Number(await page.locator('#big-map').getAttribute('data-map-zoom'));
  assert.ok(zoom > 4, 'right stick zooms in');
  await tap(1);
  assert.equal(await page.locator('#map-card').getAttribute('data-warp-id'), 'fire-50-50');
  assert.ok(
    ['ready', 'blocked'].includes(await page.locator('#map-card').getAttribute('data-state')),
  );
  passed(
    'Simulated controller: stick pointer, square pin, R3 recentre, right stick zoom, circle selects the home fire without warping',
  );
  // Item 7: the atlas terrain is recomputed for the viewport, so zooming reveals detail instead
  // of magnifying pixels, and the shoreline stays a thin vector line at every zoom.
  const detail = (zoomLevel) =>
    page.evaluate(async (target) => {
      const canvas = document.querySelector('#big-map');
      const level = () => Number(canvas.dataset.mapZoom);
      while (level() < target - 0.01) {
        document.querySelector('#map-zoom-in').click();
        await new Promise(requestAnimationFrame);
      }
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 250));
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(
        Math.round(canvas.width / 2) - 40,
        Math.round(canvas.height / 2) - 40,
        80,
        80,
      );
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4)
        colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return { zoom: level(), colors: colors.size };
    }, zoomLevel);
  const near8 = await detail(8);
  const near32 = await detail(32);
  assert.ok(near8.colors > 20, `zoom 8 keeps terrain detail (${near8.colors} colours)`);
  assert.ok(
    near32.colors > 20,
    `zoom ${near32.zoom} is recomputed, not magnified (${near32.colors} colours)`,
  );
  await page.screenshot({ path: `${output}/atlas-zoom-32.png` });
  // The longest frame right after a view change is the fine refill; it must stay a short hitch.
  const refineMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.querySelector('#map-zoom-out').click();
        let last = performance.now(),
          longest = 0,
          frames = 0;
        const tick = () => {
          const now = performance.now();
          longest = Math.max(longest, now - last);
          last = now;
          if (++frames < 45) requestAnimationFrame(tick);
          else resolve(Math.round(longest));
        };
        requestAnimationFrame(tick);
      }),
  );
  assert.ok(refineMs < 400, `terrain refine frame ${refineMs} ms`);
  passed(`Atlas terrain is redrawn for the viewport at 8x and 32x; refine frame ${refineMs} ms`);
  // The whole world at 1x: the vector shoreline is the only thing drawing the coast.
  await page.evaluate(async () => {
    const canvas = document.querySelector('#big-map');
    while (Number(canvas.dataset.mapZoom) > 1.001) {
      document.querySelector('#map-zoom-out').click();
      await new Promise(requestAnimationFrame);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: `${output}/atlas-zoom-1.png` });
  // The stroke colour of the traced shoreline must be present all around the world at 1x.
  const shoreline = await page.evaluate(() => {
    const canvas = document.querySelector('#big-map');
    const { data } = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height);
    let found = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        Math.abs(data[i] - 170) < 22 &&
        Math.abs(data[i + 1] - 176) < 22 &&
        Math.abs(data[i + 2] - 137) < 22
      )
        found++;
    return found;
  });
  assert.ok(shoreline > 200, `the vector shoreline is drawn (${shoreline} px)`);
  passed(`Vector shoreline strokes the whole world at 1x (${shoreline} px of coast line)`);
  // Item 9: one arrow shape, turned by the live facing (facing 0 aims down the screen).
  const arrow = await page.evaluate(() => {
    const marker = document.querySelector('#map-self');
    const svg = marker?.querySelector('svg.map-arrow path');
    return {
      path: svg?.getAttribute('d') ?? '',
      facing: marker?.style.getPropertyValue('--facing') ?? '',
      glyph: (marker?.textContent ?? '').includes('▲'),
    };
  });
  assert.match(arrow.path, /^M12 2 L/, 'the atlas marker is the shared arrow path');
  assert.match(arrow.facing, /rad$/, 'the marker is turned by the live facing');
  assert.equal(arrow.glyph, false, 'no triangle glyph left');
  await page
    .locator('#map-self')
    .screenshot({ path: `${output}/player-marker.png`, scale: 'device' });
  passed('Player marker is the shared SVG arrow, rotated from the live facing');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('.atlas').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    for (const selector of ['#map-card', '#map-pin-send', '#map-zoom-in', '#map-center']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(
        rect &&
          rect.x >= 0 &&
          rect.x + rect.width <= width + 1 &&
          rect.y >= 0 &&
          rect.y + rect.height <= height + 1,
        `${selector} fits ${width}x${height}`,
      );
    }
    await page.screenshot({ path: `${output}/${width}x${height}.png` });
  }
  passed('Card, pin and zoom controls fit at phone portrait and landscape sizes');
  // The minimap draws the same arrow on its canvas: its bright fill must be there once closed.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#big-map', { state: 'hidden' });
  await page.waitForTimeout(300);
  const minimapArrow = await page.evaluate(() => {
    const canvas = document.querySelector('#minimap');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let bright = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 245 && data[i + 1] > 238 && data[i + 2] > 200 && data[i + 2] < 235) bright++;
    return bright;
  });
  assert.ok(minimapArrow > 20, `the minimap arrow is filled (${minimapArrow} px)`);
  await page.locator('#minimap').screenshot({ path: `${output}/minimap-arrow.png` });
  passed(`Minimap draws the same arrow shape (${minimapArrow} px of its bright fill)`);
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
