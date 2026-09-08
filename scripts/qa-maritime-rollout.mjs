// Normal local server, a dedicated QA room, ordinary UI and read-only delivery checks.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3000',
  folder = 'assets/weather-current/rollout';
await mkdir(folder, { recursive: true });
const health = await (await fetch(base + '/api/health')).json(),
  checks = [],
  errors = [];
for (const f of [
  'src/main.js',
  'src/maritime-ui.js',
  'src/boat-ui.js',
  'src/boat-renderer.js',
  'src/world-map.js',
  'src/world-atmosphere.js',
  'src/gulf-ui.js',
  'src/gulf.css',
  'shared/maritime-weather.mjs',
  'shared/boats.mjs',
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
let peer, last, diagnostics;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', '空と航路・反映確認');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + '/?room=WEATHER-ROLLOUT&autostart=1', { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  peer = new WebSocket(base.replace('http', 'ws') + '/ws?room=WEATHER-ROLLOUT&name=CHECK');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No local snapshot')), 10000);
    peer.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'state') {
        last = m;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  assert.equal(last.maritime.version, 1);
  assert.equal(last.playerLimit, 5);
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-travel').click();
  await page.waitForTimeout(800);
  await page.locator('#gulf-button').click();
  assert.ok((await page.locator('body').ariaSnapshot()).includes('空と航路'));
  await page.locator('#gulf-weather').click();
  assert.ok((await page.locator('#sea-now').innerText()).includes('凪'));
  await page.screenshot({ path: folder + '/01-forecast.png' });
  await page.locator('#sea-map').click();
  await page.screenshot({ path: folder + '/02-map.png' });
  assert.equal(await page.locator('#big-map').getAttribute('data-map-mode'), 'gulf');
  await page.keyboard.press('Escape');
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-weather').click();
  await page.locator('#sea-go-hearth-landing').click();
  const started = Date.now();
  while (true) {
    const p = last.players.find((p) => p.name === '空と航路・反映確認');
    if (p && !p.moving && Math.hypot(p.x + 2270, p.z - 538.5) < 3) break;
    if (Date.now() - started > 90000) throw new Error('Did not reach landing by normal walking');
    await page.waitForTimeout(180);
  }
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-weather').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sea-go-east-outer-landing').scrollIntoViewIfNeeded();
  assert.equal(
    await page.locator('#modal').evaluate((d) => d.scrollWidth > d.clientWidth + 2),
    false,
  );
  await page.screenshot({ path: folder + '/03-mobile.png' });
  diagnostics = await page.locator('#world').evaluate((c) => ({
    seaWeather: c.dataset.seaWeather,
    fogFar: c.dataset.seaFog,
    fps: c.dataset.fps,
  }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(String(error));
  throw error;
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
        errors,
        diagnostics,
        plannedFlows: [
          'gulf expedition',
          'forecast via gulf panel',
          'gulf map',
          'normal walking to hearth landing',
          '390x844 scrolling',
        ],
        snapshot: last ? { playerLimit: last.playerLimit, maritime: last.maritime } : null,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ rollout: 'passed', modules: checks.length, errors }));
