import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = 'output/playwright/quiet-actions-carry';
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [],
  errors = [],
  reports = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (const species of ['ape', 'bear']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
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
    await page.route('**/src/main.js', async (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          `import { WorldRenderer as W } from '/src/world3d.js'; const r = W.prototype.render; W.prototype.render = function(...a) { window.qaWorld = this; return r.apply(this,a); };\n` +
          (await readFile('dist/src/main.js', 'utf8')),
      }),
    );
    await page.goto(`http://127.0.0.1:${port}/?room=QUIET-CARRY`);
    await page.locator('#title-start').click();
    await page.locator('#setup-form input[name="name"]').fill(`Quiet-${species}`);
    await page.locator(`#setup-form input[name="species"][value="${species}"]`).check();
    await page.locator('#setup-submit').click();
    await page.waitForSelector('body.in-game', { timeout: 60000 });
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 90000 });
  }
  const room = game.rooms.get('QUIET-CARRY');
  const ape = [...room.players.values()].find((p) => p.species === 'ape');
  const mage = [...room.players.values()].find((p) => p.species === 'bear');
  const [a, m] = pages;
  room.enemies = [];
  room.animals = [];
  room.resources = [];
  for (const [p, x] of [
    [ape, 95],
    [mage, 105],
  ]) {
    stopActor(p);
    Object.assign(p, { x, z: 110, facing: 0 });
  }
  await sleep(800);
  const tap = async (page, button) => {
    for (const pressed of [false, true, false])
      await page.evaluate(
        async ({ button, pressed }) => {
          window.qaPad.buttons[button] = { pressed, value: pressed ? 1 : 0 };
          await new Promise((resolve) => setTimeout(resolve, 220));
        },
        { button, pressed },
      );
  };
  await a.evaluate(() => {
    window.qaToasts = [];
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node.nodeType === 1 && node.matches('.toast')) window.qaToasts.push(node.textContent);
    });
    observer.observe(document.querySelector('.toast-stack'), { childList: true });
  });
  await a.keyboard.press('r');
  await tap(a, 3);
  await a.keyboard.press('e');
  await tap(a, 0);
  await a.keyboard.press('b');
  await sleep(500);
  assert.deepEqual(await a.evaluate(() => window.qaToasts), []);
  assert.ok(!ape.mountId && !ape.boatId && !ape.passengerId);
  reports.push({ step: 'R, triangle, E, cross and B without a target', toasts: 0 });
  console.log('Quiet controls passed');
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ]) {
    for (const page of pages) await page.setViewportSize({ width, height });
    stopActor(ape);
    stopActor(mage);
    Object.assign(ape, { x: 95, z: 110, facing: 0 });
    const separation = ape.radius + mage.radius + 1.6;
    Object.assign(mage, { x: 95 + separation, z: 110, facing: 0 });
    await sleep(500);
    for (const page of pages)
      await page.evaluate(() => {
        window.qaWorld.yaw = Math.PI;
      });
    await a.keyboard.down('w');
    await m.keyboard.down('w');
    await sleep(140);
    assert.ok(ape.moving && mage.moving);
    console.log(
      'Before invite',
      width,
      { x: ape.x, z: ape.z, radius: ape.radius },
      { x: mage.x, z: mage.z, radius: mage.radius },
      await a.locator('#ride-button').isVisible(),
      await a.locator('#ride-button').isEnabled(),
    );
    await a.keyboard.press('r');
    await sleep(100);
    console.log('Offer', ape.carryOfferToId, mage.carryOfferFromId, errors);
    await m.waitForFunction(
      () => !!window.qaWorld.players.get(window.qaWorld.selfId).state.carryOfferFromId,
    );
    assert.ok(ape.moving && mage.moving);
    const before = { x: ape.x, z: ape.z };
    // Acceptance uses the screen button while both players still hold movement.
    await m.locator('#ride-button').click();
    await m.waitForFunction(
      () => !!window.qaWorld.players.get(window.qaWorld.selfId).state.carrierId,
    );
    await sleep(200);
    assert.equal(mage.carrierId, ape.id);
    assert.equal(ape.passengerId, mage.id);
    assert.ok(ape.moving);
    assert.ok(Math.hypot(ape.x - before.x, ape.z - before.z) > 0.1);
    assert.equal(ape.x, mage.x);
    assert.equal(ape.z, mage.z);
    await a.keyboard.up('w');
    await m.keyboard.up('w');
    await m.screenshot({ path: `${folder}/${width}x${height}.png` });
    await m.locator('#world').focus();
    await tap(m, 3);
    await m.waitForFunction(
      () => !window.qaWorld.players.get(window.qaWorld.selfId).state.carrierId,
    );
    reports.push({
      step: 'moving invitation, acceptance, continued walking and triangle dismount',
      width,
      height,
      startingSeparation: separation,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify(
      {
        reports,
        errors,
        fixtures: [
          'profiles',
          'positions',
          'QA resources, enemies and animals removed',
          'camera',
          'Gamepad API',
        ],
        clocksChanged: false,
        normalSaveModified: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ reports, errors }));
} finally {
  await browser.close();
  await game.close();
}
