// Browser decode, native playback and actual loop rendering. No game state.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const reviewOnly = process.argv.includes('--review-only');
const out =
  process.env.AUDIO_QA_OUT ||
  `output/playwright/nature-audio-quality-20261006/${reviewOnly ? 'review-r02' : 'assets-r01'}`;
await mkdir(out, { recursive: true });
const root = path.resolve('public/audio/nature');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')));
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + req.url);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
try {
  await page.goto('http://127.0.0.1:59431/');
  await page.screenshot({ path: `${out}/review-desktop.png`, fullPage: true });
  for (const item of reviewOnly ? [] : manifest.files) {
    const r = await page.evaluate(
      async ({ item, base }) => {
        const context = new OfflineAudioContext(2, 1, 44100);
        const b = await context.decodeAudioData(
          await (await fetch(base + '/' + item.name + '.mp3')).arrayBuffer(),
        );
        const stats = {
          name: item.name,
          channels: b.numberOfChannels,
          seconds: b.duration,
          peak: 0,
          mean: 0,
          seam: 0,
          diffRms: 0,
        };
        for (let c = 0; c < b.numberOfChannels; c++) {
          const d = b.getChannelData(c);
          let sum = 0,
            delta = 0;
          for (let i = 0; i < d.length; i++) {
            stats.peak = Math.max(stats.peak, Math.abs(d[i]));
            sum += d[i];
            if (i) delta += (d[i] - d[i - 1]) ** 2;
          }
          stats.mean = Math.max(stats.mean, Math.abs(sum / d.length));
          stats.diffRms = Math.max(stats.diffRms, Math.sqrt(delta / d.length));
          stats.seam = Math.max(stats.seam, Math.abs(d[0] - d[d.length - 1]));
        }
        if (item.loop) {
          const render = new OfflineAudioContext(b.numberOfChannels, 4410, 44100);
          const source = render.createBufferSource();
          source.buffer = b;
          source.loop = true;
          source.connect(render.destination);
          source.start(0, b.duration - 0.05);
          const audio = await render.startRendering();
          stats.renderedSeam = Math.abs(
            audio.getChannelData(0)[2205] - audio.getChannelData(0)[2204],
          );
        }
        return stats;
      },
      { item, base },
    );
    assert.equal(r.channels, item.channels);
    assert.ok(Math.abs(r.seconds - item.seconds) < 0.003, item.name + ' decoder padding');
    assert.ok(r.peak < 0.6, item.name + ' clipping');
    assert.ok(r.mean < 0.001, item.name + ' DC');
    if (item.loop)
      assert.ok(r.seam < Math.max(0.006, r.diffRms * 8), item.name + ' seam ' + JSON.stringify(r));
    results.push(r);
  }
  // User click unlocks native media; inspect each player's decoded duration and actual progress.
  const players = page.locator('audio');
  const playable = await players.count();
  for (let i = 0; i < playable; i++) {
    await players.nth(i).evaluate((a) => {
      a.load();
    });
    await page.locator('#stop').click();
    await players.nth(i).evaluate((a) => a.play());
    await page.waitForFunction((i) => document.querySelectorAll('audio')[i].currentTime > 0.08, i);
    const state = await players
      .nth(i)
      .evaluate((a) => ({ error: a.error?.message, duration: a.duration }));
    assert.ok(!state.error && state.duration >= 0.49);
    await players.nth(i).evaluate((a) => a.pause());
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${out}/review-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/summary.json`, JSON.stringify({ results, playable, errors }, null, 2));
  console.log(
    'PASS',
    results.length,
    'runtime decodes / loops;',
    playable,
    'native A/B players; stereo, headroom, gapless duration, mobile layout',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
