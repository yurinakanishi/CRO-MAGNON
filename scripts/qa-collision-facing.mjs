// Isolated in-memory world. Fixtures set contact positions; movement uses real keys and time.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
import { overlap } from '../dist/shared/collision.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = path.resolve('output/playwright/collision-facing');
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  reports = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.route('**/src/main.js', async (route) => {
  const source = await readFile('dist/src/main.js', 'utf8');
  await route.fulfill({
    contentType: 'text/javascript',
    body:
      `
    import { WorldRenderer as QAWorld } from '/src/world3d.js';
    const qaRender = QAWorld.prototype.render;
    window.qaSamples = [];
    QAWorld.prototype.render = function(...args) {
      window.qaWorld = this;
      const result = qaRender.apply(this, args);
      const p = this.players.get(this.selfId);
      if (p?.actor && window.qaCollect) window.qaSamples.push({
        at: performance.now(), x: p.model.position.x, z: p.model.position.z,
        facing: p.model.rotation.y, serverFacing: p.state.facing
      });
      return result;
    };
  ` + source,
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angleError = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
try {
  await page.goto(`http://127.0.0.1:${port}/?room=FACING-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('衝突の向き確認');
  await page.locator('#setup-submit').click();
  await page.locator('#guide-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  const room = game.rooms.get('FACING-QA');
  const p = [...room.players.values()][0];
  const tent = room.collision.obstacles.find((o) => o.id === 'hide-tent' && o.x > 40 && o.x < 50);
  async function prepare(position, facing, prediction = false) {
    Object.assign(p, position, {
      facing,
      dx: 0,
      dz: 0,
      target: null,
      moving: false,
      runningRequested: false,
    });
    await sleep(400);
    await page.evaluate(
      ({ position, facing, prediction }) => {
        const w = window.qaWorld;
        w.prediction.enabled = prediction;
        w.prediction.reset();
        const e = w.players.get(w.selfId);
        e.model.position.x = position.x;
        e.model.position.z = position.z;
        e.model.rotation.y = facing;
        w.focus.set(position.x, 1.3, position.z);
        w.yaw = facing + Math.PI;
        window.qaCollect = false;
        window.qaSamples = [];
      },
      { position, facing, prediction },
    );
    await page.locator('#world').focus();
    await sleep(300);
  }
  async function collect(label, facing, duration = 1200, keys = true, trigger = () => {}) {
    if (keys) await page.keyboard.down('w');
    if (keys) await sleep(350);
    await page.evaluate(() => {
      window.qaSamples = [];
      window.qaCollect = true;
    });
    trigger();
    await sleep(duration);
    if (keys) await page.keyboard.up('w');
    await sleep(300);
    const samples = await page.evaluate(() => {
      window.qaCollect = false;
      return window.qaSamples;
    });
    assert.ok(samples.length > 10, label + ': rendered samples');
    const error = Math.max(...samples.map((s) => angleError(s.facing, facing)));
    assert.ok(error < 0.04, label + ': visible facing error ' + error);
    assert.ok(
      samples.every((s) => angleError(s.serverFacing, facing) < 0.001),
      label + ': server facing',
    );
    reports.push({
      label,
      samples: samples.length,
      maxAngleError: error,
      first: samples[0],
      last: samples.at(-1),
    });
    await page.screenshot({ path: path.join(folder, label + '.png') });
    return samples;
  }
  const position = {
    x: tent.x - tent.c * (tent.hx + p.radius + 0.002) - tent.s * 1.5,
    z: tent.z + tent.s * (tent.hx + p.radius + 0.002) - tent.c * 1.5,
  };
  const facing = Math.atan2(tent.c + tent.s, -tent.s + tent.c);
  for (const prediction of [false, true]) {
    await prepare(position, facing, prediction);
    const samples = await collect('tent-slide-' + prediction, facing);
    assert.ok(Math.hypot(samples.at(-1).x - samples[0].x, samples.at(-1).z - samples[0].z) > 0.3);
    assert.equal(overlap(p, p.radius, tent), null);
  }
  // A live enemy's collider pushes an idle player. Suppress AI during this contact fixture.
  const enemy = room.enemies.find((e) => e.modelKey === 'crow-shaman');
  const idleFacing = 0.7;
  await prepare({ x: 40, z: 50 }, idleFacing);
  const startX = p.x;
  await collect('enemy-idle-push', idleFacing, 800, false, () => {
    Object.assign(enemy, {
      x: 40 + enemy.radius + p.radius - 0.18,
      z: 50,
      hitUntil: Date.now() + 10000,
      targetId: null,
      target: null,
      path: [],
    });
  });
  assert.ok(p.x < startX - 0.1, 'actual enemy collision displaced player');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(folder, 'summary.json'),
    JSON.stringify(
      {
        reports,
        errors,
        fixtures: ['player contact positions and camera', 'enemy position and temporary AI hold'],
        clocksChanged: false,
        normalSaveModified: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ reports, errors }, null, 2));
} finally {
  await browser.close();
  await game.close();
}
