// Independent in-memory game, no connection to the user's normal saved rooms.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { CAMP_CAVE, CAVE_APPROACH, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.CAVE_QA_OUTPUT ?? 'output/playwright/cave-entrance-seam-20261007';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  shots = [],
  peers = [];
const roomName = 'CAVE-SEAM-QA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, why, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(why);
    await sleep(50);
  }
}
let room, failure;
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(),
    seen = { id: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
    }),
  );
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'standard');
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text())
          .replace(
            'if (!this.occluded()) this.renderer.render(this.scene, this.camera);',
            'if(Number.isInteger(window.reviewLod)){const hill=this.landmarks?.instances.get("camp-mountain");hill?.levels.forEach((level,i)=>level.object.visible=i===window.reviewLod);} if (!this.occluded()) this.renderer.render(this.scene, this.camera);',
          )
          .replace(
            'this.camera.lookAt(aim);',
            `this.camera.lookAt(aim);if(window.reviewView){this.camera.position.set(...reviewView.eye);this.camera.lookAt(...reviewView.target);this.camera.fov=reviewView.fov??65;this.camera.updateProjectionMatrix();}`,
          ) +
        `
      const originalUpdateCaveRender=WorldRenderer.prototype.render;
      WorldRenderer.prototype.render=function(...args){const r=originalUpdateCaveRender.apply(this,args);window.qa=this;return r;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('[data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  room = game.rooms.get(roomName);
  return {
    page,
    seen,
    get p() {
      return room.players.get(seen.id);
    },
  };
}
async function shot(user, name, view = null) {
  await user.page.evaluate((view) => {
    window.reviewView = view;
  }, view);
  await sleep(600);
  await user.page.screenshot({ path: `${out}/${name}.png` });
  shots.push({ name, view, player: { x: user.p.x, z: user.p.z } });
  console.log('CAPTURE', name);
}
async function place(user, point, facing = Math.PI / 2) {
  stopActor(user.p);
  Object.assign(user.p, point, { facing, warpSequence: (user.p.warpSequence ?? 0) + 1 });
  await user.page.evaluate(() => {
    window.reviewView = null;
  });
  await sleep(800);
  await user.page.locator('#world').focus();
}
async function walk(user, point) {
  await user.page.evaluate((point) => {
    const self = qa.state.players.find((p) => p.id === qa.selfId);
    qa.yaw = Math.atan2(self.x - point.x, self.z - point.z);
    qa.pitch = 0.2;
    qa.targetDistance = 5;
  }, point);
  await user.page.locator('#world').focus();
  await user.page.keyboard.down('w');
  try {
    await until(
      () => Math.hypot(user.p.x - point.x, user.p.z - point.z) < 0.6,
      'walking to ' + JSON.stringify(point),
      30000,
    );
  } finally {
    await user.page.keyboard.up('w');
  }
  await sleep(150);
}
try {
  const a = await open('CaveReviewer');
  room.enemies = [];
  room.behemoth = null;
  room.sabertooth = null;
  await a.page.waitForFunction(
    () =>
      Object.values(qa.landmarks.caveExtraPigments).length >= 4 &&
      Object.values(qa.landmarks.caveExtraPigments).every(
        (t) => t.image?.complete || t.image instanceof HTMLCanvasElement,
      ),
    null,
    { timeout: 60000 },
  );
  await sleep(4000);
  await shot(a, 'camp-facing-cave', {
    eye: [64, 10, 44],
    target: [CAMP_CAVE.x, 3, CAMP_CAVE.z - 8],
    fov: 65,
  });
  for (const [name, eye, target] of [
    ['front-close', [52, 5, 76], [52, 4, 88]],
    ['east-close', [64, 6, 81], [52, 4, 86]],
    ['west-close', [40, 11, 78], [52, 4, 86]],
    ['top-close', [53, 17, 82], [52, 4, 88]],
    ['front-hill', [52, 7, 62], [50, 8, 100]],
    ['east-hill', [80, 12, 86], [49, 8, 99]],
    ['west-hill', [23, 13, 80], [51, 8, 95]],
    ['above-hill', [62, 35, 71], [46, 5, 105]],
    ['whole-mountain', [88, 32, 64], [15, 13, 115]],
  ])
    await shot(a, name, { eye, target, fov: 65 });
  await a.page.evaluate(() => {
    window.reviewView = null;
  });
  await a.page.evaluate(() => {
    window.reviewLod = 1;
  });
  await shot(a, 'east-close-lod', { eye: [64, 6, 81], target: [52, 4, 86], fov: 65 });
  await shot(a, 'front-close-lod', { eye: [52, 5, 76], target: [52, 4, 88], fov: 65 });
  await a.page.evaluate(() => {
    window.reviewLod = undefined;
    window.reviewView = null;
  });
  if (process.env.CAVE_QA_PREVIEW !== '1') {
    for (const goal of CAVE_APPROACH) await walk(a, goal);
    await shot(a, 'ground-entrance');
    await walk(a, caveWorldAt(5));
    assert.ok(Math.hypot(a.p.x - CAMP_CAVE.x, a.p.z - (CAMP_CAVE.z - 5)) < 1);
    checks.push(
      'actual W key walks from normal camp spawn to the ground-level entrance and inside',
    );
    await walk(a, caveWorldAt(14));
    await shot(a, 'walking-out');
    checks.push('actual W key exits through the same ground-level entrance');
    const b = await open('CavePeer');
    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=CaveProtocol${i}`);
      peers.push(ws);
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    }
    await until(() => room.players.size === 5, 'five connections');
    room.camp.caveFireLit = true;
    for (const [name, z, side] of [['mae-kohaku', -28.5, -1]]) {
      const center = caveWorldAt(z);
      await place(a, caveWorldAt(z, side * 3.5), side < 0 ? Math.PI / 2 : -Math.PI / 2);
      const eye = [center.x - side * 0.8, CAMP_CAVE.elevation + 2.6, center.z];
      const target = [center.x - side * 5.7, CAMP_CAVE.elevation + 2.3, center.z];
      await shot(a, name, { eye, target, fov: 78 });
      checks.push(`${name} loaded and captured under game torch/hearth lighting`);
    }
    await place(a, { x: 52, z: 74 });
    await a.page.evaluate(() => {
      qa.yaw = Math.PI;
      qa.pitch = 0.28;
      qa.targetDistance = 8;
    });
    await shot(a, 'normal-camera');
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await a.page.setViewportSize({ width, height });
      await shot(a, `normal-${width}x${height}`);
    }
    await b.page.reload();
    await b.page.waitForLoadState('domcontentloaded');
    if (await b.page.locator('#title-start').isVisible()) {
      await b.page.locator('#title-start').click();
      await b.page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
      await b.page.locator('[data-choose-difficulty="normal"]').click();
      await b.page.locator('#setup-flow-yes').click();
    }
    await b.page.locator('#world[data-world-asset="ready"]').waitFor({ timeout: 180000 });
    await until(
      () => room.players.size === 5 && room.players.has(b.seen.id),
      'five peers after reload',
    );
    checks.push(
      'second real browser reconnects while three protocol peers retain five-player room',
    );
  }
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e.stack ?? e);
  console.error(failure);
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        checks,
        shots,
        errors,
        failure,
        cave: CAMP_CAVE,
        scope:
          'Memory-only game; keyboard camp approach. Mural positions and review cameras are QA fixtures; actual game lighting. No saved-game edits.',
      },
      null,
      2,
    ),
  );
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, checks, errors, failure }));
if (failure) process.exitCode = 1;
