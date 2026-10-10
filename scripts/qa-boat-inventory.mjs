// Actual UI operations in an isolated, memory-only local verification world.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { launchPoint, landingPoint } from '../dist/shared/boats.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/boat-inventory-20261006/final-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  checks = [],
  actions = [];
let id,
  failure,
  reviewPage = page;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(condition, label, timeout = 12000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout) throw Error(`Timed out: ${label}`);
    await sleep(60);
  }
}
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('websocket', (ws) => {
  ws.on('framereceived', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'welcome') id = message.id;
  });
  ws.on('framesent', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'action') actions.push(message);
  });
});
await page.addInitScript(() => {
  localStorage.setItem('cro-name', 'BoatInventoryReview');
  localStorage.setItem('cro-graphics-quality', 'low');
});
try {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  const room = game.rooms.get('LOCAL_VERIFY'),
    p = room.players.get(id);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  // Stock and start positions are fixture values; transfers use actual UI actions.
  stopActor(p);
  Object.assign(p, { x: 43, z: 43, warpSequence: (p.warpSequence ?? 0) + 1 });
  p.inventory.wood = 24;
  await sleep(800);
  assert.equal(await page.locator('#boat-weather, #gulf-weather, #sea-panel').count(), 0);
  assert.equal((await page.locator('body').innerText()).includes('空と航路'), false);
  pass('removed weather/route buttons and dialog are absent');
  assert.equal(await page.locator('#boat-craft').count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="crafting"]').click();
  await page.locator('#modal-boat-craft').click();
  await until(() => p.inventory.boat === 1, 'inland craft');
  assert.equal(p.inventory.wood, 12);
  assert.equal(room.boats.length, 0);
  await page.keyboard.press('i');
  await page.locator('[data-item="boat"]').click();
  assert.equal(await page.locator('[data-item-action="launchBoat"]').isDisabled(), true);
  await page.screenshot({ path: `${out}/inland-inventory.png` });
  await page.locator('#modal-close').click();
  pass('crafting inland adds one carried boat; inventory cannot launch inland');
  const shore = { x: 138, z: 112 };
  assert.ok(launchPoint(room, { ...p, ...shore }));
  stopActor(p);
  Object.assign(p, shore, { warpSequence: p.warpSequence + 1 });
  await sleep(1000);
  await page.keyboard.press('i');
  await page.locator('[data-item="boat"]').click();
  await page.locator('[data-item-action="launchBoat"]').click();
  await until(() => room.boats.length === 1 && p.inventory.boat === 0, 'inventory launch');
  assert.equal(await page.locator('#modal').evaluate((dialog) => dialog.open), false);
  await sleep(550);
  await page.locator('[data-cue="board"]').click();
  await until(() => !!p.boatId, 'board');
  await until(
    async () => !(await page.locator('#boat-recover').isVisible()),
    'recovery hides aboard',
  );
  const boat = room.boats[0];
  const before = { x: p.x, z: p.z };
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await sleep(400);
  await page.keyboard.up('w');
  await sleep(300);
  assert.ok(Math.hypot(p.x - before.x, p.z - before.z) > 0.1);
  assert.equal(p.x, boat.x);
  assert.equal(p.z, boat.z);
  pass(
    'inventory launch removes one carried boat; actual boarding and helm movement stay synchronized',
  );
  // At the last safe water point, use the real disembark and recovery buttons.
  stopActor(boat);
  Object.assign(boat, boat.mooring);
  Object.assign(p, { x: boat.x, z: boat.z });
  assert.ok(landingPoint(room, p, boat));
  await sleep(700);
  await page.locator('[data-cue="board"]').click();
  await until(() => !p.boatId, 'land');
  await sleep(550);
  await page.locator('#boat-recover').click();
  await until(() => room.boats.length === 0 && p.inventory.boat === 1, 'recover');
  await until(
    async () => (await page.locator('#world').getAttribute('data-boats')) === '0',
    'hull disappears',
  );
  assert.equal(await page.locator('#boat-recover').isVisible(), false);
  assert.equal(p.inventory.wood, 12);
  pass('landing exposes recovery; one click removes the rendered hull and restores one boat');
  await page.keyboard.press('i');
  await page.locator('[data-item="boat"]').waitFor();
  await page.screenshot({ path: `${out}/recovered-inventory.png` });
  await page.locator('#modal-close').click();
  const carried = p.inventory.boat,
    self = p.id;
  await page.reload();
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(() => room.players.get(self)?.inventory.boat === carried, 'reload inventory');
  assert.equal(id, self);
  pass('real reload and UI re-entry preserve the carried boat');
  // UI re-entry deliberately starts at camp. Stage the next control checks at sea.
  const resumedPlayer = room.players.get(id);
  stopActor(resumedPlayer);
  Object.assign(resumedPlayer, shore, { warpSequence: resumedPlayer.warpSequence + 1 });
  await sleep(800);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await sleep(500);
    await page.locator('#boat-launch').click();
    await until(() => room.boats.length === 1, 'launch again');
    await sleep(550);
    await page.locator('[data-cue="board"]').click();
    await until(() => !!room.players.get(id)?.boatId, 'board again');
    await sleep(600);
    await page.locator('[data-cue="board"]').click();
    await until(() => !room.players.get(id)?.boatId, 'land again');
    await sleep(550);
    await page.locator('#boat-recover').click();
    await until(
      () => room.boats.length === 0 && room.players.get(id)?.inventory.boat === 1,
      'recover again',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `${out}/controls-${width}x${height}.png` });
  }
  pass(
    'portrait, landscape and desktop launch/board/land/recover buttons work without horizontal overflow',
  );
  await page.close();
  const touchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  reviewPage = touchPage;
  touchPage.on('pageerror', (error) => errors.push(String(error)));
  touchPage.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  touchPage.on('websocket', (ws) =>
    ws.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'action') actions.push(message);
    }),
  );
  await touchPage.addInitScript(() => {
    localStorage.setItem('cro-name', 'TouchBoatReview');
    localStorage.setItem('cro-graphics-quality', 'low');
  });
  await touchPage.goto(`http://127.0.0.1:${port}`);
  await touchPage.locator('#title-start').tap();
  await touchPage.locator('#setup-form .character-choice:has(input[value="cro-female"])').tap();
  await touchPage.locator('#setup-flow-yes').tap();
  await touchPage
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  const touchPlayer = [...room.players.values()].find(
    (player) => player.name === 'TouchBoatReview',
  );
  stopActor(touchPlayer);
  Object.assign(touchPlayer, shore, { warpSequence: touchPlayer.warpSequence + 1 });
  touchPlayer.inventory.wood = 12;
  await sleep(800);
  assert.equal(await touchPage.locator('#boat-craft').count(), 0);
  await touchPage.locator('[data-touch-action="menu"]').tap();
  await touchPage.locator('[data-pause-tab="crafting"]').tap();
  await touchPage.locator('#modal-boat-craft').tap();
  await until(() => touchPlayer.inventory.boat === 1, 'touch craft');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await touchPage.setViewportSize({ width, height });
    await sleep(600);
    await touchPage.locator('#boat-launch').tap();
    await until(() => room.boats.length === 1, 'touch launch');
    await sleep(550);
    await touchPage.locator('[data-touch-action="board"]').tap();
    await until(() => !!touchPlayer.boatId, 'touch board');
    await sleep(650);
    await touchPage.locator('[data-touch-action="board"]').tap();
    await until(() => !touchPlayer.boatId, 'touch land');
    await sleep(550);
    await touchPage.screenshot({ path: `${out}/touch-recovery-${width}x${height}.png` });
    await touchPage.locator('#boat-recover').tap();
    await until(() => room.boats.length === 0 && touchPlayer.inventory.boat === 1, 'touch recover');
    assert.equal(
      await touchPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  assert.equal(touchPlayer.inventory.wood, 0);
  pass(
    'actual emulated touch taps craft, launch, board, land and recover in both phone orientations',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack || error);
  await reviewPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      { status: failure ? 'failed' : 'passed', checks, errors, actions, failure },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
