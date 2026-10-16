// Real Chrome UI with its own browser storage, using a local asset server or --url.
// Test the served scripts unchanged; the server must receive no game traffic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { publicAssets } from './qa-static-server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || `output/playwright/solo-${Date.now()}`;
await mkdir(output, { recursive: true });
const core = createGameCore();
const publicArg = process.argv.find((arg) => arg.startsWith('--public='));
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
assert.ok(!(publicArg && urlArg), 'Use either --public or --url');
const game = urlArg
  ? null
  : publicArg
    ? await publicAssets(publicArg.slice('--public='.length))
    : createGameServer({
        core,
        host: '127.0.0.1',
        port: 0,
        delivery: await readDeliveryOverlay(process.cwd()),
      });
const base = urlArg
  ? new URL(urlArg.slice('--url='.length)).href
  : `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  idleSamples = [],
  performanceSamples = [],
  errors = [],
  forbidden = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let page;
async function prepare(context) {
  const target = await context.newPage();
  target.on('pageerror', (error) => errors.push(error.stack || error.message));
  target.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  target.on('websocket', (socket) => forbidden.push(socket.url()));
  await target.route('**/api/**', (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });
  await target.goto(base);
  return target;
}
async function setup(target, character = 'cro-male', dye = 'blue', enter = true) {
  await target.locator('#title-start').click();
  await target.locator('#setup-form input[name="name"]').fill('Solo QA');
  await target.locator(`#setup-form input[value="${character}"]`).click();
  await target.locator(`#setup-form [data-dye="${dye}"]`).click();
  await target.locator('#setup-flow-yes').click();
  await target.locator('[data-starting-mascot="524"]').click();
  await target.locator('#mascot-start').click();
  if (enter) await enterPreparedWorld(target, false);
}
async function title(target) {
  await target.keyboard.press('Escape');
  await target.locator('[data-controller-menu="title"]').click();
  await target.waitForFunction(
    async () =>
      !(await navigator.locks.query()).held.some((lock) => lock.name === 'cro-magnon-solo-play'),
  );
}
async function checkpoint(target) {
  return target.evaluate(async () => {
    const request = indexedDB.open('cro-magnon-solo', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readonly');
      const current = tx.objectStore('checkpoints').get('current');
      tx.oncomplete = () => {
        db.close();
        resolve(current.result ? JSON.parse(current.result.payload) : null);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  });
}
async function checkInactivity(target, background = false) {
  const before = await checkpoint(target);
  let blank;
  if (background) {
    blank = await target.context().newPage();
    await blank.goto('about:blank');
    await blank.bringToFront();
  }
  const startedAt = Date.now();
  // Real elapsed time: no synthetic input, keepalive, or clock manipulation.
  await new Promise((resolve) => setTimeout(resolve, 35000));
  const elapsedMs = Date.now() - startedAt;
  if (blank) {
    await blank.close();
    await target.bringToFront();
  }
  assert.equal(
    await target.locator('#screens').evaluate((root) => root.classList.contains('active')),
    false,
  );
  assert.equal(await target.locator('#world').isVisible(), true);
  const after = await checkpoint(target);
  const first = before.game.rooms[0].sessions[0].player;
  const current = after.game.rooms[0].sessions[0].player;
  assert.equal(current.id, first.id);
  assert.deepEqual(current.inventory, first.inventory);
  assert.equal(current.mascot, first.mascot);
  assert.ok(after.game.savedAt > before.game.savedAt, 'autosave continues while idle');
  const lock = await target.evaluate(async () =>
    (await navigator.locks.query()).held.some((entry) => entry.name === 'cro-magnon-solo-play'),
  );
  assert.equal(lock, true, 'the same solo runtime remains active');
  idleSamples.push({
    background,
    elapsedMs,
    savedAtBefore: before.game.savedAt,
    savedAtAfter: after.game.savedAt,
  });
  await target.screenshot({
    path: `${output}/idle-${background ? 'background' : 'foreground'}.png`,
  });
  pass(
    `${background ? 'Resumed background' : 'New foreground'} solo play stays active and autosaves after 35 seconds without input`,
  );
}
async function profileFrames(target, device) {
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await target.waitForTimeout(1000);
    samples.push(
      await target.locator('#world').evaluate((canvas) => {
        const { fps, fpsLimit, frameSimulationMs, frameSubmissionMs, jsHeapMiB } = canvas.dataset;
        return {
          fps: Number(fps),
          fpsLimit: Number(fpsLimit),
          frameSimulationMs,
          frameSubmissionMs,
          jsHeapMiB,
        };
      }),
    );
  }
  assert.ok(samples.every((sample) => sample.fpsLimit === 30));
  const environment = await target.locator('#world').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      width: innerWidth,
      height: innerHeight,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  performanceSamples.push({ device, environment, samples });
  pass(`${device}: recorded ten real frame-rate samples with the fixed 30fps profile`);
}

async function recoverContext(target) {
  const before = await checkpoint(target);
  await target.locator('#world').evaluate((canvas) => {
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WebGL context-loss test is unavailable');
    window.qaRestoreContext = () => extension.restoreContext();
    extension.loseContext();
  });
  await target.locator('#context-recovery').waitFor();
  await target.waitForTimeout(500);
  await target.evaluate(() => window.qaRestoreContext());
  await target.locator('#context-recovery').waitFor({ state: 'detached', timeout: 60000 });
  assert.equal(await target.locator('#world').getAttribute('data-webgl-context'), 'restored');
  assert.equal(
    (await checkpoint(target)).game.rooms[0].sessions[0].player.id,
    before.game.rooms[0].sessions[0].player.id,
  );
  await target.screenshot({ path: `${output}/context-restored.png` });
  pass('A real WebGL context loss restores the scene without losing the solo session');
}

async function touchMovement(target) {
  await target.waitForFunction(() => {
    const data = document.querySelector('#world').dataset;
    return data.playerX !== undefined && data.playerZ !== undefined;
  });
  const cdp = await target.context().newCDPSession(target);
  const touch = (type, touchPoints = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const position = () =>
    target.locator('#world').evaluate((canvas) => ({
      x: Number(canvas.dataset.playerX),
      z: Number(canvas.dataset.playerZ),
    }));
  const before = await position();
  const zone = await target.locator('.touch-move').boundingBox();
  assert.ok(zone);
  const point = { id: 1, x: zone.x + zone.width / 2, y: zone.y + zone.height * 0.65 };
  try {
    await touch('touchStart', [point]);
    await touch('touchMove', [{ ...point, y: point.y - 48 }]);
    await target.waitForTimeout(1100);
    await touch('touchCancel');
    await target.waitForTimeout(1300);
    const stopped = await position();
    assert.ok(Math.hypot(stopped.x - before.x, stopped.z - before.z) > 0.2);
    await target.waitForTimeout(1300);
    const later = await position();
    assert.ok(
      Math.hypot(later.x - stopped.x, later.z - stopped.z) < 0.1,
      'cancelling touch must stop movement',
    );
    const sequence = Number(
      await target.locator('#world').getAttribute('data-player-jump-sequence'),
    );
    await target.locator('[data-touch-action="jump"]').tap();
    await target.waitForFunction(
      (previous) => Number(document.querySelector('#world').dataset.playerJumpSequence) > previous,
      sequence,
    );
    await target.locator('[data-touch-action="menu"]').tap();
    await target.locator('#modal[open]').waitFor();
    await target.locator('[data-controller-menu="title"]').tap();
    await target.locator('#screen-title').waitFor();
    const saved = (await checkpoint(target)).game.rooms[0].sessions[0].player;
    assert.ok(Math.hypot(saved.x - before.x, saved.z - before.z) > 0.2);
    pass(
      'Native Chrome touch moves, cancellation stops, jump works, and the menu saves the moved position',
    );
  } finally {
    await touch('touchEnd').catch(() => {});
    await cdp.detach();
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  page = await prepare(context);
  assert.equal(await page.locator('#title-start').innerText(), 'ソロプレイで始める');
  assert.equal(await page.locator('#title-online').isDisabled(), true);
  await page.locator('#title-online').evaluate((button) => button.click());
  assert.equal(await page.locator('#screen-title').isVisible(), true);
  await page.waitForTimeout(1200); // Finish the title's entrance animation before capture.
  await page.screenshot({ path: `${output}/title-desktop.png` });
  pass('The title enables solo and disables online entry');
  await setup(page);
  assert.equal(await page.locator('#connection-label').innerText(), 'ソロプレイ');
  assert.equal(await page.locator('.chat-panel').count(), 0);
  const first = await checkpoint(page);
  assert.equal(first.game.rooms.length, 1);
  assert.equal(first.game.rooms[0].name, 'SOLO');
  assert.equal(first.game.rooms[0].sessions.length, 1);
  const original = first.game.rooms[0].sessions[0].player;
  assert.equal(original.character, 'cro-magnon-hunter');
  assert.equal(original.dye, 'blue');
  assert.equal(original.mascot, '524');
  await page.screenshot({ path: `${output}/solo-world.png` });
  pass('First entry runs and autosaves a local character, outfit and one companion');
  if (process.argv.includes('--profile')) await profileFrames(page, 'desktop');
  if (process.argv.includes('--idle')) await checkInactivity(page);
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(800);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#local-save-status')?.textContent.includes('自動保存済み'),
  );
  assert.equal(await page.locator('[data-controller-menu="profile"]').count(), 0);
  assert.equal(await page.locator('[data-setting="reset-room"]').count(), 0);
  await page.screenshot({ path: `${output}/autosave-settings.png` });
  await page.locator('[data-controller-menu="title"]').click();
  await page.waitForTimeout(350);
  const saved = await checkpoint(page);
  const moved = saved.game.rooms[0].sessions[0].player;
  assert.ok(Math.hypot(moved.x - original.x, moved.z - original.z) > 0.2);
  await page.reload();
  await setup(page, 'cro-magnon-girl-bear', 'teal');
  const resumed = await checkpoint(page);
  const restored = resumed.game.rooms[0].sessions[0].player;
  assert.equal(restored.id, original.id);
  assert.deepEqual(restored.inventory, moved.inventory);
  assert.ok(Math.hypot(restored.x - moved.x, restored.z - moved.z) < 0.1);
  assert.equal(restored.character, 'cro-magnon-girl-bear');
  assert.equal(restored.dye, 'teal');
  assert.equal(restored.mascot, '524');
  pass('Title/reload restores the same person, inventory and location while applying new clothes');
  if (process.argv.includes('--idle')) await checkInactivity(page, true);
  if (process.argv.includes('--recovery')) await recoverContext(page);

  // A second real tab must not attach a second writer to the same saved world.
  const second = await prepare(context);
  await setup(second, 'cro-male', 'blue', false);
  await second.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 180000 });
  await second.locator('[data-cave-proceed]').click();
  await second.locator('#setup-error').filter({ hasText: '別のタブでソロプレイ中です' }).waitFor();
  assert.equal((await checkpoint(second)).game.rooms[0].sessions[0].player.id, original.id);
  await title(page);
  await second.reload();
  await setup(second);
  assert.equal((await checkpoint(second)).game.rooms[0].sessions[0].player.id, original.id);
  pass('A second tab cannot overwrite a live game and can resume after the first returns to title');
  await title(second);
  await context.close();

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  phoneContext.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  page = await prepare(phoneContext);
  await page.waitForTimeout(1200);
  const online = await page.locator('#title-online').boundingBox();
  assert.ok(
    online && online.x >= 0 && online.x + online.width <= 390 && online.y + online.height <= 844,
  );
  await page.screenshot({ path: `${output}/title-mobile.png` });
  await page.locator('#title-start').tap();
  await page.locator('#setup-form input[name="name"]').fill('ソロ');
  await page.locator('#setup-form input[value="cro-male"]').tap();
  await page.locator('#setup-form [data-dye="blue"]').tap();
  await page.locator('#setup-flow-yes').tap();
  assert.equal(await page.locator('#screen-setup').isVisible(), false);
  await page.locator('#mascot-back').tap();
  assert.equal(await page.locator('#setup-form input[value="cro-male"]').isChecked(), true);
  await page.locator('#setup-flow-yes').tap();
  await page.locator('[data-starting-mascot="blue"]').tap();
  await page.locator('#mascot-start').tap();
  await enterPreparedWorld(page, true);
  assert.equal((await checkpoint(page)).game.rooms[0].sessions[0].player.mascot, 'blue');
  await page.screenshot({ path: `${output}/solo-mobile.png` });
  if (process.argv.includes('--profile')) await profileFrames(page, 'mobile-emulation');
  pass(
    '390px touch flow keeps both title buttons visible and runs solo after separate character and companion screens',
  );
  await touchMovement(page);
  assert.deepEqual(forbidden, []);
  if (game && !publicArg) assert.equal(core.rooms.size, 0);
  assert.deepEqual(errors, []);
  pass('No WebSocket or game API request');
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        base,
        browser: browser.version(),
        checks,
        idleSamples,
        performanceSamples,
        errors,
        forbidden,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game?.close();
}
