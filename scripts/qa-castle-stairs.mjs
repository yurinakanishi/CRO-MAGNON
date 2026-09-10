// In-memory world; entrance positions/camera are fixtures, all travel uses real keys/time.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { CASTLE, castleWorld, castleLocal } from '../dist/shared/castle-layout.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = 'output/playwright/castle-stairs';
await mkdir(output, { recursive: true });
const candidate =
  'output/model-generation/models/valley-castle/work/low-poly/candidate-08/candidate.glb';
const bytes = await readFile(candidate),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  address = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  reports = [],
  sockets = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let observations = 0;
try {
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/models/world-assets.json', async (route) => {
      const manifest = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
      Object.assign(
        manifest.assets.find((a) => a.modelKey === 'valley-castle'),
        { sha256, bytes: bytes.length },
      );
      await route.fulfill({ json: manifest });
    });
    await page.route('**/models/valley-castle/model.glb', (route) =>
      route.fulfill({ body: bytes, contentType: 'model/gltf-binary' }),
    );
    await page.route('**/src/main.js', async (route) => {
      const source = await readFile('dist/src/main.js', 'utf8');
      await route.fulfill({
        contentType: 'text/javascript',
        body:
          `
        import { WorldRenderer as QAWorld } from '/src/world3d.js';
        const original=QAWorld.prototype.render;
        QAWorld.prototype.render=function(...args){window.qaWorld=this;return original.apply(this,args);};
      ` + source,
      });
    });
    await page.addInitScript((i) => {
      localStorage.setItem('cro-name', 'Castle QA ' + i);
      localStorage.setItem('cro-skip-guide', '1');
    }, i);
    await page.goto(`http://127.0.0.1:${address.port}/?room=CASTLE-STAIRS`);
    await page.locator('#title-start').click();
    if (i === 0)
      await page
        .locator('label.character-choice')
        .filter({ has: page.locator('input[value="ape-male"]') })
        .click();
    await page.locator('#setup-submit').click();
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 90000,
    });
  }
  const room = game.rooms.get('CASTLE-STAIRS'),
    actors = () => [...room.players.values()];
  const me = actors().find((p) => p.name === 'Castle QA 0'),
    other = actors().find((p) => p !== me);
  assert.equal(me.species, 'ape');
  Object.assign(other, castleWorld(-7, 23), { dx: 0, dz: 0 });
  for (let i = 0; i < 3; i++) {
    const params = new URLSearchParams({
      name: 'Castle peer ' + i,
      room: 'CASTLE-STAIRS',
      species: 'cro',
      gender: 'male',
    });
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?${params}`);
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }
  for (let i = 0; i < 100 && actors().length < 5; i++) await sleep(50);
  assert.equal(actors().length, 5);
  actors()
    .filter((p) => p !== me && p !== other)
    .forEach((p, i) => Object.assign(p, castleWorld(-9 - i * 2, 23), { dx: 0, dz: 0 }));
  const page = pages[0];
  const inventory = JSON.stringify(me.inventory);
  async function leg(local, label) {
    const goal = castleWorld(...local),
      start = castleLocal(me.x, me.z);
    const facing = Math.atan2(goal.x - me.x, goal.z - me.z);
    await page.evaluate((yaw) => {
      window.qaWorld.yaw = yaw;
    }, facing + Math.PI);
    await page.locator('#world').focus();
    await sleep(350);
    await page.keyboard.down('w');
    const begun = Date.now();
    let closest = Infinity;
    while (Date.now() - begun < 25000) {
      const d = Math.hypot(goal.x - me.x, goal.z - me.z);
      closest = Math.min(closest, d);
      observations++;
      assert.ok(
        room.collision.free(me, me.radius),
        `${label}: body clearance ${JSON.stringify(castleLocal(me.x, me.z))}`,
      );
      if (d < Math.max(0.13, me.speed * 0.08) || (d > closest + 0.12 && closest < 0.25)) break;
      await sleep(25);
    }
    await page.keyboard.up('w');
    await sleep(250);
    const initialStop = castleLocal(me.x, me.z);
    const wasRunning = me.runningRequested;
    // Real-time key release can arrive one or two server ticks later at 5.4m/s.
    // Finish positioning with ordinary walking keys before aiming the next leg.
    if (wasRunning && Math.hypot(goal.x-me.x,goal.z-me.z)>.12) {
      await page.keyboard.down('Tab');
      await page.locator('#run-button').click();
      await page.keyboard.up('Tab');
      for(let attempt=0;attempt<3 && Math.hypot(goal.x-me.x,goal.z-me.z)>.12;attempt++){
        await page.evaluate(yaw=>{window.qaWorld.yaw=yaw;},Math.atan2(goal.x-me.x,goal.z-me.z)+Math.PI);
        await page.locator('#world').focus();await sleep(400);
        await page.keyboard.down('w');
        const correction=Date.now();
        while(Math.hypot(goal.x-me.x,goal.z-me.z)>.09&&Date.now()-correction<1500) await sleep(15);
        await page.keyboard.up('w');await sleep(250);
      }
      await page.keyboard.down('Tab');
      await page.locator('#run-button').click();
      await page.keyboard.up('Tab');
    }
    const end = castleLocal(me.x, me.z),
      distance = Math.hypot(goal.x - me.x, goal.z - me.z);
    reports.push({ label, start, initialStop, end, distance, ms: Date.now() - begun });
    assert.ok(distance < 0.4, `${label}: ${JSON.stringify(reports.at(-1))}`);
    console.log(JSON.stringify(reports.at(-1)));
  }
  for (const [running, side, prediction] of [
    [false, -1, false],
    [true, 1, true],
  ]) {
    Object.assign(me, castleWorld(0, 34), { dx: 0, dz: 0, moving: false, runningRequested: false });
    await sleep(400);
    await page.evaluate(
      ({ prediction, position }) => {
        const w = window.qaWorld;
        w.prediction.enabled = prediction;
        w.prediction.reset();
        w.focus.set(position.x, 1.3, position.z);
        w.yaw = -1.05;
        w.pitch = 0.45;
      },
      { prediction, position: castleWorld(0, 34) },
    );
    if (running) {
      await page.keyboard.down('Tab');
      await page.locator('#run-button').click();
      await page.keyboard.up('Tab');
    }
    const label = running ? 'run-right' : 'walk-left';
    await leg([0, 18.9], label + '-ascent');
    await page.screenshot({ path: `${output}/${label}-landing.png` });
    await leg([side * 5, 18.9], label + '-turn');
    await page.screenshot({ path: `${output}/${label}-turn.png` });
    await leg([side * 5, 23], label + '-terrace');
    await leg([side * 5, 18.9], label + '-return-turn');
    await leg([0, 18.9], label + '-return-landing');
    await leg([0, 34], label + '-descent');
  }
  // Return to the landing for a five-person view and responsive screenshots.
  await leg([0, 18.9], 'five-players-ascent');
  await page.evaluate(
    (yaw) => {
      window.qaWorld.yaw = yaw;
      window.qaWorld.pitch = 0.5;
    },
    CASTLE.yaw + Math.PI / 2,
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await sleep(400);
    await page.screenshot({ path: `${output}/landing-${viewport.width}x${viewport.height}.png` });
  }
  await pages[1].evaluate(
    ({ position, yaw }) => {
      window.qaWorld.focus.set(position.x, 8, position.z);
      window.qaWorld.yaw = yaw;
      window.qaWorld.pitch = 0.45;
    },
    { position: castleWorld(-7, 23), yaw: CASTLE.yaw },
  );
  await sleep(500);
  await pages[1].screenshot({ path: `${output}/other-client.png` });
  assert.equal(JSON.stringify(me.inventory), inventory);
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      {
        sha256,
        reports,
        observations,
        participants: actors().length,
        errors,
        fixtures: [
          'entrance start positions',
          'other participants positions',
          'camera',
          'prediction setting',
        ],
        movement: 'real keyboard and wall clock',
        normalSaveModified: false,
      },
      null,
      2,
    ),
  );
} finally {
  for (const socket of sockets) socket.close();
  await browser.close();
  await game.close();
}
