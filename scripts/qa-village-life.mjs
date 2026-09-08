// Real Chrome against an isolated server. Setup positions/time are recorded as fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { RESIDENTS, VILLAGE } = await import(build + 'shared/village-sites.mjs');
const { GULF_ENTRY } = await import(build + 'shared/gulf-region.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/village/r01';
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
  screenshots = [],
  viewports = [],
  violations = [],
  completed = [];
let observations = 0,
  maxPlayers = 0,
  timer;
const r = () => core.rooms.get('VILLAGE-QA');
const actor = (name = '暮らしA') => [...r().players.values()].find((p) => p.name === name);
const resident = (id) => r().residents.find((n) => n.id === id);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, label, limit = 45000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > limit) throw new Error(`Timeout: ${label}`);
    await sleep(150);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: `${folder}/${name}.png` });
  const diagnostics = await page.locator('#world').evaluate((c) => ({
    fps: c.dataset.fps,
    residents: c.dataset.residentModels,
    chunks: c.dataset.terrainChunks,
    models: c.dataset.worldModels,
  }));
  screenshots.push({ name, diagnostics });
  console.log(JSON.stringify({ screenshot: name, ...diagnostics }));
}
async function addPage(name, species = 'cro', gender = 'female') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ name, species, gender }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', species);
      localStorage.setItem('cro-gender', gender);
      window.qaPadEnabled = false;
      window.qaPad = {
        id: 'Wireless Controller (STANDARD GAMEPAD)',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => (window.qaPadEnabled ? [window.qaPad] : []),
      });
    },
    { name, species, gender },
  );
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/?room=VILLAGE-QA&autostart=1`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ready: name, base }));
  return page;
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function directory(page) {
  await close(page);
  if (await page.locator('#gulf-button').isVisible()) {
    await page.locator('#gulf-button').click();
    await page.locator('#gulf-residents').click();
  } else {
    await page.keyboard.press('Escape');
    await page.locator('[data-controller-menu="residents"]').click();
  }
  await page.locator('#village-panel').waitFor();
}
async function nearbyFixture(page, id, name = '暮らしA') {
  await close(page);
  const p = actor(name),
    n = resident(id);
  stopActor(p);
  const at = r().collision.nearestFree(
    { x: n.x, z: n.z + 1.45 },
    p.radius,
    ridingObstacles(r(), null, p),
    2,
  );
  assert.ok(at);
  Object.assign(p, at);
  fixtures.push({ kind: 'near-resident', player: name, resident: id, ...at });
  await sleep(600);
  await directory(page);
  await page
    .locator('#village-settlement')
    .selectOption(RESIDENTS.find((d) => d.id === id).settlementId);
  await page.locator('#resident-open-' + id).click();
  await page.locator('#village-panel[data-person="' + id + '"]').waitFor();
  await sleep(650);
}
async function pad(page, button) {
  await page.evaluate(() => (window.qaPadEnabled = true));
  await sleep(220);
  await page.evaluate((i) => (window.qaPad.buttons[i] = { pressed: true, value: 1 }), button);
  await sleep(150);
  await page.evaluate((i) => (window.qaPad.buttons[i] = { pressed: false, value: 0 }), button);
  await sleep(220);
}
try {
  const a = await addPage('暮らしA');
  await shot(a, '01-loaded');
  timer = setInterval(() => {
    if (!r()) return;
    observations++;
    maxPlayers = Math.max(maxPlayers, r().players.size);
    for (const n of r().residents)
      if (!r().collision.free(n, n.radius, ridingObstacles(r(), null, n)))
        violations.push({ observation: observations, id: n.id, x: n.x, z: n.z });
    for (const p of r().players.values())
      if (
        !r().collision.free(
          p,
          p.radius,
          r().residents.map((n) => ({ type: 'circle', ...n })),
        )
      )
        violations.push({ observation: observations, id: p.name, x: p.x, z: p.z });
  }, 250);
  const b = await addPage('暮らしB', 'nea', 'male');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(
      base.replace('http', 'ws') + `/ws?room=VILLAGE-QA&name=Peer${i}&resume=1`,
    );
    peers.push(peer);
    await new Promise((res) => peer.once('open', res));
    peer.send(JSON.stringify({ type: 'expedition', destination: GULF_ENTRY.id }));
  }
  for (const page of [a, b]) {
    await page.locator('#gulf-button').click();
    await page.locator('#gulf-travel').click();
  }
  await until(() => actor().x < -2000, 'ordinary expedition');
  await a.locator('#gulf-button').click();
  await a.locator('#gulf-welcome').click();
  await sleep(700);
  await directory(a);
  await until(() => !resident('aru').moving, 'Aru at a workplace', 60000);
  await a.locator('#resident-near-aru').click();
  await until(
    () => Math.hypot(actor().x - resident('aru').x, actor().z - resident('aru').z) <= 3,
    'ordinary walk to Aru',
    60000,
  );
  await a.keyboard.press('e');
  await a.locator('#village-panel[data-person="aru"]').waitFor({ timeout: 10000 });
  await sleep(650);
  await a.locator('#resident-help').click();
  await until(() => !!actor().gulf.residentHelp.aru, 'help acknowledgement');
  assert.equal(actor().inventory.berry, 1);
  assert.equal(actor().inventory.wood, 2);
  await a.waitForFunction(
    () => document.querySelector('#resident-help')?.disabled,
    {},
    { timeout: 5000 },
  );
  await shot(a, '02-first-conversation');
  await close(a);
  await shot(a, '03-resident-in-world');
  completed.push(
    'ordinary expedition, welcome, approach button, E conversation and first delivery',
  );
  const progress = structuredClone(actor().gulf),
    inventory = { ...actor().inventory },
    id = actor().id;
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.equal(actor().id, id);
  assert.deepEqual(actor().gulf, progress);
  assert.deepEqual(actor().inventory, inventory);
  completed.push('reload preserves identity, daily progress and inventory');
  // Explicit supplies and arrival positions exercise all other country conversations without claiming these journeys.
  Object.assign(actor().inventory, {
    wood: 20,
    berry: 20,
    water: 6,
    obsidian: 5,
    cookedShellfish: 3,
  });
  fixtures.push({
    kind: 'supplies',
    inventory: { wood: 20, berry: 20, water: 6, obsidian: 5, cookedShellfish: 3 },
  });
  for (const d of RESIDENTS.filter((d) => d.id !== 'aru')) {
    await nearbyFixture(a, d.id);
    const before = { ...actor().inventory };
    await a.locator('#resident-help').click();
    await until(() => !!actor().gulf.residentHelp[d.id], `delivery ${d.id}`);
    for (const [key, n] of Object.entries(d.cost))
      assert.equal(actor().inventory[key], before[key] - n + (d.reward[key] ?? 0));
    for (const [key, n] of Object.entries(d.reward))
      assert.equal(actor().inventory[key], before[key] + n - (d.cost[key] ?? 0));
    if (['mira', 'rok', 'neri'].includes(d.id)) {
      await shot(a, '04-conversation-' + d.id);
      await close(a);
      await sleep(1200);
      await shot(a, '05-world-' + d.id);
    }
    completed.push('conversation and exact delivery: ' + d.id);
  }
  await nearbyFixture(b, 'daro', '暮らしB');
  actor('暮らしB').inventory.wood = 2;
  fixtures.push({ kind: 'supplies', player: '暮らしB', wood: 2 });
  await sleep(650);
  await b.locator('#resident-help').click();
  await until(() => !!actor('暮らしB').gulf.residentHelp.daro, 'independent B help');
  completed.push('second player receives same resident daily request independently');
  await close(a);
  await close(b);
  const remaining = VILLAGE.dayMs - ((Date.now() + offset - r().createdAt) % VILLAGE.dayMs);
  offset += remaining + 10;
  fixtures.push({
    kind: 'clock-forward',
    milliseconds: remaining + 10,
    purpose: 'next-day reset and visible walking',
  });
  const from = r().residents.map((n) => ({ id: n.id, x: n.x, z: n.z }));
  await sleep(5500);
  assert.ok(
    r().residents.some((n) => {
      const p = from.find((p) => p.id === n.id);
      return Math.hypot(p.x - n.x, p.z - n.z) > 1;
    }),
  );
  await shot(a, '06-new-day-walking');
  await nearbyFixture(a, 'neri');
  assert.ok(await a.locator('#resident-help').isEnabled());
  // Gamepad API is simulated; no claim of physical controller verification.
  await a.locator('#resident-help').focus();
  await pad(a, 0);
  await until(
    () => actor().gulf.residentHelp.neri === core.snapshot(r()).day,
    'controller acceptance',
  );
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.setViewportSize({ width, height });
    await sleep(400);
    const layout = await a.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll('#village-panel button')].map((b) => ({
        id: b.id,
        width: b.getBoundingClientRect().width,
        height: b.getBoundingClientRect().height,
      })),
      modal: document.querySelector('#modal').getBoundingClientRect().toJSON(),
    }));
    assert.ok(layout.scrollWidth <= width);
    assert.ok(layout.buttons.every((b) => b.height >= 43 && b.width <= width));
    viewports.push(layout);
    await shot(a, `07-dialog-${width}`);
    await a.locator('#resident-back').click();
    await shot(a, `08-directory-${width}`);
    await a.locator('#resident-open-neri').click();
  }
  completed.push(
    'next-day reset, visible walking, simulated gamepad confirmation, portrait and landscape dialogs',
  );
  await close(a);
  await close(b);
  // Wait out cache disposal while A is far away, then load the same residents again.
  stopActor(actor());
  Object.assign(actor(), { x: GULF_ENTRY.x, z: GULF_ENTRY.z });
  fixtures.push({ kind: 'arrival', ...GULF_ENTRY, purpose: 'resident render eviction' });
  await sleep(13500);
  assert.equal(await a.locator('#world').getAttribute('data-resident-models'), '2');
  assert.equal(await a.locator('#world').getAttribute('data-resident-actors'), '2');
  await nearbyFixture(a, 'neri');
  await close(a);
  await sleep(1500);
  assert.equal(await a.locator('#world').getAttribute('data-resident-models'), '2');
  await shot(a, '09-returned-residents');
  completed.push('distant resident actors released and same shared models loaded on return');
  assert.equal(maxPlayers, 5);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
} catch (error) {
  errors.push(String(error));
  console.error(error);
  if (pages[0]) {
    await shot(pages[0], 'failure').catch(() => {});
    await writeFile(
      `${folder}/failure-ui.txt`,
      await pages[0]
        .locator('body')
        .ariaSnapshot()
        .catch(() => 'unavailable'),
    );
  }
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        errors,
        fixtures,
        completed,
        screenshots,
        viewports,
        observations,
        maxPlayers,
        renderedPages: pages.length,
        peers: peers.length,
        collisionViolations: violations,
        state: r() ? core.snapshot(r(), true) : null,
      },
      null,
      2,
    ),
  );
  await browser.close();
  for (const peer of peers) peer.close();
  await game.close();
  console.log(
    JSON.stringify({
      report: folder + '/report.json',
      errors,
      observations,
      maxPlayers,
      violations: violations.length,
    }),
  );
}
