// Real Chrome; fixture positions exist only in a memory-only LOCAL_VERIFY room.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { riverX } from '../dist/shared/terrain.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/nature-immersion-20261006/final-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const errors = [],
  checks = [],
  snapshots = [];
let failure, page, id, room, p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const seen = { id: null, state: null };
  tab.on('pageerror', (e) => errors.push(String(e)));
  tab.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  tab.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    }),
  );
  await tab.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'standard');
  }, name);
  await tab.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst natureRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){const r=natureRender.apply(this,a);window.qa=this;return r;};',
    });
  });
  await tab.goto(base);
  return { tab, seen, context };
}
async function join(tab) {
  await tab.locator('#title-start').click();
  await tab.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await tab.locator('[data-choose-difficulty="normal"]').click();
  await tab.locator('#setup-flow-yes').click();
  await tab
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await tab.waitForFunction(
    () => window.qa?.audio.stats.loaded === 12 && qa.audio.context?.state === 'running',
    null,
    { timeout: 90000 },
  );
}
async function snapshot(name) {
  const info = await page.evaluate(() => ({
    audio: { ...qa.audio.stats },
    errors: qa.audio.errors,
    effects: { ...qa.natureEffects.stats },
    context: qa.audio.context.state,
    settings: qa.audio.settings,
    position: qa.players.get(qa.selfId).model.position.toArray(),
    frame: {
      fps: qa.canvas.dataset.fps,
      simulationMs: qa.simulationMs,
      drawCalls: qa.renderer.info.render.calls,
    },
  }));
  snapshots.push({ name, ...info });
  console.log('STATE', name, JSON.stringify(info));
  return info;
}
async function place(point) {
  stopActor(p);
  Object.assign(p, point, { warpSequence: (p.warpSequence ?? 0) + 1 });
  await page.waitForFunction(
    (warp) => qa.players.get(qa.selfId)?.state.warpSequence === warp,
    p.warpSequence,
  );
  await sleep(700);
}
async function move(key, ms) {
  await page.locator('#world').focus();
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(350);
}
async function settings() {
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
}
try {
  const main = await open('NatureReview');
  page = main.tab;
  assert.equal(await page.evaluate(() => window.qa?.audio.context ?? null), null);
  await join(page);
  id = main.seen.id;
  room = game.rooms.get('LOCAL_VERIFY');
  p = room.players.get(id);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  await page.evaluate(() => {
    const audio = qa.audio,
      ctx = audio.context;
    window.meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    audio.master.connect(meter);
    window.recordingDestination = ctx.createMediaStreamDestination();
    audio.master.connect(recordingDestination);
    window.recorded = [];
    window.recorder = new MediaRecorder(recordingDestination.stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) recorded.push(e.data);
    };
    recorder.start();
  });
  let s = await snapshot('camp');
  assert.equal(s.audio.loaded, 12);
  assert.equal(s.audio.place, 'camp');
  assert.ok(s.effects.smoke > 0);
  assert.deepEqual(s.errors, []);
  await page.screenshot({ path: `${out}/camp.png` });
  pass('user gesture unlocks twelve locally served samples; camp smoke and environment');
  await place({ x: 43, z: 43 });
  const start = await snapshot('walk-before');
  await move('w', 2400);
  s = await snapshot('walk-after');
  assert.ok(s.audio.steps > start.audio.steps, 'actual W movement must produce footsteps');
  const stopped = s.audio.steps;
  await sleep(1300);
  assert.equal((await snapshot('standstill')).audio.steps, stopped);
  pass('real W movement produces footsteps, standing still does not');
  await page.keyboard.press('Space');
  await sleep(350);
  assert.ok((await snapshot('jump')).audio.events > s.audio.events);
  await sleep(700);
  await place({ x: riverX(34), z: 34 });
  s = await snapshot('river');
  assert.ok(s.audio.river > 0.8);
  assert.equal(s.audio.surface, 'water');
  await move('w', 1300);
  s = await snapshot('river-walking');
  await page.screenshot({ path: `${out}/river.png` });
  assert.ok(s.effects.ripples > 0);
  await settings();
  await page.locator('[data-setting="sound"]').click();
  await page.locator('#modal-close').click();
  await move('s', 850);
  const mutedWater = await snapshot('muted-water');
  assert.ok(mutedWater.effects.ripples > 0);
  assert.equal(mutedWater.audio.steps, s.audio.steps);
  await settings();
  await page.locator('[data-setting="sound"]').click();
  await page.locator('#modal-close').click();
  pass('river audio follows actual channel and water changes footstep material');
  await place(caveWorldAt(-18));
  room.camp.caveFireLit = false;
  await sleep(600);
  s = await snapshot('cave-torch');
  assert.equal(s.audio.cave, 1);
  assert.equal(s.audio.river, 0);
  assert.equal(s.audio.surface, 'stone');
  assert.ok(s.effects.dust > 0);
  await page.screenshot({ path: `${out}/cave.png` });
  await page.locator('#world').focus();
  await page.keyboard.press('l');
  await sleep(450);
  assert.equal((await snapshot('cave-unlit')).effects.dust, 0);
  await page.keyboard.press('l');
  await sleep(450);
  await settings();
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const inputs = page.locator('[data-audio-volume]');
    assert.equal(await inputs.count(), 3);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.locator('#audio-music').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/settings-${width}x${height}.png` });
  }
  const music = page.locator('#audio-music');
  await music.fill('0');
  assert.equal(await page.evaluate(() => qa.audio.settings.music), 0);
  await music.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => qa.audio.settings.music), 0.05);
  await music.fill('0');
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  const silent = await snapshot('muted');
  assert.equal(silent.settings.enabled, false);
  assert.equal(silent.audio.voices, 0);
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'running');
  await music.fill('30');
  await page.locator('#modal-close').click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => qa.graphics.setMode('low', performance.now()));
  await sleep(350);
  assert.equal((await snapshot('low-cave')).effects.dust, 16);
  await page.evaluate(() => qa.graphics.setMode('standard', performance.now()));
  pass('cave attenuation and dust; three sliders, mute/resume, portrait and landscape settings');
  // Hidden-document signal without pretending a physical OS background switch.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => qa.audio.context.state === 'running');
  const loops = await page.evaluate(() => qa.audio.stats.loops);
  assert.ok(loops <= 6);
  pass('visibility lifecycle signal suspends and resumes without new loops');
  await place({ x: 43, z: 43 });
  await sleep(5500);
  const signal = await page.evaluate(() => {
    const data = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data);
    return {
      rms: Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length),
      peak: Math.max(...data.map(Math.abs)),
    };
  });
  assert.ok(signal.rms > 0.00001 && signal.peak < 1);
  snapshots.push({ name: 'real-audio-signal', ...signal });
  const recording = await page.evaluate(async () => {
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
    const blob = new Blob(recorded, { type: 'audio/webm' }),
      bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });
  await writeFile(`${out}/game-audio.webm`, Buffer.from(recording, 'base64'));
  pass('captured actual Web Audio stream and measured nonzero unclipped output');
  const peer = await open('NaturePeer');
  await join(peer.tab);
  assert.equal(room.players.size, 2);
  await page.bringToFront();
  await page.locator('#world').focus();
  await move('d', 800);
  await peer.tab.waitForFunction((id) => qa.state.players.some((p) => p.id === id), id);
  assert.ok(await peer.tab.evaluate(() => qa.audio.stats.peakVoices <= 14));
  await peer.context.close();
  pass('two real Chrome clients receive the shared room with independent audio');
  await page.bringToFront();
  const beforeReconnect = await snapshot('before-reconnect');
  for (const socket of game.wss.clients) socket.close(1012, 'QA reconnect');
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  await page.waitForFunction(
    () => qa.audio.context.state === 'running' && qa.audio.stats.loops === 6,
    null,
    { timeout: 20000 },
  );
  await sleep(400);
  assert.equal((await snapshot('reconnected')).audio.events, beforeReconnect.audio.events);
  pass('real websocket reconnect suspends and resumes existing audio without replayed actions');
  await settings();
  await page.locator('#audio-effects').fill('55');
  await page.reload();
  await join(page);
  assert.equal(await page.evaluate(() => qa.audio.settings.effects), 0.55);
  pass('page reload and actual re-entry preserve independent volume settings');
  const manifest = JSON.parse(await readFile('public/audio/nature/manifest.json'));
  for (const item of manifest.files) {
    const response = await fetch(`${base}${item.url}`);
    assert.match(response.headers.get('content-type'), /audio\/wav/);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
      item.sha256,
    );
  }
  pass('all twelve HTTP audio responses match manifest hashes and MIME');
  s = await snapshot('final');
  assert.ok(s.audio.peakVoices <= 14);
  assert.ok(s.audio.loops <= 6);
  assert.deepEqual(s.errors, []);
  await page.evaluate(() => qa.audio.dispose());
  await page.waitForFunction(() => qa.audio.context.state === 'closed');
  assert.deepEqual(errors, []);
  pass('audio disposal closes context; no page/console/audio errors');
} catch (e) {
  failure = String(e.stack || e);
  console.error(failure);
  if (page) {
    await snapshot('failure').catch(() => {});
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify({ base, checks, snapshots, errors, failure }, null, 2),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
