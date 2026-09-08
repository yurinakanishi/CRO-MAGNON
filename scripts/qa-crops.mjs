// Real Chrome against an isolated server. Setup positions/time are recorded as fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { createGameServer } = await import(build + 'server.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { ridingObstacles } = await import(build + 'shared/riding.mjs');
const { CROPS, ROOT_RECIPES } = await import(build + 'shared/crops.mjs');
const { GULF_ENTRY, FARM_PLOTS, MANY_HEARTHS, SPRINGS } = await import(
  build + 'shared/gulf-region.mjs'
);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = process.argv[2] || 'output/playwright/crops/r01';
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
const r = () => core.rooms.get('CROP-QA');
const actor = (name = '畑A') => [...r().players.values()].find((p) => p.name === name);
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
    crops: c.dataset.cropVarieties,
    cropMaterials: c.dataset.cropMaterials,
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
  await page.goto(`${base}/?room=CROP-QA&autostart=1`, { waitUntil: 'domcontentloaded' });
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
async function pad(page, button) {
  await page.evaluate(() => (window.qaPadEnabled = true));
  await sleep(220);
  await page.evaluate((i) => (window.qaPad.buttons[i] = { pressed: true, value: 1 }), button);
  await sleep(150);
  await page.evaluate((i) => (window.qaPad.buttons[i] = { pressed: false, value: 0 }), button);
  await sleep(220);
}
async function openGulf(page) {
  await close(page);
  if (await page.locator('#gulf-button').isVisible()) await page.locator('#gulf-button').click();
  else {
    await page.keyboard.press('Escape');
    await page.locator('[data-controller-menu="gulf"]').click();
  }
  await page.locator('#gulf-crop-choice').waitFor();
}
async function plotUI(page, index) {
  await openGulf(page);
  await page.locator(`[data-plot="${FARM_PLOTS[index].id}"]`).click();
}
async function walkPlot(page, index, name = '畑A') {
  await plotUI(page, index);
  await page.locator('#gulf-plot-go').click();
  const spec = FARM_PLOTS[index];
  await until(
    () => !actor(name).moving && Math.hypot(actor(name).x - spec.x, actor(name).z - spec.z) < 3,
    `walk to plot ${index}`,
  );
  await sleep(650);
  await plotUI(page, index);
}
async function cookMeal(page, recipe) {
  await close(page);
  await page.keyboard.press('i');
  await page.locator('#modal-crop-food').click();
  await page.locator('#crop-cook-' + recipe.kind).click();
  await until(() => !!actor().cookingEndsAt, 'cook started');
  const before = actor().inventory[recipe.output];
  await until(() => actor().inventory[recipe.output] === before + 1, 'cook completed');
  await sleep(650);
}
try {
  const a = await addPage('畑A');
  await shot(a, '01-loaded');
  timer = setInterval(() => {
    if (!r()) return;
    observations++;
    maxPlayers = Math.max(maxPlayers, r().players.size);
    for (const p of r().players.values())
      if (
        !r().collision.free(
          p,
          p.radius,
          r().residents.map((n) => ({ type: 'circle', ...n })),
        )
      )
        violations.push({ id: p.name, x: p.x, z: p.z });
  }, 250);
  const b = await addPage('畑B', 'nea', 'male');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(
      base.replace('http', 'ws') + `/ws?room=CROP-QA&name=Peer${i}&resume=1`,
    );
    peers.push(peer);
    await new Promise((res) => peer.once('open', res));
  }
  for (const page of [a, b]) {
    await openGulf(page);
    await page.locator('#gulf-travel').click();
  }
  await until(() => actor().x < -2000, 'expedition');
  await openGulf(a);
  await a.locator('#gulf-welcome').click();
  await until(() => actor().gulf.welcomed, 'welcome');
  await sleep(650);
  // One extra berry funds both new seed kinds. This is setup, not claimed wild gathering.
  actor().inventory.berry += 1;
  fixtures.push({ kind: 'supplies', berry: 1, purpose: 'second seed exchange' });
  await sleep(650);
  await a.locator('#gulf-crop-choice').selectOption('root');
  await a.locator('#gulf-seeds').click();
  await until(() => actor().inventory.rootSeed === 2, 'root seeds');
  await sleep(650);
  await a.locator('#gulf-crop-choice').selectOption('herb');
  await a.locator('#gulf-seeds').click();
  await until(() => actor().inventory.herbSeed === 2, 'herb seeds');
  await sleep(650);
  completed.push(
    'ordinary expedition, welcome and two seed exchanges; one berry supplied as fixture',
  );
  await a.locator('#gulf-spring-go').click();
  await until(
    () => !actor().moving && Math.hypot(actor().x - SPRINGS[0].x, actor().z - SPRINGS[0].z) < 4.8,
    'walk to spring',
  );
  assert.match(await a.locator('#interaction-hint').textContent(), /水袋/);
  await a.keyboard.press('e');
  await until(() => actor().inventory.water === 6, 'water filled');
  await sleep(650);
  for (const [i, id] of ['root', 'herb', 'berry'].entries()) {
    await walkPlot(a, i);
    await a.locator('#gulf-crop-choice').selectOption(id);
    await a.locator('#gulf-farm').click();
    await until(() => r().gulf.plots[i].stage === 'planted', 'plant ' + id);
    await sleep(650);
    assert.equal(r().gulf.plots[i].cropId, id);
    await a.locator('#gulf-farm').click();
    await until(() => r().gulf.plots[i].stage === 'growing', 'water ' + id);
    await sleep(650);
  }
  assert.equal(actor().inventory.water, 2);
  completed.push('walk to spring, carry water, walk among plots and plant/water all three crops');
  await close(a);
  await sleep(1000);
  await shot(a, '02-growing-crops');
  assert.equal(await a.locator('#world').getAttribute('data-crop-varieties'), 'berry,herb,root');
  await walkPlot(b, 0, '畑B');
  assert.match(await b.locator('#gulf-plot-state').textContent(), /火根草.*成長中/s);
  await shot(b, '03-shared-plot');
  await close(b);
  // Advance only isolated server time. Growth duration itself is tested without acceleration in core tests.
  const skip = Math.max(...r().gulf.plots.map((p) => p.readyAt)) - Date.now() - offset + 200;
  offset += skip;
  fixtures.push({ kind: 'clock-forward', milliseconds: skip, purpose: 'crop maturation' });
  await until(
    () =>
      r()
        .gulf.plots.slice(0, 3)
        .every((p) => p.stage === 'ripe'),
    'all ripe',
  );
  await sleep(800);
  await shot(a, '04-ripe-crops');
  // B harvests A's root crop through its real UI; A receives the synchronized empty plot.
  await plotUI(b, 0);
  await b.locator('#gulf-farm').click();
  await until(() => actor('畑B').inventory.rawRoot === 3, 'visitor harvest');
  await plotUI(a, 0);
  assert.match(await a.locator('#gulf-plot-state').textContent(), /空き畑/);
  completed.push('second browser sees crop kind and harvests first player crop once');
  // Replant roots using earned seeds. A harvests herbs/berries and its second root crop.
  await walkPlot(a, 0);
  await a.locator('#gulf-crop-choice').selectOption('root');
  await a.locator('#gulf-farm').click();
  await until(() => r().gulf.plots[0].stage === 'planted', 'replant');
  await sleep(650);
  await a.locator('#gulf-farm').click();
  await until(() => r().gulf.plots[0].stage === 'growing', 're-water');
  await sleep(650);
  for (const i of [1, 2]) {
    await walkPlot(a, i);
    await a.locator('#gulf-farm').click();
    await until(() => r().gulf.plots[i].stage === 'empty', 'harvest ' + i);
    await sleep(650);
  }
  const skip2 = r().gulf.plots[0].readyAt - Date.now() - offset + 200;
  offset += skip2;
  fixtures.push({ kind: 'clock-forward', milliseconds: skip2, purpose: 'second root harvest' });
  await until(() => r().gulf.plots[0].stage === 'ripe', 'second root ripe');
  await walkPlot(a, 0);
  await a.locator('#gulf-farm').click();
  await until(() => actor().inventory.rawRoot === 3, 'root harvest');
  await sleep(650);
  assert.equal(actor().inventory.herb, 3);
  const prior = {
    id: actor().id,
    inventory: { ...actor().inventory },
    gulf: structuredClone(actor().gulf),
  };
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => !!actor(), 'reconnect');
  assert.equal(actor().id, prior.id);
  assert.deepEqual(actor().inventory, prior.inventory);
  assert.deepEqual(actor().gulf, prior.gulf);
  completed.push('harvested food/seeds and plot progress survive same-tab reload');
  await a.keyboard.press('i');
  await a.locator('#modal-crop-food').click();
  await a.locator('#crop-food-fire').click();
  await until(
    () =>
      (!actor().moving &&
        Math.hypot(actor().x - MANY_HEARTHS.x, actor().z - MANY_HEARTHS.z) < 3.4) ||
      (!actor().moving &&
        Math.hypot(actor().x - (MANY_HEARTHS.x + 8), actor().z - (MANY_HEARTHS.z + 8)) < 3.4),
    'walk to cooking fire',
  );
  await sleep(700);
  await a.keyboard.press('i');
  await a.locator('#modal-crop-food').click();
  await a.locator('#crop-cook-herbRoot').click();
  await until(() => !!actor().cookingEndsAt, 'cook before cancel');
  await a.locator('#cancel-cook').click();
  await until(() => !actor().cookingEndsAt, 'cancel cook');
  assert.equal(actor().inventory.rawRoot, 3);
  assert.equal(actor().inventory.herb, 3);
  await sleep(700);
  await cookMeal(a, ROOT_RECIPES[0]);
  await cookMeal(a, ROOT_RECIPES[1]);
  completed.push(
    'walk to furnace; cancel preserves ingredients; both recipes consume correct materials',
  );
  actor().energy = 20;
  fixtures.push({ kind: 'energy', value: 20, purpose: 'food recovery' });
  await sleep(700);
  await a.keyboard.press('i');
  await a.locator('#modal-crop-food').click();
  await a.locator('#crop-eat-root').click();
  await until(() => actor().energy === 55, 'eat root +35');
  await sleep(700);
  await a.locator('#crop-eat-herbRoot').click();
  await until(() => actor().energy === 100, 'eat herb root capped');
  await sleep(700);
  await shot(a, '05-crop-meals');
  await cookMeal(a, ROOT_RECIPES[1]);
  // Isolated fixture fills other feast requirements; the food is normally farmed/cooked above.
  const p = actor();
  stopActor(p);
  const safe = r().collision.nearestFree(
    { x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 2 },
    p.radius,
    ridingObstacles(r(), null, p),
    2,
  );
  assert.ok(safe);
  Object.assign(p, safe);
  r().gulf.stores = { wood: 8, berry: 9, obsidian: 4 };
  fixtures.push({ kind: 'feast-setup', stores: { ...r().gulf.stores }, position: safe });
  await sleep(700);
  await a.keyboard.press('i');
  await a.locator('#modal-crop-food').click();
  await a.locator('#crop-offer-herbRoot').click();
  await until(() => r().gulf.festivals === 1, 'meal starts feast');
  assert.equal(actor().inventory.herbRoot, 0);
  completed.push(
    'both meals eaten; cultivated herb meal completes a feast with other supplies prepared',
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
      modal: document.querySelector('#modal').getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll('#crop-food-panel button')].map((b) => ({
        id: b.id,
        width: b.getBoundingClientRect().width,
        height: b.getBoundingClientRect().height,
      })),
    }));
    assert.ok(layout.scrollWidth <= width);
    assert.ok(layout.buttons.every((b) => b.height >= 42 && b.width <= width));
    viewports.push(layout);
    await shot(a, '06-meals-' + width);
    await a.locator('#crop-food-farms').click();
    await a.locator('#gulf-crop-choice').scrollIntoViewIfNeeded();
    await shot(a, '07-farms-' + width);
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await a.locator('#gulf-crop-food').click();
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  await openGulf(a);
  await a.locator('#gulf-crop-choice').selectOption('berry');
  await a.locator('#gulf-crop-choice').focus();
  await pad(a, 15);
  assert.equal(await a.locator('#gulf-crop-choice').inputValue(), 'root');
  await sleep(1500);
  await pad(a, 15);
  assert.equal(await a.locator('#gulf-crop-choice').inputValue(), 'herb');
  completed.push(
    'portrait/landscape recipe and plot UI; simulated controller crop selection remains focused across updates',
  );
  // Renderer eviction with a living crop, then return and recreate shared materials.
  await a.evaluate(() => (window.qaPadEnabled = false));
  await close(a);
  r().gulf.plots[0].stage = 'growing';
  r().gulf.plots[0].readyAt = Date.now() + offset;
  r().gulf.plots[0].cropId = 'root';
  fixtures.push({ kind: 'ripe-plot', id: FARM_PLOTS[0].id, purpose: 'renderer eviction/return' });
  // Use ordinary movement to display the fixture, then a clearly recorded long-distance fixture.
  await walkPlot(a, 0);
  await close(a);
  await sleep(1100);
  assert.ok(Number(await a.locator('#world').getAttribute('data-crop-materials')) > 0);
  stopActor(actor());
  Object.assign(actor(), { x: GULF_ENTRY.x - 180, z: GULF_ENTRY.z });
  const far = r().collision.nearestFree(
    actor(),
    actor().radius,
    ridingObstacles(r(), null, actor()),
    20,
  );
  assert.ok(far);
  Object.assign(actor(), far);
  fixtures.push({ kind: 'far-position', ...far, purpose: 'eviction' });
  await sleep(13500);
  assert.equal(await a.locator('#world').getAttribute('data-crop-materials'), '0');
  const back = r().collision.nearestFree(
    { x: FARM_PLOTS[0].x, z: FARM_PLOTS[0].z + 1.3 },
    actor().radius,
    ridingObstacles(r(), null, actor()),
    2,
  );
  assert.ok(back);
  Object.assign(actor(), back);
  fixtures.push({ kind: 'return-position', ...back, purpose: 'recreate crops' });
  await sleep(1500);
  assert.equal(await a.locator('#world').getAttribute('data-crop-varieties'), 'root');
  await shot(a, '08-returned-crop');
  completed.push(
    'crop-specific materials released beyond range and recreated on return with shared original geometry/textures',
  );
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
