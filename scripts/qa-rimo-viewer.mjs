// Exact, self-contained GLB viewer; no external network or user's game save.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || '03',
  out =
    process.env.QA_RIMO_VIEWER_OUT ||
    `output/model-generation/models/rimo-neko/qa/rig-${revision}/browser`;
await mkdir(out, { recursive: true });
const viewer = resolve(out, '../viewer.html'),
  record = JSON.parse(await readFile(resolve(out, '../viewer.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } }),
  errors = [],
  requests = [],
  checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url());
});
try {
  await page.goto(pathToFileURL(viewer).href);
  await page.waitForFunction(() => window.modelReady, {}, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.candidateSha256), record.sourceSha256);
  const clips = await page.evaluate(() => document.querySelector('#mv').availableAnimations);
  assert.equal(clips.length, 7);
  await page.locator('#play').click();
  const before = await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta);
  await page.mouse.move(580, 450);
  await page.mouse.down();
  await page.mouse.move(820, 485, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta);
  assert.ok(Math.abs(after - before) > 0.1);
  checks.push('drag orbit');
  const radius = await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().radius);
  await page.mouse.wheel(0, -280);
  await page.waitForTimeout(400);
  assert.notEqual(
    await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().radius),
    radius,
  );
  checks.push('wheel zoom');
  await page.locator('#reset').click();
  assert.ok(
    Math.abs(
      (await page.evaluate(() => document.querySelector('#mv').getCameraOrbit().theta)) -
        Math.PI / 6,
    ) < 0.005,
  );
  checks.push('reset');
  for (const clip of clips) {
    await page.locator('#clip').selectOption(clip);
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.querySelector('#mv').currentTime);
    assert.ok(t > 0);
    await page.locator('#play').click();
    const paused = await page.evaluate(() => document.querySelector('#mv').currentTime);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => document.querySelector('#mv').currentTime), paused);
    const duration = await page.evaluate(() => document.querySelector('#mv').duration);
    for (const ratio of [0.15, 0.4, 0.65, 0.9]) {
      await page.locator('#timeline').evaluate((el, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, duration * ratio);
      await page.waitForTimeout(80);
      assert.ok(
        Math.abs(
          (await page.evaluate(() => document.querySelector('#mv').currentTime)) - duration * ratio,
        ) < 0.005,
      );
      await page.screenshot({ path: `${out}/${clip}-${ratio}.png` });
    }
    checks.push(`${clip}: play pause scrub`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#reset').click();
  await page.locator('#clip').selectOption('Idle_Loop');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  checks.push('narrow screen');
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      { sourceSha256: record.sourceSha256, checks, errors, externalRequests: requests },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
