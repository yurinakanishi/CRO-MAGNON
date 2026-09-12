// Real Chrome UI and residents; supply, afternoon positions, visits and clock changes are explicit fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { MANY_HEARTHS } = await import(build + 'shared/gulf-region.mjs');
const { RESIDENTS } = await import(build + 'shared/village-sites.mjs');
const { householdAssignment } = await import(build + 'shared/household-life.mjs');
const { HOUSEHOLDS } = await import(build + 'shared/household-sites.mjs');
const { MIDDEN_SITES } = await import(build + 'shared/coastal-sites.mjs');
const { PANTRY_FOODS, supperTotal } = await import(build + 'shared/pantry.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/resident-supper/r01';
await mkdir(folder, { recursive: true });
let offset = 0;
const core = createGameCore({
  runtime: {
    now: () => Date.now() + offset,
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID(),
  },
});
const game = createGameServer({ core, port: 0, host: '127.0.0.1' }),
  address = await game.listen(),
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
  screenshots = [],
  viewports = [],
  violations = [];
let observations = 0,
  maxPlayers = 0,
  timer;
const room = () => core.rooms.get('SUPPER-QA'),
  actor = (name = '夕食A') => [...room().players.values()].find((p) => p.name === name),
  stock = () => room().gulf.pantries.find((p) => p.settlementId === MANY_HEARTHS.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, limit = 15000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > limit) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
function place(p, at, purpose) {
  stopActor(p);
  const free = room().collision.nearestFree(at, p.radius, ridingObstacles(room(), null, p), 3);
  assert.ok(free);
  Object.assign(p, free);
  fixtures.push({ kind: 'position', id: p.id, purpose, ...free });
}
function clock(elapsed, purpose) {
  offset = room().createdAt + elapsed - Date.now();
  fixtures.push({ kind: 'clock', elapsed, purpose });
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function guide(page) {
  await close(page);
  await page.locator('#gulf-button').click();
}
async function pantry(page) {
  await guide(page);
  await page.locator('#gulf-pantry').click();
  await page.locator('#pantry-settlement').selectOption('many-hearths');
}
async function supper(page) {
  await pantry(page);
  await page.locator('#pantry-supper').click();
}
async function click(page, id) {
  await page.waitForFunction((id) => {
    const n = document.querySelector(id);
    return n && !n.disabled;
  }, id);
  await page.locator(id).click();
  await sleep(550);
}
async function food(page, id) {
  await page.locator('#supper-food-' + id).click();
}
async function shot(page, name) {
  await page.screenshot({ path: folder + '/' + name + '.png' });
  const d = await page
    .locator('#world')
    .evaluate((c) => ({ fps: c.dataset.fps, chunks: c.dataset.terrainChunks }));
  screenshots.push({ name, ...d });
  console.log(JSON.stringify({ screenshot: name, ...d }));
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
  await page.goto(base + '/?room=SUPPER-QA&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loaded: name, base }));
  return page;
}
try {
  const a = await addPage('夕食A', 'cro', true);
  await shot(a, '01-loaded');
  const b = await addPage('夕食B', 'bear');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=SUPPER-QA&name=Peer${i}`);
    peers.push(peer);
    await new Promise((r) => peer.once('open', r));
  }
  await until(() => room().players.size === 5, 'five players');
  const ap = actor(),
    bp = actor('夕食B');
  place(
    ap,
    { x: MANY_HEARTHS.x - 2, z: MANY_HEARTHS.z + 5 },
    'prepare supper beside the main hearth',
  );
  place(
    bp,
    { x: MANY_HEARTHS.x + 2, z: MANY_HEARTHS.z + 5 },
    'other player beside same food store',
  );
  for (const f of PANTRY_FOODS) {
    ap.inventory[f.id] = 4;
    bp.inventory[f.id] = 0;
  }
  bp.inventory.shells = 0;
  fixtures.push({
    kind: 'inventory',
    a: structuredClone(ap.inventory),
    b: structuredClone(bp.inventory),
    purpose: 'food source for serving; no claim of gathering/cooking this stock',
  });
  clock(70000, 'afternoon preparation');
  for (const [i, h] of room().households.entries())
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: room().createdAt + 600000,
    });
  fixtures.push({
    kind: 'household-visits',
    purpose: 'all three visiting households; full journeys were not walked in this browser test',
  });
  for (const n of room().residents) {
    const d = RESIDENTS.find((d) => d.id === n.id),
      target = householdAssignment(room(), n.id, 1)?.target ?? d.routine[1];
    place(n, target, 'afternoon work position before ordinary evening walk');
    n.routineKey = '';
    n.destination = null;
  }
  timer = setInterval(() => {
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const p of [...room().players.values(), ...room().residents])
      if (!room().collision.free(p, p.radius, ridingObstacles(room(), null, p)))
        violations.push({ observation: observations, id: p.id, x: p.x, z: p.z });
  }, 250);
  await sleep(700);
  await pantry(a);
  await click(a, '#pantry-give');
  assert.equal(stock().food.berry, 1);
  await a.locator('#pantry-supper').click();
  await supper(b);
  for (const f of PANTRY_FOODS) {
    await food(a, f.id);
    await click(a, '#supper-give');
    await b.waitForFunction(
      (id) => document.querySelector('#supper-count-' + id).textContent.includes('夕食 1'),
      f.id,
    );
  }
  completed.push(
    'six foods explicitly reserved through normal UI; second Chrome sees stock; common berry remains separate',
  );
  await food(a, 'cookedRoot');
  await click(a, '#supper-release');
  assert.equal(stock().supper.cookedRoot, 0);
  assert.equal(stock().food.cookedRoot, 1);
  await pantry(b);
  await b.locator('#pantry-food-cookedRoot').click();
  await click(b, '#pantry-take');
  assert.equal(bp.inventory.cookedRoot, 1);
  assert.equal(bp.gulf.pantryAllowance.taken, 1);
  await b.locator('#pantry-supper').click();
  await food(b, 'cookedRoot');
  await click(b, '#supper-give');
  assert.equal(bp.inventory.cookedRoot, 0);
  assert.equal(stock().supper.cookedRoot, 1);
  await food(a, 'cookedShellfish');
  await click(a, '#supper-give');
  await click(a, '#supper-give');
  assert.equal(supperTotal(stock()), 8);
  completed.push(
    'unused supper returns to common food; another player receives it under the daily allowance and reserves it again',
  );
  await shot(a, '02-eight-suppers');
  clock(
    117000,
    'evening begins in three seconds; subsequent resident walking and eating use real elapsed time',
  );
  await close(a);
  await until(
    () => room().residents.some((n) => n.activity.includes('炉へ歩')),
    'residents walking to hearth',
    10000,
  );
  await shot(a, '03-evening-walk');
  await until(
    () => room().residents.every((n) => n.supper?.day === 1),
    'all eight eat after reaching the hearths',
    55000,
  );
  assert.equal(supperTotal(stock()), 0);
  assert.equal(stock().food.berry, 1);
  assert.equal(stock().supperShells, 3);
  await b.waitForFunction(() =>
    document.querySelector('#supper-attendance').textContent.includes('8/8'),
  );
  completed.push(
    'all eight residents follow actual evening walks from prepared afternoon positions, then consume exactly eight reserved portions; three shells remain and common food is preserved',
  );
  await shot(b, '04-everyone-fed');
  await supper(a);
  await food(a, 'berry');
  await click(a, '#supper-give');
  await sleep(1100);
  assert.equal(stock().supper.berry, 1, 'one supper per resident per day');
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
  const tap = async (b) => {
    await input([b]);
    await input();
  };
  const select = async (selector) => {
    for (let i = 0; i < 50; i++) {
      if (await a.locator(selector).evaluate((n) => n.classList.contains('gamepad-focus'))) return;
      await tap(PAD.down);
    }
    throw Error('Unreachable controller item ' + selector);
  };
  await input();
  await select('#supper-food-herbRoot');
  await tap(PAD.circle);
  assert.equal(await a.locator('#supper-food-herbRoot').getAttribute('aria-pressed'), 'true');
  await a.evaluate(() => {
    window.qaFocus = document.activeElement;
  });
  for (let i = 0; i < 3; i++) await click(b, '#supper-shell-take');
  assert.equal(bp.inventory.shells, 3);
  assert.equal(stock().supperShells, 0);
  assert.ok(
    await a.evaluate(() => window.qaFocus === document.activeElement && window.qaFocus.isConnected),
  );
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.setViewportSize(size);
    await input([], [0, 0, 0, 1]);
    await sleep(650);
    await input();
    const layout = await a.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow:
        document.querySelector('#modal').scrollWidth >
        document.querySelector('#modal').clientWidth + 2,
      buttons: [...document.querySelectorAll('#supper-panel button')].map((n) => ({
        id: n.id,
        height: n.getBoundingClientRect().height,
        width: n.getBoundingClientRect().width,
      })),
    }));
    assert.ok(layout.scrollWidth <= size.width && !layout.overflow);
    assert.ok(layout.buttons.every((n) => n.height >= 43 && n.width <= size.width));
    viewports.push(layout);
    await shot(a, '05-supper-' + size.width);
    await select('#supper-back');
    await tap(PAD.square);
    await a.locator('#pantry-panel').waitFor();
    await a.locator('#pantry-supper').click();
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  completed.push(
    'simulated Gamepad food selection survives shell stock updates; 390x844 and 844x390 scroll, 44px targets and controller Back work',
  );
  const midden = MIDDEN_SITES.find((s) => s.id === 'midden-many-hearths');
  place(
    bp,
    { x: midden.x - 2, z: midden.z },
    'carry actual meal shells to existing midden from a prepared nearby position',
  );
  await sleep(600);
  await guide(b);
  await b.locator('#gulf-coastal').click();
  await click(b, '#shell-deposit');
  await until(
    () => room().gulf.middens.find((m) => m.id === midden.id).shells === 3,
    'midden receives meal shells',
  );
  assert.equal(bp.inventory.shells, 0);
  assert.equal(bp.gulf.pantryAllowance.taken, 1);
  completed.push(
    'player receives three meal shells and deposits them into existing growing midden; food allowance is unchanged by shells',
  );
  const inventory = structuredClone(ap.inventory),
    meals = room().residents.map((n) => structuredClone(n.supper)),
    pantries = structuredClone(room().gulf.pantries);
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual(actor().inventory, inventory);
  assert.deepEqual(
    room().residents.map((n) => n.supper),
    meals,
  );
  assert.deepEqual(room().gulf.pantries, pantries);
  await supper(a);
  completed.push(
    'same-tab reconnect keeps portions, returned shells, meal records and inventory without another meal',
  );
  clock(355000, 'next day just before evening; one remaining portion for the next daily meal');
  await until(() => room().residents.some((n) => n.supper?.day === 2), 'next day meal', 55000);
  assert.equal(room().residents.filter((n) => n.supper?.day === 2).length, 1);
  assert.equal(stock().supper.berry, 0);
  assert.equal(stock().food.berry, 1);
  await shot(a, '06-next-evening');
  completed.push(
    'next day permits one fresh meal, without backfilling missed days or taking common food',
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
        observations,
        maxPlayers,
        violations,
        screenshots,
        viewports,
        scope:
          'Two real Chrome views and three network peers. Inventory, player proximity, visiting household state, afternoon resident positions and three clock changes are explicit fixtures. Evening walks and food consumption follow actual elapsed time. Gamepad API input only is simulated. No physical controller/mobile device, full gathering/cooking or complete journey, large-room load, long-duration or constant 60FPS claim.',
      },
      null,
      2,
    ),
  );
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
