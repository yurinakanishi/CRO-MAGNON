// Real Chrome + real game/server/Worker. Synthetic frames/landmarks are explicitly labelled.
// No user saves, real webcam images, external requests or physical controllers are used.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
const root = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || `output/playwright/motion-controls-${Date.now()}`);
await mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(path.join(root, 'dist/server.mjs')));
const { createExhibitionClient } = await import(
  pathToFileURL(path.join(root, 'dist/infrastructure/node/exhibition-client.mjs'))
);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const game = createGameServer({ host: '127.0.0.1', port: 0, exhibition: true });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const browserSession = await browser.newBrowserCDPSession();
const systemInfo = await browserSession.send('SystemInfo.getInfo');
const graphics = {
  devices: systemInfo.gpu.devices,
  renderer: systemInfo.gpu.auxAttributes?.glRenderer,
  vendor: systemInfo.gpu.auxAttributes?.glVendor,
};
await browserSession.detach();
const clients = [],
  pages = [],
  checks = [],
  measurements = [],
  errors = [],
  externalRequests = [];
const roomName = `MOTIONQA${String(Date.now()).slice(-6)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
const room = () => game.rooms.get(roomName);
const actor = (name) => [...room().players.values()].find((p) => p.name === name);
const handFixture = (
  await readFile(new URL('../tests/helpers/motion-hands.mjs', import.meta.url), 'utf8')
).replaceAll('export ', '');
const fakeWorker =
  handFixture +
  `\nlet bootId=0; self.onmessage=({data:d})=>{
 if(d.type==='close'){self.postMessage({type:'closed',bootId});self.close();return;}
 if(d.type==='init'){bootId=d.bootId;self.postMessage({type:'ready',bootId,modelLoadMs:1});return;}
 if(d.type!=='frame')return;
 const g=d.qaGesture||{}, move=g.move||{x:0,y:0}, act=g.act||{x:0,y:0};
 const hands=syntheticHands(move,act,g.swapped);
 if(g.lossMove)hands[g.swapped?'right':'left']=null;
 if(g.lossAction)hands[g.swapped?'left':'right']=null;
 d.bitmap.close();
 if(g.stall)return;
 setTimeout(()=>self.postMessage({type:'result',bootId,sessionId:d.sessionId,frameId:d.frameId,sampledAtMainMs:d.sampledAtMainMs,width:640,height:480,hands:g.noPose?null:hands,inferenceMs:1}),g.delay||0);
};`;
async function instrument(page) {
  await page.addInitScript(() => {
    window.qaGesture = {};
    window.qaSent = [];
    window.qaTracks = [];
    window.qaWorkers = [];
    window.qaMediaMode = 'normal';
    window.qaFramesInFlight = 0;
    window.qaMaxInFlight = 0;
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      constructor(...args) {
        super(...args);
        window.qaSocket = this;
        this.addEventListener('message', (e) => {
          const v = JSON.parse(e.data);
          if (v.type === 'welcome') window.qaSelf = v.id;
          if (v.type === 'state') window.qaState = v;
        });
      }
      send(value) {
        window.qaSent.push({ at: performance.now(), value: JSON.parse(value) });
        if (window.qaSent.length > 1000) window.qaSent.shift();
        super.send(value);
      }
    };
    const WorkerBase = window.Worker;
    window.Worker = class extends WorkerBase {
      constructor(...args) {
        super(...args);
        this.isMotion = String(args[0]).includes('motion-worker');
        if (this.isMotion) {
          const rec = { terminated: false };
          this.rec = rec;
          window.qaWorkers.push(rec);
          this.addEventListener('message', (e) => {
            if (e.data.type === 'result')
              window.qaFramesInFlight = Math.max(0, window.qaFramesInFlight - 1);
          });
        }
      }
      postMessage(value, transfer) {
        if (this.isMotion && value.type === 'frame') {
          value.qaGesture = window.qaGesture;
          window.qaFramesInFlight++;
          window.qaMaxInFlight = Math.max(window.qaMaxInFlight, window.qaFramesInFlight);
        }
        super.postMessage(value, transfer);
      }
      terminate() {
        if (this.rec) {
          this.rec.terminated = true;
          window.qaFramesInFlight = 0;
        }
        super.terminate();
      }
    };
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (options) => {
      if (window.qaMediaMode === 'denied') throw new DOMException('denied', 'NotAllowedError');
      if (window.qaMediaMode === 'missing') throw new DOMException('missing', 'NotFoundError');
      if (window.qaMediaMode === 'busy') throw new DOMException('busy', 'NotReadableError');
      const result = await native(options);
      window.qaTracks.push(...result.getTracks());
      if (window.qaMediaMode === 'late') await new Promise((resolve) => (window.qaAllow = resolve));
      return result;
    };
  });
}
async function createPage(name, mock) {
  const client = createExhibitionClient({
    root,
    port: 0,
    config: {
      mode: 'lan',
      serverUrl: `ws://127.0.0.1:${port}/ws`,
      room: roomName,
      guestName: name,
    },
  });
  clients.push(client);
  const local = await client.listen();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pages.push(page);
  page.motionRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.context().on('request', (r) => {
    if (/mediapipe|\/motion\/.*\.task/.test(r.url())) page.motionRequests.push(r.url());
    if (
      !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(r.url()) &&
      !/^(blob:|data:)/.test(r.url())
    )
      externalRequests.push(r.url());
  });
  await instrument(page);
  if (mock)
    await page.route('**/src/motion-worker.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeWorker }),
    );
  await page.goto(`http://127.0.0.1:${local.port}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[value="cro-female"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-choose-spawn="camp"]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  return page;
}
const state = (page, value) =>
  page.locator(`#motion-controls[data-state="${value}"]`).waitFor({ timeout: 15000 });
async function gesture(page, value, ms = 450) {
  await page.evaluate((value) => {
    window.qaGesture = value;
  }, value);
  await sleep(ms);
}
async function wave(page) {
  await gesture(page, { act: { pitch: 1.3 } }, 250);
  for (const x of [0.1, 0.2, 0.3, 0.4]) await gesture(page, { act: { pitch: 1.3, x } }, 100);
}
async function start(page, active = true) {
  await page.bringToFront();
  if (await page.locator('#motion-panel').isHidden()) await page.locator('#motion-open').click();
  else await page.locator('#motion-start').click();
  if (active) await state(page, 'ACTIVE');
}
async function stopped(page) {
  await page.waitForFunction(
    () =>
      window.qaTracks.every((t) => t.readyState === 'ended') &&
      window.qaWorkers.every((w) => w.terminated),
  );
  assert.equal(await page.locator('#motion-video').evaluate((v) => v.srcObject), null);
}
async function measure(page, label, ms = 4000) {
  await sleep(1000);
  await page.evaluate(async () => (await import('/src/main.js')).resetMotionMetrics());
  await sleep(ms);
  const value = await page.evaluate(async () => ({
    ...(await import('/src/main.js')).motionDiagnostics(),
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    mediaSettings: (() => {
      const settings = document
        .querySelector('#motion-video')
        .srcObject?.getVideoTracks()[0]
        ?.getSettings();
      if (!settings) return null;
      const { width, height, frameRate, aspectRatio } = settings;
      return { width, height, frameRate, aspectRatio };
    })(),
  }));
  measurements.push({ label, ...value });
  console.log('MEASURE', label, JSON.stringify(value));
}
try {
  const p = await createPage('motion', true);
  const q = await createPage('observer', false);
  await p.bringToFront();
  // Warm the same camp views before comparing modes. Initial shader compilation may
  // legitimately exceed the safety deadline; that is recorded separately from inference.
  await p.mouse.move(800, 450);
  await p.mouse.down({ button: 'right' });
  await p.mouse.move(1350, 450, { steps: 55 });
  await sleep(500);
  await p.mouse.move(250, 450, { steps: 110 });
  await sleep(500);
  await p.mouse.move(800, 450, { steps: 55 });
  await p.mouse.up({ button: 'right' });
  await sleep(1500);
  await p.evaluate(async () => {
    window.qaMotionTrace = [];
    const { MotionInputAdapter } = await import('/src/motion-input.js');
    for (const method of ['read', 'accept']) {
      const original = MotionInputAdapter.prototype[method];
      MotionInputAdapter.prototype[method] = function (...args) {
        const before = this.state;
        const result = original.apply(this, args);
        if (method === 'accept' || this.state !== before) {
          window.qaMotionTrace.push({
            method,
            at: performance.now(),
            sample: this.lastSample,
            frame: args[0]?.sampledAtMainMs,
            session: this.sessionId,
            before,
            after: this.state,
          });
          if (window.qaMotionTrace.length > 100) window.qaMotionTrace.shift();
        }
        return result;
      };
    }
  });
  await measure(p, 'camera OFF, game at camp');
  assert.equal(await p.evaluate(() => window.qaTracks.length), 0);
  assert.equal(p.motionRequests.length, 0);
  pass('camera OFF requests no model/WASM/camera');
  await start(p);
  pass('synthetic hands calibrate and arms in real game UI');
  await measure(p, 'synthetic 21-point hands ACTIVE (mock inference, software timing only)', 2000);
  const first = { x: actor('motion').x, z: actor('motion').z };
  await gesture(p, { move: { x: 0, y: 0, push: 0.55 } }, 900);
  assert.ok(Math.hypot(actor('motion').x - first.x, actor('motion').z - first.z) > 0.15);
  const seen = await q.evaluate(() => window.qaState.players.find((p) => p.name === 'motion'));
  assert.ok(Math.hypot(seen.x - first.x, seen.z - first.z) > 0.1);
  pass(
    'camera forward input goes through server collision and is received by second Chrome client',
  );
  await gesture(p, {}, 350);
  const stationary = { x: actor('motion').x, z: actor('motion').z, facing: actor('motion').facing };
  const cameraBefore = Number(await p.locator('#world').getAttribute('data-camera-yaw'));
  for (const x of [0.12, 0.24, 0.36, 0.48]) await gesture(p, { act: { x } }, 150);
  assert.ok(Math.abs(actor('motion').facing - stationary.facing) < 0.01);
  const cameraAfter = Number(await p.locator('#world').getAttribute('data-camera-yaw'));
  assert.ok(Math.abs(cameraAfter - cameraBefore) > 0.2);
  assert.ok(Math.hypot(actor('motion').x - stationary.x, actor('motion').z - stationary.z) < 0.02);
  pass(
    'open right-hand stroke turns only the camera; authoritative facing and position stay fixed',
  );
  await gesture(p, {}, 250);
  const seq = actor('motion').attackSequence;
  await gesture(p, { move: { x: 0, y: 0, push: 0.55 }, act: { gun: true } }, 450);
  assert.equal(actor('motion').attackSequence, seq + 1);
  await sleep(1200);
  assert.equal(actor('motion').attackSequence, seq + 1);
  pass('move + attack is consumed once and held action cannot repeat');
  await gesture(p, {}, 300);
  const jumpBefore = actor('motion').jumpSequence || 0;
  await gesture(p, { move: { x: 0, y: -0.32 } }, 400);
  assert.equal(actor('motion').jumpSequence, jumpBefore + 1);
  pass('jump gesture invokes existing server jump');
  await gesture(p, {}, 1100);
  const beforeAction = await p.evaluate(
    () => window.qaSent.filter((x) => x.value.type === 'action').length,
  );
  await wave(p);
  const sent = await p.evaluate(
    (n) => window.qaSent.filter((x) => x.value.type === 'action').slice(n),
    beforeAction,
  );
  assert.ok(sent.every((x) => x.value.action !== 'attack'));
  pass('interact never falls back to attack');
  await gesture(p, {}, 250);
  await gesture(p, { move: { x: 0, y: 0, push: 0.55 } }, 300);
  const lossAt = Date.now();
  await gesture(p, { noPose: true }, 100);
  await state(p, 'RECOVERING');
  assert.equal(actor('motion').dx, 0);
  assert.equal(actor('motion').dz, 0);
  measurements.push({
    label: 'explicit synthetic hand loss to server stop upper bound ms',
    value: Date.now() - lossAt,
  });
  await p.screenshot({ path: path.join(out, '01-safe-stop.png') });
  await gesture(p, { move: { x: 0, y: 0, push: 0.55 } }, 400);
  assert.ok(Math.hypot(actor('motion').dx, actor('motion').dz) > 0.5);
  await gesture(p, {}, 400);
  await state(p, 'ACTIVE');
  assert.equal(await p.locator('#motion-resume').count(), 0);
  pass(
    'hand loss stops server motion and fresh visible hands resume without a neutral pose or button',
  );
  await gesture(p, { move: { x: 0, y: 0, push: 0.55 } }, 250);
  await gesture(p, { stall: true }, 350);
  await state(p, 'RECOVERING');
  assert.equal(actor('motion').dx, 0);
  assert.equal(actor('motion').dz, 0);
  await state(p, 'RECOVERING');
  assert.equal(actor('motion').dx, 0);
  assert.equal(actor('motion').dz, 0);
  assert.ok(await p.evaluate(() => window.qaMaxInFlight <= 1));
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('stalled Worker expires input, never queues more than one bitmap, terminates on stop');
  await gesture(p, {}, 0);
  await start(p);
  await p.keyboard.press('Escape');
  await state(p, 'PAUSED');
  await p.keyboard.press('Escape');
  await sleep(100); // Exhibition may close by native Escape.
  if (await p.locator('#modal').evaluate((d) => d.open))
    await p.locator('#modal').evaluate((d) => d.close());
  await state(p, 'ACTIVE');
  await p.evaluate(() => window.qaSocket.close());
  await state(p, 'PAUSED');
  await p.waitForFunction(() => window.qaSocket.readyState === WebSocket.OPEN);
  await state(p, 'ACTIVE');
  pass(
    'actual WebSocket disconnect pauses camera input and reconnect returns with fresh hands automatically',
  );
  // Headless pages can all report focus; exercise the browser lifecycle handlers explicitly.
  await p.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    window.dispatchEvent(new Event('blur'));
  });
  await state(p, 'PAUSED');
  await p.evaluate(() => delete document.hasFocus);
  await state(p, 'ACTIVE');
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await state(p, 'PAUSED');
  await p.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await state(p, 'ACTIVE');
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass(
    'menu, focus and visibility pauses stop immediately, then continue automatically with fresh hands',
  );
  for (const [mode, text] of [
    ['denied', '許可'],
    ['missing', '見つかりません'],
    ['busy', '使用中'],
  ]) {
    await p.evaluate((mode) => (window.qaMediaMode = mode), mode);
    await start(p, false);
    await state(p, 'ERROR');
    assert.match(await p.locator('#motion-status').innerText(), new RegExp(text));
    await stopped(p);
  }
  pass('permission denial, absent camera and occupied camera have distinct recoverable errors');
  await p.evaluate(() => (window.qaMediaMode = 'late'));
  await start(p, false);
  await p.waitForFunction(() => typeof window.qaAllow === 'function');
  await p.locator('#motion-quick-stop').click();
  await p.evaluate(() => window.qaAllow());
  await stopped(p);
  pass('cancel during permission request stops a subsequently granted stream');
  await p.evaluate(() => {
    window.qaAllow = undefined;
    window.qaMediaMode = 'late';
  });
  await start(p, false);
  await p.waitForFunction(() => typeof window.qaAllow === 'function');
  await p.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    window.dispatchEvent(new Event('blur'));
    window.qaAllow();
  });
  await sleep(1800);
  assert.equal(await p.locator('#motion-controls').getAttribute('data-state'), 'PAUSED');
  await p.evaluate(() => delete document.hasFocus);
  await state(p, 'ACTIVE');
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('late camera/model initialization cannot undo a lifecycle pause');
  await p.evaluate(() => (window.qaMediaMode = 'normal'));
  for (let i = 0; i < 3; i++) {
    await gesture(p, {}, 0);
    await start(p);
    await p.locator('#motion-quick-stop').click();
    await stopped(p);
  }
  pass('three repeated start/stop sessions release tracks and Workers');
  await p.evaluate(() => {
    window.qaOriginalBitmap = window.createImageBitmap;
    window.qaBitmapRelease = undefined;
    window.createImageBitmap = async (...args) => {
      const bitmap = await window.qaOriginalBitmap(...args);
      window.qaLateBitmap = bitmap;
      await new Promise((resolve) => (window.qaBitmapRelease = resolve));
      return bitmap;
    };
  });
  await start(p, false);
  await p.waitForFunction(() => typeof window.qaBitmapRelease === 'function');
  await p.locator('#motion-quick-stop').click();
  await p.evaluate(() => window.qaBitmapRelease());
  await stopped(p);
  await p.waitForFunction(() => window.qaLateBitmap.width === 0);
  await p.evaluate(() => (window.createImageBitmap = window.qaOriginalBitmap));
  pass('cancel during bitmap creation closes the late bitmap before transfer');
  await p.evaluate(
    () => (document.querySelector('#motion-video').requestVideoFrameCallback = undefined),
  );
  await start(p);
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  await p.evaluate(() => delete document.querySelector('#motion-video').requestVideoFrameCallback);
  pass('new-video-frame RAF fallback calibrates and releases resources');
  await start(p);
  await p.locator('#motion-video').evaluate((v) => v.pause());
  await state(p, 'RECOVERING');
  assert.equal(actor('motion').dx, 0);
  assert.equal(actor('motion').dz, 0);
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('video with no new decoded frames expires rather than holding movement');
  await start(p);
  await p.evaluate(() => window.qaTracks.at(-1).dispatchEvent(new Event('ended')));
  await state(p, 'ERROR');
  await stopped(p);
  pass('camera track ending releases stream/Worker and leaves normal controls available');
  // Real MediaPipe module/WASM + real browser fake-camera frame. No human detection claim.
  await p.unroute('**/src/motion-worker.js');
  await p.locator('#motion-settings').evaluate((el) => {
    el.open = true;
    el.querySelector('details').open = true;
  });
  await p.locator('#motion-delegate').selectOption('preview');
  await start(p, false);
  await state(p, 'PAUSED');
  await measure(p, 'fake camera preview only');
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  for (const [delegate, hz] of [
    ['CPU', '10'],
    ['CPU', '15'],
    ['CPU', '20'],
    ['GPU', '10'],
  ]) {
    await p.locator('#motion-delegate').selectOption(delegate);
    await p.locator('#motion-hz').selectOption(hz);
    await start(p, false);
    await p.waitForFunction(
      () =>
        ['CALIBRATING', 'ERROR'].includes(document.querySelector('#motion-controls').dataset.state),
      null,
      { timeout: 40000 },
    );
    const current = await p.locator('#motion-controls').getAttribute('data-state');
    if (current === 'ERROR' && delegate === 'CPU')
      throw new Error(
        `${delegate} initialization: ${await p.locator('#motion-status').innerText()}`,
      );
    await measure(
      p,
      `real Lite ${delegate} Worker ${hz} Hz with synthetic browser camera (no person)`,
      5000,
    );
    const latest = measurements.at(-1);
    if (delegate === 'GPU' && (latest.state === 'ERROR' || !latest.metrics.frames)) {
      latest.limitation =
        'GPU Worker could not produce a usable result in this headless environment; do not use its frame times as successful inference performance.';
      latest.error = await p.locator('#motion-status').innerText();
      await stopped(p);
    } else {
      assert.ok(latest.metrics.frames > 0);
      assert.equal(latest.metrics.validRate, 0);
      if (
        delegate === 'GPU' &&
        (latest.metrics.distributions.inferenceMs?.p95 > 230 ||
          latest.metrics.distributions.renderFrameMs?.p95 > 50)
      )
        latest.limitation =
          'GPU produced results but had severe stalls; this run is not evidence of usable interactive inference.';
      await p.locator('#motion-quick-stop').click();
      await stopped(p);
    }
  }
  pass(
    'real local model + module WASM executes CPU in production CSP at 10/15/20 Hz; GPU result or failure recorded',
  );
  await p.locator('#motion-delegate').selectOption('CPU');
  await start(p, false);
  await state(p, 'CALIBRATING');
  await p.waitForFunction(
    async () => (await import('/src/main.js')).motionDiagnostics().metrics.frames > 1,
  );
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('CPU inference remains usable after GPU comparison and cleanup');
  // Network interception also covers Worker fetch. A missing asset must not fall back to CDN.
  await p.route('**/motion/*.task', (route) =>
    route.fulfill({ status: 404, body: 'Missing QA model' }),
  );
  await p.locator('#motion-delegate').selectOption('CPU');
  await start(p, false);
  await state(p, 'ERROR');
  assert.match(await p.locator('#motion-status').innerText(), /モデル/);
  await stopped(p);
  await p.unroute('**/motion/*.task');
  await p.route('**/src/motion-worker.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'throw new Error("QA initialization failure")',
    }),
  );
  await start(p, false);
  await state(p, 'ERROR');
  await stopped(p);
  await p.unroute('**/src/motion-worker.js');
  pass('model 404 and Worker startup failure release resources without external fallback');
  // Normal input is still usable after all error and ownership transitions.
  await p.locator('#world').focus();
  const normal = { x: actor('motion').x, z: actor('motion').z };
  await p.keyboard.down('w');
  await sleep(450);
  await p.keyboard.up('w');
  await sleep(150);
  assert.ok(Math.hypot(actor('motion').x - normal.x, actor('motion').z - normal.z) > 0.05);
  pass('keyboard movement restored after camera errors/shutdown');
  // Prepare only this unsaved QA room, then use ordinary client targeting and server actions.
  await p.route('**/src/motion-worker.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeWorker }),
  );
  await p.locator('#motion-hz').selectOption('15');
  await gesture(p, {}, 0);
  const me = actor('motion');
  Object.assign(me, { x: 56, z: 65, dx: 0, dz: 0, target: null, path: [] });
  await p.waitForFunction(() =>
    document.querySelector('#interaction-hint').textContent.includes('木材'),
  );
  const wood = me.inventory.wood;
  await start(p);
  await wave(p);
  assert.equal(me.inventory.wood, wood + 1);
  assert.ok(
    await p.evaluate(() =>
      window.qaSent.some((e) => e.value.action === 'gather' && e.value.targetId === 'wood-1'),
    ),
  );
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('interact uses the existing visible nearby resource and server gather checks');
  await gesture(p, {}, 0);
  Object.assign(me, { x: 40, z: 56.8, dx: 0, dz: 0, target: null, path: [] });
  Object.assign(room().rimoNeko, {
    x: 40,
    z: 55,
    home: { x: 40, z: 55 },
    mode: 'idle',
    facing: 0,
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    path: [],
    velocityX: 0,
    velocityZ: 0,
  });
  await p.locator('#pet-rimo-button').waitFor({ state: 'visible' });
  assert.equal(await p.locator('#interaction-hint').isVisible(), false);
  const petSequence = room().rimoNeko.petSequence;
  await start(p);
  await wave(p);
  assert.equal(room().rimoNeko.petSequence, petSequence + 1);
  assert.equal(room().rimoNeko.petPlayerId, me.id);
  await p.locator('#motion-quick-stop').click();
  await stopped(p);
  pass('interact reuses preferred companion selection and begins existing Rimo petting');
  await p.unroute('**/src/motion-worker.js');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: path.join(out, '02-mobile.png') });
  assert.ok(
    await p.locator('#motion-controls').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    }),
  );
  await p.setViewportSize({ width: 844, height: 390 });
  await p.screenshot({ path: path.join(out, '03-landscape.png') });
  assert.ok(await p.locator('#motion-quick-stop').isHidden());
  pass('portrait/landscape staff panel fits viewport and scrolls');
  const messages = await p.evaluate(() => window.qaSent.map((e) => e.value));
  assert.ok(
    messages.every(
      (m) => !('pose' in m) && !('landmarks' in m) && !('image' in m) && !('bitmap' in m),
    ),
  );
  assert.equal(externalRequests.length, 0);
  pass(
    'only existing gameplay messages plus optional facing; no images/landmarks/external network',
  );
  assert.deepEqual(
    errors.filter((e) => !e.includes('QA initialization failure')),
    [],
  );
} catch (error) {
  for (let i = 0; i < pages.length; i++) {
    const details = await pages[i]
      .evaluate(async () => ({
        diag: (await import('/src/main.js')).motionDiagnostics(),
        sent: window.qaSent.slice(-35),
        trace: window.qaMotionTrace,
        inFlight: window.qaFramesInFlight,
        maxInFlight: window.qaMaxInFlight,
        video: {
          time: document.querySelector('#motion-video').currentTime,
          paused: document.querySelector('#motion-video').paused,
          ready: document.querySelector('#motion-video').readyState,
        },
        track: window.qaTracks.map((t) => ({ state: t.readyState, muted: t.muted })),
        me: window.qaState?.players.find((p) => p.id === window.qaSelf),
      }))
      .catch((e) => ({ error: String(e) }));
    await writeFile(path.join(out, `failure-${i}.json`), JSON.stringify(details, null, 2));
    await pages[i].screenshot({ path: path.join(out, `failure-${i}.png`) }).catch(() => {});
    await writeFile(
      path.join(out, `failure-${i}.txt`),
      await pages[i]
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
  }
  throw error;
} finally {
  await writeFile(
    path.join(out, 'results.json'),
    JSON.stringify(
      {
        checks,
        measurements,
        errors: errors.filter((e) => !e.includes('QA initialization failure')),
        expectedErrors: errors.filter((e) => e.includes('QA initialization failure')),
        externalRequests,
        environment: {
          browser: browser.version(),
          node: process.version,
          os: os.version(),
          cpu: os.cpus()[0]?.model,
          graphics,
          viewport: '1440x900',
          warmup: 'same camp camera views before all baseline comparisons',
        },
        conditions:
          'Chrome headless, synthetic browser media + synthetic landmarks, isolated unsaved exhibition world. Real camera/people/controllers not tested.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await Promise.all(clients.map((c) => c.close()));
  await game.close();
  console.log('Evidence:', out);
}
