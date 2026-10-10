// Real Chrome menu actions in memory-only rooms. No user's save is opened.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';
import { SPAWN_SITES } from '../dist/shared/spawn-sites.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = `output/playwright/warp-menu/${Date.now()}`;
const layoutOnly = process.argv.includes('--layout-only');
await mkdir(out, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  arrivals = [],
  roomName = 'WARP-MENU-QA';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failure, peer, exhibition, client;
function pass(label) {
  checks.push(label);
  console.log('PASS', label);
}
async function until(fn, label) {
  const end = Date.now() + 30000;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(50);
  }
}
async function pageAt(url, lan = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const seen = { id: null, state: null };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'welcome') seen.id = message.id;
      if (message.type === 'state') seen.state = message;
    }),
  );
  await page.addInitScript(() => localStorage.setItem('cro-name', 'Warp Menu QA'));
  await page.goto(url);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  if (lan) await page.locator('[data-choose-spawn="camp"]').click();
  else {
    await page.locator('#setup-flow-yes').click();
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id, 'welcome');
  return { page, seen };
}
async function menu(page) {
  await page.keyboard.press('Escape');
  await page.locator('.pause-menu').waitFor();
  await page.locator('[data-pause-tab="warp"]').click();
  assert.equal(await page.locator('[data-warp-spawn]').count(), 6);
}
async function choose(user, room, id) {
  const p = room.players.get(user.seen.id);
  const before = p.warpSequence ?? 0,
    inventory = structuredClone(p.inventory);
  const button = user.page.locator(`[data-warp-spawn="${id}"]`);
  await until(() => button.getAttribute('aria-disabled').then((v) => v === 'false'), 'warp ready');
  await button.click();
  await until(() => p.warpSequence === before + 1, `${id} server arrival`);
  await user.page.waitForFunction(() => !document.querySelector('#modal').open);
  const site = SPAWN_SITES.find((s) => s.id === id);
  assert.ok(Math.hypot(p.x - site.x, p.z - site.z) <= 8, `${id} safe arrival`);
  assert.ok(room.collision.free(p, p.radius));
  assert.deepEqual(p.inventory, inventory);
  assert.equal(p.facing, Math.atan2(site.look.x - p.x, site.look.z - p.z));
  arrivals.push({ id, x: p.x, z: p.z, difficulty: p.difficulty, sequence: p.warpSequence });
}
try {
  const user = await pageAt(`http://127.0.0.1:${port}/?room=${roomName}`);
  const { page, seen } = user,
    room = game.rooms.get(roomName),
    p = room.players.get(seen.id);
  // Nonempty possessions and absent enemies isolate travel from combat in this unsaved fixture.
  Object.assign(p.inventory, { wood: 8, berry: 2 });
  room.enemies = [];
  const peerSeen = { state: null };
  peer = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=WarpObserver`);
  peer.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'state') peerSeen.state = m;
  });
  await new Promise((resolve, reject) => {
    peer.once('open', resolve);
    peer.once('error', reject);
  });
  await menu(page);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-warp-spawn] img')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.deepEqual(
    await page
      .locator('[data-pause-tab]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.pauseTab)),
    ['inventory', 'warp', 'crafting', 'info', 'settings'],
  );
  await page.screenshot({ path: `${out}/ordinary-menu.png` });
  if (!layoutOnly) {
    for (const site of SPAWN_SITES) {
      if (site !== SPAWN_SITES[0]) await menu(page);
      await choose(user, room, site.id);
      await until(
        () =>
          peerSeen.state?.players.some(
            (other) =>
              other.id === p.id &&
              other.warpSequence === p.warpSequence &&
              Math.abs(other.x - p.x) < 0.01,
          ),
        'observer receives arrival',
      );
      if (site === SPAWN_SITES[0]) {
        await menu(page);
        assert.equal(
          await page.locator('[data-warp-spawn="cave"]').getAttribute('aria-disabled'),
          'true',
        );
        assert.match(await page.locator('#exhibition-warp-status').innerText(), /3秒/);
        await page.keyboard.press('Escape');
      }
    }
    pass(
      'ordinary menu has all six pictured destinations; every click arrives safely with possessions and synchronized observer',
    );
    pass('three-second cooldown disables the cards and displays its explanation');
    await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="settings"]').click();
    assert.equal(await page.locator('[data-difficulty]').count(), 0);
    await page.locator('[data-pause-tab="warp"]').click();
    await choose(user, room, 'camp');
    assert.equal(p.difficulty, 'normal');
    pass('menu warps preserve fixed normal difficulty and settings offer no difficulty choice');
  } else await page.keyboard.press('Escape');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await menu(page);
    const target = page.locator('[data-warp-spawn="cave"]');
    await target.scrollIntoViewIfNeeded();
    const nameBox = await target.locator('strong').boundingBox();
    const panelBox = await page.locator('.pause-panels').boundingBox();
    assert.ok(
      nameBox.y >= panelBox.y && nameBox.y + nameBox.height <= panelBox.y + panelBox.height,
      'destination name fits the visible panel',
    );
    assert.equal(
      await page.locator('#modal').evaluate((node) => node.scrollWidth > node.clientWidth + 1),
      false,
    );
    await page.screenshot({ path: `${out}/menu-${viewport.width}.png` });
    await choose(user, room, 'cave');
  }
  pass('phone portrait and landscape reach the cave card, fit the dialog and complete the warp');
  await page.close();
  peer.close();
  if (!layoutOnly) {
    exhibition = createGameServer({ host: '127.0.0.1', port: 0, exhibition: true });
    const lan = await exhibition.listen();
    client = createExhibitionClient({
      root: path.resolve('.'),
      port: 0,
      config: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${lan.port}/ws`,
        room: roomName,
        guestName: 'LAN Warp QA',
      },
    });
    const address = await client.listen();
    const visitor = await pageAt(`http://127.0.0.1:${address.port}`, true);
    await visitor.page.keyboard.press('Escape');
    await visitor.page.locator('.exhibition-menu').waitFor();
    assert.equal(
      await visitor.page.locator('[data-pause-tab="warp"]').getAttribute('aria-selected'),
      'true',
    );
    await visitor.page.screenshot({ path: `${out}/exhibition-menu.png` });
    await choose(visitor, exhibition.rooms.get(roomName), 'cave');
    pass('exhibition still opens directly to the same six destinations and warps to the cave');
  }
  assert.deepEqual(errors, []);
  pass('no browser page or console errors');
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, layoutOnly, failure, checks, arrivals, errors }, null, 2),
  );
  peer?.close();
  await browser.close();
  await client?.close();
  await exhibition?.close();
  await game.close();
  console.log('Evidence:', out);
}
if (failure) process.exitCode = 1;
