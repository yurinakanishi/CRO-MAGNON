// Real Chrome UI and residents; starting resident positions, visits and clock changes are explicit fixtures.
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
const folder = process.argv[2] || 'output/playwright/resident-foraging/r01';
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
const room = () => core.rooms.get('FORAGE-QA'),
  actor = (name = '採集A') => [...room().players.values()].find((p) => p.name === name),
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
  await page.goto(base + '/?room=FORAGE-QA&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loaded: name, base }));
  return page;
}
try {
  const a = await addPage('採集A', 'cro', true);
  await shot(a, '01-loaded');
  const b = await addPage('採集B', 'bear');
  const wire = [];
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=FORAGE-QA&name=Peer${i}`);
    peer.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'state') wire[i] = { ...wire[i], ...m };
    });
    peers.push(peer);
    await new Promise((r) => peer.once('open', r));
  }
  await until(() => room().players.size === 5, 'five players');
  await guide(a);
  await click(a, '#gulf-travel');
  await guide(a);
  await click(a, '#gulf-welcome');
  assert.equal(actor().inventory.berry, 3);
  await pantry(a);
  await click(a, '#pantry-give');
  assert.equal(stock().food.berry, 1);
  place(actor('採集B'), { x: MANY_HEARTHS.x + 2, z: MANY_HEARTHS.z + 5 }, 'second view at hearth');
  for (const [i, h] of room().households.entries())
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: room().createdAt + 900000,
    });
  fixtures.push({
    kind: 'household-visits',
    purpose:
      'all three households start visiting; complete journeys not walked in this browser test',
  });
  for (const n of room().residents) {
    const d = RESIDENTS.find((d) => d.id === n.id),
      target = householdAssignment(room(), n.id, 3)?.target ?? d.routine[3];
    place(n, target, 'rest position before actual daytime foraging and evening return');
    n.forage = null;
    n.forageWork = null;
    n.supper = null;
    n.supperUntil = 0;
    n.routineKey = '';
    n.destination = null;
    n.talkerId = null;
    n.talkUntil = 0;
  }
  for (const r of room().resources)
    if (r.type === 'berry') {
      r.amount = r.maxAmount;
      r.regeneratedAt = Date.now() + offset;
    }
  fixtures.push({
    kind: 'fresh-day',
    purpose:
      'clear resident daily records and refill existing berry sources after loading both clients',
  });
  clock(0, 'day one starts; the entire foraging and return route now runs on real elapsed time');
  const harvests = [],
    delivered = [],
    seen = new Set(),
    moves = new Map(room().residents.map((n) => [n.id, { x: n.x, z: n.z, meters: 0 }]));
  timer = setInterval(() => {
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const p of [...room().players.values(), ...room().residents])
      if (!room().collision.free(p, p.radius, ridingObstacles(room(), null, p)))
        violations.push({ observation: observations, id: p.id, x: p.x, z: p.z });
    for (const n of room().residents) {
      const before = moves.get(n.id);
      before.meters += Math.hypot(n.x - before.x, n.z - before.z);
      before.x = n.x;
      before.z = n.z;
      if (n.forage && !seen.has(n.id + ':' + n.forage.day)) {
        seen.add(n.id + ':' + n.forage.day);
        harvests.push({
          id: n.id,
          ...n.forage,
          at: Date.now() + offset,
          sourceAmount: room().resources.find((r) => r.id === n.forage.sourceId).amount,
        });
      }
      if (
        n.forage &&
        !n.forage.carrying &&
        !seen.has(n.id + ':delivered:' + n.forage.deliveredDay)
      ) {
        seen.add(n.id + ':delivered:' + n.forage.deliveredDay);
        delivered.push({ id: n.id, ...n.forage, at: Date.now() + offset });
      }
    }
  }, 250);
  await supper(a);
  await supper(b);
  async function input(buttons = [], axes = [0, 0, 0, 0]) {
    await a.evaluate(
      ({ buttons, axes }) => {
        window.qaPad.axes = axes;
        window.qaPad.buttons.forEach((b, i) => {
          b.pressed = buttons.includes(i);
          b.value = b.pressed ? 1 : 0;
        });
      },
      { buttons, axes },
    );
  }
  async function tap(button) {
    await input([button]);
    await sleep(100);
    await input();
    await sleep(120);
  }
  async function select(id) {
    for (let i = 0; i < 90; i++) {
      if (await a.locator(id).evaluate((n) => n.classList.contains('gamepad-focus'))) return;
      await tap(PAD.down);
    }
    throw Error('Gamepad focus ' + id);
  }
  await select('#supper-food-herbRoot');
  await tap(PAD.cross);
  await a.evaluate(() => {
    window.qaFocus = document.activeElement;
  });
  await until(
    () => room().residents.every((n) => n.forage?.carrying),
    'eight residents gather actual berries',
    115000,
  );
  assert.equal(stock().supper.berry, 0);
  assert.equal(stock().food.berry, 1);
  assert.ok(room().residents.every((n) => n.forage.sourceId.startsWith('gulf-many-hearths-')));
  await until(
    () => wire.every((s) => s?.residents.every((n) => n.forage?.carrying)) && wire.length === 3,
    'three observers see carried berries',
  );
  assert.ok(
    await a.evaluate(() => window.qaFocus === document.activeElement && window.qaFocus.isConnected),
  );
  assert.equal(await a.locator('#supper-food-herbRoot').getAttribute('aria-pressed'), 'true');
  assert.ok((await b.locator('#supper-forage-neri').innerText()).includes('運んでいる'));
  await a.locator('#supper-attendance').scrollIntoViewIfNeeded();
  await shot(a, '02-carrying');
  completed.push(
    'All eight residents walked from rest places to actual shrubs and gathered one berry each; all three observers and second Chrome see carrying records; no supper credited before return; Gamepad focus survived updates.',
  );
  const records = structuredClone(room().residents.map((n) => n.forage));
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual(
    room().residents.map((n) => n.forage),
    records,
  );
  await supper(a);
  completed.push(
    'Same-tab reconnect retains berries being carried, source records and shared stock.',
  );
  await until(
    () => room().residents.every((n) => n.supper?.day === 1),
    'all eight deliver and eat at actual evening',
    135000,
  );
  assert.ok(
    room().residents.every((n) => !n.forage.carrying && n.forage.deliveredTo === 'many-hearths'),
  );
  assert.equal(stock().supper.berry, 0);
  assert.equal(stock().food.berry, 1);
  assert.equal(actor().inventory.berry, 2);
  assert.ok([...moves.values()].every((n) => n.meters > 20));
  await until(
    () => wire.length === 3 && wire.every((s) => s.residents.every((n) => n.supper?.day === 1)),
    'all observers see consumed supper',
  );
  await a.locator('#supper-attendance').scrollIntoViewIfNeeded();
  await shot(a, '03-delivered-and-eaten');
  completed.push(
    'Unmodified day-one clock reached evening: eight real return walks, deliveries and meals; common food and player inventory retained.',
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
    await shot(a, '04-layout-' + size.width);
    await select('#supper-back');
    await tap(PAD.square);
    await a.locator('#pantry-panel').waitFor();
    await a.locator('#pantry-supper').click();
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  await guide(a);
  await a.locator('#gulf-residents').click();
  assert.ok((await a.locator('#resident-forage-aru').innerText()).includes('届けた'));
  await a.locator('#resident-near-aru').click();
  await sleep(700);
  await until(() => !actor().moving, 'walk near Aru');
  await guide(a);
  await a.locator('#gulf-residents').click();
  await click(a, '#resident-open-aru');
  assert.ok((await a.locator('#resident-forage-aru').innerText()).includes('届けた'));
  await shot(a, '05-conversation');
  completed.push(
    'Resident directory and nearby conversation show delivered food; portrait/landscape layouts, simulated Gamepad selection, scrolling and Back remain usable.',
  );
  await close(a);
  place(
    actor(),
    { x: MANY_HEARTHS.x - 2, z: MANY_HEARTHS.z + 5 },
    'return QA view to hearth for capacity test',
  );
  stock().food.cookedRoot = 47;
  fixtures.push({
    kind: 'pantry-capacity',
    food: 'cookedRoot',
    amount: 47,
    purpose:
      'fill remaining capacity beside the real donated common berry; retain carried harvest at evening',
  });
  clock(240000, 'next day; actual resident harvesting continues');
  await until(
    () => room().residents.every((n) => n.forage?.day === 2 && n.forage.carrying),
    'next-day harvest',
    115000,
  );
  clock(355000, 'just before second evening after actual second harvest; avoid idle wait');
  await until(
    () =>
      room().residents.every(
        (n) =>
          n.phase === 2 &&
          !n.moving &&
          n.destination &&
          Math.hypot(n.x - n.destination.x, n.z - n.destination.z) < 0.15,
      ),
    'all returned with full pantry',
    55000,
  );
  await sleep(600);
  assert.ok(room().residents.every((n) => n.forage.carrying && n.supper.day === 1));
  await supper(a);
  await a.locator('#supper-attendance').scrollIntoViewIfNeeded();
  await shot(a, '06-full-pantry');
  await pantry(b);
  await b.locator('#pantry-food-cookedRoot').click();
  await click(b, '#pantry-take');
  await until(
    () => room().residents.every((n) => n.supper?.day === 2),
    'space permits carried food and supper',
    10000,
  );
  assert.ok(room().residents.every((n) => !n.forage.carrying));
  assert.equal(stock().food.berry, 1);
  assert.equal(stock().food.cookedRoot, 46);
  assert.equal(stock().supper.berry, 0);
  assert.equal(actor('採集B').inventory.cookedRoot, 1);
  completed.push(
    'Day two permits one new harvest each. At a full pantry all eight retain their food; a normal player withdrawal opens space, then each delivers and eats once without taking common food.',
  );
  await until(() => delivered.length === 16, 'delivery recorder');
  await writeFile(
    folder + '/journeys.json',
    JSON.stringify(
      { harvests, delivered, movement: [...moves].map(([id, p]) => ({ id, meters: p.meters })) },
      null,
      2,
    ),
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
          'Two real Chrome views plus three network peers. Guest visits, resident rest positions, cleared initial daily records, replenished source stock, a second-view position, 47 roots filling the pantry and three clock changes are explicit fixtures. All foraging walks, 4-second work, carrying, evening return, delivery and consumption run in real time. Player A uses ordinary expedition/welcome berries to contribute one common berry. Gamepad API input is simulated; no physical controller/device, large-room load, long-duration or constant 60FPS claim.',
      },
      null,
      2,
    ),
  );
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
