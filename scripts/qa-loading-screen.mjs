// Real Chrome against an isolated, unsaved local world (saves stay under the output
// folder): the contributors dialog over the loading cave, and the loading screen over
// warps and over entries that do not pass through the cave. No user room or save.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { SPAWN_SITES } from '../dist/shared/spawn-sites.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { LOADING_TIPS } from '../dist/src/loading-tips.js';
import { LOADING_TIMING } from '../dist/src/loading-screen.js';
import { titleContributors } from '../dist/src/title-credits.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/loading-screen-20261011/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  covers = [];
let lastPage;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timeout: ${label}`);
    await sleep(50);
  }
}
const pass = (label, data) => {
  checks.push({ label, data });
  console.log('PASS', label, JSON.stringify(data ?? ''));
};
const tipTitles = new Set(LOADING_TIPS.map((tip) => tip.title));
const site = (id) => SPAWN_SITES.find((entry) => entry.id === id);
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function open({ viewport = { width: 1440, height: 900 }, mobile = false } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  // Profile links in the dialog never leave the QA.
  await context.route(/^https:\/\/(?:www\.)?x\.com\//, (route) => route.abort());
  const page = await context.newPage();
  page.on('popup', (popup) => popup.close().catch(() => {}));
  lastPage = page;
  const seen = { id: null, sockets: 0, warps: [] };
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    seen.sockets++;
    ws.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'welcome') seen.id = message.id;
      } catch {}
    });
    ws.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.action === 'warp') seen.warps.push(message.targetId);
      } catch {}
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Loading Screen QA');
    // Every change of the loading screen, with what it showed at that moment.
    window.__cover = [];
    // What each frame painted: animation-frame callbacks run just before the paint.
    window.__paint = [];
    let painted = '';
    const frame = () => {
      const root = document.querySelector('#loading-screen');
      const state = !root || root.hidden ? 'hidden' : root.dataset.state;
      if (state !== painted) window.__paint.push({ at: performance.now(), state });
      painted = state;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const watch = setInterval(() => {
      const root = document.querySelector('#loading-screen');
      if (!root) return;
      clearInterval(watch);
      const record = () =>
        window.__cover.push({
          at: performance.now(),
          state: root.hidden ? 'hidden' : root.dataset.state,
          eyebrow: root.querySelector('.loading-screen-place small').textContent,
          place: root.querySelector('.loading-screen-place strong').textContent,
          image: root.querySelector('.loading-screen-art img').getAttribute('src') ?? '',
          art: !root.querySelector('.loading-screen-art').hidden,
          tip: root.querySelector('.loading-screen-tip strong').textContent,
          text: root.querySelector('.loading-screen-tip p').textContent,
          status: root.querySelector('[data-loading-status]').textContent,
          banner: document.querySelector('#area-banner')?.hidden === false,
        });
      // State changes, and content changes while shown (a warp retargeting the cover).
      new MutationObserver(record).observe(root, {
        attributes: true,
        attributeFilter: ['hidden', 'data-state', 'src'],
        childList: true,
        characterData: true,
        subtree: true,
      });
    }, 10);
  });
  return { context, page, seen };
}
async function home(page, room) {
  await page.goto(`http://127.0.0.1:${port}/?room=${room}`);
  await page.locator('#title-start').waitFor();
}
async function start(page, mobile = false) {
  const press = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await press('#title-start');
  await press('.character-choice:has(input[value="cro-male"])');
  await press('#setup-flow-yes');
}
async function caveReady(page) {
  await page
    .locator('#loading-cave[data-ready="true"], #render-error')
    .waitFor({ timeout: 180000 });
  if (await page.locator('#render-error').count())
    throw new Error(await page.locator('#render-error').innerText());
}
const cavePosition = async (page) => {
  const [x, z] = (await page.locator('#world').getAttribute('data-cave-position'))
    .split(',')
    .map(Number);
  return { x, z };
};
async function fit(page, selectors) {
  const viewport = page.viewportSize();
  for (const selector of selectors) {
    const r = await page.locator(selector).boundingBox();
    assert.ok(
      r &&
        r.x >= -1 &&
        r.y >= -1 &&
        r.x + r.width <= viewport.width + 1 &&
        r.y + r.height <= viewport.height + 1,
      `${selector}: ${JSON.stringify(r)} in ${JSON.stringify(viewport)}`,
    );
  }
}
async function pad(page, { axes = [0, 0, 0, 0], pressed = [] } = {}) {
  await page.evaluate(
    ({ axes, pressed }) => {
      window.__qaPad = {
        connected: true,
        index: 0,
        id: 'Loading Screen QA (STANDARD GAMEPAD)',
        mapping: 'standard',
        timestamp: performance.now(),
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({
          pressed: pressed.includes(i),
          touched: pressed.includes(i),
          value: pressed.includes(i) ? 1 : 0,
        })),
      };
      navigator.getGamepads = () => [window.__qaPad];
    },
    { axes, pressed },
  );
}
async function tap(page, button) {
  await pad(page, { pressed: [button] });
  await sleep(250);
  await pad(page);
  await sleep(250);
}
async function credits(page) {
  const dialog = page.locator('#modal[open] .contributors-dialog');
  await dialog.waitFor();
  const people = titleContributors();
  assert.equal(await dialog.locator('.contributor').count(), people.length);
  assert.equal(await page.locator('#contributors-cave').count(), 0, 'no visit from the cave');
  assert.equal(await dialog.locator('.modal-intro').count(), 0);
  const dots = dialog.locator('div.contributor', { hasText: 'OpenAI Dots' });
  assert.equal(await dots.count(), 1, 'OpenAI Dots is listed without a link');
  await page.waitForFunction(() => {
    const image = document.querySelector('img[src="/title/avatar-dots.jpg"]');
    return image?.complete && image.naturalWidth === 200;
  });
  return dialog;
}
async function warpMenu(page) {
  await page.keyboard.press('Escape');
  await page.locator('.pause-menu').waitFor();
  await page.locator('[data-pause-tab="warp"]').click();
}
/** The cover from its appearance after `since` until it is hidden again. */
async function coverRun(page, since, timeout = 240000) {
  await page.waitForFunction(
    (since) => window.__cover.some((entry) => entry.at > since && entry.state === 'shown'),
    since,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (since) => window.__cover.some((entry) => entry.at > since && entry.state === 'hidden'),
    since,
    { timeout },
  );
  const log = (await page.evaluate(() => window.__cover)).filter((entry) => entry.at > since);
  const shown = log.find((entry) => entry.state === 'shown'),
    leaving = log.find((entry) => entry.state === 'leaving'),
    hidden = log.find((entry) => entry.state === 'hidden');
  assert.ok(shown && leaving && hidden, JSON.stringify(log));
  assert.ok(tipTitles.has(shown.tip) && shown.text.length > 0, shown.tip);
  // Timer granularity aside, the tip stays readable at least the minimum.
  assert.ok(leaving.at - shown.at >= LOADING_TIMING.minimumMs - 20, JSON.stringify(log));
  // And it is on screen that long: painted within a few frames of appearing (before the
  // arrival's work), and still painted until it starts to fade.
  const paint = (await page.evaluate(() => window.__paint)).filter((entry) => entry.at > since);
  const firstPaint = paint.find((entry) => entry.state === 'shown'),
    leavePaint = paint.find((entry) => entry.state === 'leaving');
  assert.ok(firstPaint && leavePaint, JSON.stringify(paint));
  assert.ok(firstPaint.at - shown.at <= 120, `first painted after ${firstPaint.at - shown.at} ms`);
  assert.ok(
    leavePaint.at - firstPaint.at >= LOADING_TIMING.minimumMs - 120,
    `painted for ${leavePaint.at - firstPaint.at} ms`,
  );
  covers.push({
    log,
    shownMs: Math.round(leaving.at - shown.at),
    firstPaintMs: Math.round(firstPaint.at - shown.at),
    paintedMs: Math.round(leavePaint.at - firstPaint.at),
  });
  return { log, shown, leaving };
}
const now = (page) => page.evaluate(() => performance.now());

