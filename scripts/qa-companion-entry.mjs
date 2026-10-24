// Cold-cache Chrome entry with one selected GLB withheld. The render hook only
// observes the first world frame; setup and entry are performed through real UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const output = process.argv[2] || `output/playwright/companion-entry-${Date.now()}`;
const before = process.argv.includes('--before');
await mkdir(output, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [],
  forbidden = [],
  held = [],
  delivered = [];
const result = { before, browser: browser.version(), base, held, delivered, errors, forbidden };
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('websocket', (ws) => forbidden.push(ws.url()));
await page.route('**/api/**', (route) => {
  forbidden.push(route.request().url());
  return route.abort();
});
await page.route('**/models/rimo-neko/*.glb', async (route) => {
  held.push(new URL(route.request().url()).pathname);
  await gate;
  await route.continue();
});
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      `
const entryQaRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function(...args) {
  const value = entryQaRender.apply(this, args);
  if (!this.loadingCave && this.assetsReady && this.selfId && !window.firstCompanionFrame) {
    const owned = (body) => body.ownerId === this.selfId && !body.leavingAt;
    const companions = (this.state.companions ?? []).filter(owned);
    const dots = (this.state.orbBots ?? []).filter((b) => owned(b) && !b.companionId);
    window.firstCompanionFrame = {
      expected: [...companions, ...dots].map((b) => b.id),
      attached: [...this.companionRenderers.renderers.keys(), ...this.orbBotRenderer.bots.keys()],
      visible: [...this.companionRenderers.renderers.values()].filter((r) => r.root.visible).map((r) => r.id)
        .concat([...this.orbBotRenderer.bots].filter(([, r]) => r.actor.root.visible).map(([id]) => id)),
    };
  }
  return value;
};`,
  });
});
try {
  for (const file of ['src/world3d.js', 'src/main.js', 'src/mascot-target.js']) {
    const response = await fetch(new URL(file, base));
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    const hash = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, sha(await readFile(`dist/${file}`)));
    delivered.push({ file, sha256: hash });
  }
  await page.goto(base);
  const tap = (selector) => page.locator(selector).tap();
  await tap('#title-start');
  await page.locator('#setup-form input[name="name"]').fill('読み込みQA');
  await tap('#setup-form input[value="cro-male"]');
  await tap('#setup-flow-yes');
  await tap('[data-starting-mascot-all]');
  await tap('#mascot-start');
  await page.locator('#world[data-world-asset="ready"]').waitFor({ timeout: 180000 });
  // Allow the already-loaded startup set to settle while the selected GLB stays blocked.
  await page.waitForTimeout(1000);
  result.blocked = await page.locator('[data-cave-proceed]').evaluate((button) => ({
    disabled: button.disabled,
    busy: button.getAttribute('aria-busy'),
    worldReady: document.querySelector('#loading-cave').dataset.worldReady,
  }));
  result.requestsBeforeProceed = held.length;
  await page.screenshot({ path: `${output}/waiting.png` });
  if (!before) {
    assert.ok(held.length > 0, 'the selected companion is requested during the cave');
    assert.equal(result.blocked.disabled, true, 'entry waits for the delayed companion');
    assert.equal(result.blocked.busy, 'true');
  }
  release();
  await enterPreparedWorld(page, true);
  await page.waitForFunction(() => !!window.firstCompanionFrame);
  result.firstFrame = await page.evaluate(() => window.firstCompanionFrame);
  await page.locator('#mascot-target:not([hidden])').waitFor();
  await tap('.mascot-target-toggle');
  result.picker = {
    extraActions: await page.locator('#mascot-target [data-mascot-command]').count(),
    lowerInspect: await page.locator('[data-touch-action="inspect"]').isVisible(),
    lowerPet: await page.locator('[data-touch-action="pet"]').isVisible(),
  };
  // A genuine tap on the exposed world, away from the picker and action buttons.
  await page.touchscreen.tap(350, 300);
  result.picker.closedOutside = await page.locator('#mascot-target-panel').isHidden();
  await page.screenshot({ path: `${output}/arrived.png` });
  if (!before) {
    assert.equal(result.firstFrame.expected.length, 11);
    assert.deepEqual(
      [...result.firstFrame.attached].sort(),
      [...result.firstFrame.expected].sort(),
    );
    assert.deepEqual([...result.firstFrame.visible].sort(), [...result.firstFrame.expected].sort());
    assert.deepEqual(result.picker, {
      extraActions: 0,
      lowerInspect: true,
      lowerPet: true,
      closedOutside: true,
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.equal(game.rooms.size, 0);
  result.status = before ? 'baseline' : 'passed';
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = 'failed';
  result.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  release();
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await game.close();
}
