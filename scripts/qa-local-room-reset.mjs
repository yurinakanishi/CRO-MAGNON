// Isolated persistent host + real Chrome: resets only this disposable QA room.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { createPersistentGameServer } from '../server.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = path.resolve(process.argv[2] || 'output/playwright/local-room-reset');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(path.join(output, 'save-'));
const game = await createPersistentGameServer({
  port: 0,
  host: '127.0.0.1',
  saveDirectory: directory,
  enableRoomReset: true,
});
const { port } = await game.listen(),
  base = `http://127.0.0.1:${port}`;
const errors = [],
  checks = [],
  peers = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS ' + label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error('QA timed out');
};
let browser, page;
async function peer(room = 'RESET-UI', session = '') {
  const messages = [];
  const socket = new WebSocket(
    `${base.replace('http:', 'ws:')}/ws?${new URLSearchParams({ room, name: 'QA peer', resume: '1', session })}`,
  );
  socket.on('message', (data) => messages.push(JSON.parse(data)));
  socket.on('error', () => {});
  peers.push(socket);
  await until(() => messages.some((m) => m.type === 'welcome'));
  return { socket, messages, welcome: messages.find((m) => m.type === 'welcome') };
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function play(name) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.addInitScript((name) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', 'female');
      window.qaPad = {
        id: 'Reset QA',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
    }, name);
    await p.goto(`${base}/?room=RESET-UI&autostart=1`);
    await p.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 120000,
    });
    await p.waitForSelector('body.in-game');
    return p;
  }
  page = await play('Reset A');
  const observer = await play('Reset B');
  const originals = [];
  for (let i = 0; i < 3; i++) originals.push(await peer());
  const other = await peer('OTHER');
  const original = game.rooms.get('RESET-UI'),
    oldIds = [...original.players.keys()];
  original.camp.level = 2;
  original.createdAt -= 86400000;
  for (const player of original.players.values()) {
    player.inventory.berry = 7;
    player.inventory.wood = 11;
    player.tool = true;
    player.gathered = 15;
    player.energy = 40;
  }
  game.rooms.get('OTHER').players.get(other.welcome.id).inventory.wood = 23;
  await game.saveNow();
  await sleep(500);
  const input = async (buttons = []) =>
    page.evaluate(async (buttons) => {
      window.qaPad.buttons.forEach((b, i) => {
        b.pressed = buttons.includes(i);
        b.value = b.pressed ? 1 : 0;
      });
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    }, buttons);
  const tap = async (button) => {
    await input([button]);
    await input();
  };
  const settings = async () => {
    if (!(await page.locator('#modal').evaluate((el) => el.open)))
      await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="settings"]').click();
  };
  await settings();
  await page.locator('[data-setting="reset-room"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, '01-settings.png') });
  await page.locator('[data-setting="reset-room"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'local-reset-cancel');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('[data-setting="reset-room"]').isVisible());
  assert.equal(game.rooms.get('RESET-UI'), original);
  pass('Settings opens a confirmation with Cancel focused; Escape returns without resetting');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-setting="reset-room"]').click();
    await page.locator('#local-reset-accept').scrollIntoViewIfNeeded();
    const box = await page.locator('#local-reset-accept').boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
    );
    await page.screenshot({ path: path.join(output, `02-confirm-${viewport.width}.png`) });
    await input();
    await tap(PAD.cross);
    assert.ok(await page.locator('[data-setting="reset-room"]').isVisible());
  }
  pass('Confirmation fits portrait and landscape; controller Cross cancels');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-setting="reset-room"]').click();
  await page.route(
    '**/api/reset-room',
    (route) => route.fulfill({ status: 409, json: { error: 'QA write failure' } }),
    { times: 1 },
  );
  await page.locator('#local-reset-accept').click();
  await until(() => page.locator('#local-reset-error').innerText().then(Boolean));
  assert.ok(await page.locator('#local-reset-accept').isEnabled());
  assert.equal(game.rooms.get('RESET-UI'), original);
  pass('Failed reset displays an error and permits retry without changing progress');
  await page.locator('#local-reset-accept').focus();
  await input();
  await tap(PAD.circle);
  await until(
    () => game.rooms.get('RESET-UI') !== original && game.rooms.get('RESET-UI')?.players.size === 2,
  );
  const fresh = game.rooms.get('RESET-UI');
  assert.equal(fresh.camp.level, 0);
  for (const p of fresh.players.values()) {
    assert.ok(!oldIds.includes(p.id));
    assert.equal(p.inventory.berry, 0);
    assert.equal(p.inventory.wood, 0);
    assert.equal(p.tool, false);
    assert.equal(p.gathered, 0);
    assert.ok(p.energy > 99);
  }
  await until(() =>
    page
      .locator('#energy-label')
      .innerText()
      .then((text) => text === '100 / 100'),
  );
  await until(() =>
    observer
      .locator('#energy-label')
      .innerText()
      .then((text) => text === '100 / 100'),
  );
  assert.equal(await page.locator('#day-label').innerText(), '1日目');
  assert.equal(await page.locator('#profile-name').innerText(), 'Reset A');
  assert.equal(await observer.locator('#profile-name').innerText(), 'Reset B');
  assert.equal(await page.locator('#chat-input').count(), 1);
  assert.ok(!(await page.locator('#modal').evaluate((el) => el.open)));
  for (const originalPeer of originals) {
    assert.ok(originalPeer.messages.some((m) => m.type === 'roomReset'));
    const renewed = await peer('RESET-UI', originalPeer.welcome.session);
    assert.equal(renewed.welcome.resumed, false);
  }
  assert.equal(game.rooms.get('OTHER').players.get(other.welcome.id).inventory.wood, 23);
  await page.screenshot({ path: path.join(output, '03-after-reset.png') });
  await observer.screenshot({ path: path.join(output, '04-other-player-reset.png') });
  pass(
    'Five-player room resets and reconnects from zero; names persist and the other room stays intact',
  );
  await page.keyboard.press('i');
  assert.equal(await page.locator('[data-item="berry"]').count(), 0);
  await page.screenshot({ path: path.join(output, '05-empty-inventory.png') });
  await page.reload();
  await page.waitForSelector('body.in-game');
  await until(() =>
    page
      .locator('#online-count')
      .innerText()
      .then((text) => text === '5/5'),
  );
  await game.saveNow();
  const saved = JSON.parse(await readFile(path.join(directory, 'world.json'), 'utf8')).state;
  const savedRoom = saved.rooms.find((r) => r.name === 'RESET-UI');
  assert.equal(savedRoom.camp.level, 0);
  assert.ok(
    savedRoom.sessions.every(
      (s) => s.player.inventory.berry === 0 && s.player.inventory.wood === 0,
    ),
  );
  pass('Reload and the persisted checkpoint both retain the reset progress');
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.stack || String(error));
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        checks,
        errors,
        fixtures:
          'Disposable local persistent host; two Chrome pages, three socket peers in reset room and one peer in untouched room.',
      },
      null,
      2,
    ),
  );
  for (const socket of peers) socket.close();
  await browser?.close();
  await game.close();
}
