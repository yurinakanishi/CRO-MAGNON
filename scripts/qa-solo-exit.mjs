// Exercise a failed final save through real controls and native IndexedDB.
// Fault injection is confined to this isolated browser's Worker, never a user save.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { publicAssets } from './qa-static-server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || 'output/playwright/solo-exit';
const publicArg = process.argv.find((arg) => arg.startsWith('--public='));
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
assert.ok(Boolean(publicArg) !== Boolean(urlArg), 'Pass exactly one --public= or --url=');
await mkdir(output, { recursive: true });
const server = publicArg ? publicAssets(publicArg.slice('--public='.length)) : null;
const base = server
  ? `http://127.0.0.1:${(await server.listen()).port}/`
  : new URL(urlArg.slice('--url='.length)).href;
const checks = [],
  errors = [],
  forbidden = [];
let browser, page;
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function checkpoint() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cro-magnon-solo', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readonly');
      const request = tx.objectStore('checkpoints').get('current');
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  });
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.qaSoloWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('solo-worker')) window.qaSoloWorkers.push(this);
      }
    };
  });
  await page.route('**/src/solo-worker.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        `
      let qaDenyWrites = false;
      addEventListener('message', ({ data }) => {
        if (data?.type === '__qa_storage') qaDenyWrites = data.fail;
      });
      const qaTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (qaDenyWrites && args[1] === 'readwrite')
          throw new DOMException('Isolated QA storage denial', 'QuotaExceededError');
        return qaTransaction.apply(this, args);
      };
    ` + (await response.text()),
    });
  });
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('Save failure QA');
  await page.locator('#setup-form input[value="cro-male"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('[data-starting-mascot="524"]').click();
  await page.locator('#mascot-start').click();
  await enterPreparedWorld(page, false);
  await page.evaluate(() =>
    window.qaSoloWorkers[0].postMessage({ type: '__qa_storage', fail: true }),
  );
  const before = await checkpoint();
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  await page.locator('[data-controller-menu="title"]').click();
  await page
    .locator('#solo-exit-error')
    .filter({ hasText: '保存できなかったため' })
    .waitFor({ timeout: 10000 });
  assert.equal(
    await page.locator('#screens').evaluate((root) => root.classList.contains('active')),
    false,
  );
  assert.equal(await page.locator('#modal').isVisible(), true);
  assert.deepEqual(await checkpoint(), before, 'failed exit preserves the committed checkpoint');
  assert.equal(
    await page.evaluate(async () =>
      (await navigator.locks.query()).held.some((lock) => lock.name === 'cro-magnon-solo-play'),
    ),
    true,
  );
  await page.screenshot({ path: `${output}/save-failed-stays-in-game.png` });
  pass('A failed final save keeps the game, menu, old checkpoint and exclusive writer alive');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#solo-exit-error').scrollIntoViewIfNeeded();
  const errorBox = await page.locator('#solo-exit-error').boundingBox();
  assert.ok(errorBox && errorBox.x >= 0 && errorBox.x + errorBox.width <= 390);
  assert.ok(
    await page
      .locator('#solo-exit-error')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 14),
  );
  await page.screenshot({ path: `${output}/save-failed-mobile-layout.png` });
  pass('The save failure remains readable inside the 390px menu');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() =>
    window.qaSoloWorkers[0].postMessage({ type: '__qa_storage', fail: false }),
  );
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#screen-title').waitFor();
  await page.waitForFunction(
    async () =>
      !(await navigator.locks.query()).held.some((lock) => lock.name === 'cro-magnon-solo-play'),
  );
  const after = await checkpoint();
  const original = JSON.parse(before.payload).game.rooms[0].sessions[0].player;
  const saved = JSON.parse(after.payload).game.rooms[0].sessions[0].player;
  assert.equal(saved.id, original.id);
  assert.deepEqual(saved.inventory, original.inventory);
  assert.equal(saved.mascot, original.mascot);
  assert.ok(Math.hypot(saved.x - original.x, saved.z - original.z) > 0.2);
  pass('Retry commits the pending progress before returning to title and releasing the lock');
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  await page?.screenshot({ path: `${output}/final.png` }).catch(() => {});
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ base, checks, errors, forbidden }, null, 2),
  );
  await browser?.close();
  await server?.close();
}
