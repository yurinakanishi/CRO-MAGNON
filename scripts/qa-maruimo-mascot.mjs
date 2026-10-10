// Real Chrome and four websocket observers in an isolated memory-only local world.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/maruimo-mascot-20261007/final-r01';
await mkdir(out, { recursive: true });
let assetRoot;
if (process.argv[3]) {
  assetRoot = path.resolve(out, 'browser-root');
  await mkdir(path.join(assetRoot, 'public'), { recursive: true });
  await mkdir(path.join(assetRoot, 'dist'), { recursive: true });
  for (const dir of ['src', 'shared'])
    await symlink(
      path.resolve(process.argv[3], dir),
      path.join(assetRoot, 'dist', dir),
      'junction',
    );
  for (const dir of ['models', 'audio', 'title', 'vendor', 'spawn'])
    await symlink(
      path.resolve(process.argv[3], dir),
      path.join(assetRoot, 'public', dir),
      'junction',
    );
  for (const file of ['index.html', 'favicon.svg'])
    await copyFile(path.resolve(process.argv[3], file), path.join(assetRoot, 'public', file));
}
const game = createGameServer({
  ...localVerificationSettings(out),
  port: 0,
  ...(assetRoot ? { assetRoot } : {}),
});
const { port } = await game.listen(),
  base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  hasTouch: false,
});
const page = await context.newPage(),
  peers = [],
  errors = [],
  checks = [],
  shots = [];
