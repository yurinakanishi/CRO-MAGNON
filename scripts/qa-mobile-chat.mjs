// Real Chrome, native finger events, memory-only local world and isolated peers.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { qaGamePackage } from './qa-game-package.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { regionById, adventureProgress } from '../dist/shared/adventure-regions.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/mobile-chat-20261006/${Date.now()}`;
const browserAssets = process.argv[3];
const { createGameServer, packageRoot, packageId } = await qaGamePackage();
assert.ok(!(packageRoot && browserAssets), 'Choose a package or source overlay, not both');
await mkdir(out, { recursive: true });
let browserRoot;
if (browserAssets) {
  browserRoot = path.resolve(out, 'browser-root');
  for (const directory of ['public', 'dist'])
    await mkdir(path.join(browserRoot, directory), { recursive: true });
  for (const directory of ['src', 'shared'])
    await symlink(
      path.resolve(browserAssets, directory),
      path.join(browserRoot, 'dist', directory),
      'junction',
    );
  for (const directory of ['models', 'vendor', 'audio', 'title', 'spawn'])
    await symlink(
      path.resolve('public', directory),
      path.join(browserRoot, 'public', directory),
      'junction',
    );
  await copyFile(
    path.join(browserAssets, 'index.html'),
    path.join(browserRoot, 'public/index.html'),
  );
  await copyFile('public/favicon.svg', path.join(browserRoot, 'public/favicon.svg'));
}
const game = createGameServer({
  ...localVerificationSettings(out),
  port: 0,
  ...(packageRoot || browserRoot ? { assetRoot: packageRoot || browserRoot } : {}),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  sent = [],
  layouts = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(test, label) {
  const end = Date.now() + 20000;
  while (!(await test())) {
    if (Date.now() > end) throw Error(label);
    await sleep(80);
  }
}
let phone, desktop, failure;
async function enter(mobile, name) {
  const page = await browser.newPage({
    viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 800 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framesent', ({ payload }) => sent.push({ name, ...JSON.parse(String(payload)) })),
  );
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'low');
  }, name);
  await page.goto(`http://127.0.0.1:${port}`);
  const use = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await use('#title-start');
  await use('#setup-form .character-choice:has(input[value="cro-female"])');
  await use('[data-choose-difficulty="normal"]');
  await use('#setup-flow-yes');
  await enterPreparedWorld(page, mobile);
  return page;
}
async function closeChat(page = phone) {
  await page.locator('#chat-toggle').tap();
  await until(() => page.locator('#chat-dialog').evaluate((d) => !d.open), 'close chat');
  await page.locator('#touch-controls').waitFor({ state: 'visible' });
}
async function checkSheet(size) {
  await phone.setViewportSize(size);
  await phone.locator('[data-touch-action="chat"]').tap();
  await phone.locator('#chat-dialog[open]').waitFor();
  await sleep(250);
  const layout = await phone.evaluate(() => {
    const rect = (id) => {
      const r = document.querySelector(id).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      sheet: rect('#chat-dialog'),
      panel: rect('#chat-dialog .chat-panel'),
      input: rect('#chat-input'),
      send: rect('#chat-form button'),
      font: getComputedStyle(document.querySelector('#chat-input')).fontSize,
      focus: document.activeElement.id,
      scroll: document.documentElement.scrollWidth,
    };
  });
  layouts.push(layout);
  assert.equal(layout.focus, 'chat-input');
  assert.equal(layout.font, '16px');
  assert.ok(layout.sheet.y >= -1 && layout.sheet.bottom <= size.height + 1);
  assert.ok(layout.panel.width >= layout.sheet.width - 2);
  assert.ok(layout.input.width >= Math.min(size.width, 560) - 120);
  assert.ok(
    layout.input.bottom <= layout.sheet.bottom &&
      layout.send.height >= 44 &&
      layout.send.width >= 44,
  );
  assert.ok(layout.scroll <= size.width);
  await phone.screenshot({ path: `${out}/chat-${size.width}x${size.height}.png` });
  await closeChat();
}
try {
  phone = await enter(true, 'Mobile Chat');
  await phone.locator('#touch-controls').waitFor({ state: 'visible', timeout: 120000 });
  const toolbar = await phone.locator('.touch-toolbar button').evaluateAll((buttons) =>
    buttons.map((b) => ({
      action: b.dataset.touchAction,
      label: b.getAttribute('aria-label'),
      text: b.textContent,
      icons: b.querySelectorAll('svg').length,
    })),
  );
  assert.deepEqual(
    toolbar.map((b) => b.action),
    ['menu', 'bag', 'mascots', 'chat'],
  );
  for (const b of toolbar) {
    assert.equal(b.text, '');
    assert.equal(b.icons, 1);
    assert.ok(b.label);
  }
  assert.equal(await phone.locator('.game-viewport > .chat-panel').isVisible(), false);
  assert.equal(await phone.locator('[data-touch-action="journal"],#adventure-button').count(), 0);
  await phone.screenshot({ path: `${out}/toolbar-390x844.png` });
  pass('Four accessible icons only; floating chat and journal entrance absent');
  desktop = await enter(false, 'Desktop Chat');
  await phone.bringToFront();
  const room = game.rooms.get('LOCAL_VERIFY'),
    p = [...room.players.values()].find((p) => p.name === 'Mobile Chat');
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  Object.assign(p, { x: 76, z: 68, warpSequence: p.warpSequence + 1 });
  await sleep(500);
  const cdp = await phone.context().newCDPSession(phone);
  const stick = await phone.locator('#touch-stick').boundingBox(),
    chat = await phone.locator('[data-touch-action="chat"]').boundingBox();
  const points = [{ id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 40 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await sleep(350);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [...points, { id: 2, x: chat.x + chat.width / 2, y: chat.y + chat.height / 2 }],
  });
  await phone.locator('#chat-dialog[open]').waitFor();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(350);
  const stopped = { x: p.x, z: p.z };
  await sleep(400);
  assert.ok(Math.hypot(p.x - stopped.x, p.z - stopped.z) < 0.02);
  assert.equal(
    await phone.locator('#chat-input').evaluate((el) => el === document.activeElement),
    true,
  );
  await phone.locator('#chat-input').fill('こんにちは、谷の仲間へ 🌿');
  await phone.locator('#chat-form button').tap();
  await until(
    () =>
      desktop
        .locator('#chat-messages')
        .innerText()
        .then((s) => s.includes('こんにちは、谷の仲間へ 🌿')),
    'peer receives message',
  );
  assert.equal(await phone.locator('#chat-input').inputValue(), '');
  assert.equal(
    await phone.locator('#chat-input').evaluate((el) => el === document.activeElement),
    true,
  );
  await phone.locator('#chat-input').fill('もう一度、話しかけます');
  await phone.keyboard.press('Enter');
  assert.equal(sent.filter((m) => m.type === 'chat' && m.name === 'Mobile Chat').length, 2);
  await phone.locator('#chat-input').fill('書きかけを残す');
  await closeChat();
  await phone.locator('[data-touch-action="chat"]').tap();
  assert.equal(await phone.locator('#chat-input').inputValue(), '書きかけを残す');
  await phone.keyboard.press('Escape');
  await phone.locator('#touch-controls').waitFor({ state: 'visible' });
  pass(
    'Two-finger opening stops movement; Japanese/emoji reaches peer once; focus and draft survive',
  );
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ])
    await checkSheet(size);
  pass('Bottom sheet and typing targets fit three portrait sizes and landscape');
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.locator('[data-touch-action="chat"]').tap();
  await phone.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 360 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await sleep(250);
  const keyboardLayout = await phone.locator('#chat-input').boundingBox();
  assert.ok(keyboardLayout.y + keyboardLayout.height <= 360);
  await phone.screenshot({ path: `${out}/simulated-keyboard-viewport.png` });
  await phone.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await closeChat();
  await phone.locator('[data-touch-action="chat"]').tap();
  await sleep(250);
  await phone.touchscreen.tap(300, 200);
  await phone.locator('#touch-controls').waitFor({ state: 'visible' });
  pass(
    'Simulated keyboard viewport keeps input visible; backdrop dismisses without gameplay click',
  );
  await desktop.bringToFront();
  await desktop.locator('#world').focus();
  await desktop.keyboard.press('j');
  assert.equal(await desktop.locator('#modal').evaluate((d) => d.open), false);
  await desktop.keyboard.press('Enter');
  assert.equal(
    await desktop.locator('#chat-input').evaluate((el) => el === document.activeElement),
    true,
  );
  await desktop.locator('#chat-input').fill('PCから返事');
  await desktop.keyboard.press('Enter');
  await until(
    () =>
      phone
        .locator('#chat-messages')
        .innerText()
        .then((s) => s.includes('PCから返事')),
    'mobile receives reply',
  );
  assert.equal(await desktop.locator('#chat-dialog').evaluate((d) => d.open), false);
  await desktop.locator('#chat-toggle').click();
  const r = regionById('high-pass'),
    q = [...room.players.values()].find((p) => p.name === 'Desktop Chat');
  Object.assign(q, { x: r.camp.x, z: r.camp.z, energy: 65, warpSequence: q.warpSequence + 1 });
  q.adventure = {
    regions: {
      [r.id]: {
        visited: r.checkpoints.map((c) => c.id),
        gathered: r.amount,
        kills: r.kills,
        claimed: false,
      },
    },
  };
  await sleep(650);
  const wood = q.inventory.wood;
  await desktop.locator('#world').focus();
  await desktop.keyboard.press('e');
  await until(() => adventureProgress(q, r.id).claimed, 'world report remains available');
  assert.equal(q.inventory.wood, wood + r.reward.wood);
  pass('PC Enter chat preserved; J inert; completed region can still be reported in the world');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack;
  process.exitCode = 1;
  console.error(failure);
  await phone?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        packageId,
        checks,
        errors,
        layouts,
        failure,
        physicalDeviceTested: false,
        keyboardViewport: 'simulated visualViewport height; no physical OS keyboard',
        browserAssets: packageRoot || browserAssets || 'compiled local source',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
  console.log(out);
}
