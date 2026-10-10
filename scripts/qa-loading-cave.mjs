// Independent, unsaved world. Hold the world download to verify real loading-time controls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/loading-cave-20261007/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
let lastPage;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label, data) => {
  checks.push({ label, data });
  console.log('PASS', label, JSON.stringify(data ?? ''));
};
async function open(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
    isMobile: !!options.mobile,
    hasTouch: !!options.mobile,
  });
  const page = await context.newPage();
  lastPage = page;
  const requests = [],
    sockets = [];
  page.on('request', (r) => {
    if (/\.glb(?:\?|$)/.test(r.url())) requests.push(r.url());
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('PAGEERROR', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !options.expectedError) {
      errors.push(m.text());
      console.error('BROWSER', m.text());
    }
  });
  await page.addInitScript(() => localStorage.setItem('cro-name', 'Loading Cave QA'));
  return { context, page, requests, sockets };
}
async function home(page) {
  await page.goto(`http://127.0.0.1:${port}/?room=CAVEQA`);
  await page.locator('#title-start').waitFor();
}
async function start(page, mobile = false) {
  const click = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await click('#title-start');
  await click('.character-choice:has(input[value="cro-male"])');
  await click('#setup-flow-yes');
}
async function caveReady(page) {
  await page
    .locator('#loading-cave[data-ready="true"], #render-error')
    .waitFor({ timeout: 180000 });
  if (await page.locator('#render-error').count())
    throw new Error(await page.locator('#render-error').innerText());
}
const position = async (page) =>
  (await page.locator('#world').getAttribute('data-cave-position')).split(',').map(Number);
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
async function drag(page, x, y, dx, dy, mobile = false) {
  if (!mobile) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10, id: 1 }],
    });
  await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
