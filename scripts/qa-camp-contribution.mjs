import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = `output/playwright/camp-contribution-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(100);
  }
}
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const seen = { state: {}, id: null, commands: [] };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'welcome') seen.id = message.id;
      if (message.type === 'state') seen.state = { ...seen.state, ...message };
    });
    socket.on('framesent', ({ payload }) => seen.commands.push(JSON.parse(String(payload))));
  });
  await page.addInitScript(() => {
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=FIRE-QA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => seen.id && game.rooms.get('FIRE-QA')?.players.has(seen.id), 'join');
  return { page, seen, p: game.rooms.get('FIRE-QA').players.get(seen.id) };
}
async function tap(page, button) {
  await page.bringToFront();
  await page.locator('#world').focus();
  for (const pressed of [false, true, false]) {
    await page.evaluate(
      ({ button, pressed }) => {
        window.qaPad.buttons[button] = { pressed, value: pressed ? 1 : 0 };
      },
      { button, pressed },
    );
    await sleep(180);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
try {
  const a = await open();
  const b = await open();
  const room = game.rooms.get('FIRE-QA');
  // Only this independent test world's position, inventory and camp progress are
  // prepared. The HUD, simulated circle press, wire command and server action are real.
  stopActor(b.p);
  Object.assign(b.p, { x: 45, z: 56 });
  async function prepare(distance, wood, stone, campWood = 0, campStone = 0, level = 0) {
    stopActor(a.p);
    Object.assign(a.p, { x: room.camp.x, z: room.camp.z + distance });
    Object.assign(a.p.inventory, { wood, stone });
    Object.assign(room.camp, { wood: campWood, stone: campStone, level });
    const packet = JSON.stringify(game.snapshot(room, true));
    for (const player of room.players.values()) player.socket.send(packet);
    await sleep(500);
  }
  const hint = a.page.locator('#interaction-hint');
  const shot = (name) =>
    a.page.screenshot({ path: `${folder}/${name}.png`, animations: 'disabled' });

  await prepare(3, 0, 0);
  assert.equal(await hint.isVisible(), false);
  await tap(a.page, 1);
  assert.deepEqual([room.camp.wood, room.camp.stone], [0, 0]);
  await shot('01-empty-no-hint');
  pass('Empty hands show no fire delivery prompt and circle consumes nothing');

  await prepare(4, 10, 6);
  assert.equal(await hint.isVisible(), false);
  await tap(a.page, 1);
  assert.deepEqual([a.p.inventory.wood, a.p.inventory.stone], [10, 6]);
  await shot('02-outside-range');
  pass('Four metres is outside delivery range even with materials');

  await prepare(3.5, 10, 6, 10, 6);
  await until(
    async () =>
      (await hint.isVisible()) && (await hint.innerText()).includes('焚き火に資材を届ける'),
    'valid hint',
  );
  await tap(a.page, 11);
  assert.equal(await hint.locator('kbd').innerText(), '○');
  await shot('03-circle-with-materials');
  const peerBefore = { x: b.p.x, z: b.p.z, inventory: structuredClone(b.p.inventory) };
  await tap(a.page, 1);
  await until(() => room.camp.level === 1 && b.seen.state.camp?.level === 1, 'shared completion');
  assert.deepEqual([room.camp.wood, room.camp.stone], [12, 6]);
  assert.deepEqual([a.p.inventory.wood, a.p.inventory.stone], [8, 6]);
  assert.deepEqual({ x: b.p.x, z: b.p.z, inventory: b.p.inventory }, peerBefore);
  await until(async () => !(await hint.isVisible()), 'completed hint hidden');
  await tap(a.page, 1);
  assert.deepEqual([a.p.inventory.wood, a.p.inventory.stone], [8, 6]);
  assert.equal(
    a.seen.commands.filter((m) => m.type === 'action' && m.action === 'contribute').length,
    1,
  );
  await shot('04-completed-no-hint');
  pass(
    'Circle at 3.5 metres delivers only the missing two wood, synchronizes completion, and hides the prompt despite surplus',
  );

  await prepare(3, 8, 0, 12, 2);
  assert.equal(await hint.isVisible(), false);
  await prepare(3, 0, 3, 12, 2);
  await until(async () => await hint.isVisible(), 'stone-only hint');
  await a.page.setViewportSize({ width: 390, height: 844 });
  await shot('05-stone-only-narrow');
  await tap(a.page, 1);
  await until(() => room.camp.stone === 5, 'stone-only delivery');
  assert.equal(a.p.inventory.stone, 0);
  assert.equal(room.camp.level, 0);
  await until(async () => !(await hint.isVisible()), 'no remaining supplies');
  pass('Only needed materials enable the prompt; stone alone works on a narrow screen');
  assert.deepEqual(errors, []);
  console.log(`Evidence: ${folder}`);
} finally {
  await writeFile(`${folder}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
  await game.close();
}
