// Ordinary UI in a dedicated local room; inspect exact emitted files after rollout.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3000',
  folder = 'assets/village-life/rollout';
await mkdir(folder, { recursive: true });
const health = await (await fetch(base + '/api/health')).json();
const checks = [];
for (const f of [
  'src/main.js',
  'src/world3d.js',
  'src/village-ui.js',
  'src/village-renderer.js',
  'src/style.css',
  'shared/village-sites.mjs',
  'shared/village-life.mjs',
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
    localStorage.setItem('cro-name', '暮らし・反映確認');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await p.goto(base + '/?room=LIFE-ROLLOUT&autostart=1', { waitUntil: 'domcontentloaded' });
  await p
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await p.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.match(await p.locator('#attack-button').textContent(), /木槍/);
  peer = new WebSocket(base.replace('http', 'ws') + '/ws?room=LIFE-ROLLOUT&name=CHECK');
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
  await p.locator('#gulf-residents').click();
  await p.locator('#resident-near-aru').click({ timeout: 60000 });
  await p.waitForFunction(
    () => document.querySelector('#interaction-hint')?.textContent.includes('アルに話しかける'),
    {},
    { timeout: 45000 },
  );
  await p.keyboard.press('e');
  await p.locator('#village-panel[data-person="aru"]').waitFor();
  await p.waitForTimeout(650);
  await p.locator('#resident-help').click();
  await p.waitForFunction(
    () =>
      document.querySelector('#resident-help')?.disabled &&
      document.querySelector('#resident-result')?.textContent.includes('済ませた'),
    {},
    { timeout: 5000 },
  );
  await p.screenshot({ path: folder + '/01-help.png' });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(2200);
  await p.screenshot({ path: folder + '/02-residents.png' });
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await p.setViewportSize({ width, height });
    await p.keyboard.press('Escape');
    await p.locator('[data-controller-menu="residents"]').click();
    assert.ok(await p.locator('#village-panel').isVisible());
    views.push(
      await p.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        residents: document.querySelector('#world').dataset.residentModels,
      })),
    );
    assert.ok(views.at(-1).scrollWidth <= width);
    await p.screenshot({ path: `${folder}/03-directory-${width}.png` });
    await p.keyboard.press('Escape');
  }
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
