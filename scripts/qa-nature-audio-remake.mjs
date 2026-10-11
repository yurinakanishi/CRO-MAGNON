// Isolated memory-only game in real Chrome: calibrated levels, on-demand loading, streamed
// music, measured cave reverb, real input foley. Mixes are recorded from the master bus and
// measured with FFmpeg (EBU R128) so relative loudness is checked on the actual output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { riverX } from '../dist/shared/terrain.mjs';
import { MOUNTAIN_WATERFALL } from '../dist/shared/mountain-river.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/nature-audio-remake-20261011/game-r01';
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile('public/audio/nature/manifest.json', 'utf8'));
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen(),
  base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  requests = [],
  checks = [],
  levels = {};
let id, failure;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (s) => {
  checks.push(s);
  console.log('PASS', s);
};
function measure(file) {
  const { stderr: text } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const momentary = [...text.matchAll(/M:\s*(-?[\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((v) => v > -120);
  return {
    integrated: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)[1]),
    momentaryMax: Math.max(...momentary),
    truePeak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1] ?? NaN),
  };
}
async function recordMix(name, milliseconds) {
  const base64 = await page.evaluate(async (milliseconds) => {
    const audio = qa.audio;
    const tap = audio.context.createMediaStreamDestination();
    audio.master.connect(tap);
    const recorder = new MediaRecorder(tap.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 256000,
    });
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
  const file = `${out}/${name}.webm`;
  await writeFile(file, Buffer.from(base64, 'base64'));
  levels[name] = { ...measure(file), dba: await page.evaluate(() => ({ ...qa.audio.stats.dba })) };
  console.log(name, JSON.stringify(levels[name]));
  return levels[name];
}
const sliders = (values) =>
  page.evaluate((values) => qa.audio.setSettings({ ...qa.audio.settings, ...values }), values);
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
  // A volume saved for the old uncalibrated mix: only "enabled" may carry over.
  localStorage.setItem(
    'cro-nature-audio-v1',
    JSON.stringify({ enabled: true, ambience: 0.7, music: 0.3, effects: 0.5 }),
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
      `\nconst soundPlay=NatureAudio.prototype.play;NatureAudio.prototype.play=function(name,gain,bus,...rest){(window.soundTrace??=[]).push({name,bus,gain});return soundPlay.call(this,name,gain,bus,...rest);};`,
  });
});
try {
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('[data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(
    () => window.qa?.audio.ready && qa.audio.context.state === 'running',
    null,
    {
      timeout: 90000,
    },
  );
  const room = game.rooms.get('LOCAL_VERIFY'),
    p = room.players.get(id);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  assert.deepEqual(await page.evaluate(() => qa.audio.settings), {
    enabled: true,
    ambience: 1,
    music: 1,
    effects: 1,
  });
  const core = await page.evaluate(() => qa.audio.stats.loaded);
  assert.ok(core >= 64 && core < manifest.files.length - 3, `core ${core}`);
  pass(`ready after ${core} core files; old uncalibrated volumes were not carried over`);

  await page.waitForFunction(() => qa.audio.stats.musicPhrases > 0, null, { timeout: 20000 });
  await sleep(3000);
  const deck = await page.evaluate(() =>
    qa.audio.music.decks.map((d) => ({
      src: d.audio.getAttribute('src'),
      paused: d.audio.paused,
      t: d.audio.currentTime,
    })),
  );
  assert.ok(
    deck.some((d) => !d.paused && d.t > 1 && /bgm-(camp|explore)/.test(d.src)),
    JSON.stringify(deck),
  );
  assert.equal(
    await page.evaluate(() => [...qa.audio.buffers.keys()].some((n) => n.startsWith('bgm-'))),
    false,
  );
  pass('place music streams through a media element and is never decoded into memory');

  // Camp: real stand-still mixes, category by category.
  stopActor(p);
  Object.assign(p, { x: 50, z: 46, warpSequence: (p.warpSequence ?? 0) + 1 });
  await sleep(2500);
  await sliders({ music: 0, effects: 0 });
  await sleep(1200);
  const campAmbience = await recordMix('camp-ambience', 10000);
  assert.ok(campAmbience.dba.wind > 33 && campAmbience.dba.wind < 45);
  assert.ok((campAmbience.dba.river ?? 0) < 41, 'slow river is faint from the camp');
  await sliders({ ambience: 0, music: 0, effects: 1 });
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  const steps = await recordMix('camp-steps-only', 5000);
  await page.keyboard.up('w');
  assert.ok(await page.evaluate(() => qa.audio.stats.steps > 3));
  // Soft steps on grass: a few dB around the breeze, never dominating it.
  const stepVsBed = steps.momentaryMax - campAmbience.integrated;
  assert.ok(stepVsBed > -4 && stepVsBed < 9, `steps vs camp ambience ${stepVsBed.toFixed(1)} dB`);
  await sliders({ ambience: 1, music: 1, effects: 1 });
  await sleep(1500);
  await recordMix('camp-full-mix', 12000);
  pass(
    `camp: river faint (${campAmbience.dba.river ?? 'silent'} dBA), steps ${stepVsBed.toFixed(1)} dB re. ambience`,
  );

  // River bank: the water now leads the mix, as in the field.
  stopActor(p);
  Object.assign(p, { x: riverX(40) + 4.2, z: 40, warpSequence: p.warpSequence + 1 });
  await sleep(2500);
  await sliders({ music: 0, effects: 0 });
  await sleep(1500);
  const bank = await recordMix('river-bank-ambience', 10000);
  assert.ok(bank.dba.river > campAmbience.dba.wind + 3, JSON.stringify(bank.dba));
  assert.ok(bank.integrated > campAmbience.integrated + 2, 'bank louder than camp');
  assert.ok(
    await page.evaluate(() => {
      const l = qa.audio.loops.get('river');
      return l.filter.frequency.value > 15000 && Math.abs(l.stereo.pan.value) > 0.05;
    }),
  );
  pass(
    `river bank ${bank.integrated.toFixed(1)} LUFS vs camp ${campAmbience.integrated.toFixed(1)} LUFS; full-band, panned`,
  );

  // Mountain waterfall: loaded on demand, audible from afar, point-positioned.
  stopActor(p);
  const foot = MOUNTAIN_WATERFALL.pool;
  Object.assign(p, { x: foot.x + 22, z: foot.z - 6, warpSequence: p.warpSequence + 1 });
  await page.waitForFunction(
    () => qa.audio.buffers.has('waterfall') && qa.audio.stats.dba.waterfall > 50,
    null,
    {
      timeout: 20000,
    },
  );
  await sleep(2000);
  const fall = await recordMix('waterfall-ambience', 8000);
  assert.ok(fall.integrated > bank.integrated, 'waterfall louder than the slow river bank');
  assert.ok(fall.truePeak < 0.5);
  pass(
    `waterfall ${fall.dba.waterfall} dBA at ~22 m, ${fall.integrated.toFixed(1)} LUFS, no clipping`,
  );

  // Cave: outdoor beds silent, measured reverb loaded, drops, music crossfade.
  await sliders({ music: 1, effects: 1 });
  await page.waitForFunction(() => qa.audio.music.decks.some((d) => !d.audio.paused), null, {
    timeout: 20000,
  });
  const outdoorDeck = await page.evaluate(() =>
    qa.audio.music.decks.findIndex((d) => !d.audio.paused),
  );
  stopActor(p);
  Object.assign(p, caveWorldAt(-18), { warpSequence: p.warpSequence + 1 });
  await page.waitForFunction(() => qa.audio.stats.place === 'cave', null, { timeout: 15000 });
  room.camp.caveFireLit = false;
  await page.waitForFunction(() => qa.audio.reverb.buffer !== null, null, { timeout: 15000 });
  await page.locator('#world').focus();
  await page.keyboard.press('l');
  await sleep(450);
  await page.keyboard.press('l');
  await page.waitForFunction(() => soundTrace.some((s) => s.name.startsWith('drop-')), null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      qa.audio.music.decks.some(
        (d) => !d.audio.paused && /bgm-cave/.test(d.audio.getAttribute('src')),
      ),
    null,
    { timeout: 25000 },
  );
  // The cave piece starts on the other deck while the outdoor piece fades out.
  const caveDeck = await page.evaluate(() =>
    qa.audio.music.decks.findIndex((d) => /bgm-cave/.test(d.audio.getAttribute('src'))),
  );
  assert.notEqual(caveDeck, outdoorDeck);
  await sleep(5000);
  assert.ok(
    await page.evaluate(() =>
      ['wind', 'river', 'stream', 'waterfall', 'shore', 'rain'].every(
        (name) => !qa.audio.loops.get(name) || qa.audio.loops.get(name).gain.gain.value < 0.001,
      ),
    ),
  );
  assert.equal(
    await page.evaluate(() => qa.audio.music.decks.filter((d) => !d.audio.paused).length),
    1,
  );
  await recordMix('cave-mix', 10000);
  assert.equal(
    await page.evaluate(() => soundTrace.filter((s) => s.name === 'fx-torch-switch').length),
    2,
  );
  pass(
    'cave: outdoor beds silent, measured cathedral reverb, drips, single cave music deck, torch flare x2',
  );

  // Settings UI: three sliders at 100 %, effects-only mute, global mute/resume, portrait layout.
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  assert.equal(await page.locator('[data-audio-volume]').count(), 3);
  assert.equal(await page.locator('#audio-effects').inputValue(), '100');
  await page.locator('#audio-effects').fill('0');
  await sleep(800);
  assert.equal(await page.evaluate(() => qa.audio.effect('hurt')), undefined);
  await page.locator('#audio-effects').fill('100');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#audio-music').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/settings.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  assert.equal(await page.evaluate(() => qa.audio.music.decks.every((d) => d.audio.paused)), true);
  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(() => qa.audio.context.state === 'running');
  await page.locator('#modal-close').click();
  await page.setViewportSize({ width: 1280, height: 800 });
  pass('sliders default 100 %, effects-only mute, global mute pauses music decks, portrait fits');

  for (let i = 0; i < 5; i++) {
    p.warpSequence++;
    await sleep(220);
  }
  await sleep(1600);
  assert.equal(await page.evaluate(() => qa.audio.voices.size), 0);
  pass('rapid warps release faded voices');

  // Every shipped one-shot reaches a real AudioBufferSource.
  const names = manifest.files.filter((f) => f.kind === 'oneshot').map((f) => f.name);
  for (const name of names) {
    const started = await page.evaluate(async (name) => {
      for (let i = 0; i < 60 && !qa.audio.buffers.has(name); i++) {
        qa.audio.need(name);
        await new Promise((r) => setTimeout(r, 100));
      }
      // Respect the six-voice effects budget instead of measuring it.
      for (
        let i = 0;
        i < 60 && [...qa.audio.voices].filter((v) => v.bus === 'effects').length >= 5;
        i++
      )
        await new Promise((r) => setTimeout(r, 100));
      return qa.audio.play(name, 0.2, name.startsWith('fx-') ? 'effects' : 'ambience');
    }, name);
    assert.equal(started, true, name);
    await sleep(120);
  }
  await sleep(2500);
  const fetched = requests.length;
  await page.evaluate(() => qa.audio.setActive(false));
  await page.waitForFunction(() => qa.audio.context.state === 'suspended');
  assert.equal(await page.evaluate(() => qa.audio.voices.size), 0);
  await page.evaluate(() => qa.audio.setActive(true));
  await page.waitForFunction(() => qa.audio.context.state === 'running');
  await sleep(800);
  assert.equal(
    requests.filter((u) => !/bgm-/.test(u)).length,
    requests.slice(0, fetched).filter((u) => !/bgm-/.test(u)).length,
  );
  pass(`all ${names.length} one-shots play; leave/rejoin stops sound without re-downloading`);
  const decoded = await page.evaluate(() => qa.audio.stats.decodedBytes);
  assert.ok(decoded < 112 * 1024 * 1024);
  assert.deepEqual(await page.evaluate(() => qa.audio.errors), []);
  assert.deepEqual(errors, []);
  pass(`no audio/page/console errors; decoded ${(decoded / 1048576).toFixed(1)} MiB`);
} catch (e) {
  failure = String(e.stack || e);
  console.error(failure);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  const trace = await page.evaluate(() => window.soundTrace ?? []).catch(() => []);
  await writeFile(`${out}/sounds.json`, JSON.stringify(trace, null, 1));
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify({ checks, levels, requests: requests.length, errors, failure }, null, 2),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
