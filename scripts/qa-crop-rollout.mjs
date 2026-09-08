// Ordinary UI in a dedicated local room; inspect exact emitted files after rollout.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3000',
  folder = 'assets/crop-expansion/rollout';
await mkdir(folder, { recursive: true });
const health = await (await fetch(base + '/api/health')).json();
const checks = [];
for (const f of [
  'src/main.js',
  'src/gulf-ui.js',
  'src/gulf-renderer.js',
  'src/crop-food-ui.js',
  'src/gamepad-ui.js',
  'src/gulf.css',
  'shared/crops.mjs',
  'shared/gulf-life.mjs',
  'shared/hunting.mjs',
]) {
  const local = await readFile('dist/' + f),
    response = await fetch(base + '/' + f);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), local);
  checks.push({ path: f, sha256: createHash('sha256').update(local).digest('hex') });
}
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const errors = [],
  views = [];
let peer, last;
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.addInitScript(() => {
    localStorage.setItem('cro-name', '畑・反映確認');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await p.goto(base + '/?room=CROP-ROLLOUT&autostart=1', { waitUntil: 'domcontentloaded' });
  await p
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await p.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.match(await p.locator('#attack-button').textContent(), /木槍/);
  peer = new WebSocket(base.replace('http', 'ws') + '/ws?room=CROP-ROLLOUT&name=CHECK');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No rollout snapshot')), 10000);
    peer.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'state') {
        last = m;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  assert.equal(last.residents.length, 8);
  assert.equal(last.playerLimit, 5);
  await p.locator('#gulf-button').click();
  await p.locator('#gulf-travel').click();
  await p.locator('#gulf-button').click();
  await p.locator('#gulf-welcome').click();
  await p.waitForTimeout(650);
  await p.locator('#gulf-crop-choice').selectOption('root');
  await p.locator('#gulf-seeds').click();
  await p.waitForFunction(() =>
    document.querySelector('#gulf-crop-choice')?.selectedOptions[0]?.textContent.includes('種 2'),
  );
  await p.locator('#gulf-spring-go').click();
  await p.waitForFunction(
    () => document.querySelector('#interaction-hint')?.textContent.includes('水袋'),
    {},
    { timeout: 45000 },
  );
  await p.keyboard.press('e');
  await p.waitForTimeout(700);
  await p.locator('#gulf-button').click();
  await p.locator('#gulf-plot-go').click();
  await p.waitForFunction(
    () => document.querySelector('#interaction-hint')?.textContent.includes('育てる作物'),
    {},
    { timeout: 45000 },
  );
  await p.keyboard.press('e');
  await p.locator('#gulf-crop-choice').selectOption('root');
  await p.locator('#gulf-farm').click();
  await p.waitForTimeout(700);
  await p.locator('#gulf-farm').click();
  await p.waitForFunction(() =>
    document.querySelector('#gulf-plot-state')?.textContent.includes('成長中'),
  );
  await p.screenshot({ path: folder + '/01-growing-root.png' });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(700);
  assert.equal(await p.locator('#world').getAttribute('data-crop-varieties'), 'root');
  await p.screenshot({ path: folder + '/02-root-leaves.png' });
  await p.keyboard.press('i');
  await p.locator('#modal-crop-food').click();
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await p.setViewportSize({ width, height });
    await p.screenshot({ path: folder + '/03-recipes-' + width + '.png' });
    views.push(
      await p.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        recipes: document.querySelectorAll('.crop-recipes .gulf-card').length,
      })),
    );
    assert.ok(views.at(-1).scrollWidth <= width);
    assert.equal(views.at(-1).recipes, 2);
  }
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.locator('[data-controller-menu="title"]').click();
  assert.deepEqual(errors, []);
} catch (e) {
  errors.push(String(e));
  throw e;
} finally {
  peer?.close();
  await browser.close();
  await writeFile(
    folder + '/report.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        health,
        checks,
        views,
        errors,
        residents: last?.residents,
        playerLimit: last?.playerLimit,
        publicDeployment: false,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    rollout: 'passed',
    modules: checks.length,
    residents: last.residents.length,
    errors,
    views,
  }),
);
