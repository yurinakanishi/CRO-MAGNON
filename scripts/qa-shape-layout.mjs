// Check the actual screen positions and hit targets after the narrow-landscape correction.
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/shape-bots/layout-${Date.now()}`;
await mkdir(out, { recursive: true });
await copyFile('src/orb-bots.css', 'dist/src/orb-bots.css');
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  views = [];
let failure;
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://127.0.0.1:${port}/?room=ORB-LAYOUT-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.locator('#orb-bot-controls').waitFor({ state: 'visible' });
  for (const [width, height] of [
    [844, 390],
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const buttons = await page.locator('#orb-bot-controls button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          kind: button.dataset.botKind,
          action: button.dataset.botAction,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          hit: button === hit || button.contains(hit),
        };
      }),
    );
    assert.equal(buttons.length, 11);
    for (const b of buttons)
      assert.ok(
        b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height && b.hit,
        JSON.stringify(b),
      );
    await page.locator('#orb-bot-controls [data-bot-kind="heart"]').click();
    assert.equal(
      await page.locator('#orb-bot-controls [data-bot-kind="heart"]').getAttribute('aria-pressed'),
      'true',
    );
    await page.screenshot({ path: `${out}/${width}x${height}.png` });
    views.push({ width, height, buttons });
  }
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e.stack ?? e);
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: !failure, views, errors, failure }, null, 2) + '\n',
  );
  await browser.close();
  await game.close();
}
if (failure) throw Error(failure);
console.log(
  JSON.stringify({ out, passed: true, views: views.length, hitTargets: views.length * 11 }),
);
