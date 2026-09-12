// Real Chrome views, ordinary UI/protocol; explicitly prepared proximity and supplies.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { MANY_HEARTHS } = await import(build + 'shared/gulf-region.mjs');
const { KNAPPING_SITES } = await import(build + 'shared/coastal-sites.mjs');
const { BARTER_ITEMS } = await import(build + 'shared/barter.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/barter/r01';
await mkdir(folder, { recursive: true });
const core = createGameCore(),
  game = createGameServer({ core, port: 0, host: '127.0.0.1' });
const address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`;
const browsers = [],
  pages = [],
  peers = [],
  errors = [],
  fixtures = [],
  completed = [],
  viewports = [],
  screenshots = [],
  violations = [];
let observations = 0,
  maxPlayers = 0,
  timer;
const room = () => core.rooms.get('BARTER-QA');
const actor = (name = '交換A') => [...room().players.values()].find((p) => p.name === name);
const trade = () => room().barters.at(-1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, limit = 15000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > limit) throw Error('Timeout: ' + label);
    await sleep(100);
  }
}
function place(p, at, purpose) {
  stopActor(p);
  const free = room().collision.nearestFree(at, p.radius, ridingObstacles(room(), null, p), 3);
  assert.ok(free);
  Object.assign(p, free);
  fixtures.push({ kind: 'position', player: p.name, purpose, ...free });
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function guide(page) {
  await close(page);
  await page.locator('#gulf-button').click();
}
async function barter(page) {
  await guide(page);
  await page.locator('#gulf-barter').click();
}
async function shot(page, name) {
  await page.screenshot({ path: `${folder}/${name}.png` });
  const diagnostic = await page
    .locator('#world')
    .evaluate((c) => ({ fps: c.dataset.fps, chunks: c.dataset.terrainChunks }));
  screenshots.push({ name, ...diagnostic });
  console.log(JSON.stringify({ screenshot: name, ...diagnostic }));
}
async function addPage(name, species, pad = false) {
  // Separate browser processes let both players retain genuine window focus.
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=d3d11'],
  });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ name, species, pad }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', species);
      localStorage.setItem('cro-gender', 'female');
      if (pad) {
        window.qaPad = {
          id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
          index: 0,
          connected: true,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
        };
        Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
      }
    },
    { name, species, pad },
  );
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(base + '/?room=BARTER-QA&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loaded: name, base }));
  return page;
}
async function ready(page, selector) {
  await page.waitForFunction((id) => {
    const n = document.querySelector(id);
    return n && !n.disabled;
  }, selector);
}
async function click(page, selector) {
  await ready(page, selector);
  await page.locator(selector).click();
  await sleep(550);
}
async function offer(page, item, quantity) {
  await page.locator('#barter-item').selectOption(item);
  await page.locator('#barter-quantity').selectOption(String(quantity));
  await click(page, '#barter-offer');
}
function inventories() {
  return structuredClone([actor().inventory, actor('交換B').inventory]);
}
function totals() {
  return Object.fromEntries(
    BARTER_ITEMS.map((f) => [
      f.id,
      [actor(), actor('交換B')].reduce((s, p) => s + (p.inventory[f.id] ?? 0), 0),
    ]),
  );
}
try {
  const a = await addPage('交換A', 'cro', true);
  await shot(a, '01-loaded');
  const b = await addPage('交換B', 'bear');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=BARTER-QA&name=Peer${i}`);
    peers.push(peer);
    await new Promise((resolve) => peer.once('open', resolve));
  }
  await until(() => room().players.size === 5, 'five players');
  const ap = actor(),
    bp = actor('交換B');
  place(
    ap,
    { x: MANY_HEARTHS.x - 7, z: MANY_HEARTHS.z + 10 },
    'two stopped players beside the gathering hearth',
  );
  place(bp, { x: MANY_HEARTHS.x - 5.4, z: MANY_HEARTHS.z + 10 }, 'partner within four metres');
  Object.assign(ap.inventory, {
    obsidian: 6,
    berry: 2,
    wood: 2,
    obsidianBlade: 0,
    cookedShellfish: 0,
  });
  Object.assign(bp.inventory, { obsidian: 0, berry: 8, obsidianBlade: 1, cookedShellfish: 2 });
  ap.energy = 40;
  fixtures.push({
    kind: 'supplies-and-energy',
    a: structuredClone(ap.inventory),
    b: structuredClone(bp.inventory),
    energyA: 40,
    purpose: 'barter inputs; no claim that this QA gathered or cooked them',
  });
  timer = setInterval(() => {
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const p of [...room().players.values(), ...room().residents])
      if (!room().collision.free(p, p.radius, ridingObstacles(room(), null, p)))
        violations.push({ observation: observations, id: p.id, x: p.x, z: p.z });
  }, 250);
  await sleep(700);
  async function start() {
    // Leave the old result before sending a new invitation; closing an active invitation declines it.
    await close(b);
    await barter(a);
    if (await a.locator('#barter-again').count()) await a.locator('#barter-again').click();
    await a.locator('#barter-partner').selectOption(bp.id);
    // The UI invitation gate remains server authoritative; wait out the documented five-second gap.
    if (trade()) await sleep(Math.max(0, trade().createdAt + 5100 - Date.now()));
    await click(a, '#barter-invite');
    await until(() => trade()?.status === 'invited', 'invitation');
    await barter(b);
    await click(b, '#barter-join');
    await until(() => trade()?.status === 'open', 'joined');
  }
  await barter(a);
  await a.locator('#barter-partner').selectOption(bp.id);
  await click(a, '#barter-invite');
  assert.equal(
    await b.locator('#modal').evaluate((d) => d.open),
    false,
    'invitation does not steal recipient UI',
  );
  await b.waitForFunction(() =>
    document.querySelector('#gulf-status').textContent.includes('誘い'),
  );
  await barter(b);
  await click(b, '#barter-join');
  const before = totals();
  await offer(a, 'obsidian', 2);
  await offer(b, 'berry', 3);
  await click(a, '#barter-accept');
  assert.deepEqual(trade().accepted, [true, false]);
  assert.ok(await a.locator('#barter-item').isDisabled());
  await offer(b, 'berry', 4);
  assert.deepEqual(trade().accepted, [false, false]);
  await a.waitForFunction(() =>
    document.querySelector('#barter-other-offer').textContent.includes('4個'),
  );
  completed.push(
    'invitation appears without opening recipient modal; both offers visible; changing berry quantity revokes existing consent',
  );
  await shot(a, '02-two-offers');

  const input = async (buttons = [], axes = [0, 0, 0, 0]) =>
    a.evaluate(
      async ({ buttons, axes }) => {
        window.qaPad.buttons = window.qaPad.buttons.map((_, i) => ({
          pressed: buttons.includes(i),
          value: buttons.includes(i) ? 1 : 0,
        }));
        window.qaPad.axes = axes;
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      },
      { buttons, axes },
    );
  const tap = async (button) => {
    await input([button]);
    await input();
  };
  const select = async (selector) => {
    for (let i = 0; i < 45; i++) {
      if (await a.locator(selector).evaluate((n) => n.classList.contains('gamepad-focus'))) return;
      await tap(PAD.down);
    }
    throw Error('Unreachable controller target ' + selector);
  };
  await input();
  await select('#barter-quantity');
  await tap(PAD.right);
  assert.equal(await a.locator('#barter-quantity').inputValue(), '3');
  assert.ok(
    await a.locator('#barter-accept').isDisabled(),
    'unposted draft cannot accept old offer',
  );
  await a.evaluate(() => {
    window.qaFocus = document.activeElement;
  });
  await offer(b, 'berry', 5);
  await sleep(900);
  assert.ok(
    await a.evaluate(() => window.qaFocus === document.activeElement && window.qaFocus.isConnected),
  );
  assert.equal(await a.locator('#barter-quantity').inputValue(), '3');
  await tap(PAD.left);
  assert.equal(await a.locator('#barter-quantity').inputValue(), '2');
  completed.push(
    'controller selects quantity; unposted draft cannot accept; opponent edit and snapshots preserve draft and focus',
  );
  await select('#barter-accept');
  await ready(a, '#barter-accept');
  await tap(PAD.circle);
  await until(() => trade().accepted[0], 'controller consent');
  await sleep(550);
  await click(a, '#barter-revise');
  assert.deepEqual(trade().accepted, [false, false]);
  await click(a, '#barter-accept');
  await click(b, '#barter-accept');
  await until(() => trade().status === 'complete', 'complete exchange');
  assert.deepEqual(totals(), before);
  assert.equal(ap.inventory.obsidian, 4);
  assert.equal(bp.inventory.obsidian, 2);
  assert.equal(ap.inventory.berry, 7);
  assert.equal(bp.inventory.berry, 3);
  completed.push(
    'explicit withdraw-and-review resets consent; both final consents transfer once; all item totals conserved',
  );
  await shot(a, '03-complete');

  await start();
  await offer(a, 'berry', 1);
  await offer(b, 'obsidianBlade', 1);
  await click(a, '#barter-accept');
  await click(b, '#barter-accept');
  assert.equal(ap.inventory.obsidianBlade, 1);
  assert.equal(bp.inventory.obsidianBlade, 0);
  const pos = { x: ap.x, z: ap.z },
    site = KNAPPING_SITES.find((s) => s.id === 'knap-many-hearths');
  await close(a);
  place(
    ap,
    { x: site.x, z: site.z + 1.5 },
    'use the received blade at the existing stone worksite',
  );
  await sleep(700);
  await guide(a);
  await a.locator('#gulf-coastal').click();
  await click(a, '#stone-haft');
  await until(() => ap.spearHead === 'obsidian', 'received blade attached');
  assert.equal(ap.inventory.obsidianBlade, 0);
  assert.equal(bp.species, 'bear');
  place(ap, pos, 'return to the partner after worksite use');
  await sleep(700);
  completed.push(
    'received blade attaches to human wooden spear through existing worksite UI; mage participant retains species',
  );

  await start();
  await offer(a, 'berry', 1);
  await offer(b, 'cookedShellfish', 1);
  await click(a, '#barter-accept');
  await click(b, '#barter-accept');
  const shellCount = ap.inventory.shells,
    energy = ap.energy;
  await guide(a);
  await a.locator('#gulf-coastal').click();
  await click(a, '#shell-eat');
  await until(() => ap.inventory.shells === shellCount + 1, 'eat received shellfish');
  assert.equal(ap.energy, energy + 20);
  completed.push(
    'received cooked shellfish is eaten through existing UI, restoring energy and leaving a shell',
  );

  await start();
  await offer(a, 'obsidian', 1);
  await offer(b, 'berry', 1);
  const cancelBefore = inventories();
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.setViewportSize(size);
    await input([], [0, 0, 0, 1]);
    await sleep(500);
    await input();
    const layout = await a.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modalOverflow:
        document.querySelector('#modal').scrollWidth >
        document.querySelector('#modal').clientWidth + 2,
      buttons: [...document.querySelectorAll('#barter-panel button')].map((n) => ({
        id: n.id,
        height: n.getBoundingClientRect().height,
        width: n.getBoundingClientRect().width,
      })),
    }));
    assert.ok(layout.scrollWidth <= size.width && !layout.modalOverflow);
    assert.ok(layout.buttons.every((n) => n.height >= 43 && n.width <= size.width));
    viewports.push(layout);
    await shot(a, '04-barter-' + size.width);
  }
  await select('#barter-back');
  await tap(PAD.triangle);
  await a.locator('#gulf-detail').waitFor();
  await until(() => trade().status === 'cancelled', 'controller back cancels');
  assert.deepEqual(inventories(), cancelBefore);
  completed.push(
    '390x844 and 844x390 fit with scroll and 44px buttons; simulated controller right-face confirm on Back cancels without losing items',
  );
  await a.setViewportSize({ width: 1440, height: 900 });
  await start();
  await offer(a, 'obsidian', 1);
  await offer(b, 'berry', 1);
  await a.evaluate(() => window.dispatchEvent(new Event('blur')));
  await until(() => trade().status === 'cancelled', 'focus loss cancels');
  assert.deepEqual(inventories(), cancelBefore);
  completed.push('simulated window focus loss cancels the pending exchange without item loss');
  await start();
  await offer(a, 'obsidian', 1);
  await offer(b, 'berry', 1);
  const saved = { id: ap.id, inventory: structuredClone(ap.inventory), spearHead: ap.spearHead };
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => actor()?.id === saved.id, 'resumed same player');
  assert.equal(trade().status, 'cancelled');
  assert.deepEqual(actor().inventory, saved.inventory);
  assert.equal(actor().spearHead, saved.spearHead);
  await barter(a);
  await shot(a, '05-reconnected');
  completed.push(
    'same-tab reload cancels unfinished agreement while retaining exchanged inventory and upgraded spear',
  );
  assert.equal(maxPlayers, 5);
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
} catch (e) {
  errors.push(String(e));
  console.error(e);
  process.exitCode = 1;
  for (let i = 0; i < pages.length; i++) {
    await shot(pages[i], 'failure-' + i).catch(() => {});
    await writeFile(
      `${folder}/failure-${i}.txt`,
      await pages[i]
        .locator('body')
        .ariaSnapshot()
        .catch(() => ''),
    );
  }
} finally {
  clearInterval(timer);
  await writeFile(
    folder + '/report.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        errors,
        fixtures,
        completed,
        viewports,
        screenshots,
        observations,
        maxPlayers,
        violations,
        scope:
          'Two real Chrome views and three network peers. Proximity, supplies and initial energy are explicit fixtures. Window blur and Gamepad API inputs are simulated. No claim of physical controllers/mobile hardware, all gathering/cooking, long-distance travel, long-duration load or constant 60FPS.',
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.close();
  for (const browser of browsers) await browser.close();
  await game.close();
}
