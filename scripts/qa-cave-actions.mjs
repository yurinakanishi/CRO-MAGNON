// Real Chrome operations in an independent memory-only world, never the user's MMO room.
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt, CAVE_HEARTH } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/cave-actions-20261006/${Date.now()}`;
const browserAssets = process.argv[3];
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
  ...(browserRoot ? { assetRoot: browserRoot } : {}),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  actions = [],
  captures = [],
  peers = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(80);
  }
}
let desktop, phone, room, failure;
async function enter(mobile, name) {
  const page = await browser.newPage({
    viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 800 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  const seen = { id: null, state: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'action') actions.push({ name, ...m });
    });
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    });
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'low');
    window.reviewPad = null;
    navigator.getGamepads = () => (window.reviewPad ? [window.reviewPad] : []);
  }, name);
  await page.goto(`http://127.0.0.1:${port}`);
  const use = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await use('#title-start');
  await use('#setup-form .character-choice:has(input[value="cro-female"])');
  await use('[data-choose-difficulty="normal"]');
  await use('#setup-flow-yes');
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(() => seen.id && game.rooms.get('LOCAL_VERIFY')?.players.has(seen.id), 'joined');
  return {
    page,
    seen,
    get p() {
      return game.rooms.get('LOCAL_VERIFY').players.get(seen.id);
    },
  };
}
async function place(user, point) {
  await until(() => !!user.p, 'current connection after asset loading');
  stopActor(user.p);
  Object.assign(user.p, point, { warpSequence: (user.p.warpSequence ?? 0) + 1 });
  await sleep(1000);
}
async function display(user, lit, tool = false, weapon = false) {
  await until(async () => {
    const d = await user.page.locator('#world').evaluate((el) => ({ ...el.dataset }));
    return (
      d.caveTorchHeld === 'true' &&
      d.caveTorchLit === String(lit) &&
      d.toolVisible === String(tool) &&
      d.weaponVisible === String(weapon)
    );
  }, `torch-only display ${lit}`);
  const d = await user.page.locator('#world').evaluate((el) => ({ ...el.dataset }));
  assert.notEqual(d.playerAnimation, 'Attack');
  return d;
}
async function capture(user, label) {
  captures.push({
    label,
    dataset: await user.page.locator('#world').evaluate((el) => ({ ...el.dataset })),
  });
  await user.page.screenshot({ path: `${out}/${label}.png` });
}
async function pad(user, index) {
  await user.page.evaluate(() => {
    window.reviewPad = {
      index: 0,
      id: 'Review DualShock 4',
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
  });
  await sleep(250);
  await user.page.evaluate((index) => {
    window.reviewPad.buttons[index] = { pressed: true, touched: true, value: 1 };
  }, index);
  await sleep(220);
  await user.page.evaluate((index) => {
    window.reviewPad.buttons[index] = { pressed: false, touched: false, value: 0 };
  }, index);
  await sleep(250);
  await user.page.evaluate(() => {
    window.reviewPad = null;
  });
}
try {
  desktop = await enter(false, 'CaveDesktop');
  room = game.rooms.get('LOCAL_VERIFY');
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  desktop.p.tool = false;
  await place(desktop, caveWorldAt(13));
  // S walks forward in the world from the default camera; the real movement crosses the mouth.
  const entryZ = desktop.p.z;
  await desktop.page.locator('#world').focus();
  await desktop.page.keyboard.down('s');
  await until(() => desktop.p.z > entryZ + 4, 'real walk through mouth');
  await desktop.page.keyboard.up('s');
  await display(desktop, true);
  await capture(desktop, 'entry');
  pass('real keyboard walk across the mouth hides the spear and equips a lit torch');
  await place(desktop, caveWorldAt(-21));
  desktop.p.tool = true;
  await display(desktop, true);
  const inventory = { ...desktop.p.inventory },
    seq = desktop.p.attackSequence;
  for (const key of ['f', '5', 'x']) await desktop.page.keyboard.press(key);
  await pad(desktop, 2);
  await pad(desktop, 7);
  await pad(desktop, 10);
  await sleep(500);
  assert.equal(desktop.p.attackSequence, seq);
  assert.equal(actions.filter((m) => m.action === 'attack' || m.action === 'throwBot').length, 0);
  await desktop.page.keyboard.press('l');
  await until(() => desktop.p.caveTorchOff, 'L extinguish');
  await display(desktop, false);
  await capture(desktop, 'unlit-held');
  await desktop.page.keyboard.press('f');
  assert.equal(desktop.p.attackSequence, seq);
  await desktop.page.keyboard.press('Escape');
  const torchButton = desktop.page.locator('[data-controller-menu="caveTorch"]');
  assert.equal(await torchButton.innerText(), '松明を灯す');
  await torchButton.click();
  await until(() => !desktop.p.caveTorchOff, 'menu light');
  await display(desktop, true);
  pass(
    'keys, synthetic pad attack/throw are blocked; L extinguishes but keeps the torch; menu relights',
  );
  phone = await enter(true, 'CavePhone');
  await place(phone, caveWorldAt(-19, -2));
  phone.p.tool = true;
  await display(phone, true);
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=LOCAL_VERIFY&name=CavePeer${i}`),
      seen = { state: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'state') seen.state = m;
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  await until(() => room.players.size === 5, 'five clients joined');
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [430, 932],
    [844, 390],
  ]) {
    await phone.page.setViewportSize({ width, height });
    const attack = phone.page.locator('[data-touch-action="attack"]');
    assert.equal(await attack.isDisabled(), true);
    assert.equal(await phone.page.locator('[data-touch-action="throw"]').count(), 0);
    const box = await attack.boundingBox();
    await phone.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const torch = phone.page.locator('[data-touch-action="torch"]');
    assert.equal(await torch.innerText(), '松明を消す');
    await torch.tap();
    await until(() => phone.p.caveTorchOff, 'touch extinguish');
    await display(phone, false);
    await capture(phone, `phone-${width}x${height}-unlit`);
    await until(() => Date.now() - phone.p.lastAction > 500, 'toggle cooldown');
    assert.equal(await torch.innerText(), '松明を灯す');
    await torch.tap();
    await until(() => !phone.p.caveTorchOff, 'touch relight');
    await display(phone, true);
    assert.equal(phone.p.attackSequence, 0);
  }
  pass(
    'native touch portrait at 3 sizes and landscape keep an unlit torch and disable attacks/pickups',
  );
  await until(() => Date.now() - phone.p.lastAction > 500, 'toggle cooldown');
  await phone.page.locator('[data-touch-action="torch"]').tap();
  await until(() => phone.p.caveTorchOff, 'phone personal light');
  await until(
    () =>
      [desktop, ...peers].every(
        (v) => v.seen.state?.players.find((p) => p.id === phone.seen.id)?.caveTorchOff === true,
      ),
    '5 clients light sync',
  );
  assert.equal(desktop.p.caveTorchOff ?? false, false);
  // A malicious command still passes through the actual socket and authoritative attack gate.
  const peerPlayer = [...room.players.values()].find((p) => p.name === 'CavePeer0');
  Object.assign(peerPlayer, caveWorldAt(-15));
  peers[0].ws.send(
    JSON.stringify({ type: 'action', action: 'attack', weapon: 'magic', damage: 999 }),
  );
  await sleep(700);
  assert.equal(peerPlayer.attackSequence, 0);
  pass('five clients synchronize personal light; forged network attack is rejected');
  await place(desktop, { x: CAVE_HEARTH.x, z: CAVE_HEARTH.z - 1 });
  await desktop.page.keyboard.press('e');
  await until(() => room.camp.caveFireLit, 'shared hearth light');
  await display(desktop, true);
  pass('shared cave hearth still lights with E while the torch remains held');
  await place(desktop, { x: 50, z: 50 });
  await until(
    async () => (await desktop.page.locator('#world').getAttribute('data-tool-visible')) === 'true',
    'axe restored outside',
  );
  assert.deepEqual(desktop.p.inventory, inventory);
  await desktop.page.keyboard.press('f');
  await until(() => desktop.p.attackSequence === seq + 1, 'outdoor attack');
  await capture(desktop, 'exit-tool');
  pass('exit restores equipped axe, inventory and normal attack');
  desktop.p.tool = false;
  Object.assign(desktop.p, { species: 'cat', gender: 'female' });
  await place(desktop, caveWorldAt(-21, -2));
  await until(
    async () =>
      (await desktop.page.locator('#world').getAttribute('data-player-model')) === 'cat-kunoichi',
    'kunoichi asset',
    180000,
  );
  await display(desktop, true);
  await desktop.page.keyboard.press('l');
  await until(() => desktop.p.caveTorchOff, 'kunoichi extinguish');
  await display(desktop, false);
  await capture(desktop, 'kunoichi-unlit');
  await place(desktop, { x: 50, z: 50 });
  await until(
    async () =>
      (await desktop.page.locator('#world').getAttribute('data-weapon-visible')) === 'true',
    'katana restored',
  );
  await capture(desktop, 'kunoichi-exit');
  pass('kunoichi katana stays hidden with lit/unlit torch and returns outside');
  assert.deepEqual(errors, []);
  assert.equal(actions.filter((m) => m.action === 'attack').length, 1);
  assert.equal(actions.filter((m) => m.action === 'throwBot').length, 0);
} catch (error) {
  failure = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(failure);
  await (phone ?? desktop)?.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        ok: !failure,
        failure,
        checks,
        errors,
        actions,
        captures,
        browserAssets: browserAssets || 'compiled source',
        physicalDeviceTested: false,
        gamepad: 'synthetic standard-mapping Gamepad API',
      },
      null,
      2,
    ),
  );
  peers.forEach(({ ws }) => ws.close());
  await browser.close();
  await game.close();
  console.log(out);
}
