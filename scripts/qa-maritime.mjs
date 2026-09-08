// Actual Chrome and WebSockets. Explicit positions/materials/time are fixtures, not earned play.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { LANDINGS } = await import(build + 'shared/gulf-region.mjs');
const { waterBodyFree } = await import(build + 'shared/boats.mjs');
const { MARITIME } = await import(build + 'shared/maritime-weather.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/maritime/r01';
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
  screenshots = [],
  violations = [],
  measurements = [];
let observations = 0,
  maxPlayers = 0,
  maxMovingBoats = 0,
  timer,
  peerTimer;
const r = () => core.rooms.get('SEA-QA');
const actor = (name = '舟A') => [...r().players.values()].find((p) => p.name === name);
const boat = (name = '舟A') => r().boats.find((b) => b.riderId === actor(name).id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, limit = 45000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > limit) throw new Error('Timeout: ' + label);
    await sleep(160);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: `${folder}/${name}.png` });
  const diagnostics = await page.locator('#world').evaluate((c) => ({
    fps: c.dataset.fps,
    seaWeather: c.dataset.seaWeather,
    fogFar: c.dataset.seaFog,
    chunks: c.dataset.terrainChunks,
    boats: c.dataset.boats,
  }));
  screenshots.push({ name, diagnostics });
  console.log(JSON.stringify({ screenshot: name, ...diagnostics }));
}
async function close(page) {
  if (await page.locator('#modal').evaluate((d) => d.open)) await page.keyboard.press('Escape');
}
async function openSea(page) {
  await close(page);
  if (await page.locator('#boat-weather').isVisible()) await page.locator('#boat-weather').click();
  else {
    if (await page.locator('#gulf-button').isVisible()) await page.locator('#gulf-button').click();
    else {
      await page.keyboard.press('Escape');
      await page.locator('[data-controller-menu="gulf"]').click();
    }
    assert.ok((await page.locator('body').ariaSnapshot()).includes('空と航路'));
    await page.locator('#gulf-weather').click();
  }
  assert.ok((await page.locator('body').ariaSnapshot()).includes('次の上陸地'));
}
async function addPage(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ name }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', 'female');
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
    { name },
  );
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/?room=SEA-QA&autostart=1`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ready: name, base }));
  return page;
}
function phase(index) {
  offset = r().createdAt + index * MARITIME.periodMs + 10000 - Date.now();
  fixtures.push({
    kind: 'clock',
    phase: index,
    purpose: 'observe forecast and navigation in every weather',
  });
}
function place(name, point) {
  const p = actor(name),
    b = boat(name);
  stopActor(b || p);
  Object.assign(b || p, point);
  Object.assign(p, point);
  fixtures.push({ kind: 'position', name, ...point, aboard: !!b });
}
async function mapTarget(page, x, z) {
  await close(page);
  await page.keyboard.press('m');
  await page.locator('#map-gulf').click();
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸の全図'));
  const canvas = page.locator('#big-map'),
    box = await canvas.boundingBox(),
    dims = await canvas.evaluate((c) => ({ width: c.width, height: c.height }));
  const scale = Math.min((dims.width - 24) / 1480, (dims.height - 28) / 1340);
  await canvas.click({
    position: {
      x: ((dims.width / 2 + (x + 2210) * scale) * box.width) / dims.width,
      y: ((dims.height / 2 + (z - 740) * scale) * box.height) / dims.height,
    },
  });
  await page.locator('#map-walk').click();
}
async function moveMeasure(page, x, label) {
  place('舟A', { x: -2200, z: 1145 });
  await sleep(450);
  await mapTarget(page, x, 1145);
  await until(() => boat().moving, label + ' started');
  await sleep(1300);
  measurements.push({
    label,
    speed: boat().speed,
    x: boat().x,
    z: boat().z,
    weather: core.snapshot(r()).maritime.kind,
  });
  await openSea(page);
  await sleep(350);
  const before = { x: boat().x, z: boat().z };
  await sleep(1000);
  assert.deepEqual({ x: boat().x, z: boat().z }, before);
  await close(page);
}
try {
  const a = await addPage('舟A');
  await shot(a, '01-ready');
  timer = setInterval(() => {
    if (!r()) return;
    observations++;
    maxPlayers = Math.max(maxPlayers, r().players.size);
    maxMovingBoats = Math.max(maxMovingBoats, r().boats.filter((b) => b.moving).length);
    for (const b of r().boats) {
      if (!waterBodyFree(b.x, b.z, b.radius))
        violations.push({ kind: 'shore', id: b.id, x: b.x, z: b.z });
      if (b.riderId) {
        const p = r().players.get(b.riderId);
        if (!p || Math.hypot(p.x - b.x, p.z - b.z) > 0.001)
          violations.push({ kind: 'rider', id: b.id });
      }
    }
    for (let i = 0; i < r().boats.length; i++)
      for (let j = i + 1; j < r().boats.length; j++) {
        const a = r().boats[i],
          b = r().boats[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius - 0.001)
          violations.push({ kind: 'overlap', ids: [a.id, b.id] });
      }
  }, 250);
  const b = await addPage('舟B');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(
      base.replace('http', 'ws') + `/ws?room=SEA-QA&name=Peer${i}&resume=1`,
    );
    peers.push(peer);
    peer.on('message', (bytes) => {
      const m = JSON.parse(bytes);
      if (m.type === 'state') peer.state = m;
    });
    await new Promise((resolve) => peer.once('open', resolve));
  }
  await until(() => r().players.size === 5, 'five players');
  for (const [name, landing, page] of [
    ['舟A', LANDINGS[1], a],
    ['舟B', LANDINGS[0], b],
  ]) {
    place(name, { x: landing.x, z: landing.z });
    actor(name).inventory.wood = 12;
    fixtures.push({ kind: 'materials', name, wood: 12, purpose: 'boat crafting' });
    await sleep(800);
    await page.locator('#boat-craft').click();
    await until(
      () => r().boats.some((v) => !v.riderId && Math.hypot(v.x - landing.x, v.z - landing.z) < 6),
      'crafted',
    );
    await sleep(650);
    await page.locator('#boat-board').click();
    await until(() => !!actor(name).boatId, 'boarded');
  }
  phase(1);
  await sleep(1000);
  await openSea(a);
  await shot(a, '02-forecast');
  const beforeForecast = await a.locator('#sea-now').innerText();
  await openSea(b);
  assert.equal(await b.locator('#sea-now').innerText(), beforeForecast);
  await close(b);
  await a.locator('#sea-map').click();
  await shot(a, '03-current-map');
  await close(a);
  await openSea(a);
  await a.locator('#sea-go-reed-landing').click();
  await mapTarget(b, -2200, 840);
  for (let i = 0; i < 3; i++) {
    const p = actor('Peer' + i),
      point = { x: -2320 + i * 40, z: 1200 };
    const hull = {
      ...r().boats[0],
      ...point,
      id: 'qa-boat-' + i,
      riderId: p.id,
      mooring: { ...point },
      shore: { ...LANDINGS[i + 2] },
      path: [],
      target: null,
      dx: 0,
      dz: 0,
    };
    stopActor(hull);
    r().boats.push(hull);
    Object.assign(p, point, { boatId: hull.id });
    fixtures.push({
      kind: 'peer-boat',
      name: p.name,
      ...point,
      purpose: 'five simultaneous boat movements',
    });
  }
  peerTimer = setInterval(
    () =>
      peers.forEach((s) =>
        s.send(JSON.stringify({ type: 'move', dx: 0, dz: -0.6, running: true })),
      ),
    150,
  );
  await sleep(7000);
  clearInterval(peerTimer);
  peers.forEach((s) => s.send(JSON.stringify({ type: 'move', dx: 0, dz: 0 })));
  assert.equal(maxMovingBoats, 5);
  console.log(JSON.stringify({ crossing: 'west to east', maxMovingBoats }));
  await until(() => !actor('舟B').moving, 'B reaches inner fishing ground', 160000);
  await until(
    () => !actor().moving && Math.hypot(actor().x - LANDINGS[2].x, actor().z - LANDINGS[2].z) < 6,
    'A reaches opposite shore',
    180000,
  );
  await sleep(650);
  await a.locator('#boat-board').click();
  await until(() => !actor().boatId, 'land at east shore');
  assert.ok(r().collision.free(actor(), actor().radius));
  await shot(a, '04-east-landed');
  completed.push(
    'two UI-built boats, five simultaneous movements, west-to-east route and landing through ordinary controls',
  );
  await sleep(650);
  await a.locator('#boat-board').click();
  await until(() => !!actor().boatId, 'reboard');
  phase(2);
  await moveMeasure(a, -2000, 'rain-with-current');
  await moveMeasure(a, -2400, 'rain-against-current');
  assert.ok(measurements[0].speed > measurements[1].speed + 1);
  await shot(a, '05-rain');
  completed.push('rain: direction changes speed; opening forecast stops and holds the hull');
  place('舟B', { x: -2190, z: 1145 });
  actor('舟B').gulf.fishingKit = true;
  fixtures.push({
    kind: 'fishing-kit',
    name: '舟B',
    purpose: 'weather does not cancel stationary fishing',
  });
  await sleep(700);
  const fishBefore = actor('舟B').inventory.rawFish;
  await b.keyboard.press('e');
  await until(() => !!actor('舟B').fishing, 'fishing begins');
  phase(3);
  await until(
    () => actor('舟B').inventory.rawFish === fishBefore + 1,
    'fish across weather change',
  );
  assert.equal(boat('舟B').x, -2190);
  assert.equal(boat('舟B').z, 1145);
  completed.push('stationary offshore fishing across a shared weather change');
  phase(4);
  await sleep(1600);
  await shot(a, '06-mist');
  assert.ok(Number(await a.locator('#world').getAttribute('data-sea-fog')) < 70);
  await openSea(a);
  await openSea(b);
  assert.equal(await a.locator('#sea-now').innerText(), await b.locator('#sea-now').innerText());
  for (const peer of peers) assert.equal(peer.state.maritime.kind, 'mist');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.setViewportSize({ width, height });
    await sleep(450);
    const overflow = await a.locator('#modal').evaluate((d) => d.scrollWidth > d.clientWidth + 2);
    assert.equal(overflow, false);
    await a.locator('#sea-go-east-outer-landing').scrollIntoViewIfNeeded();
    await shot(a, `07-forecast-${width}`);
    measurements.push({ viewport: [width, height], overflow });
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  await close(a);
  await a.evaluate(() => {
    window.qaPadEnabled = true;
  });
  await sleep(300);
  await a.evaluate(() => {
    window.qaPad.axes[0] = 0.4;
  });
  await sleep(850);
  assert.ok(boat().moving);
  assert.equal(boat().runningRequested, false);
  await a.evaluate(() => {
    window.qaPad.axes[0] = 0.9;
  });
  await sleep(600);
  assert.equal(boat().runningRequested, true);
  await a.evaluate(() => {
    window.qaPad.axes[0] = 0;
  });
  await sleep(650);
  assert.equal(boat().moving, false);
  await a.evaluate(() => {
    window.qaPadEnabled = false;
  });
  completed.push(
    'portrait/landscape forecast scrolling and simulated analog controller paddling/release',
  );
  const inv = { ...actor().inventory },
    savedId = actor().id;
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => actor()?.id === savedId, 'same session');
  assert.deepEqual(actor().inventory, inv);
  assert.equal(actor().boatId, null);
  await openSea(a);
  assert.ok((await a.locator('#sea-now').innerText()).includes('海霧'));
  await close(a);
  completed.push('same-tab reconnect keeps inventory, weather, and safe embarkation return');
  phase(6);
  await sleep(1600);
  await shot(a, '08-calm');
  assert.ok(Number(await a.locator('#world').getAttribute('data-sea-fog')) > 110);
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.equal(maxPlayers, 5);
} catch (error) {
  errors.push(String(error));
  console.error(error);
  process.exitCode = 1;
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
} finally {
  clearInterval(timer);
  clearInterval(peerTimer);
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
        measurements,
        observations,
        maxPlayers,
        maxMovingBoats,
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
      maxMovingBoats,
      violations: violations.length,
    }),
  );
}
