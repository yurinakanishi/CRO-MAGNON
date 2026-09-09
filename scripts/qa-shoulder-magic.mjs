// Isolated in-memory game; profile and proximity are fixtures, actions use real UI and time.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = 'output/playwright/shoulder-magic';
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [],
  errors = [],
  reports = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (const species of ['ape', 'bear']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript((species) => localStorage.setItem('cro-species', species), species);
    await page.route('**/src/main.js', async (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          `import { WorldRenderer as QAWorld } from '/src/world3d.js';
       const render = QAWorld.prototype.render;
       QAWorld.prototype.render = function(...args) {
         window.qaWorld = this; const result = render.apply(this, args);
         const e = this.players.get(this.selfId);
         if (e?.actor?.animation.name === 'Carry_Cast') window.qaCastFrames = (window.qaCastFrames || 0) + 1;
         return result;
       };\n` + (await readFile('dist/src/main.js', 'utf8')),
      }),
    );
    await page.goto(`http://127.0.0.1:${port}/?room=SHOULDER-MAGIC`);
    await page.locator('#title-start').click();
    await page.locator('#setup-form input[name="name"]').fill(`MagicQA-${species}`);
    await page.locator(`#setup-form input[name="species"][value="${species}"]`).check();
    await page.locator('#setup-submit').click();
    await page.locator('#guide-start').click();
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 90000 });
  }
  const room = game.rooms.get('SHOULDER-MAGIC');
  const ape = [...room.players.values()].find((p) => p.species === 'ape');
  const mage = [...room.players.values()].find((p) => p.species === 'bear');
  const [a, m] = pages;
  // Open grass, clear of enemies; no normal save is involved.
  for (const [p, x] of [
    [ape, 95],
    [mage, 96.3],
  ]) {
    stopActor(p);
    Object.assign(p, { x, z: 110, facing: 0 });
  }
  room.enemies = [];
  room.animals = [];
  await sleep(800);
  for (const page of pages)
    await page.evaluate(() => {
      const w = window.qaWorld;
      w.focus.set(95, 1.5, 110);
      w.yaw = 2.7;
      w.distance = 5;
    });
  await a.locator('#ride-button').click();
  await m.locator('#ride-button').click();
  await m.waitForFunction(
    () => !!window.qaWorld.players.get(window.qaWorld.selfId).state.carrierId,
  );
  assert.equal(mage.carrierId, ape.id);
  await m.locator('#attack-button').waitFor({ state: 'visible' });
  assert.equal(await m.locator('#attack-button').isEnabled(), true);
  await m.keyboard.press('f');
  await m.waitForFunction(
    () => window.qaWorld.players.get(window.qaWorld.selfId).actor.animation.name === 'Carry_Cast',
  );
  await m.screenshot({ path: `${folder}/cast.png` });
  await sleep(900);
  assert.equal(mage.attackSequence, 1);
  assert.equal(mage.carrierId, ape.id);
  const casts = await m.evaluate(() => window.qaCastFrames);
  assert.ok(casts > 0);
  const before = { x: ape.x, z: ape.z };
  await a.keyboard.down('w');
  await m.locator('#attack-button').click();
  await sleep(850);
  await a.keyboard.up('w');
  assert.ok(Math.hypot(ape.x - before.x, ape.z - before.z) > 0.1);
  assert.equal(mage.carrierId, ape.id);
  assert.equal(mage.attackSequence, 2);
  reports.push({ step: 'keyboard and button, carrier walking', casts });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await m.setViewportSize(viewport);
    await sleep(1200);
    const sequence = mage.attackSequence;
    await m.locator('#attack-button').click();
    await m.waitForFunction(
      (seq) => window.qaWorld.players.get(window.qaWorld.selfId).state.attackSequence > seq,
      sequence,
    );
    const box = await m.locator('#attack-button').boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
    );
    await m.screenshot({ path: `${folder}/${viewport.width}.png` });
    reports.push({ viewport, sequence: mage.attackSequence, box });
  }
  await sleep(1200);
  await m.locator('#ride-button').click();
  await m.waitForFunction(() => !window.qaWorld.players.get(window.qaWorld.selfId).state.carrierId);
  await m.keyboard.press('f');
  await sleep(500);
  assert.equal(mage.attackSequence, 5);
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify(
      {
        reports,
        errors,
        fixtures: ['profile', 'nearby positions', 'empty QA animals/enemies', 'camera'],
        clocksChanged: false,
        normalSaveModified: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ reports, errors }));
} finally {
  await browser.close();
  await game.close();
}
