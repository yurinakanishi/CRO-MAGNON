// Actual Chrome + three network peers. Explicit boundary/time/supply fixtures are reported.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { HOUSEHOLDS, householdGoal } = await import(build + 'shared/household-sites.mjs');
const { SETTLEMENTS, MANY_HEARTHS } = await import(build + 'shared/gulf-region.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/household-journeys/r01';
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
  screenshots = [],
  viewports = [],
  completed = [],
  violations = [],
  transitions = [];
let observations = 0,
  maxPlayers = 0,
  timer,
  lastStage = '';
const room = () => core.rooms.get('HOUSEHOLD-QA'),
  actor = (name = '旅支度A') => [...room().players.values()].find((p) => p.name === name),
  household = () => room().households[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, limit = 60000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > limit) throw Error('Timeout: ' + label);
    await sleep(150);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: `${folder}/${name}.png` });
  const diagnostic = await page.locator('#world').evaluate((c) => ({
    fps: c.dataset.fps,
    residents: c.dataset.residentModels,
    actors: c.dataset.residentActors,
    chunks: c.dataset.terrainChunks,
  }));
  screenshots.push({ name, ...diagnostic });
  console.log(JSON.stringify({ screenshot: name, ...diagnostic }));
}
async function addPage(name, species = 'cro') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ name, species }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', species);
      localStorage.setItem('cro-gender', 'female');
    },
    { name, species },
  );
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(base + '/?room=HOUSEHOLD-QA&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  const ui = await page.locator('body').ariaSnapshot();
  assert.ok(ui.includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loaded: name, base }));
  return page;
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function directory(page) {
  await close(page);
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="residents"]').click();
  await page.locator('#village-panel').waitFor();
  assert.ok((await page.locator('body').ariaSnapshot()).includes('世帯の旅'));
}
async function journeys(page) {
  await directory(page);
  await page.locator('#resident-journeys').click();
  await page.locator('#household-panel').waitFor();
  await page.locator('body').ariaSnapshot();
}
function place(p, point, purpose) {
  stopActor(p);
  const at = room().collision.nearestFree(point, p.radius, ridingObstacles(room(), null, p), 4);
  assert.ok(at);
  Object.assign(p, at);
  fixtures.push({ kind: 'position', player: p.name, purpose, ...at });
}
try {
  const a = await addPage('旅支度A');
  await shot(a, '01-loaded');
  timer = setInterval(() => {
    if (!room()) return;
    observations++;
    maxPlayers = Math.max(maxPlayers, room().players.size);
    for (const n of room().residents)
      if (!room().collision.free(n, n.radius, ridingObstacles(room(), null, n)))
        violations.push({ observation: observations, id: n.id, x: n.x, z: n.z });
    const h = household(),
      key = h.stage + ':' + h.leg;
    if (key !== lastStage) {
      lastStage = key;
      transitions.push({ at: Date.now() + offset, ...h });
      console.log(JSON.stringify({ journey: key }));
    }
  }, 250);
  const b = await addPage('旅支度B', 'bear');
  for (let i = 0; i < 3; i++) {
    const p = new WebSocket(
      base.replace('http', 'ws') + `/ws?room=HOUSEHOLD-QA&name=Peer${i}&resume=1`,
    );
    peers.push(p);
    await new Promise((resolve) => p.once('open', resolve));
  }
  await until(() => room().players.size === 5, 'five players');
  const home = SETTLEMENTS.find((s) => s.id === HOUSEHOLDS[0].homeId);
  for (const name of ['旅支度A', '旅支度B']) {
    place(actor(name), { x: home.x, z: home.z + 5 }, 'prepare at country hearth');
    Object.assign(actor(name).inventory, { wood: 10, berry: 10, water: 6 });
    fixtures.push({ kind: 'supplies', player: name, wood: 10, berry: 10, water: 6 });
  }
  await sleep(650);
  await journeys(a);
  await a.locator('#journey-prepare-valley-hearth').click();
  await until(() => household().stage === 'assembling', 'ordinary preparation');
  assert.equal(actor().inventory.wood, 8);
  assert.equal(actor().inventory.berry, 7);
  assert.equal(actor().inventory.water, 5);
  await journeys(b);
  await b.waitForFunction(() => document.querySelector('#journey-prepare-valley-hearth')?.disabled);
  assert.equal(actor('旅支度B').inventory.wood, 10);
  await shot(a, '02-prepared');
  await close(a);
  await close(b);
  const start = room()
    .residents.filter((n) => HOUSEHOLDS[0].members.includes(n.id))
    .map((n) => ({ id: n.id, x: n.x, z: n.z }));
  await until(() => household().stage === 'outbound', 'assembly and departure', 90000);
  await sleep(5000);
  for (const n of room().residents.filter((n) => HOUSEHOLDS[0].members.includes(n.id))) {
    const old = start.find((p) => p.id === n.id);
    assert.ok(Math.hypot(old.x - n.x, old.z - n.z) > 5);
  }
  await shot(a, '03-walking-from-country');
  completed.push(
    'ordinary UI preparation consumes once; both residents assemble and walk from country; five players see shared departure',
  );
  await a.keyboard.press('m');
  await a.locator('#big-map').waitFor();
  await a.locator('body').ariaSnapshot();
  await a.locator('#map-gulf').click();
  await a.waitForFunction(
    () => document.querySelector('#big-map')?.dataset.travellingHouseholds === '1',
  );
  await shot(a, '04-route-map');
  await close(a);
  const id = actor('旅支度B').id,
    inventory = { ...actor('旅支度B').inventory },
    visit = household().visit;
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.equal(actor('旅支度B').id, id);
  assert.deepEqual(actor('旅支度B').inventory, inventory);
  assert.equal(household().visit, visit);
  completed.push(
    'route map shows travelling household; reload retains identity, inventory and shared journey',
  );
  // The full three round trips run without position/time jumps in the domain tests.
  // Chrome exercises the final physical approach after this declared last-leg fixture.
  const d = HOUSEHOLDS[0],
    h = household();
  h.leg = d.route.length - 1;
  for (const id of d.members) {
    const n = room().residents.find((n) => n.id === id);
    stopActor(n);
    n.destination = null;
    n.routineKey = '';
    const goal = householdGoal(d, h, d.members.indexOf(id));
    Object.assign(
      n,
      room().collision.nearestFree(
        { x: goal.x - 13, z: goal.z + 10 },
        n.radius,
        ridingObstacles(room(), null, n),
        4,
      ),
    );
    fixtures.push({ kind: 'resident-last-leg', id, x: n.x, z: n.z, leg: h.leg });
  }
  for (const name of ['旅支度A', '旅支度B'])
    place(actor(name), { x: MANY_HEARTHS.x - 20, z: MANY_HEARTHS.z + 28 }, 'watch final arrival');
  await until(() => h.stage === 'visiting', 'actual final approach and arrival', 90000);
  await shot(a, '05-arrival');
  for (const [page, name] of [
    [a, '旅支度A'],
    [b, '旅支度B'],
  ]) {
    const n = room().residents.find((n) => n.id === 'mira');
    place(actor(name), { x: n.x, z: n.z + 1.4 }, 'welcome proximity');
    await sleep(650);
    await journeys(page);
    await page.locator('#journey-welcome-valley-hearth').click();
    await until(
      () => actor(name).gulf.householdWelcomes[d.id] === h.visit,
      'personal welcome ' + name,
    );
    await page.waitForFunction(
      () => document.querySelector('#journey-welcome-valley-hearth')?.disabled,
    );
  }
  assert.equal(actor().inventory.rootSeed, 1);
  assert.equal(actor('旅支度B').inventory.rootSeed, 1);
  await shot(a, '06-welcomed');
  await directory(a);
  await a.locator('#village-settlement').selectOption('many-hearths');
  assert.ok(await a.locator('#resident-card-mira').isVisible());
  assert.ok(await a.locator('#resident-card-tovan').isVisible());
  assert.equal(await a.locator('#resident-card-ena').isVisible(), false);
  await shot(a, '07-hosts-and-guests');
  await a.locator('#resident-open-mira').click();
  await a.locator('#resident-help').click();
  await until(() => !!actor().gulf.residentHelp.mira, 'daily request at guest camp');
  completed.push(
    'actual final arrival; both players including mage welcome once; guest directory and unchanged daily help work at destination',
  );
  const progress = structuredClone(actor().gulf),
    items = { ...actor().inventory };
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual(actor().gulf, progress);
  assert.deepEqual(actor().inventory, items);
  await journeys(a);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.setViewportSize({ width, height });
    await sleep(450);
    const layout = await a.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modal: document.querySelector('#modal').getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll('#household-panel button')].map((b) => ({
        id: b.id,
        width: b.getBoundingClientRect().width,
        height: b.getBoundingClientRect().height,
      })),
    }));
    assert.ok(layout.scrollWidth <= width);
    assert.ok(layout.buttons.every((b) => b.height >= 43 && b.width <= width));
    viewports.push(layout);
    await shot(a, '08-journeys-' + width);
    await a.locator('#journey-back').click();
    await a.locator('#resident-journeys').click();
  }
  completed.push(
    'welcome and daily progress survive reload; portrait/landscape journey dialog, scroll and back navigation',
  );
  await a.setViewportSize({ width: 1440, height: 900 });
  await close(a);
  await close(b);
  const forward = h.stayUntil - (Date.now() + offset) + 1;
  offset += forward;
  fixtures.push({
    kind: 'clock-forward',
    milliseconds: forward,
    purpose: 'finish eight-minute visit, without teleporting',
  });
  const from = room()
    .residents.filter((n) => d.members.includes(n.id))
    .map((n) => ({ id: n.id, x: n.x, z: n.z }));
  await until(() => h.stage === 'returning', 'end visit');
  await until(() => h.leg < d.route.length - 1, 'return departure', 90000);
  await sleep(4000);
  await shot(a, '09-returning');
  assert.ok(
    room().residents.some((n) =>
      from.some((p) => p.id === n.id && Math.hypot(n.x - p.x, n.z - p.z) > 4),
    ),
  );
  completed.push('clock expires stay; both residents gather and physically depart on return route');
  assert.equal(maxPlayers, 5);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
} catch (e) {
  errors.push(String(e));
  console.error(e);
  if (pages[0]) {
    await shot(pages[0], 'failure').catch(() => {});
    await writeFile(
      folder + '/failure-ui.txt',
      await pages[0]
        .locator('body')
        .ariaSnapshot()
        .catch(() => ''),
    );
  }
  process.exitCode = 1;
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
        screenshots,
        viewports,
        transitions,
        observations,
        maxPlayers,
        violations,
        scope:
          'Two actual Chrome contexts plus three WebSocket peers. Supplies, proximity, last-leg positions and stay clock are explicit fixtures. All three uninterrupted full round trips are covered by domain simulation, not claimed as full browser walks. No physical controller or mobile device.',
      },
      null,
      2,
    ),
  );
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
