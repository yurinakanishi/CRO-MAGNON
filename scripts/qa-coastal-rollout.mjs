// Read-only delivery checks plus ordinary UI in a dedicated local QA room.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3000',
  folder = 'assets/coastal-craft/rollout';
await mkdir(folder, { recursive: true });
const health = await (await fetch(base + '/api/health')).json();
const delivery = JSON.parse(await readFile('assets/coastal-craft/delivery-qa.json', 'utf8'));
for (const file of delivery.files) {
  const response = await fetch(base + file.url);
  assert.equal(response.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex'),
    file.sha256,
  );
}
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const errors = [],
  viewports = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', '貝と石器・確認');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + '/?room=COAST-ROLLOUT&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.equal(await page.locator('#world').getAttribute('data-weapon'), 'spear');
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-travel').click();
  await page.locator('#gulf-button').click();
  await page.waitForFunction(
    () => document.querySelector('#gulf-travel')?.textContent === 'ここへ歩く',
    {},
    { timeout: 10000 },
  );
  await page.locator('#gulf-coastal').click();
  await page.locator('#coastal-detail').waitFor();
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const b = document.querySelector('#shell-gather').getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        gatherButtonWidth: b.width,
        modal: document.querySelector('#modal').getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(geometry.width, geometry.scrollWidth);
    assert.ok(geometry.gatherButtonWidth >= 120);
    viewports.push(geometry);
    await page.screenshot({ path: `${folder}/${width}x${height}.png` });
  }
  await page.locator('#stone-outcrop').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/stone-recipe.png` });
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        status: 'passed',
        at: new Date().toISOString(),
        health,
        servedGLBs: delivery.files.length,
        errors,
        viewports,
        notes: [
          'Dedicated QA room only. Normal expedition and guide navigation; no inventory or position fixtures.',
          'All served GLBs match their delivery SHA. Public Cloudflare not changed.',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