// Node's production static allowlist intentionally rejects .bin. Feed the exact
// verified MMO chunks through the QA route so its real split-asset loader runs.
if (process.argv[3]) {
  await page.route('**/models/**/*.bin', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const root = path.resolve(process.argv[3]);
    const target = path.resolve(root, '.' + url);
    assert.ok(target.startsWith(root + path.sep));
    await route.fulfill({ contentType: 'application/octet-stream', body: await readFile(target) });
  });
}
const device = await context.newCDPSession(page);
await device.send('Emulation.setTouchEmulationEnabled', { enabled: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(60);
  }
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
let id, room, p, c, failure;
page.on('websocket', (ws) =>
  ws.on('framereceived', ({ payload }) => {
    const m = JSON.parse(String(payload));
    if (m.type === 'welcome') id = m.id;
  }),
);
await page.addInitScript(() => {
  localStorage.setItem('cro-name', 'Maruimo QA');
  localStorage.setItem('cro-graphics-quality', 'standard');
});
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  assert.ok(source.includes('this.camera.lookAt(aim);'));
  await route.fulfill({
    response,
    body:
      source.replace(
        'this.camera.lookAt(aim);',
        'this.camera.lookAt(aim);if(window.reviewView){this.camera.position.set(...reviewView.eye);this.camera.lookAt(...reviewView.target);this.camera.fov=reviewView.fov??70;this.camera.updateProjectionMatrix();}',
      ) +
      '\nconst originalRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){const r=originalRender.apply(this,a);window.qa=this;return r;};',
  });
});
async function enter() {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(
    () =>
      window.qa?.maruimoRenderer && qa.landmarks.caveExtraPigments.maruimoFrieze?.image?.complete,
    null,
    { timeout: 60000 },
  );
  room = game.rooms.get('LOCAL_VERIFY');
  p = room.players.get(id);
  c = room.maruimo;
}
async function shot(name, view) {
  if (view !== undefined) await page.evaluate((v) => (window.reviewView = v), view);
  await sleep(350);
  await page.screenshot({ path: `${out}/${name}.png` });
  shots.push(name);
  console.log('CAPTURE', name);
}
async function tap(selector) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  assert.ok(b);
  await device.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
  });
  await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function near() {
  // Bulk selection can bring the other pets into this small contact fixture.
  // Keep them available in the world, but outside the nearest-pet input radius.
  for (const pet of [room.kohaku, room.mae, room.rimoNeko, room.companion524])
    Object.assign(pet, {
      x: 64,
      z: 60,
      mode: 'idle',
      followPlayerId: null,
      petPlayerId: null,
      path: [],
    });
  for (const [i, bot] of room.orbBots.entries())
    Object.assign(bot, {
      x: 65 + i * 0.4,
      z: 60,
      home: { x: 65 + i * 0.4, z: 60 },
      mode: 'home',
      ownerId: '',
      returnHome: false,
      path: [],
    });
  stopActor(p);
  Object.assign(p, { x: 40, z: 55.55, facing: Math.PI, warpSequence: (p.warpSequence ?? 0) + 1 });
  Object.assign(c, {
    x: 40,
    z: 54,
    facing: 0,
    mode: 'idle',
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    path: [],
    trail: [{ ...c.home }],
    velocityX: 0,
    velocityZ: 0,
    followSpeed: 0,
    ownerPosition: null,
  });
  await sleep(500);
  await page.evaluate(() => {
    qa.maruimoRenderer.placed = false;
    qa.yaw = 1.1;
    qa.pitch = 0.24;
    qa.targetDistance = 3;
  });
  await until(
    () =>
      page.evaluate(
        () =>
          Math.hypot(
            qa.maruimoRenderer.root.position.x - qa.state.maruimo.x,
            qa.maruimoRenderer.root.position.z - qa.state.maruimo.z,
          ) < 0.02,
      ),
    'model settled',
  );
  await page.locator('#world').focus();
}
try {
  await page.goto(base);
  await enter();
  room.enemies = [];
  room.animals = [];
  room.behemoth = null;
  room.sabertooth = null;
  for (const pet of [room.kohaku, room.mae, room.rimoNeko, room.companion524])
    Object.assign(pet, { x: 64, z: 60 });
  for (let i = 0; i < 4; i++) {
    const peer = {
      state: null,
      ws: new WebSocket(`ws://127.0.0.1:${port}/ws?room=LOCAL_VERIFY&name=Observer${i}`),
    };
    peer.ws.on('message', (b) => {
      const m = JSON.parse(b);
      if (m.type === 'state') peer.state = m;
    });
    peers.push(peer);
    await new Promise((r, j) => {
      peer.ws.once('open', r);
      peer.ws.once('error', j);
    });
  }
  await until(() => room.players.size === 5, 'five participants');
  for (const other of room.players.values())
    if (other.id !== id) Object.assign(other, { x: 70, z: 55 });
  await near();
  await shot('camp-mascot', { eye: [42, 1.1, 57], target: [40, 0.38, 54], fov: 45 });
  await page.keyboard.press('v');
  await until(() => c.petContactAt > 0, 'V pet contact');
  await until(
    () => page.evaluate(() => qa.maruimoRenderer.diagnostics().hearts >= 2),
    'happy hearts',
  );
  await shot('pet-happy');
  const contact = c.petContactAt;
  await until(
    () => peers.every((q) => q.state?.maruimo?.petContactAt === contact),
    'five shared contact clocks',
  );
  await until(() => !c.petPlayerId, 'pet completed');
  assert.equal(c.followPlayerId, id);
  pass('V petting, authored wave and hearts, five synchronized clients');
  await page.evaluate(() => (window.reviewView = null));
  const start = { x: c.x, z: c.z },
    playerStart = { x: p.x, z: p.z };
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await sleep(3000);
  await page.keyboard.up('w');
  await sleep(1500);
  assert.ok(
    Math.hypot(p.x - playerStart.x, p.z - playerStart.z) > 1,
    `player movement ${JSON.stringify({ playerStart, x: p.x, z: p.z })}`,
  );
  assert.ok(
    Math.hypot(c.x - start.x, c.z - start.z) > 0.5,
    `follow movement ${JSON.stringify({ start, x: c.x, z: c.z })}`,
  );
  await shot('following');
  pass('Actual W movement makes Maruimo follow');
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="mascots"]').click();
  assert.equal(await page.locator('[data-mascot]').count(), 14);
  await until(
    () =>
      page
        .locator('[data-mascot] img')
        .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)),
    '14 portraits',
  );
  await shot('cards-desktop');
  await page.locator('[data-mascot="maruimo-mascot"]').click();
  await until(() => !c.followPlayerId, 'return from card');
  await page.locator('[data-mascot-all="select"]').click();
  await until(
    () =>
      page
        .locator('#mascot-selection-count')
        .textContent()
        .then((t) => t.includes('14 / 14')),
    'all 14',
  );
  await page.locator('[data-mascot-all="clear"]').click();
  await until(
    () =>
      page
        .locator('#mascot-selection-count')
        .textContent()
        .then((t) => t.includes('0 / 14')),
    'clear 14',
  );
  await device.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await tap('[data-mascot="maruimo-mascot"]');
    await until(() => c.followPlayerId === id, 'touch select');
    await shot(`cards-${width}x${height}`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await tap('[data-mascot="maruimo-mascot"]');
    await until(() => !c.followPlayerId, 'touch return');
  }
  pass(
    '14 portraits, select/all/clear, real taps at three phone sizes without horizontal overflow',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await near();
  await until(
    () =>
      page
        .locator('[data-touch-action="pet"]')
        .textContent()
        .then((t) => t.includes('まるぃも')),
    'Maruimo is the nearest touch target',
  );
  await tap('[data-touch-action="pet"]');
  await until(() => c.petContactAt > 0, 'touch pet');
  await until(() => !c.petPlayerId, 'touch pet done');
  pass('Touch petting uses the same authoritative action');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [distance, expected] of [
    [4, 0],
    [14, 1],
    [4, 0],
  ]) {
    await page.evaluate(
      ({ x, z, d }) => (window.reviewView = { eye: [x, 1, z + d], target: [x, 0.4, z] }),
      { x: c.x, z: c.z, d: distance },
    );
    await until(
      () =>
        page
          .evaluate(() => qa.maruimoRenderer.actor.root.userData.actorDetail.level)
          .then((v) => v === expected),
      'LOD switch',
    );
  }
  pass('Actual camera distance switches mascot LOD and restores its original mesh');
  const center = caveWorldAt(-14.8);
  stopActor(p);
  Object.assign(p, caveWorldAt(-14.8, -3.3), {
    facing: Math.PI / 2,
    warpSequence: p.warpSequence + 1,
  });
  room.camp.caveFireLit = true;
  const view = {
    eye: [center.x - 1, 2.35, center.z],
    target: [center.x + 5.7, 2.1, center.z],
    fov: 65,
  };
  await shot('mural-whole', view);
  await shot('mural-close', {
    eye: [center.x + 1, 2.1, center.z],
    target: [center.x + 5.7, 2.1, center.z],
    fov: 65,
  });
  room.camp.caveFireLit = false;
  await shot('mural-torch', view);
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const image = await page.evaluate(() => qa.landmarks.caveExtraPigments.maruimoFrieze.image.src);
  assert.equal(new URL(image).pathname, asset.mascotPigments.maruimoFrieze.url);
  assert.equal(
    hash(Buffer.from(await (await fetch(image)).arrayBuffer())),
    asset.mascotPigments.maruimoFrieze.sha256,
  );
  pass(
    'Animal frieze appears on original cave stone in hearth and torch light; served PNG SHA matches',
  );
  peers.forEach((p) => p.ws.close());
  await page.reload();
  await enter();
  assert.equal(c.followPlayerId, id);
  pass('Browser reload and UI re-entry retain the mascot bond');
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e.stack ?? e);
  console.error(failure);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        checks,
        shots,
        errors,
        failure,
        fixture:
          'Memory-only local world. Positions, quiet world, observation camera and hearth are QA setup. Inputs and rendering are the actual game.',
      },
      null,
      2,
    ) + '\n',
  );
  peers.forEach((p) => p.ws.close());
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, checks, errors, failure }));
if (failure) process.exitCode = 1;
