// Real Chrome, isolated memory-only room. Placement is a fixture; walking and
// switching the torch are real keyboard/touch events. Never accesses user saves.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/cave-spring-20261010/final';
const candidate = process.argv[3];
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  checks = [],
  captures = [],
  peers = [];
const sent = [];
page.on('websocket', (socket) =>
  socket.on('framesent', ({ payload }) => {
    try {
      sent.push(JSON.parse(String(payload)));
    } catch {}
  }),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let room, me, failure;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function until(fn, text, limit = 30000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > limit) throw Error(text);
    await sleep(100);
  }
}
async function capture(label, phase) {
  await sleep(700);
  const pixels = await page.evaluate((phase) => {
    const w = window.qaWorld,
      c = phase === 'waiting' ? window.qaCave : w;
    const renderer = w.renderer;
    // The same fixed camera permits an actual waiting/live comparison.
    const camera = c.camera.clone();
    camera.position.set(39.2, 3.25, 121.1);
    camera.lookAt(35.4, 0.5, 128.2);
    camera.updateMatrixWorld();
    renderer.render(c.scene, camera);
    window.qaReviewCamera = camera;
    const gl = renderer.getContext(),
      width = w.canvas.width,
      height = w.canvas.height;
    const p = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let sum = 0,
      black = 0,
      n = 0;
    for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 3)
      for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 3) {
        const i = (y * width + x) * 4,
          l = p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722;
        sum += l;
        black += Number(l < 6);
        n++;
      }
    const lights = [];
    c.scene.traverse((node) => {
      if (node.isLight)
        lights.push({
          type: node.type,
          intensity: node.intensity,
          color: node.color.getHexString(),
          distance: node.distance,
        });
    });
    return {
      mean: sum / n,
      black: black / n,
      lights,
      spring: !!c.scene.getObjectByName('cave-spring-water'),
    };
  }, phase);
  await page.screenshot({ path: `${out}/${label}.png` });
  await page.evaluate(() => {
    window.qaReviewCamera = null;
  });
  captures.push({ label, ...pixels });
  return pixels;
}
try {
  await page.route('**/src/main.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.qaInputState=()=>({keys:[...keys],screen:screens.active,touch:touchMode(),focus:document.hasFocus(),motion:!!motionControls?.ownsInput,hidden:document.hidden,modal:document.querySelector("#modal").open,chat:chatUI?.dialog.open,active:document.activeElement?.outerHTML?.slice(0,180),joined,ready:playReady(),renderUnavailable,easyControls});',
    });
  });
  for (const [file, cls, key] of [
    ['loading-cave', 'LoadingCave', 'qaCave'],
    ['world3d', 'WorldRenderer', 'qaWorld'],
  ])
    await page.route(`**/src/${file}.js`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `\nconst qaRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;const r=qaRender.apply(this,args);if(window.qaReviewCamera && !this.disposed ${key === 'qaWorld' ? '&& !this.loadingCave' : ''})${key === 'qaCave' ? 'this.world.renderer' : 'this.renderer'}.render(this.scene,window.qaReviewCamera);return r;};`,
      });
    });
  if (candidate) {
    const report = JSON.parse(await readFile(`${candidate}/report.json`));
    await page.route('**/models/world-assets.json', async (route) => {
      const response = await route.fetch(),
        catalog = await response.json();
      Object.assign(
        catalog.assets.find((a) => a.modelKey === 'camp-cave'),
        { url: report.url, sha256: report.sha256, bytes: report.bytes },
      );
      await route.fulfill({ response, json: catalog });
    });
    await page.route(`**${report.url}`, (route) =>
      route.fulfill({ contentType: 'model/gltf-binary', path: `${candidate}/model.glb` }),
    );
  }
  await page.goto(`http://127.0.0.1:${port}/?room=SPRINGQA`);
  await page.locator('#title-start').click();
  await page.locator('.character-choice:first-child').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
  await page.evaluate((p) => {
    qaCave.movement.position = p;
    qaCave.movement.facing = 0;
    qaCave.yaw = Math.PI;
    qaCave.pitch = 0.22;
  }, caveWorldAt(-28.5));
  const waitingLit = await capture('waiting-lit', 'waiting');
  assert.equal(waitingLit.spring, true);
  assert.equal(await page.locator('#world').getAttribute('data-cave-torch-held'), 'true');
  await page.keyboard.press('l');
  const waitingOff = await capture('waiting-off', 'waiting');
  assert(waitingLit.mean > waitingOff.mean + 0.2, 'torch illuminates surroundings');
  assert(waitingOff.mean > 18 && waitingOff.black < 0.2, 'unlit cave remains dimly readable');
  await page.locator('[data-cave-torch]').click();
  const before = await page.evaluate(() => ({ ...qaCave.movement.position }));
  await page.keyboard.down('w');
  await sleep(700);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => ({ ...qaCave.movement.position }));
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 0.3);
  pass(
    'Waiting: held torch, keyboard and button switching, readable unlit stone, actual walking toward spring',
  );
  await page.screenshot({ path: `${out}/waiting-normal.png` });
  await page.locator('[data-cave-proceed]:enabled').waitFor({ timeout: 180000 });
  await page.locator('[data-cave-proceed]').click();
  await page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
  room = game.rooms.get('SPRINGQA');
  me = [...room.players.values()][0];
  room.enemies = [];
  room.camp.caveFireLit = false;
  stopActor(me);
  Object.assign(me, caveWorldAt(-28.5), { y: 0, facing: 0, caveTorchOff: false });
  await page.evaluate(() => {
    qaWorld.yaw = Math.PI;
    qaWorld.pitch = 0.22;
  });
  await sleep(7000);
  const liveLit = await capture('live-lit', 'live');
  assert(liveLit.spring);
  await page.keyboard.press('l');
  await until(() => me.caveTorchOff, 'server torch switch');
  const liveOff = await capture('live-off', 'live');
  assert(liveLit.mean > liveOff.mean + 0.2);
  assert(liveOff.mean > 18 && liveOff.black < 0.2);
  assert(
    Math.abs(liveOff.mean - waitingOff.mean) < 10,
    'same environmental brightness waiting/live',
  );
  pass(
    'Live: same spring and dim environment; actual L switches personal lighting without blacking out cave',
  );
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=SPRINGQA&name=SpringPeer${i}`);
    peers.push(ws);
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
  }
  await until(() => room.players.size === 5, 'five connected players');
  for (const [i, p] of [...room.players.values()].entries())
    if (p !== me) {
      stopActor(p);
      Object.assign(p, caveWorldAt(-25 + i * 0.8, (i % 2 ? 1 : -1) * 2), {
        y: 0,
        caveTorchOff: false,
      });
    }
  await page.keyboard.press('l');
  await until(() => !me.caveTorchOff, 'local torch relit');
  await sleep(4000);
  await capture('five-players', 'live');
  assert([...room.players.values()].every((p) => !p.caveTorchOff));
  await page.keyboard.press('l');
  await until(() => me.caveTorchOff, 'local torch off with peers');
  assert([...room.players.values()].filter((p) => p !== me).every((p) => !p.caveTorchOff));
  // Walk along the dry bank; walking straight into the sloped basin can be
  // stopped by the existing drop/shore collision and is not a swim test.
  const position = { x: me.x, z: me.z };
  await page.bringToFront();
  await page.locator('#world').click({ position: { x: 400, y: 400 } });
  // Five arriving actors may still be compiling. Observe displacement instead
  // of assuming a short fixed key hold always contains an input frame.
  await page.keyboard.down('s');
  await until(
    () => Math.hypot(me.x - position.x, me.z - position.z) > 0.3,
    'real keyboard movement along bank',
    15000,
  );
  pass('Bank movement reaches the server from real keyboard input', { dx: me.dx, dz: me.dz });
  await page.keyboard.up('s');
  console.log(
    'BANK WALK',
    JSON.stringify({ before: position, after: { x: me.x, z: me.z, y: me.y } }),
  );
  assert(Math.hypot(me.x - position.x, me.z - position.z) > 0.3);
  assert(Number.isFinite(me.y));
  pass(
    'Five connected players retain independent torches; actual movement at spring has a valid measured floor',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await page.screenshot({ path: `${out}/live-portrait.png` });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack || error);
  console.error(failure);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        checks,
        captures,
        errors,
        failure,
        browser: browser.version(),
        candidate,
        fixture:
          'server placement only; keyboard walking and switching; one real Chrome and four WebSocket peers; phone viewport is not a physical device',
      },
      null,
      2,
    ),
  );
  for (const ws of peers) ws.close();
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
