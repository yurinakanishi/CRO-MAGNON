// Read-only delivery checks and ordinary UI in a dedicated room on the normal local server.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3000',
  folder = process.argv[2] || 'output/playwright/household-journeys/rollout';
const roomName = 'HOUSEHOLD-CHECK';
assert.ok(roomName.length <= 16);
await mkdir(folder, { recursive: true });
const health = await (await fetch(base + '/api/health')).json(),
  checks = [],
  errors = [];
for (const f of [
  'src/household-ui.js',
  'src/village-ui.js',
  'src/world-map.js',
  'src/gulf.css',
  'shared/household-sites.mjs',
  'shared/household-life.mjs',
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
let peer, last, diagnostics;
const notices = [],
  movement = [];
const flows = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', '世帯の旅・反映確認');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + `/?room=${roomName}&autostart=1`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=${roomName}&name=CHECK`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('No snapshot')), 10000);
    peer.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'notice') notices.push(m.text);
      if (m.type === 'state') {
        last = m;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  assert.equal(last.households.length, 3);
  assert.equal(last.room, roomName);
  assert.ok(last.players.some((p) => p.name === '世帯の旅・反映確認'));
  assert.equal(last.residents.length, 8);
  assert.equal(last.playerLimit, 5);
  assert.ok(last.households.every((h) => h.stage === 'home'));
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-travel').click();
  await page.waitForTimeout(700);
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-residents').click();
  assert.ok((await page.locator('body').ariaSnapshot()).includes('世帯の旅'));
  await page.locator('#resident-journeys').click();
  await page.locator('#household-panel').waitFor();
  assert.equal(await page.locator('#household-panel .gulf-card').count(), 3);
  assert.ok(await page.locator('#journey-prepare-valley-hearth').isDisabled());
  await page.screenshot({ path: folder + '/01-households.png' });
  flows.push(
    'ordinary gulf expedition, resident directory, all three households; remote preparation disabled',
  );
  await page.locator('#journey-go-valley-hearth').click();
  const start = Date.now();
  while (true) {
    const p = last.players.find((p) => p.name === '世帯の旅・反映確認');
    if (movement.length < 3 || Date.now() - movement.at(-1).at > 1500)
      movement.push({ at: Date.now(), player: p ?? null, others: last.players.map((p) => p.name) });
    if (p?.moving && Math.hypot(p.x + 2270, p.z - 455) > 2) break;
    if (Date.now() - start > 20000) throw Error('No walking toward country');
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('m');
  await page.locator('#big-map').waitFor();
  assert.equal(await page.locator('#big-map').getAttribute('data-map-mode'), 'gulf');
  await page.screenshot({ path: folder + '/02-map.png' });
  flows.push('country hearth button starts ordinary navigation; gulf map opens');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="residents"]').click();
  await page.locator('#resident-journeys').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#journey-go-reed-hearth').scrollIntoViewIfNeeded();
  assert.equal(
    await page.locator('#modal').evaluate((d) => d.scrollWidth > d.clientWidth + 2),
    false,
  );
  await page.screenshot({ path: folder + '/03-mobile.png' });
  await page.locator('#journey-back').click();
  await page.locator('#village-panel').waitFor();
  flows.push('390x844 last household scrolling and back navigation');
  diagnostics = await page.locator('#world').evaluate((c) => ({
    fps: c.dataset.fps,
    residents: c.dataset.residentModels,
    chunks: c.dataset.terrainChunks,
  }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
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
        errors,
        diagnostics,
        movement,
        notices,
        flows,
        snapshot: last
          ? {
              playerLimit: last.playerLimit,
              households: last.households,
              residents: last.residents.length,
            }
          : null,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ rollout: 'passed', modules: checks.length, errors, flows }));
