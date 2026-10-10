// Isolated memory-only game. Real input + instrumented sound requests distinguish actions from ambience.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/nature-audio-only-20261006/final-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen(),
  base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  requests = [],
  checks = [];
let id, failure;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (s) => {
  checks.push(s);
  console.log('PASS', s);
};
async function recordMix(name, milliseconds = 12000) {
  const base64 = await page.evaluate(async (milliseconds) => {
    const audio = qa.audio;
    const tap = audio.context.createMediaStreamDestination();
    audio.master.connect(tap);
    const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    recorder.stop();
    await stopped;
    audio.master.disconnect(tap);
    tap.stream.getTracks().forEach((track) => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }, milliseconds);
  await writeFile(`${out}/${name}.webm`, Buffer.from(base64, 'base64'));
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('request', (r) => {
  if (r.url().includes('/audio/')) requests.push(r.url());
});
page.on('websocket', (ws) =>
  ws.on('framereceived', ({ payload }) => {
    const m = JSON.parse(String(payload));
    if (m.type === 'welcome') id = m.id;
  }),
);
await page.addInitScript(() => {
  localStorage.setItem('cro-name', 'SoundReview');
  localStorage.setItem('cro-graphics-quality', 'low');
  localStorage.setItem(
    'cro-nature-audio-v1',
    JSON.stringify({ enabled: true, ambience: 0.7, music: 0.3, effects: 1 }),
  );
});
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      '\nconst soundRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){const r=soundRender.apply(this,a);window.qa=this;return r;};',
  });
});
await page.route('**/src/nature-audio.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      `\nconst soundPlay=NatureAudio.prototype.play;NatureAudio.prototype.play=function(name,volume,bus,...rest){(window.soundTrace??=[]).push({name,bus});return soundPlay.call(this,name,volume,bus,...rest);};`,
  });
});
try {
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(
    () => window.qa?.audio.stats.loaded === 14 && qa.audio.context.state === 'running',
    null,
    { timeout: 60000 },
  );
  const room = game.rooms.get('LOCAL_VERIFY'),
    p = room.players.get(id);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  await page.waitForFunction(
    () => qa.audio.stats.birds > 0 && qa.audio.stats.musicPhrases > 0,
    null,
    { timeout: 15000 },
  );
  assert.equal(
    await page.evaluate(() => Object.keys(qa.audio.settings).includes('effects')),
    false,
  );
  assert.ok(await page.evaluate(() => qa.natureEffects.stats.smoke > 0));
  pass(
    '14 recorded/mastered files, birds and camp BGM; previous effects setting cannot restore SE; smoke remains',
  );
  assert.ok(await page.evaluate(() => qa.audio.stats.decodedBytes < 128 * 1024 * 1024));
  assert.equal(await page.evaluate(() => qa.audio.buffers.get('wind').numberOfChannels), 2);
  assert.equal(await page.evaluate(() => qa.audio.buffers.get('river').numberOfChannels), 2);
  assert.ok(
    await page.evaluate(() =>
      [...qa.audio.loops.values()].every((l) => !l.panner || l.panner.rolloffFactor === 0),
    ),
  );
  await recordMix('camp-mix');
  pass(
    'stereo ambience, bounded decoded memory and single distance attenuation; camp mix recorded',
  );
  stopActor(p);
  Object.assign(p, { x: 43, z: 43, warpSequence: (p.warpSequence ?? 0) + 1 });
  await sleep(700);
  await page.locator('#world').focus();
  const before = { x: p.x, z: p.z, jump: p.jumpSequence };
  await page.keyboard.down('w');
  await sleep(1300);
  await page.keyboard.up('w');
  await sleep(300);
  assert.ok(Math.hypot(p.x - before.x, p.z - before.z) > 0.5);
  await page.keyboard.press('Space');
  await sleep(400);
  assert.ok(p.jumpSequence > before.jump);
  await page.keyboard.press('q');
  await sleep(400);
  assert.ok(await page.evaluate(() => qa.natureEffects.stats.footfalls > 0));
  pass('real movement and jump still work and visual footfalls remain');
  stopActor(p);
  Object.assign(p, caveWorldAt(-18), { warpSequence: p.warpSequence + 1 });
  await sleep(1500);
  await page.waitForFunction(() => qa.audio.stats.place === 'cave');
  room.camp.caveFireLit = false;
  await sleep(200);
  assert.ok(await page.evaluate(() => qa.natureEffects.stats.dust > 0));
  await page.keyboard.press('l');
  await sleep(450);
  assert.equal(await page.evaluate(() => qa.natureEffects.stats.dust), 0);
  await page.keyboard.press('l');
  await sleep(450);
  await page.waitForFunction(() => soundTrace.some((s) => s.name.startsWith('drop-')), null, {
    timeout: 15000,
  });
  await page.waitForFunction(() => [...qa.audio.voices].some((v) => v.name === 'bgm-cave'), null, {
    timeout: 15000,
  });
  await sleep(5000);
  assert.ok(
    await page.evaluate(() =>
      ['wind', 'river', 'shore', 'rain'].every(
        (name) => qa.audio.loops.get(name).gain.gain.value < 0.001,
      ),
    ),
  );
  assert.ok(
    await page.evaluate(() =>
      [...qa.audio.voices].filter((v) => v.bus === 'music').every((v) => v.name === 'bgm-cave'),
    ),
  );
  await recordMix('cave-mix');
  pass('outdoor beds fade to silence inside cave; previous BGM voices end; cave mix recorded');
  pass('cave BGM, water drops and torch lighting remain; torch action does not emit an SE');
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  assert.equal(await page.locator('[data-audio-volume]').count(), 2);
  assert.equal(await page.locator('#audio-effects').count(), 0);
  await page.locator('#audio-music').fill('45');
  assert.equal(await page.evaluate(() => qa.audio.settings.music), 0.45);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#audio-music').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/settings.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'running');
  await page.locator('#modal-close').click();
  pass('only ambience/birds and BGM sliders; mute/resume works in portrait');
  // Rapid room/warp baselines must release old 48-second music buffers promptly.
  for (let i = 0; i < 5; i++) {
    p.warpSequence++;
    await sleep(220);
  }
  await sleep(1600);
  assert.equal(await page.evaluate(() => qa.audio.voices.size), 0);
  pass('rapid warps release faded voices without building up silent music sources');
  const trace = await page.evaluate(() => soundTrace);
  assert.ok(trace.every((s) => s.bus === 'music' || s.bus === 'ambience'));
  assert.ok(
    trace.every((s) =>
      [
        'bgm-explore',
        'bgm-camp',
        'bgm-cave',
        'drop-0',
        'drop-1',
        'birds-0',
        'birds-1',
        'birds-2',
      ].includes(s.name),
    ),
  );
  assert.ok(requests.length === 14 && requests.every((url) => !/(sand|stone)/.test(url)));
  assert.equal(await page.evaluate(() => typeof qa.audio.confirm), 'undefined');
  assert.equal(await page.evaluate(() => typeof qa.audio.updateEvents), 'undefined');
  assert.deepEqual(await page.evaluate(() => qa.audio.errors), []);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/sounds.json`, JSON.stringify(trace, null, 2));
  pass('all sound requests are ambience/BGM; no footsteps, action handler or notice sound remains');
} catch (e) {
  failure = String(e.stack || e);
  console.error(failure);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify({ checks, requests, errors, failure }, null, 2),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
