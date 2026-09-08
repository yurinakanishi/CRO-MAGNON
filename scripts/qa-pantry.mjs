// Two real Chrome views plus three network peers; supply/proximity/time fixtures are explicit.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { SETTLEMENTS, MANY_HEARTHS } = await import(build + 'shared/gulf-region.mjs');
const { PANTRY_FOODS } = await import(build + 'shared/pantry.mjs');
const { villageDay } = await import(build + 'shared/village-sites.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/shared-pantry/r01';
await mkdir(folder, { recursive: true });
let offset = 0;
const core = createGameCore({
  runtime: {
    now: () => Date.now() + offset,
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID(),
  },
});
const game = createGameServer({ core, port: 0, host: '127.0.0.1' });
const address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const pages = [],
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
const room = () => core.rooms.get('PANTRY-QA');
const actor = (name = '分け合いA') => [...room().players.values()].find((p) => p.name === name);
const stock = (id = MANY_HEARTHS.id) =>
  room().gulf.pantries.find((p) => p.settlementId === id).food;
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
function nextDay() {
  const day = villageDay(Date.now() + offset, room().createdAt);
  offset = room().createdAt + day * 240000 + 1000 - Date.now();
  fixtures.push({ kind: 'clock-forward', day: day + 1, purpose: 'daily allowance boundary' });
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function guide(page) {
  await close(page);
  await page.locator('#gulf-button').click();
}
async function pantry(page, id = MANY_HEARTHS.id) {
  await guide(page);
  await page.locator('#gulf-pantry').click();
  await page.locator('#pantry-settlement').selectOption(id);
  assert.ok((await page.locator('body').ariaSnapshot()).includes('共同の食料置き場'));
}
async function food(page, id) {
  await page.locator('#pantry-food-' + id).click();
}
async function transfer(page, type, predicate, label) {
  await page.locator('#pantry-' + type).click();
  await until(predicate, label);
  await sleep(550);
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
  await page.goto(base + '/?room=PANTRY-QA&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loaded: name, base }));
  return page;
}
try {
  const a = await addPage('分け合いA', 'cro', true);
  await shot(a, '01-loaded');
  const b = await addPage('分け合いB', 'bear');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=PANTRY-QA&name=Peer${i}`);
    peers.push(peer);
    await new Promise((resolve) => peer.once('open', resolve));
  }
  await until(() => room().players.size === 5, 'five players');
  timer = setInterval(() => {
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const p of [...room().players.values(), ...room().residents])
      if (!room().collision.free(p, p.radius, ridingObstacles(room(), null, p)))
        violations.push({ observation: observations, id: p.id, x: p.x, z: p.z });
  }, 250);
  const ap = actor(),
    bp = actor('分け合いB');
  place(ap, { x: MANY_HEARTHS.x - 2, z: MANY_HEARTHS.z + 5 }, 'donor beside shared hearth');
  place(bp, { x: MANY_HEARTHS.x + 2, z: MANY_HEARTHS.z + 5 }, 'recipient beside shared hearth');
  for (const f of PANTRY_FOODS) {
    ap.inventory[f.id] = 4;
    bp.inventory[f.id] = 0;
  }
  bp.energy = 25;
  bp.inventory.shells = 0;
  fixtures.push({
    kind: 'supplies',
    player: ap.name,
    food: Object.fromEntries(PANTRY_FOODS.map((f) => [f.id, 4])),
    purpose: 'prepared six-food donor; gathering/cooking is not claimed',
  });
  fixtures.push({
    kind: 'supplies',
    player: bp.name,
    food: 0,
    energy: 25,
    shells: 0,
    purpose: 'empty recipient and measurable meal',
  });
  await sleep(600);
  await pantry(a);
  await pantry(b);
  for (const f of PANTRY_FOODS) {
    await food(a, f.id);
    await transfer(a, 'give', () => stock()[f.id] === 1, 'deposit ' + f.id);
    await b.waitForFunction(
      ({ id }) => document.querySelector('#pantry-count-' + id)?.textContent.includes('置き場 1'),
      { id: f.id },
    );
  }
  completed.push(
    'six food types donated through UI; second Chrome sees shared quantities; five simultaneous players',
  );
  await shot(b, '02-shared-food');
  await food(b, 'cookedShellfish');
  await transfer(b, 'take', () => bp.inventory.cookedShellfish === 1, 'receive shellfish');
  await transfer(
    b,
    'eat',
    () => bp.inventory.cookedShellfish === 0 && bp.inventory.shells === 1,
    'eat shellfish',
  );
  assert.equal(bp.energy, 45);
  await food(a, 'cookedShellfish');
  await transfer(a, 'give', () => stock().cookedShellfish === 1, 'second shellfish');
  await transfer(b, 'take', () => bp.inventory.cookedShellfish === 1, 'shellfish for resident');
  await food(b, 'berry');
  await transfer(b, 'take', () => bp.inventory.berry === 1, 'third daily item');
  assert.equal(bp.gulf.pantryAllowance.taken, 3);
  await food(b, 'cookedMeat');
  assert.ok(await b.locator('#pantry-take').isDisabled());
  await b.locator('#pantry-settlement').selectOption('long-valley');
  assert.ok((await b.locator('#pantry-allowance').innerText()).includes('あと0個'));
  assert.ok(await b.locator('#pantry-give').isDisabled());
  const saved = {
    id: bp.id,
    inventory: structuredClone(bp.inventory),
    allowance: structuredClone(bp.gulf.pantryAllowance),
  };
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => actor('分け合いB'), 'resumed player');
  const resumed = actor('分け合いB');
  assert.equal(resumed.id, saved.id);
  assert.deepEqual(resumed.inventory, saved.inventory);
  assert.deepEqual(resumed.gulf.pantryAllowance, saved.allowance);
  await pantry(b);
  assert.ok((await b.locator('#pantry-allowance').innerText()).includes('あと0個'));
  completed.push(
    'recipient eats donated shellfish and gains shell; three-item cap follows locations and same-tab reload',
  );
  await shot(b, '03-daily-limit');

  // Use the received cooked shellfish in the existing daily-help flow.
  const neri = room().residents.find((n) => n.id === 'neri');
  place(resumed, { x: neri.x, z: neri.z + 1.5 }, 'reach Neri for food handover');
  await sleep(600);
  await guide(b);
  await b.locator('#gulf-residents').click();
  await b.locator('#village-settlement').selectOption('reed-shore');
  await b.locator('#resident-open-neri').click();
  const seeds = resumed.inventory.seed,
    shells = resumed.inventory.shells;
  await b.locator('#resident-help').click();
  await until(
    () => resumed.inventory.cookedShellfish === 0 && resumed.inventory.seed === seeds + 2,
    'Neri handover',
  );
  assert.equal(resumed.inventory.shells, shells + 1);
  completed.push('received shellfish completes Neri daily help through conversation UI');

  nextDay();
  place(
    resumed,
    { x: MANY_HEARTHS.x + 2, z: MANY_HEARTHS.z + 5 },
    'return recipient to pantry for feast',
  );
  await sleep(600);
  await pantry(b);
  await food(b, 'cookedFish');
  await transfer(b, 'take', () => resumed.inventory.cookedFish === 1, 'fish on next day');
  room().gulf.stores = { wood: 8, berry: 9, obsidian: 4 };
  fixtures.push({
    kind: 'feast-stores',
    stores: { wood: 8, berry: 9, obsidian: 4 },
    purpose: 'prepare remaining contribution; pantry supplies final fish',
  });
  await guide(b);
  await b.locator('[data-gulf-tab="many-hearths"]').click();
  await b.locator('#gulf-fishing').click();
  await b.locator('#fish-offer').click();
  await until(() => room().gulf.festivals === 1, 'shared fish feast');
  assert.equal(resumed.inventory.cookedFish, 0);
  completed.push(
    'next server day restores allowance; received fish completes shared feast through UI',
  );

  // Three berries from another player's pantry complete a household's real preparation action.
  nextDay();
  const valley = SETTLEMENTS.find((s) => s.id === 'long-valley');
  place(ap, { x: valley.x - 2, z: valley.z + 5 }, 'country pantry donor');
  place(resumed, { x: valley.x + 2, z: valley.z + 5 }, 'country pantry recipient');
  resumed.inventory.berry = 0;
  resumed.inventory.wood = 2;
  resumed.inventory.water = 1;
  fixtures.push({
    kind: 'supplies',
    player: resumed.name,
    berry: 0,
    wood: 2,
    water: 1,
    purpose: 'household preparation remainder; all three berries received through pantry',
  });
  await sleep(600);
  await pantry(a, valley.id);
  await food(a, 'berry');
  for (let i = 1; i <= 3; i++)
    await transfer(a, 'give', () => stock(valley.id).berry === i, 'country deposit ' + i);
  await pantry(b, valley.id);
  await food(b, 'berry');
  for (let i = 1; i <= 3; i++)
    await transfer(b, 'take', () => resumed.inventory.berry === i, 'country receive ' + i);
  await guide(b);
  await b.locator('#gulf-residents').click();
  await b.locator('#resident-journeys').click();
  await b.locator('#journey-prepare-valley-hearth').click();
  await until(() => room().households[0].stage !== 'home', 'household preparation');
  assert.equal(resumed.inventory.berry, 0);
  completed.push(
    'three player-donated berries at country pantry start existing two-person household journey',
  );

  // Controller menu input is simulated; application, focus, DOM and network remain real.
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
    for (let i = 0; i < 50; i++) {
      if (await a.locator(selector).evaluate((n) => n.classList.contains('gamepad-focus'))) return;
      await tap(PAD.down);
    }
    throw Error('Unreachable controller target ' + selector);
  };
  await pantry(a, valley.id);
  await input();
  await select('#pantry-food-cookedMeat');
  await tap(PAD.cross);
  assert.equal(await a.locator('#pantry-food-cookedMeat').getAttribute('aria-pressed'), 'true');
  await a.evaluate(() => {
    window.qaFocus = document.activeElement;
  });
  await sleep(1600);
  assert.ok(
    await a.evaluate(() => window.qaFocus === document.activeElement && window.qaFocus.isConnected),
  );
  await select('#pantry-settlement');
  await tap(PAD.right);
  assert.equal(await a.locator('#pantry-settlement').inputValue(), 'pale-ridge');
  assert.ok(await a.locator('#pantry-give').isDisabled());
  completed.push(
    'D-pad reaches food and settlement selector, confirm chooses food, focus survives live snapshots',
  );
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.setViewportSize({ width, height });
    await input([], [0, 0, 0, 1]);
    await sleep(900);
    await input();
    const layout = await a.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modalOverflow:
        document.querySelector('#modal').scrollWidth >
        document.querySelector('#modal').clientWidth + 2,
      buttons: [...document.querySelectorAll('#pantry-panel button')].map((n) => ({
        id: n.id,
        height: n.getBoundingClientRect().height,
        width: n.getBoundingClientRect().width,
      })),
    }));
    assert.ok(layout.scrollWidth <= width && !layout.modalOverflow);
    assert.ok(layout.buttons.every((n) => n.height >= 43 && n.width <= width));
    viewports.push(layout);
    await shot(a, '04-pantry-' + width);
    await select('#pantry-back');
    await tap(PAD.cross);
    await a.locator('#gulf-detail').waitFor();
    await a.locator('#gulf-pantry').click();
  }
  completed.push(
    '390x844 and 844x390 pane scroll, target sizes, visible back navigation with controller',
  );
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.locator('#pantry-settlement').selectOption('many-hearths');
  const from = { x: ap.x, z: ap.z };
  await a.locator('#pantry-go').click();
  await until(
    () => ap.moving && Math.hypot(ap.x - from.x, ap.z - from.z) > 2,
    'ordinary hearth navigation',
  );
  await a.keyboard.press('m');
  await a.locator('#big-map').waitFor();
  completed.push('selected hearth starts ordinary walking; map stops travel and opens gulf map');
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
          'Two real Chrome views plus three network peers. Proximity, six-food supply, two day boundaries, feast remainder and household wood/water are explicit fixtures. No claims of full harvest/cooking/long-distance walks, physical controller, mobile device, or permanent 60 FPS.',
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
