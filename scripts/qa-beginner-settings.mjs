import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = path.resolve(process.argv[2] || 'output/playwright/beginner-ui-20261005/settings');
await mkdir(out, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  exhibition: false,
  visibility: { hiddenCharacters: ['maruimo', 'howkey'], hideMae: true },
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  blocked = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1') {
      blocked.push(u.href);
      return route.abort();
    }
    if (u.pathname === '/src/main.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body:
          (await readFile('dist/src/main.js', 'utf8')) +
          `
      export function cameraReview(){return {yaw:renderer.yaw,pitch:renderer.pitch,distance:renderer.targetDistance,auto:assistedControls()};}
    `,
      });
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('cro-graphics-quality', 'low'));
  await page.goto(`http://127.0.0.1:${port}/?room=BEGINNER-UI`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('UI確認');
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.evaluate(async () => {
    window.review = await import('/src/main.js');
  });
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  assert.equal(await page.locator('[data-setting="zoom-in"]').isVisible(), true);
  await page.locator('[data-controls="easy"]').click();
  assert.equal(await page.locator('[data-setting="zoom-in"]').isVisible(), false);
  assert.equal(await page.locator('[data-setting="camera"]').isVisible(), false);
  await page.screenshot({ path: path.join(out, 'automatic-settings.png') });
  await page.locator('[data-controls="normal"]').click();
  assert.equal(await page.locator('[data-setting="zoom-in"]').isVisible(), true);
  const before = await page.evaluate(() => window.review.cameraReview());
  await page.locator('[data-setting="zoom-in"]').click();
  await page.waitForFunction((d) => window.review.cameraReview().distance < d, before.distance);
  const after = await page.evaluate(() => window.review.cameraReview());
  assert.equal(after.auto, false);
  await page.screenshot({ path: path.join(out, 'normal-settings.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(
      { before, after, errors, blocked, automaticButtonsHidden: true, normalRestored: true },
      null,
      2,
    ),
  );
  console.log('Automatic camera settings hidden; normal camera zoom restored.');
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await game.close();
}
