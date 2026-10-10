// Memory-only QA worlds. Stock/position are fixtures; all crafting uses real UI
// events and authoritative server transactions. No user's save is opened.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/inventory-crafting-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  changes = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let page, failure;
async function until(condition, label) {
  const end = Date.now() + 12000;
  while (!(await condition())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(40);
  }
}
async function open(roomName, mobile = false) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // Observe the actual animation classifier; this wrapper never changes its return value.
  await page.route('**/src/character-animation.js', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(
      'export function confirmedAction(',
      'function qaConfirmedAction(',
    );
    await route.fulfill({
      response,
      body: `${source}\nexport function confirmedAction(before, after) {
      const value = qaConfirmedAction(before, after);
      if (before && JSON.stringify([before.inventory,before.tool,before.spearHead]) !== JSON.stringify([after.inventory,after.tool,after.spearHead]))
        (window.qaInventoryChanges ??= []).push({value, before, after});
      return value;
    }`,
    });
  });
  await page.addInitScript(
    ({ mobile }) => {
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', 'female');
      if (!mobile) {
        window.qaPad = {
          id: 'Wireless Controller',
          index: 0,
          connected: true,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
        };
        Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
      }
    },
    { mobile },
  );
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  const room = game.rooms.get(roomName),
    me = [...room.players.values()][0];
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  stopActor(me);
  Object.assign(me, { x: 43, z: 43, energy: 70, warpSequence: (me.warpSequence ?? 0) + 1 });
  Object.assign(me.inventory, {
    wood: 52,
    stone: 5,
    obsidian: 4,
    obsidianBlade: 0,
    boat: 0,
    berry: 3,
    rawMeat: 2,
    rawRoot: 2,
    herb: 1,
  });
  await sleep(800);
  if (mobile) await page.locator('[data-touch-action="menu"]').tap();
  else await page.keyboard.press('i');
  await page.locator('#inventory-crafting').waitFor();
  assert.equal(await page.locator('[data-pause-tab="crafting"]').count(), 0);
  assert.ok(await page.locator('.inventory-grid').isVisible());
  await page.evaluate(() => (window.qaInventoryChanges = []));
  return { page, room, me };
}
async function craft(page, id, input = 'click') {
  const button = page.locator(`[data-craft="${id}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  const before = await page.locator('.pause-panels').evaluate((el) => el.scrollTop);
  if (input === 'keyboard') await page.keyboard.press('Enter');
  else if (input === 'touch') await button.tap();
  else if (input === 'pad') {
    await page.evaluate((index) => {
      window.qaPad.buttons[index] = { pressed: true, value: 1 };
    }, PAD.circle);
    await sleep(120);
    await page.evaluate((index) => {
      window.qaPad.buttons[index] = { pressed: false, value: 0 };
    }, PAD.circle);
  } else await button.click();
  await until(
    async () =>
      (await button.getAttribute('aria-busy')) === 'false' &&
      (await page.locator('#inventory-craft-result').getAttribute('data-tone')) === 'success',
    `${id} acknowledged`,
  );
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  if (input !== 'touch')
    assert.equal(await button.evaluate((el) => el === document.activeElement), true);
  assert.ok(
    Math.abs((await page.locator('.pause-panels').evaluate((el) => el.scrollTop)) - before) <= 2,
    `${id}: crafting preserves scroll position`,
  );
}
try {
  let user = await open('CRAFT-UI');
  ({ page } = user);
  const { me, room } = user;
  await page.screenshot({ path: `${out}/desktop-before.png` });
  await craft(page, 'boat', 'keyboard');
  await until(() => me.inventory.boat === 1, 'boat stored');
  assert.equal(me.inventory.wood, 40);
  assert.equal(room.boats.length, 0);
  assert.equal(await page.locator('[data-item="boat"] b').innerText(), '1');
  await craft(page, 'boat', 'keyboard');
  await until(() => me.inventory.boat === 2, 'second boat stored');
  pass(
    'Keyboard crafts two boats into the open inventory, preserves focus and scroll, and never launches a hull',
  );
  await craft(page, 'axe');
  assert.equal(me.tool, true);
  assert.equal(await page.locator('[data-item="axe"]').count(), 1);
  await craft(page, 'blade');
  assert.equal(me.inventory.obsidianBlade, 1);
  assert.equal(me.inventory.stone, 3);
  await craft(page, 'spear', 'pad');
  assert.equal(me.spearHead, 'obsidian');
  assert.equal(me.inventory.obsidianBlade, 0);
  assert.match(await page.locator('[data-item="weapon"]').innerText(), /黒曜石の槍/);
  pass(
    'Mouse and simulated controller craft axe, reusable-tool blade and spear; equipment is listed immediately',
  );
  const inv = structuredClone(me.inventory);
  await page.locator('[data-craft="spear"]').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(me.inventory, inv);
  assert.match(await page.locator('#inventory-craft-result').innerText(), /所持済み/);
  assert.equal(await page.locator('[data-craft="meat"]').getAttribute('aria-disabled'), 'true');
  await page.screenshot({ path: `${out}/desktop-crafted.png` });
  pass('Owned equipment and cooking away from fire explain why crafting is unavailable');
  // Move this fixture to the fire without issuing a warp, which intentionally closes menus.
  Object.assign(me, { x: 50, z: 52 });
  await until(
    async () =>
      (await page.locator('[data-craft="meat"]').getAttribute('aria-disabled')) === 'false',
    'fire enables cooking',
  );
  await craft(page, 'herbRoot', 'keyboard');
  assert.equal(me.inventory.herbRoot, 1);
  assert.equal(me.inventory.rawRoot, 1);
  assert.equal(me.inventory.herb, 0);
  assert.equal(me.cookingEndsAt, 0);
  await page.locator('[data-item="rawMeat"]').click();
  await page.locator('[data-item-action="cook"]').click();
  await until(() => me.inventory.cookedMeat === 1, 'item menu cooks instantly');
  assert.equal(me.cookingEndsAt, 0);
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  await until(
    async () =>
      (await page.locator('#inventory-craft-result').innerText()) ===
      '焼き肉を持ち物に追加しました。',
    'food result',
  );
  const observed = await page.evaluate(() => window.qaInventoryChanges);
  changes.push(...observed);
  assert.equal(observed.length, 7);
  assert.ok(observed.every((change) => change.value === null));
  pass(
    'Inventory recipe and item cooking are instant at fire; all seven real craft transactions produce no character animation',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('i');
  assert.equal(await page.locator('[data-item="boat"] b').innerText(), '2');
  assert.match(await page.locator('[data-item="weapon"]').innerText(), /黒曜石の槍/);
  await page.close();
  user = await open('CRAFT-TOUCH', true);
  ({ page } = user);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await craft(page, 'boat', 'touch');
    assert.equal(
      await page.locator('#modal').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    const box = await page.locator('[data-craft="boat"]').boundingBox();
    assert.ok(box.height >= 43.9 && box.width >= 43.9);
    assert.equal(
      await page.locator('[data-craft="boat"]').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
      true,
      'craft target remains unobscured by the result or header',
    );
    await page.screenshot({ path: `${out}/touch-${viewport.width}x${viewport.height}.png` });
    pass(
      `${viewport.width}x${viewport.height}: real touch crafts with open inventory, 44px target and no horizontal overflow`,
    );
  }
  assert.equal(user.me.inventory.boat, 3);
  await page.locator('.pause-more').tap();
  assert.equal(await page.locator('.pause-more').getAttribute('aria-expanded'), 'true');
  assert.ok(await page.locator('[data-controller-menu="title"]').isVisible());
  await page.locator('.pause-more').tap();
  user.me.inventory.wood = 0;
  await until(
    async () =>
      (await page.locator('[data-craft="boat"]').getAttribute('aria-disabled')) === 'true',
    'shortage disables button',
  );
  assert.match(await page.locator('#recipe-reason-boat').innerText(), /木材 あと12/);
  assert.deepEqual(errors, []);
  pass('Live shortage feedback and no browser errors');
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, checks, errors, changes, failure }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log('EVIDENCE', out);
}
if (failure) process.exitCode = 1;
