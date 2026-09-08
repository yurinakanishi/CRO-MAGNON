// Normal local server, dedicated short QA room, ordinary expedition and welcome supplies.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const base = 'http://127.0.0.1:3000',
  folder = process.argv[2] || 'output/playwright/shared-pantry/rollout';
const roomName = 'PANTRY-CHECK',
  name = '食料置き場・反映確認';
assert.ok(roomName.length <= 16);
await mkdir(folder, { recursive: true });
const errors = [],
  checks = [],
  completed = [],
  notices = [];
let peer, last, diagnostic;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const health = await (await fetch(base + '/api/health')).json();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 15000) throw Error('Timeout: ' + label);
    await sleep(100);
  }
}
const actor = () => last?.players.find((p) => p.name === name);
const pantry = () => last?.gulf?.pantries[0];
try {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(
    ({ name }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', 'female');
      window.qaNotices = [];
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = class extends OriginalWebSocket {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', (e) => {
            try {
              const m = JSON.parse(e.data);
              if (m.type === 'notice') window.qaNotices.push({ text: m.text, popup: m.popup });
            } catch {}
          });
        }
      };
    },
    { name },
  );
  await page.goto(base + `/?room=${roomName}&autostart=1`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  assert.ok((await page.locator('body').ariaSnapshot()).includes('三つの岸'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: folder + '/01-loaded.png' });
  console.log('Normal local server loads in actual Chrome without errors.');
  for (const f of [
    'src/main.js',
    'src/gulf-ui.js',
    'src/pantry-ui.js',
    'src/gulf.css',
    'shared/gulf-life.mjs',
    'shared/pantry.mjs',
  ]) {
    const local = await readFile('dist/' + f),
      response = await fetch(base + '/' + f);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), local);
    checks.push({ path: f, sha256: createHash('sha256').update(local).digest('hex') });
  }
  peer = new WebSocket(base.replace('http', 'ws') + `/ws?room=${roomName}&name=CHECK`);
  peer.on('message', (data) => {
    const m = JSON.parse(data);
    if (m.type === 'state') last = { ...last, ...m };
  });
  await until(() => last?.gulf && actor(), 'observer snapshot');
  assert.equal(last.room, roomName);
  assert.equal(last.gulf.pantries.length, 4);
  assert.ok(last.gulf.pantries.every((p) => Object.values(p.food).every((n) => n === 0)));
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-travel').click();
  await sleep(600);
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-welcome').click();
  await until(() => actor()?.gulf.welcomed && actor().inventory.berry === 3, 'welcome supplies');
  await sleep(600);
  await page.locator('#gulf-pantry').click();
  assert.ok((await page.locator('body').ariaSnapshot()).includes('共同の食料置き場'));
  await page.locator('#pantry-give').click();
  await until(
    () => pantry().food.berry === 1 && actor().inventory.berry === 2,
    'donate welcome berry',
  );
  await sleep(600);
  await page.locator('#pantry-take').click();
  await until(
    () =>
      pantry().food.berry === 0 &&
      actor().inventory.berry === 3 &&
      actor().gulf.pantryAllowance.taken === 1,
    'receive berry',
  );
  await sleep(600);
  notices.push(...(await page.evaluate(() => window.qaNotices)));
  const transfers = notices.filter((n) => /食料置き場へ預けた|ベリーを1つ受け取った/.test(n.text));
  assert.equal(transfers.length, 2);
  // The separate quiet-feedback change adds this flag. Keep this pantry check
  // usable before that change is committed, while checking it when available.
  if (transfers.some((n) => typeof n.popup === 'boolean'))
    assert.ok(transfers.every((n) => n.popup === false));
  assert.ok((await page.locator('#pantry-allowance').innerText()).includes('あと2個'));
  await page.screenshot({ path: folder + '/02-shared-pantry.png' });
  completed.push(
    'ordinary gulf expedition and welcome; donate and receive berry; server quantities and existing success feedback verified',
  );
  const saved = {
    id: actor().id,
    inventory: structuredClone(actor().inventory),
    allowance: structuredClone(actor().gulf.pantryAllowance),
  };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => actor()?.id === saved.id, 'resume identity');
  assert.deepEqual(actor().inventory, saved.inventory);
  assert.deepEqual(actor().gulf.pantryAllowance, saved.allowance);
  await page.locator('#gulf-button').click();
  await page.locator('#gulf-pantry').click();
  assert.ok((await page.locator('#pantry-allowance').innerText()).includes('あと2個'));
  await page.locator('#pantry-settlement').selectOption('pale-ridge');
  assert.ok(await page.locator('#pantry-give').isDisabled());
  assert.ok(await page.locator('#pantry-take').isDisabled());
  completed.push(
    'same-tab reload preserves inventory and daily use; remote country storage cannot transfer food',
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('#pantry-back').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#modal').evaluate((d) => d.scrollWidth <= d.clientWidth + 2));
    await page.screenshot({ path: `${folder}/03-pantry-${viewport.width}.png` });
    await page.locator('#pantry-back').click();
    await page.locator('#gulf-pantry').click();
  }
  completed.push('normal local build portrait/landscape scrolling and back navigation');
  diagnostic = await page
    .locator('#world')
    .evaluate((c) => ({ fps: c.dataset.fps, chunks: c.dataset.terrainChunks }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
  assert.deepEqual(errors, []);
} catch (e) {
  errors.push(String(e));
  console.error(e);
  process.exitCode = 1;
  await page.screenshot({ path: folder + '/failure.png' }).catch(() => {});
  await writeFile(
    folder + '/failure.txt',
    await page
      .locator('body')
      .ariaSnapshot()
      .catch(() => ''),
  );
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
        completed,
        notices,
        diagnostic,
        fixture:
          'Separate QA room only. Standard welcome berries; no position, inventory or clock mutations. Existing user room was not entered.',
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({ passed: errors.length === 0, modules: checks.length, errors, completed }),
);
