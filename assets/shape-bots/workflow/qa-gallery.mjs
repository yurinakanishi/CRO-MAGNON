import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
const errors = [],
  external = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  if (/^https?:/.test(r.url())) external.push(r.url());
});
try {
  await page.goto(pathToFileURL(path.resolve('output/shape-bots-gallery.html')).href);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('model-viewer')].every((m) => m.loaded),
  );
  assert.equal(await page.locator('model-viewer').count(), 4);
  await page.screenshot({ path: 'output/shape-bots-gallery.png', fullPage: true });
  await page.locator('#play').click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('model-viewer').evaluateAll((ms) => ms.every((m) => !m.paused)));
  await page.selectOption('#clip', 'Catch');
  assert.ok(
    await page
      .locator('model-viewer')
      .evaluateAll((ms) => ms.every((m) => m.animationName === 'Catch')),
  );
  await page.locator('#play').click();
  assert.ok(await page.locator('model-viewer').evaluateAll((ms) => ms.every((m) => m.paused)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/shape-bots-gallery-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    'output/shape-bots-gallery-qa.json',
    JSON.stringify(
      {
        passed: true,
        models: 4,
        offline: true,
        desktop: [1440, 850],
        mobile: [390, 844],
        errors,
        external,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Four exact GLBs, play/pause, shared clip and mobile gallery passed');
} finally {
  await browser.close();
}
