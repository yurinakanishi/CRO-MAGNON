// Real Chrome phone HUD (2026-10-12 redesign) in an isolated, unsaved game server.
// Preparation only places the actor and its inventory; each checked action comes from a finger.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { qaGamePackage } from './qa-game-package.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { RIMO_NEKO } from '../dist/shared/rimo-neko.mjs';
import { CAMP } from '../dist/shared/world.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/mobile-hud-20261012/${Date.now()}`;
const ROOM = 'HUD-QA';
const { createGameServer, packageRoot, packageId } = await qaGamePackage();
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1', assetRoot: packageRoot });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const errors = [],
  checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, ms = 25000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
let page, context, cdp, room, selfId, peer, failure;
const me = () => room.players.get(selfId);
async function shot(name) {
  await sleep(250);
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
}
async function place(x, z) {
  stopActor(me());
  Object.assign(me(), { x, z, downedUntil: 0, invulnerableUntil: 0 });
  await sleep(700);
}
const touch = (type, points = []) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ radiusX: 5, radiusY: 5, force: 1, ...p })),
  });
const box = (selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }, selector);
/** Visible touch buttons stay whole on screen, at least 44px, hit-testable and apart. */
async function targets() {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    buttons: [...document.querySelectorAll('#touch-controls button')]
      .filter((el) => el.getClientRects().length)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          action: el.dataset.touchAction,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          hit:
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') ===
            el,
        };
      }),
    prompts: document.querySelectorAll('#touch-controls .touch-prompt').length,
  }));
  assert.ok(layout.prompts <= 3, `prompts ${layout.prompts}`);
  for (const b of layout.buttons)
    assert.ok(
      b.w >= 44 &&
        b.h >= 44 &&
        b.hit &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.w <= layout.width + 1 &&
        b.y + b.h <= layout.height + 1,
      JSON.stringify(b),
    );
  for (let a = 0; a < layout.buttons.length; a++)
    for (let b = a + 1; b < layout.buttons.length; b++) {
      const p = layout.buttons[a],
        q = layout.buttons[b];
      assert.ok(
        Math.min(p.x + p.w, q.x + q.w) <= Math.max(p.x, q.x) + 1 ||
          Math.min(p.y + p.h, q.y + q.h) <= Math.max(p.y, q.y) + 1,
        `overlap ${p.action}/${q.action}`,
      );
    }
  return layout;
}
try {
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') selfId = m.id;
    }),
  );
  await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}`);
  await page.locator('#title-start').tap();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').tap();
  await page.locator('#setup-flow-yes').tap();
  await enterPreparedWorld(page, true);
  await until(() => selfId && game.rooms.get(ROOM)?.players.has(selfId), 'join');
  room = game.rooms.get(ROOM);
  cdp = await context.newCDPSession(page);
  await page.locator('#touch-controls').waitFor({ state: 'visible' });
  await place(76, 68);
  await sleep(1500);

  // Two columns: status and rail at the left, the round minimap at the right; no web chrome.
  const rail = await page
    .locator('.touch-toolbar button')
    .evaluateAll((buttons) => buttons.map((b) => b.dataset.touchAction));
  assert.deepEqual(rail, ['menu', 'mascots', 'chat', 'center']);
  const plate = await box('.status-plate'),
    map = await box('.minimap-button'),
    area = await box('.map-area');
  assert.ok(plate.x < 30 && plate.y < 30 && plate.h <= 60, JSON.stringify(plate));
  assert.ok(map.right > 360 && Math.abs(map.w - map.h) < 1, JSON.stringify(map));
  assert.ok(area.x >= 0 && area.right <= 391 && area.y > map.bottom, JSON.stringify(area));
  assert.equal(await page.locator('#minimap').getAttribute('data-compact'), 'true');
  assert.equal(
    await page.locator('#minimap').evaluate((c) => getComputedStyle(c).borderRadius),
    '50%',
  );
  assert.equal(
    await page
      .locator('.status-plate')
      .evaluate((el) => getComputedStyle(el).backdropFilter || 'none'),
    'none',
  );
  assert.equal(await page.locator('[data-touch-action="bag"]').count(), 0);
  await targets();
  await shot('01-idle');
  pass('Left status and slim rail, round minimap with its area, no blur and no duplicate bag');

  // The pad appears where the thumb lands and glows when pushed far enough to run.
  const landing = { x: 150, y: 640 };
  await touch('touchStart', [{ id: 1, ...landing }]);
  const stick = await box('#touch-stick');
  assert.ok(
    Math.abs(stick.x + stick.w / 2 - landing.x) < 2 &&
      Math.abs(stick.y + stick.h / 2 - landing.y) < 2,
    JSON.stringify(stick),
  );
  await touch('touchMove', [{ id: 1, x: landing.x, y: landing.y - 44 }]);
  await until(() => me().running, 'deep thumb runs');
  assert.equal(await page.locator('#touch-stick').getAttribute('data-gait'), 'run');
  await shot('02-floating-run');
  await touch('touchEnd');
  await until(() => !me().moving, 'release stops');
  await until(
    async () => (await page.locator('#touch-stick').getAttribute('data-gait')) === 'rest',
    'pad rests',
  );
  pass('The pad appears under the thumb, runs from a deep push and stops on release');

  // Prompts stack above the pad, the first nearest the thumb; abilities keep fixed slots.
  await place(RIMO_NEKO.home.x + 1, RIMO_NEKO.home.z);
  await page.locator('[data-touch-action="pet"]').waitFor();
  const promptOrder = await page
    .locator('.touch-prompt')
    .evaluateAll((buttons) => buttons.map((b) => b.dataset.touchAction));
  assert.equal(promptOrder[0], 'pet');
  const pet = await box('[data-touch-action="pet"]'),
    attack = await box('[data-touch-action="attack"]');
  assert.ok(pet.bottom < attack.y, 'prompts above the action pad');
  assert.ok(
    (await page
      .locator('[data-touch-action="pet"] .touch-prompt-icon')
      .evaluate((el) => getComputedStyle(el).backgroundColor)) !== 'rgba(0, 0, 0, 0)',
  );
  await targets();
  await shot('03-prompts');
  await page.locator('[data-touch-action="pet"]').tap();
  await until(() => room.rimoNeko.followPlayerId === selfId, 'pet by prompt');
  await sleep(700);
  await place(76, 68);
  await page.locator('[data-touch-action="throw"]').waitFor();
  assert.equal(await page.locator('[data-touch-action="throw"]').getAttribute('data-slot'), 'near');
  assert.equal(await page.locator('[data-touch-action="throw"]').innerText(), '1匹投げる');
  await targets();
  await shot('04-ability');
  pass('Up to three prompts above the pad with the primary at the bottom; abilities keep slots');

  // The attack shows the weapon and its recharge.
  assert.equal(
    await page.locator('[data-touch-action="attack"]').getAttribute('data-weapon'),
    'spear',
  );
  const before = me().attackSequence || 0;
  await page.locator('[data-touch-action="attack"]').tap();
  await until(() => me().attackSequence > before, 'attack by touch');
  await until(
    async () =>
      (await page.locator('[data-touch-action="attack"]').getAttribute('data-cooling')) === 'true',
    'recharge shown',
  );
  await shot('05-recharge');
  await until(
    async () =>
      (await page.locator('[data-touch-action="attack"]').getAttribute('data-cooling')) === 'false',
    'recharge ends',
  );
  pass('Attack carries the weapon glyph and a recharge sweep that ends when ready');

  // Cooking through its prompt; the task then keeps only its cancel and progress.
  me().inventory.rawMeat = 2;
  await place(CAMP.x + 2.6, CAMP.z);
  const cookAction = page.locator('.touch-prompt').filter({ hasText: /焼く/ }).first();
  await cookAction.waitFor();
  const cookCount = await page.locator('[data-touch-action="cook"]').count();
  const fireCount = await page
    .locator('[data-touch-action="interact"]')
    .filter({ hasText: /焼く/ })
    .count();
  assert.equal(cookCount + fireCount, 1, 'one cooking prompt, not two');
  await shot('06-cook-prompt');
  await cookAction.tap();
  await until(() => me().cookingEndsAt > Date.now(), 'cooking starts');
  await page.locator('#touch-controls[data-mode="busy"]').waitFor();
  assert.equal(await page.locator('.touch-pad').isVisible(), false);
  const cancel = await box('[data-touch-action="cancel"]'),
    progress = await box('#cooking-status');
  assert.ok(cancel && progress, 'cancel and progress shown');
  assert.ok(progress.bottom <= cancel.y + 1 && progress.right > 300, JSON.stringify(progress));
  await shot('07-busy');
  await until(() => !me().cookingEndsAt || me().cookingEndsAt < Date.now(), 'cooking ends', 8000);
  await page.locator('#touch-controls[data-mode="play"]').waitFor();
  pass('Cooking is one prompt; while busy only its cancel and progress remain by the thumb');

  // Another traveller's line: unread dot and a brief peek, cleared by opening the chat.
  peer = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${ROOM}&name=Peer`);
  await new Promise((resolve, reject) => {
    peer.once('open', resolve);
    peer.once('error', reject);
  });
  await until(() => room.players.size === 2, 'peer joined');
  await sleep(700);
  peer.send(JSON.stringify({ type: 'chat', text: 'こんにちは、焚き火で待ってるね' }));
  await page.locator('.touch-chat-peek:not([hidden])').waitFor();
  assert.equal(
    await page.locator('[data-touch-action="chat"]').getAttribute('data-unread'),
    'true',
  );
  const peek = await box('.touch-chat-peek');
  assert.ok(peek.x >= 0 && peek.right <= 391, JSON.stringify(peek));
  await shot('08-chat-peek');
  await page.locator('[data-touch-action="chat"]').tap();
  await page.locator('#chat-dialog[open]').waitFor();
  assert.equal(
    await page.locator('[data-touch-action="chat"]').getAttribute('data-unread'),
    'false',
  );
  await page.keyboard.press('Escape');
  await page.locator('#touch-controls').waitFor({ state: 'visible' });
  pass('A peer line shows an unread dot and a peek; opening the chat clears both');

  // Repeated notices refresh instead of stacking; the downed card stays above them. Opening
  // the menu while downed stops input, whose three cancel commands each earn the same notice.
  me().downedUntil = Date.now() + 8000;
  await page.locator('.combat-status.downed').waitFor();
  await page.locator('[data-touch-action="menu"]').tap();
  await page.locator('.pause-menu').waitFor();
  await page.locator('#modal-close').tap();
  await sleep(900);
  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('#toast-stack .toast')].map((t) => t.textContent),
  );
  assert.equal(
    toasts.filter((text) => text.includes('回復を待っています')).length,
    1,
    JSON.stringify(toasts),
  );
  assert.equal(new Set(toasts).size, toasts.length, JSON.stringify(toasts));
  assert.equal(
    await page.locator('.combat-status.downed').evaluate((el) => getComputedStyle(el).zIndex),
    '3',
  );
  await shot('09-downed');
  await until(() => !me().downedUntil || me().downedUntil < Date.now(), 'revived', 15000);
  await page.locator('.combat-status.downed').waitFor({ state: 'hidden' });
  pass('A repeated notice shows once; the downed card stays above the notices');

  // A close-up view leaves zoom and return prompts by the thumb.
  await place(RIMO_NEKO.home.x + 1, RIMO_NEKO.home.z);
  const inspect = page.locator('[data-touch-action="inspect"]');
  if (await inspect.count()) {
    await inspect.tap();
    await page.locator('#touch-controls[data-mode="viewing"]').waitFor();
    assert.deepEqual(
      await page
        .locator('.touch-prompt')
        .evaluateAll((buttons) => buttons.map((b) => b.dataset.touchAction)),
      ['zoomIn', 'zoomOut', 'endInspect'],
    );
    assert.equal(await page.locator('.touch-pad').isVisible(), false);
    await shot('10-viewing');
    await page.locator('[data-touch-action="endInspect"]').tap();
    await page.locator('#touch-controls[data-mode="play"]').waitFor();
    pass('Viewing a companion offers only zoom and return, by the thumb');
  }

  // In the cave: no throwing or attacking; the torch takes the place nearest the thumb.
  const inCave = caveWorldAt(-19, -2);
  await place(inCave.x, inCave.z);
  const torch = page.locator('[data-touch-action="torch"]');
  await torch.waitFor();
  assert.equal(await torch.getAttribute('data-slot'), 'near');
  assert.equal(await page.locator('[data-touch-action="throw"]').count(), 0);
  await until(
    () => page.locator('[data-touch-action="attack"]').isDisabled(),
    'attack disabled in the cave',
  );
  const torchLabel = await torch.innerText();
  assert.match(torchLabel, /^松明を(消す|灯す)$/);
  await targets();
  await shot('11-cave-torch');
  await torch.tap();
  await until(async () => (await torch.innerText()) !== torchLabel, 'torch toggles by touch');
  pass('In the cave the torch takes the near slot and toggles; no throwing and attack disabled');
  await place(76, 68);

  // English labels and the phone menu's single tab row.
  await page.evaluate(async () => (await import('/src/language.js')).setLanguage('en'));
  await sleep(500);
  const english = await page
    .locator('#touch-controls')
    .evaluate((el) =>
      [...el.querySelectorAll('.touch-prompt-label, .touch-skill-label')].map((s) => s.textContent),
    );
  assert.ok(english.length > 0);
  for (const text of english) assert.doesNotMatch(text, /[\u3040-\u30ff\u3400-\u9fff]/, text);
  await shot('12-english');
  await page.evaluate(async () => (await import('/src/language.js')).setLanguage('ja'));
  await page.locator('[data-touch-action="menu"]').tap();
  await page.locator('.pause-menu').waitFor();
  const tabs = await page.locator('.pause-tab').evaluateAll((list) =>
    list.map((tab) => {
      const r = tab.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right };
    }),
  );
  const close = await box('#modal-close');
  assert.ok(
    tabs.every((t) => Math.abs(t.y - tabs[0].y) < 1),
    'one tab row',
  );
  assert.ok(
    tabs.every((t) => t.right <= close.x + 1),
    'tabs stay clear of the back button',
  );
  await shot('13-menu');
  await page.locator('#modal-close').tap();
  pass('English prompt and ability labels; the phone menu keeps all tabs in one row');

  for (const size of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await sleep(700);
    await targets();
    const mapArea = await box('.map-area');
    assert.ok(mapArea.x >= 0 && mapArea.right <= size.width + 1, JSON.stringify(mapArea));
    await shot(`14-${size.width}x${size.height}`);
  }
  pass('320x568, 430x932 and 844x390 keep whole, separate targets and the area name on screen');
  assert.deepEqual(errors, []);
  pass('No browser exceptions');
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  if (page) await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  peer?.close();
  await writeFile(
    `${out}/result.json`,
    JSON.stringify({ packageId, checks, errors, failure, physicalDeviceTested: false }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log(out);
}
