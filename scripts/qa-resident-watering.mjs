// Real Chrome input and resident movement. Every prepared position, supply and clock change is recorded.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { MANY_HEARTHS, FARM_PLOTS } = await import(build + 'shared/gulf-region.mjs');
const { RESIDENTS } = await import(build + 'shared/village-sites.mjs');
const { householdAssignment } = await import(build + 'shared/household-life.mjs');
const { HOUSEHOLDS } = await import(build + 'shared/household-sites.mjs');
const { PAD } = await import(build + 'src/gamepad-input.js');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/resident-watering-20260909/r01';
await mkdir(folder, { recursive: true });
const checks = [],
  errors = [],
  fixtures = [],
  shots = [],
  violations = [],
  pages = [],
  peers = [],
  wire = [],
  sent = [],
  events = [];
let offset = 0,
  timer,
  observations = 0,
  maxPlayers = 0;
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
const room = () => core.rooms.get('WATER-QA'),
  actor = (name = '水やりA') => [...room().players.values()].find((p) => p.name === name);
const plots = FARM_PLOTS.filter((p) => p.settlementId === MANY_HEARTHS.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const passed = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
async function until(fn, label, limit = 15000) {
  const start = Date.now();
  while (!(await fn())) {
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
  if (await page.locator('#modal').evaluate((d) => d.open))
    await page.locator('#modal-close').click();
}
async function guide(page, index = 0) {
  await close(page);
  if (await page.locator('#gulf-button').isVisible()) await page.locator('#gulf-button').click();
  else {
    await page.locator('#world').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-controller-menu="gulf"]').click();
  }
  await page.locator('[data-gulf-tab="many-hearths"]').click();
  await page.locator('[data-plot="' + plots[index].id + '"]').click();
}
async function click(page, selector) {
  await page.locator(selector).click();
  await sleep(550);
}
async function shot(page, name) {
  await page.screenshot({ path: folder + '/' + name + '.png' });
  shots.push({
    name,
    viewport: page.viewportSize(),
    ...(await page
      .locator('#world')
      .evaluate((c) => ({ fps: c.dataset.fps, chunks: c.dataset.terrainChunks }))),
  });
  console.log('IMAGE ' + name);
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
          id: 'Wireless Controller',
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
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      try {
        sent.push(JSON.parse(frame.payload.toString()));
      } catch {}
    }),
  );
  await page.goto(base + '/?room=WATER-QA', { waitUntil: 'domcontentloaded' });
  await page.locator('#title-start').click();
  await page.locator('#setup-submit').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual(errors, []);
  console.log('READY ' + name + ' ' + base);
  return page;
}
try {
  // Immediate browser readiness check after starting the private server.
  const a = await addPage('水やりA', 'cro', true);
  await shot(a, '01-ready');
  const b = await addPage('水やりB', 'nea');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=WATER-QA&name=Peer${i}`);
    peers.push(peer);
    peer.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'state') wire[i] = { ...wire[i], ...m };
    });
    await new Promise((r) => peer.once('open', r));
  }
  await until(() => room().players.size === 5, 'five connections');
  // Preparing plots takes place at night; residents begin the actual work the following morning.
  clock(
    180000,
    'night while players plant and request; all watering itself uses elapsed real time',
  );
  Object.assign(actor().inventory, { seed: 10, rootSeed: 4, herbSeed: 4, water: 6 });
  fixtures.push({
    kind: 'inventory',
    player: '水やりA',
    seed: 10,
    rootSeed: 4,
    herbSeed: 4,
    water: 6,
  });
  place(
    actor(),
    { x: plots[0].x, z: plots[0].z + 6.7 },
    'just outside farm range before manual approach',
  );
  place(actor('水やりB'), { x: plots[0].x + 3, z: plots[0].z + 4 }, 'second viewer beside farms');
  await guide(a);
  assert.equal(await a.locator('#gulf-farm').isDisabled(), true);
  await close(a);
  await a.locator('#world').focus();
  await a.keyboard.down('w');
  await until(
    () => Math.hypot(actor().x - plots[0].x, actor().z - plots[0].z) < 4.5,
    'manual approach',
  );
  await a.keyboard.up('w');
  await sleep(300);
  await guide(a);
  await a.locator('#gulf-crop-choice').selectOption('root');
  await click(a, '#gulf-farm');
  await click(a, '#gulf-resident-water');
  await guide(b);
  assert.match(await b.locator('#gulf-watering-status').innerText(), /頼みを受け付け/);
  await click(a, '#gulf-resident-water');
  assert.equal(room().gulf.plots[0].waterRequestAt, 0);
  assert.match(await b.locator('#gulf-watering-status').innerText(), /まだ頼んでいません/);
  passed(
    'Manual approach, root planting, request and cancellation are shared between two Chrome views',
  );

  const input = async (buttons = [], axes = [0, 0, 0, 0]) => {
    await a.evaluate(
      async ({ buttons, axes }) => {
        window.qaPad.axes = axes;
        window.qaPad.buttons.forEach((b, i) => {
          b.pressed = buttons.includes(i);
          b.value = b.pressed ? 1 : 0;
        });
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      },
      { buttons, axes },
    );
  };
  const tap = async (key) => {
    await input([key]);
    await input();
    await sleep(600);
  };
  const arm = async (selector) => {
    await a.keyboard.press('Tab');
    await a.locator(selector).focus();
    await input([], [0, 0, 0.4, 0]);
    await input();
  };
  for (const button of [PAD.circle, PAD.square, PAD.triangle]) {
    const was = room().gulf.plots[0].waterRequestAt > 0;
    await arm('#gulf-resident-water');
    await tap(button);
    assert.equal(room().gulf.plots[0].waterRequestAt > 0, !was);
    assert.equal(await a.evaluate(() => document.activeElement.id), 'gulf-resident-water');
  }
  await click(a, '#gulf-resident-water');
  passed(
    'All four simulated face buttons confirm request/cancel and retain focus through state updates',
  );
  place(
    actor(),
    { x: plots[0].x + 4.5, z: plots[0].z + 1.5 },
    'within five metres of the first eight fields for UI planting',
  );
  for (let i = 1; i < 8; i++) {
    await guide(a, i);
    await a.locator('#gulf-crop-choice').selectOption(['root', 'herb', 'berry'][i % 3]);
    await click(a, '#gulf-farm');
    await click(a, '#gulf-resident-water');
  }
  await guide(a, 10); // an unrequested neighbour, prepared with ordinary planting too
  place(actor(), { x: plots[10].x, z: plots[10].z + 1.4 }, 'plant the unrequested control field');
  await sleep(250);
  await a.locator('#gulf-crop-choice').selectOption('berry');
  await click(a, '#gulf-farm');
  const unrequested = structuredClone(room().gulf.plots[10]);
  for (const [i, h] of room().households.entries())
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: room().createdAt + 1000000,
    });
  for (const n of room().residents) {
    place(
      n,
      householdAssignment(room(), n.id, 3)?.target ??
        RESIDENTS.find((d) => d.id === n.id).routine[3],
      'guest/home night position before walking',
    );
    Object.assign(n, {
      forage: null,
      forageWork: null,
      supper: null,
      supperUntil: 0,
      watering: { water: 0, last: null },
      wateringWork: null,
      wateringTarget: null,
      routineKey: '',
      destination: null,
      talkerId: null,
      talkUntil: 0,
    });
  }
  for (const source of room().resources)
    if (source.type === 'berry') {
      source.amount = source.maxAmount;
      source.regeneratedAt = room().createdAt + 240000;
    }
  fixtures.push({
    kind: 'visits-and-daily-records',
    purpose:
      'three households already visiting, fresh daily records and replenished existing berry stock',
  });
  const stock = room().gulf.pantries.find((p) => p.settlementId === MANY_HEARTHS.id);
  stock.food.cookedRoot = 1;
  fixtures.push({
    kind: 'pantry-control',
    cookedRoot: 1,
    purpose: 'common food must not be taken automatically',
  });
  place(actor(), { x: plots[0].x - 3, z: plots[0].z + 3 }, 'observe and select first field');
  await guide(a);
  await guide(b);
  const inventory = structuredClone(actor().inventory),
    movement = new Map(room().residents.map((n) => [n.id, { x: n.x, z: n.z, meters: 0 }]));
  clock(240000, 'morning: foraging, filling, delivery and watering now run in real time');
  const seen = new Set();
  timer = setInterval(() => {
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const p of [...room().players.values(), ...room().residents])
      if (!room().collision.free(p, p.radius, ridingObstacles(room(), null, p)))
        violations.push({ observation: observations, id: p.id, x: p.x, z: p.z });
    for (const n of room().residents) {
      const m = movement.get(n.id);
      m.meters += Math.hypot(m.x - n.x, m.z - n.z);
      m.x = n.x;
      m.z = n.z;
      const key = `${n.id}:${n.watering.water}:${n.watering.last?.day ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push({
          id: n.id,
          at: Date.now() + offset,
          ...structuredClone(n.watering),
          activity: n.activity,
          meters: m.meters,
        });
      }
    }
  }, 250);
  await until(
    () => room().residents.some((n) => n.watering.water === 2),
    'actual filling at spring',
    110000,
  );
  await until(() => room().residents.some((n) => n.watering.last), 'first water delivery', 90000);
  await a.locator('#gulf-resident-water').scrollIntoViewIfNeeded();
  await shot(a, '02-first-watered');
  await shot(b, '03-second-view');
  await until(
    () => room().residents.every((n) => n.supper?.day === 2),
    'first evening, actual walking and supper',
    130000,
  );
  assert.equal(stock.food.cookedRoot, 1);
  assert.deepEqual(actor().inventory, inventory);
  assert.deepEqual(room().gulf.plots[10], unrequested);
  passed(
    'All guests gather and eat; real spring filling and field delivery use no player supplies or unrequested crops',
  );
  clock(
    480000,
    'next morning skips only rest; pending deliveries and new foraging run in real time',
  );
  await until(
    () => room().residents.every((n) => n.watering.last),
    'all eight residents finish requested fields',
    140000,
  );
  for (const n of room().residents) assert.ok(movement.get(n.id).meters > 50);
  await until(
    () => wire.every((w) => w.gulf?.plots.slice(0, 8).every((p) => p.stage !== 'planted')),
    'all three network peers have completed fields',
  );
  passed(
    'All eight visiting residents finish across two days; one helper per plot, five connections synchronized',
  );
  await guide(a);
  await a.locator('#gulf-residents').click();
  await a.locator('#resident-watering-aru').waitFor();
  assert.match(await a.locator('#resident-watering-aru').innerText(), /持ち水.*水をやった/);
  await shot(a, '04-resident-records');
  const beforeReload = structuredClone(room().gulf.plots),
    waterBeforeReload = room().residents.map((n) => structuredClone(n.watering));
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a.locator('#title-start').click();
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => room().players.size === 5, 'reconnected player');
  assert.deepEqual(
    room().residents.map((n) => n.watering),
    waterBeforeReload,
  );
  assert.equal(room().gulf.plots[0].waterRequestAt, beforeReload[0].waterRequestAt);
  passed('Reload resumes requests, carried water and watering records');
  // Harvest through ordinary UI. Forward clock steps also advance crop growth during skipped rest.
  place(
    actor(),
    { x: plots[0].x - 2, z: plots[0].z + 2 },
    'harvest the completed first root field',
  );
  await guide(a);
  await until(() => room().gulf.plots[0].stage === 'ripe', 'root ripens', 180000);
  const roots = actor().inventory.rawRoot;
  await click(a, '#gulf-farm');
  assert.equal(actor().inventory.rawRoot, roots + 3);
  assert.equal(room().gulf.plots[0].stage, 'empty');
  assert.equal(room().gulf.plots[0].waterRequestAt, 0);
  passed('Player harvests the resident-watered root crop; residents leave ripe harvests in place');
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.setViewportSize(size);
    await guide(a, 10);
    place(
      actor(),
      { x: plots[10].x - 1.5, z: plots[10].z + 1.5 },
      'near control field for small-screen UI',
    );
    await sleep(250);
    await a.locator('#gulf-resident-water').scrollIntoViewIfNeeded();
    assert.match(await a.locator('#gulf-watering-status').innerText(), /まだ頼んでいません/);
    await arm('#gulf-resident-water');
    await tap(PAD.circle);
    assert.ok(room().gulf.plots[10].waterRequestAt > 0);
    await tap(PAD.circle);
    assert.equal(room().gulf.plots[10].waterRequestAt, 0);
    await a.keyboard.press('ArrowUp');
    assert.notEqual(await a.evaluate(() => document.activeElement.id), 'gulf-resident-water');
    await shot(a, 'farm-' + size.width + 'x' + size.height);
    const bounds = await a
      .locator('#modal')
      .evaluate((d) => ({ scroll: d.scrollWidth, client: d.clientWidth }));
    assert.ok(bounds.scroll <= bounds.client + 2);
    await arm('#modal-close');
    await tap(PAD.triangle);
    assert.equal(await a.locator('#modal').evaluate((d) => d.open), false);
  }
  passed(
    'Portrait and landscape farm controls scroll, keep selection, navigate spatially, confirm and return',
  );
  assert.equal(maxPlayers, 5);
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  assert.ok(
    !sent.some(
      (m) =>
        ['expedition', 'destination', 'boatDestination', 'rideDestination'].includes(m.type) ||
        ['gulfTravel', 'expedition'].includes(m.action),
    ),
  );
  assert.ok(
    sent
      .filter((m) => m.type === 'move')
      .every((m) => Number.isFinite(m.dx) && Number.isFinite(m.dz) && !('x' in m) && !('z' in m)),
  );
  await writeFile(
    folder + '/movement.json',
    JSON.stringify(
      { events, movement: [...movement].map(([id, m]) => ({ id, meters: m.meters })) },
      null,
      2,
    ),
  );
} catch (e) {
  errors.push(String(e));
  console.error(e);
  process.exitCode = 1;
  for (const [i, page] of pages.entries()) {
    await shot(page, 'failure-' + i).catch(() => {});
    await writeFile(
      folder + '/failure-' + i + '.txt',
      await page
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
        checks,
        errors,
        fixtures,
        observations,
        maxPlayers,
        violations,
        shots,
        scope:
          'Two real Chrome views and three network peers. Profile, manual-approach starting point, nearby UI positions, seed/water supplies, initial visiting households/daily records/source stock, one common root and three forward clock settings are fixtures. All work durations and walks use real elapsed time. Forward clock steps also advance crop growth during skipped rest; readyAt is never overridden. Physical controllers/touch devices, full household travel, large-player loads and long sessions are not tested.',
      },
      null,
      2,
    ),
  );
  peers.forEach((p) => p.close());
  await browser.close();
  await game.close();
}
