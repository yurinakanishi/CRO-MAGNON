// Real Chrome fast travel to the six pictured sights in memory-only rooms: the map's 名所 row
// in the ordinary game, the menu's ワープする tab in the exhibition. No user's save is opened.
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
    if (await page.locator('#loading-cave').count())
      await page.locator('[data-cave-proceed]').click({ timeout: 180000 });
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id, 'welcome');
  // A start without the loading cave (the exhibition) is covered until the arrival.
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
  return { page, seen };
}
/** The ordinary game's sights are photos in the map's row. */
async function sights(page) {
  await page.locator('#world').focus();
  await page.keyboard.press('m');
  await page.locator('.atlas-places').waitFor();
  assert.equal(await page.locator('[data-map-place]').count(), 6);
}
/** A photo chooses its sight; the warp button (or the chosen photo again) sends it. */
async function inMap(page, id, how) {
  const photo = page.locator(`[data-map-place="spawn-${id}"]`);
  await photo.scrollIntoViewIfNeeded();
  await photo.click();
  await page.locator(`#map-card[data-state="ready"]`).waitFor();
  assert.equal(await photo.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#map-region').innerText(), '名所');
  if (how === 'photo') await photo.click();
  else await page.locator('#map-warp').click();
}
/** The exhibition keeps its own menu tab of the same six cards. */
async function inMenu(page, id) {
  const button = page.locator(`[data-warp-spawn="${id}"]`);
  await until(() => button.getAttribute('aria-disabled').then((v) => v === 'false'), 'warp ready');
  await button.click();
}
async function choose(user, room, id, how = 'button') {
  const p = room.players.get(user.seen.id);
  const before = p.warpSequence ?? 0,
    inventory = structuredClone(p.inventory);
  if (how === 'menu') await inMenu(user.page, id);
  else await inMap(user.page, id, how);
  // The own warp is covered by the loading screen until the destination is drawn;
  // the menu opens again only after it lifts.
  await user.page.locator('#loading-screen[data-state="shown"]').waitFor({ timeout: 5000 });
  await until(() => p.warpSequence === before + 1, `${id} server arrival`);
  await user.page.waitForFunction(() => !document.querySelector('#modal').open);
  await user.page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
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
  // The menu no longer has a warp tab; the map shows the six photos.
  await page.keyboard.press('Escape');
  await page.locator('.pause-menu').waitFor();
  assert.deepEqual(
    await page
      .locator('[data-pause-tab]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.pauseTab)),
    ['inventory', 'mascots', 'settings', 'more'],
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await sights(page);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-map-place] img')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: `${out}/ordinary-map.png` });
  if (!layoutOnly) {
    for (const site of SPAWN_SITES) {
      if (site !== SPAWN_SITES[0]) await sights(page);
      // Alternate the warp button and a second press on the chosen photo.
      await choose(user, room, site.id, SPAWN_SITES.indexOf(site) % 2 ? 'photo' : 'button');
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
        await sights(page);
        await page.locator('[data-map-place="spawn-cave"]').click();
        await page.locator('#map-card[data-state="blocked"]').waitFor();
        assert.equal(await page.locator('#map-warp').isDisabled(), true);
        assert.match(await page.locator('#map-warp-status').innerText(), /3秒/);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#modal').open);
      }
    }
    pass(
      "the map's 名所 row has all six pictured destinations; every warp arrives safely with possessions and synchronized observer",
    );
    pass('three-second cooldown blocks the chosen sight and displays its explanation');
    await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="settings"]').click();
    assert.equal(await page.locator('[data-difficulty]').count(), 0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await sights(page);
    await choose(user, room, 'camp');
    assert.equal(p.difficulty, 'normal');
    pass('sight warps preserve fixed normal difficulty and settings offer no difficulty choice');
  } else {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
  }
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await sights(page);
    const target = page.locator('[data-map-place="spawn-cave"]');
    await target.scrollIntoViewIfNeeded();
    const photoBox = await target.boundingBox();
    const rowBox = await page.locator('.atlas-places-row').boundingBox();
    assert.ok(
      photoBox.x >= rowBox.x - 1 &&
        photoBox.x + photoBox.width <= rowBox.x + rowBox.width + 1 &&
        photoBox.x + photoBox.width <= viewport.width,
      'the last photo slides fully into view',
    );
    assert.equal(
      await page.locator('#modal').evaluate((node) => node.scrollWidth > node.clientWidth + 1),
      false,
    );
    await page.screenshot({ path: `${out}/map-${viewport.width}.png` });
    await choose(user, room, 'cave');
  }
  pass('phone portrait and landscape slide to the cave photo, fit the map and complete the warp');
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
    await choose(visitor, exhibition.rooms.get(roomName), 'cave', 'menu');
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
