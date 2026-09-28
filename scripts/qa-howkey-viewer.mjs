// Exact new Howkey artifact, without external requests or game save access.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || '09',
  root = resolve(`output/model-generation/models/howkey-scientist/qa/final-${revision}`),
  out = `output/playwright/howkey/viewer-r${revision}`;
await mkdir(out, { recursive: true });
const record = JSON.parse(await readFile(`${root}/viewer.json`, 'utf8')),
  sha = createHash('sha256')
    .update(await readFile(record.source))
    .digest('hex');
assert.equal(record.sourceSha256, sha);
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    recordVideo: { dir: out, size: { width: 1200, height: 900 } },
  }),
  page = await context.newPage(),
  errors = [],
  requests = [],
  checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url());
});
let failure;
try {
  await page.goto(pathToFileURL(`${root}/viewer.html`).href);
  await page.waitForFunction(() => window.modelReady, {}, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.candidateSha256), sha);
  const clips = await page.evaluate(() => document.querySelector('#mv').availableAnimations);
  assert.equal(clips.length, 10);
  checks.push('exact delivery SHA and 10 clips');
  await page.locator('#play').click();
  const theta = await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta);
  await page.mouse.move(580, 400);
  await page.mouse.down();
  await page.mouse.move(810, 450, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.ok(
    Math.abs(
      (await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta)) - theta,
    ) > 0.1,
  );
  const radius = await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().radius);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(350);
  assert.notEqual(
    await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().radius),
    radius,
  );
  await page.locator('#reset').click();
  assert.ok(
    Math.abs(
      (await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta)) -
        Math.PI / 6,
    ) < 0.005,
  );
  checks.push('drag, zoom and reset');
  for (const view of ['threequarter', 'side']) {
    // Camera is a QA observation fixture; animation is operated through controls.
    await page.evaluate((view) => {
      const mv = document.querySelector('#mv');
      mv.cameraOrbit = `${view === 'side' ? 90 : 30}deg 76deg 165%`;
      mv.jumpCameraToGoal();
    }, view);
    for (const clip of clips) {
      await page.locator('#clip').selectOption(clip);
      await page.waitForTimeout(100);
      const duration = await page.evaluate(() => document.querySelector('#mv').duration);
      for (const speed of [1, 0.5]) {
        await page.locator('#speed').selectOption(String(speed));
        await page.locator('#timeline').evaluate((el) => {
          el.value = '0';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('#play').click();
        const before = await page.evaluate(() => ({
          time: document.querySelector('#mv').currentTime,
          at: performance.now(),
        }));
        await page.waitForTimeout(Math.min(450, duration * 600));
        const after = await page.evaluate(() => ({
          time: document.querySelector('#mv').currentTime,
          at: performance.now(),
          rate: document.querySelector('#mv').timeScale,
        }));
        assert.equal(after.rate, speed);
        assert.ok(after.time > before.time, 'animation advances');
        const measured = (after.time - before.time) / ((after.at - before.at) / 1000);
        assert.ok(Math.abs(measured - speed) < 0.2, `${clip} measured playback ${measured}`);
        await page.waitForTimeout(Math.max(1, (duration / speed) * 1000 - 400));
        await page.locator('#play').click();
        const paused = await page.evaluate(() => document.querySelector('#mv').currentTime);
        await page.waitForTimeout(70);
        assert.equal(await page.evaluate(() => document.querySelector('#mv').currentTime), paused);
      }
      for (const ratio of [0.25, 0.5, 0.75]) {
        await page.locator('#timeline').evaluate((el, value) => {
          el.value = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, duration * ratio);
        await page.waitForTimeout(70);
        const actual = await page.evaluate(() => document.querySelector('#mv').currentTime);
        assert.ok(
          Math.abs(actual - duration * ratio) < 0.005,
          `${clip} scrub wanted ${duration * ratio}, got ${actual}`,
        );
        await page.screenshot({ path: `${out}/${view}-${clip}-${ratio}.png` });
      }
      checks.push({ view, clip, normalAndHalfSpeed: true, scrub: true });
      console.log('VIEWER', view, clip);
    }
  }
  await page.locator('#speed').selectOption('0.25');
  assert.equal(await page.evaluate(() => document.querySelector('#mv').timeScale), 0.25);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#reset').click();
  await page.locator('#clip').selectOption('Idle_Loop');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  checks.push('quarter-speed and mobile controls');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
} catch (e) {
  failure = String(e);
  await page.screenshot({ path: `${out}/failure.png` });
  throw e;
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify({ sha256: sha, checks, errors, requests, failure, pass: !failure }, null, 2) +
      '\n',
  );
  await context.close();
  await browser.close();
}
