// Solo browser fixture: real controls drive petting and inspection; the renderer is observed.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, stat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { chromium } from 'playwright';
const output = process.argv[2] || 'output/playwright/mascot-touch-view-20261016';
const before = process.argv.includes('--before');
const character =
  process.argv.find((arg) => arg.startsWith('--character='))?.slice('--character='.length) ||
  'cro-male';
const phase = before ? 'before' : 'after';
await mkdir(`${output}/${phase}/save-before`, { recursive: true });
const hash = (data) => createHash('sha256').update(data).digest('hex');
const saveFiles = [];
for (const name of (await readdir('.cro-magnon-save')).sort()) {
  const source = '.cro-magnon-save/' + name,
    info = await stat(source);
  if (!info.isFile()) continue;
  saveFiles.push({
    name,
    sha256: hash(await readFile(source)),
    modifiedAt: info.mtime.toISOString(),
  });
  await copyFile(source, `${output}/${phase}/save-before/${name}`);
}
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  forbidden = [],
  samples = [],
  checks = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let failure, activePage;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => forbidden.push(ws.url()));
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) forbidden.push(r.url());
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst qaRender = WorldRenderer.prototype.render; WorldRenderer.prototype.render = function(...args) { const result = qaRender.apply(this,args); window.qa = this; return result; };',
    });
  });
  await page.goto(base);
  await page.locator('#title-start').tap();
  await page.locator('#setup-form input[name="name"]').fill('仲間の表示確認');
  await page.locator(`#setup-form input[value="${character}"]`).tap();
  await page.locator('#setup-flow-yes').tap();
  await page.locator('[data-starting-mascot="524"]').tap();
  await page.locator('#mascot-start').tap();
  await enterPreparedWorld(page, true);
  await page.waitForFunction(() =>
    window.qa?.companionRenderers.diagnostics().some((c) => c.key === '524'),
  );
  await page.evaluate(() => {
    window.petSamples = [];
    window.petTimer = setInterval(() => {
      const c = qa.state.companions.find((c) => c.key === '524');
      petSamples.push({
        at: qa.serverNow(),
        ...c,
        diagnostics: qa.companionRenderers.diagnostics()[0],
      });
    }, 50);
  });
  await page.locator('[data-touch-action="pet"]').tap();
  await page.waitForFunction(() => qa.companionRenderers.diagnostics()[0].hearts >= 3);
  const heartView = await page.evaluate(() => {
    const r = [...qa.companionRenderers.renderers.values()][0];
    const player = qa.players.get(qa.selfId);
    return r.hearts
      .filter((h) => h.visible)
      .map((h) => {
        const point = h.position.clone().project(qa.camera);
        qa.raycaster.set(
          qa.camera.position,
          h.position.clone().sub(qa.camera.position).normalize(),
        );
        const hit = qa.raycaster.intersectObject(player.model, true)[0];
        return {
          screen: [point.x, point.y, point.z],
          y: h.position.y,
          opacity: h.material.opacity,
          playerOccludes: !!hit && hit.distance < h.position.distanceTo(qa.camera.position),
        };
      });
  });
  await writeFile(`${output}/${phase}/hearts.json`, JSON.stringify(heartView, null, 2));
  await page.screenshot({ path: `${output}/${phase}/pet.png` });
  if (!before) {
    assert.ok(heartView.length >= 3);
    assert.ok(
      heartView.every(
        (h) => !h.playerOccludes && Math.abs(h.screen[0]) < 1 && Math.abs(h.screen[1]) < 1,
      ),
    );
    pass('524 hearts rise visibly above the petter instead of being hidden behind their body');
  }
  await page.waitForTimeout(2000);
  samples.push(
    ...(await page.evaluate(() => {
      clearInterval(petTimer);
      return petSamples;
    })),
  );
  await page.locator('[data-touch-action="inspect"]').tap();
  await page.waitForTimeout(1000);
  const view = await page.evaluate(() => ({
    targetDistance: qa.targetDistance,
    distance: qa.distance,
    target: qa
      .companionViewTargets()
      .filter((t) => t.id === qa.viewedId)
      .map(({ id, point, radius }) => ({ id, point: point.toArray(), radius }))[0],
    diagnostics: qa.companionRenderers.diagnostics(),
    buttons: [...document.querySelectorAll('#touch-controls button')]
      .filter((b) => b.getClientRects().length)
      .map((b) => ({
        action: b.dataset.touchAction,
        text: b.textContent,
        rect: b.getBoundingClientRect().toJSON(),
      })),
  }));
  await writeFile(`${output}/${phase}/view.json`, JSON.stringify(view, null, 2));
  await page.screenshot({ path: `${output}/${phase}/inspect.png` });
  if (!before) {
    assert.ok(view.targetDistance > 0.8, '524 uses its real dimensions for the initial view');
    assert.equal(await page.locator('.touch-move').isVisible(), false);
    assert.equal(
      await page.locator('[data-touch-action="zoomIn"], [data-touch-action="zoomOut"]').count(),
      0,
    );
    const back = await page.locator('[data-touch-action="endInspect"]').boundingBox();
    assert.ok(back && back.x < 30 && back.y > 700 && back.height >= 44);
    const cdp = await context.newCDPSession(page);
    const state = () =>
      page.evaluate(() => ({
        distance: qa.targetDistance,
        yaw: qa.yaw,
        pitch: qa.pitch,
        x: qa.state.players[0].x,
        z: qa.state.players[0].z,
        id: qa.viewedId,
        scale: visualViewport.scale,
      }));
    async function pinch(factor, cancel = false) {
      const { width, height } = page.viewportSize(),
        y = Math.round(height * 0.52),
        center = width / 2;
      const points = (gap) => [
        { id: 11, x: center - gap / 2, y, radiusX: 1, radiusY: 1, force: 1 },
        { id: 12, x: center + gap / 2, y, radiusX: 1, radiusY: 1, force: 1 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: points(100 * (1 + ((factor - 1) * i) / 8)),
        });
        await page.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(200);
    }
    const initial = await state();
    await pinch(1.4);
    const near = await state();
    assert.ok(near.distance < initial.distance * 0.8);
    assert.equal(near.yaw, initial.yaw);
    assert.equal(near.pitch, initial.pitch);
    assert.equal(near.scale, 1);
    assert.equal(near.x, initial.x);
    assert.equal(near.z, initial.z);
    await pinch(0.65);
    assert.ok((await state()).distance > near.distance * 1.4);
    await pinch(1.1, true);
    const cancelled = await state();
    await pinch(0.8);
    assert.ok((await state()).distance > cancelled.distance, 'cancel clears gesture state');
    await page.locator('[data-touch-action="endInspect"]').tap();
    await page.waitForFunction(() => !qa.viewedId);
    await page.locator('.touch-move').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.touch-move').isVisible(), true);
    assert.deepEqual(
      await page.evaluate(() => ({ x: qa.state.players[0].x, z: qa.state.players[0].z })),
      { x: initial.x, z: initial.z },
    );
    pass(
      'Native two-finger pinch zooms both ways, cancels cleanly, and return restores walking without movement',
    );
    for (const [width, height] of [
      [320, 568],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      await page.locator('[data-touch-action="inspect"]').tap();
      await page.waitForTimeout(700);
      const r = await page.locator('[data-touch-action="endInspect"]').boundingBox();
      assert.ok(r && r.x < 30 && r.y > height * 0.7 && r.y + r.height <= height);
      assert.equal(await page.locator('.touch-move').isVisible(), false);
      await page.screenshot({ path: `${output}/${phase}/inspect-${width}x${height}.png` });
      await pinch(1.2);
      await page.locator('[data-touch-action="endInspect"]').tap();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const key of ['rimo-neko', 'white']) {
      await page.locator('[data-touch-action="mascots"]').tap();
      await page.locator(`[data-mascot="${key}"]`).tap();
      await page.locator('#modal-close').tap();
      await page.waitForFunction(
        (key) => qa.state.players[0].mascot === key && qa.companionViewChoice()?.id.startsWith(key),
        key,
      );
      await page.locator('[data-touch-action="inspect"]').tap();
      await page.waitForFunction(() => !!qa.viewedId);
      const start = await state();
      await pinch(1.3);
      assert.ok((await state()).distance < start.distance);
      await page.locator('[data-touch-action="endInspect"]').tap();
      await page.locator('.touch-move').waitFor({ state: 'visible' });
    }
    await cdp.detach();
    pass('Narrow portrait and landscape keep Return at bottom left and support pinch zoom');
    pass('The cat and a Dot share the same pinch and return controls');
  }
  console.log(
    JSON.stringify({
      petFrames: samples.length,
      maximumHearts: Math.max(...samples.map((s) => s.diagnostics.hearts)),
      reactions: [...new Set(samples.map((s) => s.diagnostics.reaction))],
      contacts: samples.filter((s) => s.petContactAt > 0).length,
      viewDistance: view.targetDistance,
      radius: view.target?.radius,
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  for (const saved of saveFiles) {
    assert.equal(hash(await readFile('.cro-magnon-save/' + saved.name)), saved.sha256);
    assert.equal(
      (await stat('.cro-magnon-save/' + saved.name)).mtime.toISOString(),
      saved.modifiedAt,
    );
  }
  await context.close();
  if (!before) {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pc = await desktop.newPage();
    activePage = pc;
    pc.setDefaultTimeout(30000);
    pc.on('pageerror', (e) => errors.push(String(e)));
    await pc.goto(base);
    await pc.locator('#title-start').click();
    await pc.locator('#setup-form input[value="cro-male"]').click();
    await pc.locator('#setup-flow-yes').click();
    await pc.locator('[data-starting-mascot="524"]').click();
    await pc.locator('#mascot-start').click();
    await enterPreparedWorld(pc, false);
    await pc.locator('[data-cue="inspect"]').click();
    await pc.waitForFunction(() => !!document.querySelector('#world').dataset.companionView);
    await pc.locator('#input-cues.is-inspecting').waitFor();
    assert.deepEqual(
      await pc
        .locator('#input-cues [data-cue]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.cue)),
      ['endInspect'],
    );
    const desktopBack = await pc.locator('[data-cue="endInspect"]').boundingBox();
    assert.ok(desktopBack && desktopBack.x < 30 && desktopBack.y > 700);
    assert.equal(await pc.locator('#input-cues .input-basics').isVisible(), false);
    await pc.waitForTimeout(700);
    await pc.screenshot({ path: `${output}/${phase}/inspect-desktop.png` });
    await pc.keyboard.press('+');
    await pc.mouse.move(640, 400);
    await pc.mouse.wheel(0, 120);
    await pc.mouse.down();
    await pc.mouse.move(700, 430, { steps: 5 });
    await pc.mouse.up();
    await pc.keyboard.press('Escape');
    await pc.waitForFunction(() => !document.querySelector('#world').dataset.companionView);
    assert.equal(await pc.locator('#modal').isVisible(), false);
    await desktop.close();
    pass('Desktop inspection, keyboard/wheel/orbit and Escape return remain available');
  }
  for (const path of [
    '/src/world3d.js',
    '/src/companion-524-renderer.js',
    '/src/companion-renderers.js',
    '/src/touch-controls.js',
    '/src/touch-input.js',
    '/src/touch-controls.css',
  ]) {
    assert.equal(
      hash(Buffer.from(await (await fetch(base + path)).arrayBuffer())),
      hash(await readFile('dist' + path)),
    );
  }
  assert.equal((await fetch(base + '/api/health').then((r) => r.json())).ok, true);
  assert.equal((await fetch(base + '/api/status').then((r) => r.json())).ok, true);
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack || error);
  await activePage?.screenshot({ path: `${output}/${phase}/failure.png` }).catch(() => {});
  if (activePage && !activePage.isClosed())
    await writeFile(
      `${output}/${phase}/failure-state.json`,
      JSON.stringify(
        await activePage.evaluate(() => ({
          text: document.body.innerText.slice(-5000),
          view: window.qa?.viewedId,
          character: window.qa?.state.players?.[0],
          companions: window.qa?.state.companions,
          diagnostics: window.qa?.companionRenderers.diagnostics(),
        })),
        null,
        2,
      ),
    );
  console.error(failure);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${output}/${phase}/report.json`,
    JSON.stringify({ base, checks, samples, errors, forbidden, failure, saveFiles }, null, 2),
  );
  await browser.close();
  await game.close();
}