async function fit(page, selectors) {
  for (const selector of selectors) {
    const r = await page.locator(selector).boundingBox();
    const viewport = page.viewportSize();
    assert.ok(
      r &&
        r.x >= -1 &&
        r.y >= -1 &&
        r.x + r.width <= viewport.width + 1 &&
        r.y + r.height <= viewport.height + 1,
      `${selector}: ${JSON.stringify(r)}`,
    );
  }
}
let failure;
try {
  {
    const { context, page, requests, sockets } = await open();
    let release;
    const held = new Promise((r) => (release = r));
    let worldRequests = 0;
    await page.route('**/*.glb', async (route) => {
      if (!/\/models\/(camp-cave|cro-magnon-hunter|firewood-log)\//.test(route.request().url())) {
        worldRequests++;
        await held;
      }
      await route.continue().catch(() => {});
    });
    await home(page);
    await sleep(500);
    assert.equal(requests.length, 0);
    assert.equal(await page.locator('.cave-mural').count(), 0);
    assert.equal(await page.locator('#title-start').isEnabled(), true);
    await page.locator('#title-contributors').click();
    assert.ok((await page.locator('.contributor').count()) >= 5);
    await page.locator('#modal-close').click();
    await page.screenshot({ path: `${out}/title-desktop.png` });
    pass('Immediate mural-free menu and contributor dialog; no world GLB requested on title');
    await start(page);
    await caveReady(page);
    await sleep(500);
    assert.ok(worldRequests > 0);
    assert.equal(sockets.length, 0);
    assert.equal(await page.locator('[data-cave-proceed]').isDisabled(), true);
    await page.screenshot({ path: `${out}/cave-before.png` });
    const before = await position(page);
    await page.keyboard.down('w');
    await sleep(1100);
    const walk = await page.locator('#world').getAttribute('data-cave-animation');
    await page.keyboard.up('w');
    const after = await position(page);
    assert.ok(moved(before, after) > 1);
    assert.equal(walk, 'Walk_Loop');
    const yaw = await page.locator('#world').getAttribute('data-cave-camera-yaw');
    await drag(page, 900, 400, 260, 0);
    assert.notEqual(await page.locator('#world').getAttribute('data-cave-camera-yaw'), yaw);
    await page.keyboard.down('Shift');
    await page.keyboard.down('s');
    await sleep(800);
    const run = await page.locator('#world').getAttribute('data-cave-animation');
    await page.keyboard.up('s');
    await page.keyboard.up('Shift');
    assert.equal(run, 'Run_Loop');
    await page.screenshot({ path: `${out}/cave-west.png` });
    pass('Walk, run and orbit while world download is held; no room connection', {
      before,
      after,
      walk,
      run,
      requests: requests.map((u) => new URL(u).pathname),
    });
    await page.evaluate(() => {
      window.__cavePad = {
        connected: true,
        index: 0,
        id: 'QA',
        mapping: 'standard',
        axes: [0.5, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      };
      navigator.getGamepads = () => [window.__cavePad];
    });
    const padBefore = await position(page);
    await sleep(900);
    const padAfter = await position(page);
    assert.ok(moved(padBefore, padAfter) > 0.4);
    await page.evaluate(() => {
      window.__cavePad.axes = [0, 0, 0, 0];
    });
    pass('Simulated gamepad moves the local visitor', { padBefore, padAfter });
    const profiler = process.env.QA_CAVE_PROFILE ? await context.newCDPSession(page) : null;
    if (profiler) {
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.start');
    }
    await page.evaluate(() => {
      window.__caveFrameTimes = [];
      let last = performance.now();
      const sample = (now) => {
        window.__caveFrameTimes.push(now - last);
        last = now;
        if (!document.querySelector('#loading-cave')?.dataset.worldReady)
          requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    release();
    await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 240000 });
    if (profiler) {
      await writeFile(
        `${out}/cpu-profile.json`,
        JSON.stringify((await profiler.send('Profiler.stop')).profile),
      );
      await profiler.detach();
    }
    const timing = await page.evaluate(() => {
      const frames = window.__caveFrameTimes.slice().sort((a, b) => a - b);
      return {
        frames: frames.length,
        maxFrameMs: frames.at(-1),
        p95FrameMs: frames[Math.floor(frames.length * 0.95)],
        worldPreparedMs: document.querySelector('#world').dataset.worldPreparedMs,
      };
    });
    pass('Background loading frame timing (single local Chrome run)', timing);
    await sleep(800);
    assert.equal(sockets.length, 0);
    assert.equal(await page.locator('#loading-cave').count(), 1);
    await page.screenshot({ path: `${out}/cave-ready.png` });
    await page.locator('[data-cave-proceed]').click();
    await sleep(1500);
    console.log(
      'AFTER CONTINUE',
      await page.evaluate(() => ({
        data: {
          worldAsset: document.querySelector('#world').dataset.worldAsset,
          playerModel: document.querySelector('#world').dataset.playerModel,
        },
        status: document.querySelector('#connection-label')?.textContent,
        error: document.querySelector('#setup-error')?.textContent,
        screen: document.body.dataset.screen,
      })),
    );
    await page.screenshot({ path: `${out}/after-continue.png` });
    await page.waitForFunction(
      () => document.querySelector('#world').dataset.glbPlayers === '1',
      {},
      { timeout: 180000 },
    );
    assert.equal(await page.locator('#loading-cave').count(), 0);
    assert.equal(sockets.length, 1);
    await page.keyboard.down('w');
    await sleep(500);
    await page.keyboard.up('w');
    await page.screenshot({ path: `${out}/game.png` });
    pass('Ready cave waits for explicit continue; game connects and displays the chosen player');
    await context.close();
  }
  {
    const { context, page, sockets } = await open({
      mobile: true,
      viewport: { width: 390, height: 844 },
    });
    let release;
    const held = new Promise((r) => (release = r));
    await page.route('**/*.glb', async (route) => {
      if (!/\/models\/(camp-cave|cro-magnon-hunter|firewood-log)\//.test(route.request().url()))
        await held;
      await route.continue().catch(() => {});
    });
    await home(page);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 844, height: 390 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await sleep(300);
      await fit(page, ['.title-art', '#title-start', '#title-contributors']);
      await page.screenshot({ path: `${out}/title-${viewport.width}.png` });
    }
    await start(page, true);
    await caveReady(page);
    await fit(page, [
      '[data-cave-back]',
      '[data-cave-proceed]',
      '.loading-cave-stick',
      '[data-cave-torch]',
    ]);
    assert.equal(await page.locator('[data-cave-torch]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-cave-torch]').tap();
    assert.equal(await page.locator('[data-cave-torch]').getAttribute('aria-pressed'), 'false');
    await page.locator('[data-cave-torch]').tap();
    assert.equal(await page.locator('[data-cave-torch]').getAttribute('aria-pressed'), 'true');
    const before = await position(page);
    const stick = await page.locator('.loading-cave-stick').boundingBox();
    await drag(page, stick.x + stick.width / 2, stick.y + stick.height / 2, 0, -40, true);
    const after = await position(page);
    assert.ok(moved(before, after) > 0.5);
    const stopped = await position(page);
    await sleep(350);
    assert.ok(moved(stopped, await position(page)) < 0.05);
    const yaw = await page.locator('#world').getAttribute('data-cave-camera-yaw');
    await drag(page, 300, 360, -100, 0, true);
    assert.notEqual(await page.locator('#world').getAttribute('data-cave-camera-yaw'), yaw);
    await page.screenshot({ path: `${out}/cave-mobile.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(300);
    await fit(page, ['[data-cave-back]', '[data-cave-proceed]', '.loading-cave-stick']);
    await page.screenshot({ path: `${out}/cave-landscape.png` });
    await page.locator('[data-cave-back]').tap();
    assert.equal(await page.locator('#loading-cave').count(), 0);
    assert.equal(sockets.length, 0);
    await page.locator('#title-start').waitFor();
    await start(page, true);
    await caveReady(page);
    assert.equal(sockets.length, 0);
    assert.equal(await page.locator('[data-cave-proceed]').isDisabled(), true);
    await page.locator('[data-cave-back]').tap();
    release();
    await context.close();
    pass(
      'Phone portrait/landscape controls fit; real touch movement, release, orbit, back and re-entry work',
    );
  }
  {
    const { context, page, sockets } = await open({ expectedError: true });
    // The herd now streams after entry. Fail the required arrival floor instead.
    await page.route('**/models/meadow-ground/*.glb', (route) =>
      route.fulfill({ status: 503, body: 'world download QA failure' }),
    );
    await home(page);
    await start(page);
    await page.locator('#render-error').waitFor({ timeout: 180000 });
    assert.equal(sockets.length, 0);
    assert.equal(await page.locator('#loading-cave').count(), 0);
    await context.close();
    pass('World download failure closes the gallery and reports the reload error without joining');
  }
  {
    const { context, page, sockets } = await open({ expectedError: true });
    await page.route('**/models/camp-cave/*.png', (route) =>
      route.fulfill({ status: 404, body: 'missing QA texture' }),
    );
    await home(page);
    await start(page);
    await page.locator('#render-error').waitFor({ timeout: 180000 });
    assert.equal(sockets.length, 0);
    assert.equal(await page.locator('#loading-cave').count(), 0);
    await page.screenshot({ path: `${out}/error.png` });
    await context.close();
    pass('Missing cave painting stops at the reload error without joining');
  }
  assert.deepEqual(errors, []);
} catch (e) {
  failure = e;
  console.error(e);
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    await writeFile(
      `${out}/failure-state.json`,
      JSON.stringify(
        await lastPage
          .evaluate(() => ({
            data: { ...document.querySelector('#world').dataset },
            text: document.body.innerText,
          }))
          .catch(() => null),
        null,
        2,
      ),
    );
  }
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, failure: failure?.stack, checks, errors }, null, 2),
  );
  await browser.close();
  await game.close?.();
  process.exit(failure ? 1 : 0);
}