let failure;
try {
  // Desktop: the credits over the loading cave, with keyboard and controller.
  const desktop = await open();
  const { page } = desktop;
  let release, releaseCave;
  const held = new Promise((r) => (release = r));
  // The cave itself is held first, so its own preparation can be seen.
  const caveHeld = new Promise((r) => (releaseCave = r));
  await page.route('**/*.glb', async (route) => {
    const url = route.request().url();
    if (/\/models\/camp-cave\//.test(url)) await caveHeld;
    else if (!/\/models\/(cro-magnon-hunter|firewood-log)\//.test(url)) await held;
    await route.continue().catch(() => {});
  });
  await home(page, 'COVERQA');
  // The cover sits above the HUD and its hand controls, below a failure and the
  // lost-context notice (probe panels are removed at once). The game module adds the
  // cover and the hand controls after the title shell.
  await page.waitForFunction(
    () => document.querySelector('#loading-screen') && document.querySelector('#motion-controls'),
    null,
    { timeout: 60000 },
  );
  const layers = await page.evaluate(() => {
    const viewport = document.querySelector('.game-viewport');
    const probe = (className, id = '') => {
      const node = document.createElement('div');
      if (className) node.className = className;
      if (id) node.id = id;
      viewport.append(node);
      const z = Number(getComputedStyle(node).zIndex);
      node.remove();
      return z;
    };
    return {
      hud: probe('status-plate'),
      hands: Number(getComputedStyle(document.querySelector('#motion-controls')).zIndex),
      cave: probe('', 'loading-cave'),
      cover: Number(getComputedStyle(document.querySelector('#loading-screen')).zIndex),
      failure: probe('render-error'),
      lost: probe('context-recovery'),
    };
  });
  assert.ok(
    layers.hud < layers.hands &&
      layers.hands < layers.cave &&
      layers.cave < layers.cover &&
      layers.cover < layers.failure &&
      layers.failure < layers.lost,
    JSON.stringify(layers),
  );
  pass(
    'Layer order: HUD < hand controls < loading cave < loading screen < failure < lost-context',
    layers,
  );
  let since = await now(page);
  await start(page);
  // The cave's own load (held here) is covered by the loading screen and a tip.
  await page.waitForFunction(
    (since) => window.__paint.some((entry) => entry.at > since && entry.state === 'shown'),
    since,
    { timeout: 10000 },
  );
  assert.equal(await page.locator('#loading-cave').count(), 1);
  assert.equal(await page.locator('#loading-cave .loading-tip').count(), 0, 'no tip in the cave');
  const back = await page.locator('[data-cave-back]').boundingBox();
  assert.equal(
    await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#loading-screen'),
      { x: back.x + back.width / 2, y: back.y + back.height / 2 },
    ),
    true,
    'the screen lies over the cave',
  );
  assert.equal(await page.locator('[data-loading-status]').innerText(), '洞窟を準備しています');
  await page
    .locator('#loading-screen .loading-tip')
    .evaluate((card) => Promise.all(card.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `${out}/cave-loading-desktop.png` });
  releaseCave();
  await caveReady(page);
  const caveLoad = await coverRun(page, since);
  assert.equal(caveLoad.shown.eyebrow, '');
  assert.equal(caveLoad.shown.place, site('cave').name);
  assert.equal(caveLoad.shown.image, '/spawn/cave.jpg');
  // Lifted once the cave is shown: inside the cave there are no tips.
  assert.equal(await page.locator('#loading-screen').isVisible(), false);
  assert.equal(await page.locator('#loading-cave .loading-tip').count(), 0);
  const caveShownAt = caveLoad.log.find((entry) => entry.state === 'hidden').at;
  await page.screenshot({ path: `${out}/cave-shown-desktop.png` });
  pass("The cave's own load is covered by the loading screen and a tip; inside it, none", {
    tip: caveLoad.shown.tip,
    shownMs: covers.at(-1).shownMs,
    firstPaintMs: covers.at(-1).firstPaintMs,
  });
  await fit(page, ['[data-cave-contributors]', '[data-cave-back]', '[data-cave-proceed]']);
  await page.locator('[data-cave-contributors]').click();
  await credits(page);
  await page.screenshot({ path: `${out}/cave-credits-desktop.png` });
  const before = await cavePosition(page);
  await page.keyboard.down('w');
  await sleep(700);
  await page.keyboard.up('w');
  assert.ok(gap(before, await cavePosition(page)) < 0.05, 'keys belong to the dialog');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  assert.equal(await page.locator('#loading-cave').count(), 1, 'Escape closed only the dialog');
  assert.equal(await page.locator('#screen-title').isVisible(), false);
  assert.equal(desktop.seen.sockets, 0);
  await page.keyboard.down('w');
  await sleep(700);
  await page.keyboard.up('w');
  assert.ok(gap(before, await cavePosition(page)) > 0.5, 'the cave walks again after closing');
  pass('Loading-cave credits: OpenAI Dots listed, no cave visit, keys held by the dialog');

  await page.locator('[data-cave-contributors]').click();
  await credits(page);
  const still = await cavePosition(page);
  await pad(page, { axes: [0, -1, 0, 0] });
  await sleep(700);
  await pad(page);
  assert.ok(gap(still, await cavePosition(page)) < 0.05, 'the stick belongs to the dialog');
  release();
  await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 240000 });
  // A with the world ready acts in the dialog, never entering the world.
  await tap(page, 0);
  await sleep(600);
  assert.equal(desktop.seen.sockets, 0, 'A in the dialog did not enter the world');
  assert.equal(await page.locator('#loading-cave').count(), 1);
  if (await page.locator('#modal[open]').count()) await tap(page, 1);
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  assert.equal(desktop.seen.sockets, 0);
  pass('Controller in the dialog: the stick does not walk and A does not enter the world');
  await tap(page, 0);
  await page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#world').dataset.glbPlayers === '1', {
    timeout: 180000,
  });
  assert.equal(desktop.seen.sockets, 1);
  assert.ok(
    !(await page.evaluate(() => window.__cover)).some(
      (entry) => entry.at > caveShownAt && entry.state === 'shown',
    ),
    'entering the world from the cave shows no loading screen',
  );
  await page.evaluate(() => {
    navigator.getGamepads = () => [];
  });
  pass('A after closing the dialog proceeds as before; the cave entry shows no loading screen');

  // A warp from the menu: the destination, its photo and a tip until it is drawn.
  const room = game.rooms.get('COVERQA');
  const me = () => room.players.get(desktop.seen.id);
  await warpMenu(page);
  const castle = site('castle');
  const castleCard = page.locator('[data-warp-spawn="castle"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-warp-spawn="castle"]')?.getAttribute('aria-disabled') ===
      'false',
  );
  since = await now(page);
  await castleCard.click();
  await page.waitForFunction(
    (since) => window.__paint.some((entry) => entry.at > since && entry.state === 'shown'),
    since,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${out}/warp-castle-desktop.png` });
  const warpCastle = await coverRun(page, since);
  assert.equal(warpCastle.shown.eyebrow, 'ワープ');
  // One deck: a tip read in the cave does not come back so soon.
  assert.notEqual(warpCastle.shown.tip, caveLoad.shown.tip);
  assert.equal(warpCastle.shown.place, castle.name);
  assert.equal(warpCastle.shown.image, '/spawn/castle.jpg');
  assert.equal(warpCastle.shown.art, true);
  assert.ok(gap(me(), castle) <= 8, 'arrived at the castle');
  const arrival = JSON.parse(await page.locator('#world').getAttribute('data-arrival-landmarks'));
  assert.ok(arrival.ids.includes('valley-castle') && arrival.instanced, JSON.stringify(arrival));
  // The floor the screen waited for is the destination's, not the place left behind.
  const floorAt = ({ floor: [x, z] }) => ({ x, z });
  assert.ok(gap(floorAt(arrival), castle) <= 8, JSON.stringify(arrival));
  await page.screenshot({ path: `${out}/warp-castle-arrived.png` });
  // Once it lifts, the controller opens the menu again; then the keyboard closes it. The
  // pad connects first: a button already held when a pad connects is ignored.
  await pad(page);
  await sleep(200);
  await tap(page, 9);
  await page.locator('.pause-menu').waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.evaluate(() => {
    navigator.getGamepads = () => [];
  });
  await page.keyboard.press('Escape');
  await page.locator('.pause-menu').waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  pass('Menu warp: castle name, photo and a tip; input held, landmarks drawn, play resumes', {
    shownMs: covers.at(-1).shownMs,
    arrival,
  });

  // A far map fire in another region: no photo, a new biome's ground to stream, and
  // the region's banner only once the screen lifts.
  // Its glacier landmarks are held back, so the screen deterministically stays up while
  // every kind of input is tried behind it.
  const fire = WARP_POINTS.find((point) => point.id === 'fire-ice');
  let releaseGlaciers;
  const glaciers = new Promise((resolve) => (releaseGlaciers = resolve));
  let glacierRequests = 0;
  await page.route(/\/models\/glacier-[a-z-]+\/[^?]*\.glb/, async (route) => {
    glacierRequests++;
    await glaciers;
    await route.continue().catch(() => {});
  });
  await page.keyboard.press('m');
  await page.locator(`[data-warp-point="${fire.id}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#map-warp').disabled, null, {
    timeout: 10000,
  });
  since = await now(page);
  await page.locator('#map-warp').click();
  await page.waitForFunction(
    (since) => window.__paint.some((entry) => entry.at > since && entry.state === 'shown'),
    since,
    { timeout: 5000 },
  );
  await until(() => glacierRequests > 0, 'the destination landmarks are requested');
  const stillAt = { x: me().x, z: me().z };
  await page.keyboard.down('w');
  await sleep(300);
  await page.keyboard.up('w');
  const mapButton = await page.locator('#map-button').boundingBox();
  await page.mouse.click(mapButton.x + mapButton.width / 2, mapButton.y + mapButton.height / 2);
  await pad(page, { axes: [0, -1, 0, 0] });
  await sleep(250);
  await pad(page);
  await tap(page, 9);
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await page.locator('#loading-screen').getAttribute('data-state'), 'shown');
  assert.equal(await page.locator('#modal[open]').count(), 0, 'no menu or map behind the screen');
  assert.ok(gap(stillAt, me()) < 0.05, 'no movement behind the screen');
  await page.screenshot({ path: `${out}/warp-fire-held.png` });
  releaseGlaciers();
  const warpFire = await coverRun(page, since);
  await page.evaluate(() => {
    navigator.getGamepads = () => [];
  });
  assert.equal(warpFire.shown.place, fire.name);
  assert.equal(warpFire.shown.art, false);
  assert.ok(gap(me(), fire) <= 8);
  const fireArrival = JSON.parse(
    await page.locator('#world').getAttribute('data-arrival-landmarks'),
  );
  assert.ok(gap(floorAt(fireArrival), fire) <= 8, JSON.stringify(fireArrival));
  assert.ok(
    warpFire.log.every((entry) => entry.state !== 'shown' || !entry.banner),
    'no banner behind the screen',
  );
  await page.locator('#area-banner:not([hidden])').waitFor({ timeout: 3000 });
  assert.match(await page.locator('#area-banner strong').innerText(), new RegExp(fire.name));
  await page.screenshot({ path: `${out}/warp-fire-arrived.png` });
  pass('Map fire warp: named without a photo; the new region is announced after the screen', {
    fire: fire.name,
    shownMs: covers.at(-1).shownMs,
    arrival: fireArrival,
  });

  // Back to the title and in again, with the world already loaded: covered, no cave.
  await page.keyboard.press('Escape');
  await page.locator('.pause-menu').waitFor();
  if (await page.locator('.pause-more').isVisible()) await page.locator('.pause-more').click();
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#title-start').waitFor();
  since = await now(page);
  await start(page);
  const reentry = await coverRun(page, since);
  assert.equal(reentry.shown.eyebrow, '');
  assert.equal(reentry.shown.place, '');
  assert.equal(await page.locator('#loading-cave').count(), 0);
  assert.equal(desktop.seen.sockets, 2);
  await page.screenshot({ path: `${out}/reentry-arrived.png` });
  pass('Re-entry from the title is covered until the player stands in the world', {
    shownMs: covers.at(-1).shownMs,
    arrival: JSON.parse(await page.locator('#world').getAttribute('data-arrival-landmarks')),
  });
  assert.deepEqual(desktop.seen.warps, ['spawn-castle', fire.id]);
  await desktop.context.close();

  // Phone: the cave's load covered upright, header buttons fit, the dialog by touch,
  // a warp cover held upright.
  const phone = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  await home(phone.page, 'COVERPHONE');
  since = await now(phone.page);
  await start(phone.page, true);
  await phone.page.locator('#loading-screen[data-state="shown"]').waitFor({ timeout: 10000 });
  await fit(phone.page, [
    '.loading-screen-place strong',
    '.loading-screen-tip',
    '.loading-screen-status',
  ]);
  await phone.page
    .locator('#loading-screen .loading-tip')
    .evaluate((card) => Promise.all(card.getAnimations().map((a) => a.finished)));
  await phone.page.screenshot({ path: `${out}/cave-loading-phone.png` });
  await caveReady(phone.page);
  const phoneCave = await coverRun(phone.page, since);
  assert.equal(phoneCave.shown.place, site('cave').name);
  assert.equal(await phone.page.locator('#loading-cave .loading-tip').count(), 0);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await phone.page.setViewportSize(viewport);
    await sleep(300);
    await fit(phone.page, [
      '[data-cave-contributors]',
      '[data-cave-back]',
      '[data-cave-proceed]',
      '.loading-cave-heading h2',
    ]);
    await phone.page.screenshot({ path: `${out}/cave-header-${viewport.width}.png` });
  }
  await phone.page.locator('[data-cave-contributors]').tap();
  await credits(phone.page);
  await phone.page.screenshot({ path: `${out}/cave-credits-phone.png` });
  await phone.page.locator('#modal-close').tap();
  await phone.page.waitForFunction(() => !document.querySelector('#modal').open);
  assert.equal(await phone.page.locator('#loading-cave').count(), 1);
  await phone.page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 240000 });
  await phone.page.locator('[data-cave-proceed]').tap();
  await phone.page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
  await warpMenu(phone.page);
  const cave = site('cave');
  await phone.page.waitForFunction(
    () =>
      document.querySelector('[data-warp-spawn="cave"]')?.getAttribute('aria-disabled') === 'false',
  );
  since = await now(phone.page);
  await phone.page.locator('[data-warp-spawn="cave"]').tap();
  await phone.page.locator('#loading-screen[data-state="shown"]').waitFor({ timeout: 5000 });
  await fit(phone.page, [
    '.loading-screen-place strong',
    '.loading-screen-tip',
    '.loading-screen-status',
  ]);
  // The page never scrolls sideways (the art's slight zoom is clipped by the screen).
  assert.equal(
    await phone.page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1),
    true,
  );
  await phone.page.screenshot({ path: `${out}/warp-cave-phone.png` });
  const warpCave = await coverRun(phone.page, since);
  assert.equal(warpCave.shown.place, cave.name);
  assert.equal(warpCave.shown.image, '/spawn/cave.jpg');
  const phoneMe = game.rooms.get('COVERPHONE').players.get(phone.seen.id);
  assert.ok(gap(phoneMe, cave) <= 8);
  await phone.page.screenshot({ path: `${out}/warp-cave-phone-arrived.png` });
  pass(
    "Phone: the cave's load covered upright, then no tip; header fits 320–844 px, credits by touch, warp cover fits",
  );
  await phone.context.close();

  // The title's cave visit: covered from the start through its warp to the cave.
  const visit = await open();
  await home(visit.page, 'COVERVISIT');
  await visit.page.locator('#title-contributors').click();
  await visit.page.locator('#contributors-cave').click();
  await visit.page.locator('#loading-screen[data-state="shown"]').waitFor({ timeout: 5000 });
  await visit.page.waitForFunction(
    () =>
      /世界を読み込んでいます \d+%|世界を組み立てています/.test(
        document.querySelector('[data-loading-status]').textContent,
      ),
    null,
    { timeout: 30000 },
  );
  await visit.page.screenshot({ path: `${out}/visit-loading.png` });
  const visitRun = await coverRun(visit.page, 0);
  assert.equal(visitRun.shown.eyebrow, '');
  // The same screen turns to the cave once the join's warp is seen, then lifts there.
  const retargeted = visitRun.log.find(
    (entry) => entry.eyebrow === 'ワープ' && entry.place === cave.name,
  );
  assert.ok(retargeted && retargeted.image === '/spawn/cave.jpg', JSON.stringify(visitRun.log));
  assert.ok(
    visitRun.log.findIndex((entry) => entry.state === 'leaving') > visitRun.log.indexOf(retargeted),
    'one cover: it does not start lifting before it reaches the cave',
  );
  const visitor = game.rooms.get('COVERVISIT').players.get(visit.seen.id);
  assert.ok(gap(visitor, cave) <= 8, 'arrived at the cave');
  assert.deepEqual(visit.seen.warps, ['spawn-cave']);
  assert.equal(await visit.page.locator('#loading-cave').count(), 0);
  const visitArrival = JSON.parse(
    await visit.page.locator('#world').getAttribute('data-arrival-landmarks'),
  );
  assert.ok(visitArrival.instanced, JSON.stringify(visitArrival));
  assert.ok(gap(floorAt(visitArrival), cave) <= 8, JSON.stringify(visitArrival));
  await visit.page.screenshot({ path: `${out}/visit-arrived.png` });
  pass('Title cave visit: one cover from the first download through the warp to the cave', {
    arrival: visitArrival,
  });
  await visit.context.close();

  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error);
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    await writeFile(
      `${out}/failure-state.json`,
      JSON.stringify(
        await lastPage
          .evaluate(() => ({
            cover: window.__cover,
            data: { ...document.querySelector('#world')?.dataset },
            text: document.body.innerText.slice(0, 4000),
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
    JSON.stringify({ ok: !failure, failure: failure?.stack, checks, covers, errors }, null, 2),
  );
  await browser.close();
  await game.close?.();
  process.exit(failure ? 1 : 0);
}
