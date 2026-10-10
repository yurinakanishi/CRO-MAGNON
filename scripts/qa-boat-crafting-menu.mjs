// Real Chrome UI in an isolated, memory-only world. The gamepad alone is simulated.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/boat-crafting-menu-20261006/final-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  actions = [],
  routes = [];
let page, failure;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, label) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > 12000) throw Error(`Timed out: ${label}`);
    await sleep(60);
  }
}
function pass(label) {
  checks.push(label);
  console.log('PASS', label);
}
async function enter(name, options = {}) {
  page = await browser.newPage(options);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'action') actions.push({ player: name, ...message });
    }),
  );
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'low');
    window.qaPad = {
      id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  }, name);
  await page.goto(`http://127.0.0.1:${port}`);
  const use = (selector) =>
    options.hasTouch ? page.locator(selector).tap() : page.locator(selector).click();
  await use('#title-start');
  await use('#setup-form .character-choice:has(input[value="cro-female"])');
  await use('#setup-flow-yes');
  if (await page.locator('#loading-cave').count())
    await page.locator('[data-cave-proceed]').click({ timeout: 180000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  const room = game.rooms.get('LOCAL_VERIFY');
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  const p = [...room.players.values()].find((p) => p.name === name);
  stopActor(p);
  Object.assign(p, { x: 43, z: 43, warpSequence: p.warpSequence + 1 });
  p.inventory.wood = 48;
  p.inventory.boat = 0;
  await sleep(800);
  assert.equal(await page.locator('#boat-craft').count(), 0);
  assert.equal(await page.locator('.boat-controls').isVisible(), false);
  return { room, p };
}
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return (
      el?.id ||
      el?.dataset?.pauseTab ||
      el?.dataset?.controllerMenu ||
      el?.dataset?.item ||
      el?.className ||
      ''
    );
  });
async function keyboardSelect(selector) {
  const route = [];
  for (let i = 0; i < 80; i++) {
    route.push(await focused());
    if (await page.locator(selector).evaluate((el) => el === document.activeElement)) {
      routes.push({ input: 'keyboard', selector, route });
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw Error(`Keyboard cannot reach ${selector}: ${route.join(' > ')}`);
}
async function padInput(buttons = []) {
  await page.evaluate(async (buttons) => {
    window.qaPad.buttons = window.qaPad.buttons.map((_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    }));
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
  }, buttons);
}
async function padTap(button) {
  await padInput([button]);
  await padInput();
}
async function padSelect(selector) {
  const route = [];
  // Follow real direction presses, stopping at each edge. No forced DOM focus or clicks.
  for (const direction of [
    PAD.up,
    PAD.left,
    PAD.right,
    PAD.down,
    PAD.left,
    PAD.up,
    PAD.down,
    PAD.right,
  ]) {
    let previous;
    for (let i = 0; i < 20; i++) {
      const current = await focused();
      route.push(current);
      if (
        await page
          .locator(selector)
          .evaluate((el) => el === document.activeElement && el.classList.contains('gamepad-focus'))
      ) {
        routes.push({ input: 'gamepad', selector, route });
        return;
      }
      if (current === previous) break;
      previous = current;
      await padTap(direction);
    }
  }
  throw Error(`Controller cannot reach ${selector}: ${route.join(' > ')}`);
}
async function made(p, before) {
  await until(() => p.inventory.boat === before.boat + 1, 'one carried boat');
  assert.equal(p.inventory.wood, before.wood - 12);
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  assert.equal(await page.locator('#boat-craft').count(), 0);
  assert.equal(game.rooms.get('LOCAL_VERIFY').boats.length, 0);
  await sleep(550);
}
try {
  const { p } = await enter('CraftMenuDesktop', { viewport: { width: 1280, height: 800 } });
  await page.keyboard.press('Escape');
  await keyboardSelect('[data-craft="boat"]');
  await page.screenshot({ path: `${out}/keyboard-craft.png` });
  const before = { ...p.inventory };
  await page.keyboard.press('Enter');
  await made(p, before);
  pass(
    'Escape, Tab, Enter: menu crafting adds one carried boat and consumes 12 wood; HUD craft absent',
  );
  for (const [width, height] of [
    [1280, 800],
    [844, 390],
  ]) {
    await page.locator('#modal-close').click();
    await page.setViewportSize({ width, height });
    await padTap(PAD.options);
    await until(() => page.locator('#modal').evaluate((el) => el.open), 'pad menu opens');
    await padSelect('[data-craft="boat"]');
    await page.screenshot({ path: `${out}/controller-craft-${width}x${height}.png` });
    const stock = { ...p.inventory };
    await padTap(PAD.circle);
    await made(p, stock);
    pass(`OPTIONS, directional navigation, confirm: craft without pointer at ${width}x${height}`);
  }
  p.inventory.wood = 11;
  await sleep(600);
  await until(
    async () =>
      (await page.locator('[data-craft="boat"]').getAttribute('aria-disabled')) === 'true',
    'insufficient wood disables craft',
  );
  const boats = p.inventory.boat;
  p.inventory.wood = 12;
  p.inventory.boat = 99;
  await sleep(600);
  assert.equal(await page.locator('[data-craft="boat"]').getAttribute('aria-disabled'), 'true');
  p.inventory.boat = boats;
  await until(
    async () =>
      (await page.locator('[data-craft="boat"]').getAttribute('aria-disabled')) === 'false',
    '12 wood enables craft',
  );
  pass('menu recipe keeps material and inventory capacity conditions');
  await page.close();
  const touch = await enter('CraftMenuTouch', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await sleep(600);
    await page.locator('[data-touch-action="menu"]').tap();
    await page.screenshot({ path: `${out}/touch-craft-${width}x${height}.png` });
    const stock = { ...touch.p.inventory };
    await page.locator('[data-craft="boat"]').tap();
    await made(touch.p, stock);
    await page.locator('#modal-close').tap();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    pass(`actual emulated touch taps craft through the menu at ${width}x${height}`);
  }
  assert.equal(
    actions.filter((action) => action.action === 'inventoryCraft' && action.targetId === 'boat')
      .length,
    5,
  );
  assert.deepEqual(errors, []);
  pass('five confirmations send five craft actions; page and console errors zero');
} catch (error) {
  failure = String(error.stack || error);
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      { status: failure ? 'failed' : 'passed', checks, errors, actions, routes, failure },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
