// Actual browser input; test-only positions, supplies and resting mammoths are explicit fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const build = new URL('../output/manual-movement/preview/dist/', import.meta.url).href;
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { canMount, RIDING } = await import(build + 'shared/riding.mjs');
const { MANY_HEARTHS, GULF_ENTRY } = await import(build + 'shared/gulf-region.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = 'output/playwright/manual-movement-20260909';
await mkdir(out, { recursive: true });
const checks = [],
  errors = [],
  sent = [];
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
const passed = (s) => {
  checks.push(s);
  console.log('PASS ' + s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f) => {
  for (let i = 0; i < 100; i++) {
    if (await f()) return;
    await sleep(50);
  }
  throw Error('Condition timed out');
};
const position = (p) => ({ x: p.x, z: p.z });
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (socket) =>
    socket.on('framesent', (e) => {
      try {
        sent.push(JSON.parse(e.payload.toString()));
      } catch {}
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Manual QA');
    localStorage.setItem('cro-species', 'cro');
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
  await page.goto('http://127.0.0.1:' + address.port + '/?room=MANUAL-QA');
  await page.locator('#title-start').click();
  await page.locator('#setup-submit').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  const room = game.rooms.get('MANUAL-QA'),
    p = [...room.players.values()][0];
  assert.ok(p);
  passed('Normal title, setup and guide enter the game');
  let origin = position(p);
  await page.locator('#world').click({ position: { x: 720, y: 610 } });
  await sleep(350);
  assert.deepEqual(position(p), origin);
  await page.keyboard.press('r');
  await sleep(350);
  assert.deepEqual(position(p), origin);
  assert.ok(!p.mountId);
  assert.equal(await page.locator('#go-camp,#go-hunt,#go-enemy,#boat-shore').count(), 0);
  passed('Ground click and distant R neither move nor auto-mount; HUD travel buttons removed');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('#world').focus();
    await page.keyboard.press('m');
    await page.locator('#map-location').selectOption(GULF_ENTRY.id);
    await page.locator('#map-camp').click();
    await page.locator('#big-map').click({ position: { x: 50, y: 40 } });
    assert.equal(await page.locator('#map-walk,#map-expedition').count(), 0);
    await page.locator('#modal-close').click();
    await sleep(200);
    assert.deepEqual(position(p), origin);
    await page.screenshot({
      path: out + '/world-' + viewport.width + 'x' + viewport.height + '.png',
    });
  }
  passed(
    'Desktop, portrait and landscape maps only select locations; all three views remain stationary',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  // Inspect every former travel panel through its ordinary menu.
  for (const name of ['journal', 'gulf', 'fishing', 'coastal', 'residents', 'inventory']) {
    await page.locator('#world').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-controller-menu="' + name + '"]').click();
    assert.doesNotMatch(
      await page.locator('#modal-body').innerText(),
      /へ歩く|走って向かう|小舟で向かう|この地域へ遠征|次の目標へ/,
    );
    if (name === 'gulf') {
      await page.locator('#gulf-pantry').click();
      await page.locator('#pantry-supper').click();
      await page.locator('#supper-back').click();
      await page.locator('#pantry-back').click();
      await page.locator('#gulf-barter').click();
      assert.equal(await page.locator('#barter-go,#pantry-go,#supper-go').count(), 0);
    }
    if (name === 'residents') {
      await page.locator('#resident-journeys').click();
      assert.equal(await page.locator('[id^="journey-go-"]').count(), 0);
    }
    if (name === 'inventory') {
      await page.locator('#modal-crop-food').click();
      assert.equal(await page.locator('#crop-food-fire').count(), 0);
    }
    await page.locator('#modal-close').click();
    assert.deepEqual(position(p), origin);
  }
  passed(
    'Journal, Gulf, fishing, coastal, residents, household, pantry, supper, barter and recipe panels work without travel controls',
  );
  // Position fixture just outside a real mammoth's mounting range. The approach below is keyboard movement.
  const a = room.animals[0];
  stopActor(a);
  Object.assign(a, { nextRoam: Infinity, age: 0, hitUntil: 0 });
  stopActor(p);
  Object.assign(p, { x: a.x, z: a.z + a.radius + p.radius + RIDING.reach + 0.6 });
  assert.ok(room.collision.free(p, p.radius));
  await sleep(350);
  assert.equal(await page.locator('#world').getAttribute('data-ride-available'), 'false');
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await until(() => canMount(p, a, room.collision, Date.now()));
  await page.keyboard.up('w');
  await sleep(250);
  assert.ok(!p.mountId);
  await page.waitForSelector('#world[data-ride-available="true"]');
  const pad = async (buttons) => {
    await page.evaluate((buttons) => {
      window.qaPad.buttons = window.qaPad.buttons.map((_, i) => ({
        pressed: buttons.includes(i),
        value: buttons.includes(i) ? 1 : 0,
      }));
    }, buttons);
    await sleep(100);
  };
  await pad([]);
  await pad([PAD.r1]);
  await pad([]);
  assert.match(await page.locator('#riding-hint').innerText(), /△.*乗れます/);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await sleep(150);
    const bounds = await page.locator('#ride-button').boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
    await page.screenshot({
      path: out + '/ride-' + viewport.width + 'x' + viewport.height + '.png',
    });
  }
  await page.screenshot({ path: out + '/triangle-near-mammoth.png' });
  origin = position(p);
  await sleep(450);
  assert.deepEqual(position(p), origin);
  assert.ok(!p.mountId);
  await pad([PAD.cross]);
  await pad([]);
  await until(() => !!p.mountId);
  await sleep(400);
  origin = position(p);
  await sleep(250);
  assert.deepEqual(position(p), origin);
  const observer = await browser.newPage({ viewport: { width: 800, height: 600 } });
  observer.on('pageerror', (e) => errors.push(String(e)));
  await observer.goto('http://127.0.0.1:' + address.port + '/?room=MANUAL-QA&autostart=1');
  await observer.waitForSelector('#world[data-world-asset="ready"]', { timeout: 60000 });
  const riders = JSON.parse(await observer.locator('#world').getAttribute('data-riders'));
  assert.equal(riders.find((r) => r.id === a.id).riderId, p.id);
  await observer.close();
  await page.bringToFront();
  await page.locator('#world').focus();
  await page.locator('#world').click({ position: { x: 800, y: 600 } });
  await sleep(200);
  assert.deepEqual(position(p), origin);
  await page.keyboard.down('w');
  await sleep(450);
  await page.keyboard.up('w');
  await sleep(150);
  assert.ok(Math.hypot(p.x - origin.x, p.z - origin.z) > 0.08);
  await page.keyboard.press('r');
  await until(() => !p.mountId);
  passed(
    'Manual W approach shows △ prompt; proximity alone never mounts; triangle mounts, W drives, R dismounts, clicks do not drive',
  );
  // Explicit position fixture takes the player to the Gulf for UI regression.
  stopActor(p);
  Object.assign(p, { x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 5 });
  await sleep(250);
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="gulf"]').click();
  await page.locator('#gulf-pantry').click();
  await page.locator('#pantry-supper').click();
  await page.locator('#modal-close').click();
  await page.reload();
  await page.waitForSelector('#title-continue', { state: 'visible' });
  await page.locator('#title-continue').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  assert.equal(sent.filter((m) => ['target', 'expedition'].includes(m.type)).length, 0);
  assert.deepEqual(errors, []);
  passed('Gulf panels and reconnect succeed, with zero travel commands and zero browser errors');
} catch (error) {
  errors.push(String(error));
  if (page) await page.screenshot({ path: out + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    out + '/summary.json',
    JSON.stringify(
      {
        checks,
        errors,
        fixtures:
          'Profile, Gamepad API and one near-mammoth / Gulf player position; resting mammoth. No clock or resource changes.',
        commands: sent.map((m) => m.type),
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
