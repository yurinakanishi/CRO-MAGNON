// Isolated exhibition world, real Chrome pages and ordinary UI actions.
// Controller devices and the inventory-use fixture are simulated; no user save is read.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const root = path.resolve(process.argv[2] || '.');
const folder = path.resolve(`output/playwright/exhibition-menu-${Date.now()}`);
await mkdir(folder, { recursive: true });
const { createGameServer } = await import(pathToFileURL(path.join(root, 'dist/server.mjs')));
const { createExhibitionClient } = await import(
  pathToFileURL(path.join(root, 'dist/infrastructure/node/exhibition-client.mjs'))
);
const { SPAWN_SITES } = await import(pathToFileURL(path.join(root, 'dist/shared/spawn-sites.mjs')));
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const game = createGameServer({ host: '127.0.0.1', port: 0, exhibition: true });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [],
  clients = [],
  sockets = [],
  checks = [],
  errors = [],
  observations = [];
const roomName = 'MENU-QA';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const room = () => game.rooms.get(roomName);
const actor = (name) => [...room().players.values()].find((p) => p.name === name);
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function until(fn, label) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`Timeout: ${label}`);
}
async function tap(page, index) {
  await page.bringToFront();
  for (const pressed of [false, true, false]) {
    await page.evaluate(
      ({ index, pressed }) => {
        window.qaPad.buttons[index] = { pressed, value: pressed ? 1 : 0 };
      },
      { index, pressed },
    );
    await sleep(180);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(folder, `${name}.png`), animations: 'disabled' });
  await writeFile(path.join(folder, `${name}.txt`), await page.locator('body').ariaSnapshot());
}
async function menu(page) {
  await tap(page, 9);
  await page.locator('.exhibition-menu').waitFor();
}
try {
  for (const layout of ['ps4', 'switch-pro']) {
    const client = createExhibitionClient({
      root,
      port: 0,
      config: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/ws`,
        room: roomName,
        guestName: layout,
        controllerLayout: layout,
      },
    });
    clients.push(client);
    const local = await client.listen();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
      window.qaPad = {
        id: 'QA standard pad',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
      window.qaStates = [];
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', (e) => {
            const value = JSON.parse(e.data);
            if (value.type === 'welcome') window.qaSelf = value.id;
            if (value.type === 'state') {
              window.qaState = value;
              window.qaStates.push(value);
              if (window.qaStates.length > 200) window.qaStates.shift();
            }
          });
        }
      };
    });
    await page.goto(`http://127.0.0.1:${local.port}`);
    await page.waitForFunction(() => {
      const avatars = [...document.querySelectorAll('.credit-avatar')];
      return (
        avatars.length === 6 &&
        avatars.every((image) => image.complete && image.naturalWidth === 200)
      );
    });
    await page.locator('#title-start').click();
    await tap(page, 1);
    await page.locator('#setup-flow[data-step="spawn"]').waitFor();
    const startCards = await page.locator('[data-choose-spawn]').evaluateAll((nodes) =>
      nodes.map((el) => ({
        id: el.dataset.chooseSpawn,
        text: el.innerText,
        image: el.querySelector('img').getAttribute('src'),
      })),
    );
    await page.locator('[data-choose-spawn="camp"]').click();
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 120000 });
    // Position only in this unsaved QA world to exercise the prompt beside Or.
    const nearOr = actor(layout);
    const start = { x: nearOr.x, z: nearOr.z };
    Object.assign(nearOr, { x: 70, z: 43 });
    await sleep(800);
    assert.doesNotMatch(await page.locator('#interaction-hint').innerText(), /オルと物々交換する/);
    await shot(page, `${layout}-no-trade-prompt`);
    Object.assign(nearOr, start);
    await sleep(500);
    pass(`${layout}: all six title avatars load; no trade prompt beside Or`);
    await menu(page);
    assert.deepEqual(
      await page
        .locator('[data-pause-tab]')
        .evaluateAll((nodes) => nodes.map((el) => el.dataset.pauseTab)),
      ['warp', 'character', 'inventory'],
    );
    assert.equal(
      await page
        .locator('[data-controller-menu="resume"], [data-setting], [data-pause-subtab]')
        .count(),
      0,
    );
    assert.equal(await page.locator('#modal-close').isVisible(), false);
    assert.equal(await page.locator('[data-controller-menu="title"]').isVisible(), true);
    assert.match(
      await page.locator('.pause-hint').innerText(),
      layout === 'ps4' ? /×（下のボタン）/ : /B（下のボタン）/,
    );
    assert.equal(
      await page
        .locator('.inventory-card, .inventory-none')
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await shot(page, `${layout}-inventory`);
    await page.locator('[data-pause-tab="warp"]').click();
    const warpCards = await page.locator('[data-warp-spawn]').evaluateAll((nodes) =>
      nodes.map((el) => ({
        id: el.dataset.warpSpawn,
        text: el.innerText,
        image: el.querySelector('img').getAttribute('src'),
      })),
    );
    assert.deepEqual(warpCards, startCards);
    await shot(page, `${layout}-warp`);
    await tap(page, 0);
    assert.equal(await page.locator('#modal').isVisible(), false);
    pass(`${layout}: three tabs, same six photos, inventory focus and bottom-button close`);
  }
  for (let i = 0; i < 3; i++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Observer${i}`);
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('message', resolve);
      socket.once('error', reject);
    });
  }
  await until(() => room().players.size === 5, 'five players');
  const page = pages[0],
    peer = pages[1];
  const p = actor('ps4');
  // Fixture: one berry and low health permit a real inventory use without gathering first.
  p.inventory.berry = 1;
  p.energy = 40;
  await sleep(500);
  await menu(page);
  await page.locator('[data-inventory-item="berry"], [data-item="berry"]').first().click();
  await page.locator('[data-item-action="eat"]').click();
  await until(() => p.inventory.berry === 0 && p.energy >= 65, 'eat and update health');
  pass('Inventory food use still consumes the last item and updates health');
  await page.locator('[data-pause-tab="character"]').click();
  const before = { x: p.x, z: p.z, inventory: structuredClone(p.inventory), energy: p.energy };
  await page.locator('#character-switch-form input[value="cro-male"]').focus();
  await tap(page, 1);
  await page.locator('#character-confirm').waitFor();
  await tap(page, 0);
  assert.equal(await page.locator('#character-confirm').count(), 0);
  assert.equal(await page.locator('.exhibition-menu').isVisible(), true);
  await tap(page, 1);
  await tap(page, 1);
  await until(() => p.gender === 'male', 'character change');
  await page
    .locator('#world[data-character-asset="ready"][data-player-model="cro-magnon-hunter"]')
    .waitFor({ timeout: 120000 });
  assert.deepEqual({ x: p.x, z: p.z, inventory: p.inventory, energy: p.energy }, before);
  await until(
    () =>
      peer.evaluate(
        (id) => window.qaState?.players?.some((p) => p.id === id && p.gender === 'male'),
        p.id,
      ),
    'peer sees character',
  );
  assert.equal(await page.locator('#modal').isVisible(), false);
  pass(
    'Character confirmation cancels with bottom button; confirmed change preserves state and reaches peer',
  );
  for (const site of [...SPAWN_SITES.slice(1), SPAWN_SITES[0]]) {
    await menu(page);
    await page.locator('[data-pause-tab="warp"]').click();
    const card = page.locator(`[data-warp-spawn="${site.id}"]`);
    await until(
      () => card.getAttribute('aria-disabled').then((value) => value === 'false'),
      'warp ready',
    );
    await card.focus();
    const sequence = p.warpSequence ?? 0;
    const inventory = structuredClone(p.inventory);
    await tap(page, 1);
    await until(() => p.warpSequence === sequence + 1, `warp ${site.id}`);
    assert.ok(Math.hypot(p.x - site.x, p.z - site.z) <= 8);
    assert.deepEqual(p.inventory, inventory);
    await until(
      () =>
        peer.evaluate(
          ({ id, sequence }) =>
            window.qaState?.players?.some((p) => p.id === id && p.warpSequence === sequence),
          { id: p.id, sequence: p.warpSequence },
        ),
      'peer warp synchronization',
    );
    assert.equal(await page.locator('#modal').isVisible(), false);
    observations.push({
      site: site.id,
      x: p.x,
      z: p.z,
      sequence: p.warpSequence,
      players: room().players.size,
    });
    await sleep(700);
    await shot(page, `arrival-${site.id}`);
    pass(`Controller warp to ${site.name} reaches both clients and preserves inventory`);
  }
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await menu(page);
    for (const tab of ['inventory', 'character', 'warp']) {
      await page.locator(`[data-pause-tab="${tab}"]`).click();
      const panel = page.locator(`[data-pause-panel="${tab}"]`);
      assert.equal(await panel.isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const targets =
        tab === 'character'
          ? panel.locator('input[type="radio"]')
          : tab === 'warp'
            ? panel.locator('[data-warp-spawn]')
            : panel.locator('.inventory-card, .inventory-none');
      await targets.last().focus();
      await targets.last().scrollIntoViewIfNeeded();
      assert.equal(await targets.last().evaluate((el) => el === document.activeElement), true);
      await shot(page, `${viewport.width}x${viewport.height}-${tab}`);
    }
    await tap(page, 0);
    assert.equal(await page.locator('#modal').isVisible(), false);
  }
  pass('All three panels and their last cards are reachable on desktop, portrait and landscape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await menu(page);
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#screen-title:not([hidden])').waitFor();
  await page.reload();
  await page.locator('#title-start').click();
  await tap(page, 1);
  await page.locator('[data-choose-spawn="camp"]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await menu(page);
  assert.equal(await page.locator('[data-pause-tab]').count(), 3);
  pass('Return to title, reload and rejoin retain the exhibition menu');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    path.join(folder, 'result.json'),
    JSON.stringify(
      {
        root,
        checks,
        errors,
        observations,
        physicalControllers: false,
        fixtures: [
          'Standard Gamepad API',
          'Position beside Or',
          'One berry and 40 health in isolated world',
        ],
      },
      null,
      2,
    ),
  );
  console.log('EVIDENCE', folder);
  await browser.close();
  for (const socket of sockets) socket.close();
  for (const client of clients) await client.close();
  await game.close();
}
