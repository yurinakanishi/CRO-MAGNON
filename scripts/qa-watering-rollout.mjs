// Ordinary local UI and read-only delivery checks; no positions, inventories or clocks are prepared.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const base = 'http://localhost:3000',
  folder = 'output/playwright/resident-watering-20260909/local';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  checks = [],
  delivery = [],
  commands = [];
let state = {},
  id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const current = () => state.players?.find((p) => p.id === id);
async function close() {
  if (await page.locator('#modal').evaluate((d) => d.open))
    await page.locator('#modal-close').click();
}
async function gulf() {
  await close();
  if (await page.locator('#gulf-button').isVisible()) await page.locator('#gulf-button').click();
  else {
    await page.locator('#world').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-controller-menu="gulf"]').click();
  }
}
try {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (s) => {
    s.on('framesent', (e) => {
      try {
        commands.push(JSON.parse(e.payload.toString()));
      } catch {}
    });
    s.on('framereceived', (e) => {
      try {
        const m = JSON.parse(e.payload.toString());
        if (m.type === 'welcome') id = m.id;
        if (m.type === 'state') state = { ...state, ...m };
      } catch {}
    });
  });
  await page.goto(base + '/?room=WATER-LOCAL');
  assert.equal(await page.locator('#screen-title .menu-item').count(), 2);
  assert.equal(await page.locator('#screen-title a').count(), 0);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('水やり反映確認');
  await page.locator('#setup-submit').click();
  await page.locator('#guide-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual(errors, []);
  checks.push(
    'Current two-entry XI title, static credits, setup and world assets load without errors',
  );
  console.log('READY normal 3000');
  assert.ok(state.residents.every((n) => n.watering && n.watering.water === 0));
  assert.ok(state.gulf.plots.every((p) => p.waterRequestAt === 0));
  const original = { x: current().x, z: current().z };
  await page.locator('#world').click({ position: { x: 650, y: 620 } });
  await sleep(200);
  assert.deepEqual({ x: current().x, z: current().z }, original);
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await sleep(600);
  await page.keyboard.up('w');
  await sleep(350);
  assert.ok(Math.hypot(current().x - original.x, current().z - original.z) > 0.15);
  const stopped = { x: current().x, z: current().z };
  await sleep(500);
  assert.deepEqual({ x: current().x, z: current().z }, stopped);
  checks.push('Ground click remains stationary; keyboard movement and release still work');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await gulf();
    assert.equal(await page.locator('#gulf-travel,#gulf-expedition').count(), 0);
    await page.locator('#gulf-resident-water').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#gulf-resident-water').isDisabled(), true);
    assert.match(await page.locator('#gulf-watering-status').innerText(), /種を植え/);
    await page.screenshot({
      path: folder + '/farm-' + viewport.width + 'x' + viewport.height + '.png',
    });
    const bounds = await page
      .locator('#modal')
      .evaluate((d) => ({ width: d.clientWidth, scroll: d.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width + 2);
    await page.locator('#gulf-residents').click();
    assert.match(await page.locator('#resident-watering-aru').innerText(), /持ち水 0\/2/);
    await close();
    assert.deepEqual({ x: current().x, z: current().z }, stopped);
  }
  checks.push(
    'Desktop/portrait/landscape show watering and resident records; distant or empty fields cannot request assistance',
  );
  await page.reload();
  await page.locator('#title-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.deepEqual({ x: current().x, z: current().z }, stopped);
  checks.push('Ordinary resume preserves player position and new resident state');
  for (const f of [
    'src/gulf-ui.js',
    'src/village-ui.js',
    'shared/watering.mjs',
    'shared/watering-types.mjs',
    'shared/gulf-season.mjs',
    'shared/gulf-life.mjs',
    'shared/gulf-types.mjs',
    'shared/crops.mjs',
    'shared/village-life.mjs',
    'shared/village-types.mjs',
  ]) {
    const local = await readFile('dist/' + f),
      response = await fetch(base + '/' + f);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), local);
    delivery.push({ path: f, sha256: createHash('sha256').update(local).digest('hex') });
  }
  assert.ok(!commands.some((m) => ['target', 'expedition'].includes(m.type)));
  assert.deepEqual(errors, []);
  checks.push(
    'All ten delivered modules match the verified build; retired destination commands stay absent',
  );
  console.log(JSON.stringify({ checks, errors }));
  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
} catch (e) {
  errors.push(String(e));
  process.exitCode = 1;
  console.error(e);
  await page.screenshot({ path: folder + '/failure.png' }).catch(() => {});
} finally {
  await writeFile(
    folder + '/report.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        checks,
        errors,
        delivery,
        scope:
          'Ordinary setup and UI in a new local QA room. No position/inventory/clock/world fixtures. Checks delivery, controls, disabled distant farming and resume; nearby full watering is covered by the isolated browser QA.',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
