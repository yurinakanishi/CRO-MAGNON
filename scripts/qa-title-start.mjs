import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPersistentGameServer } from '../dist/server.mjs';
import { characterModel } from '../dist/shared/characters.mjs';
import { parseCharacterValue } from '../dist/src/character-selection.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = `output/playwright/title-start-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = await createPersistentGameServer({
  host: '127.0.0.1',
  port: 0,
  saveDirectory: `${folder}/save`,
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(100);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
async function select(page, character, difficulty) {
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator(`#setup-flow [data-choose-difficulty="${difficulty}"]`).click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await page
    .locator(`#world[data-player-model="${characterModel(parseCharacterValue(character)).key}"]`)
    .waitFor({ timeout: 90000 });
}
async function shot(page, name) {
  await page.screenshot({ path: `${folder}/${name}.png`, animations: 'disabled' });
}
async function title(page) {
  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#screen-title').waitFor({ state: 'visible' });
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?room=TITLE-QA`);
  assert.equal(await page.locator('#screen-title').isVisible(), true);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill(name);
  await select(page, 'cro-female', 'normal');
  await until(
    () => [...(game.rooms.get('TITLE-QA')?.players.values() ?? [])].some((p) => p.name === name),
    'player joined',
  );
  return {
    context,
    page,
    player: [...game.rooms.get('TITLE-QA').players.values()].find((p) => p.name === name),
  };
}
try {
  const a = await open('TitleA');
  await shot(a.page, '01-started');
  pass('Game renders in Chrome without an error overlay');
  const b = await open('TitleB');
  const room = game.rooms.get('TITLE-QA');
  // Explicit preparation only: inventory and resource fixtures. Movement and all
  // title/menu/reconnect actions below use the real browser or connection.
  a.player.inventory.wood = 8;
  a.player.inventory.stone = 3;
  a.player.inventory.shells = 4;
  room.resources[0].amount = 1;
  room.camp.wood = 7;
  await game.saveNow();
  const inventory = structuredClone(a.player.inventory);
  const peerBefore = {
    x: b.player.x,
    z: b.player.z,
    inventory: structuredClone(b.player.inventory),
  };
  await a.page.locator('#world').focus();
  await a.page.keyboard.down('s');
  await sleep(1500);
  await a.page.keyboard.up('s');
  await sleep(350);
  const moved = { x: a.player.x, z: a.player.z };
  assert.ok(Math.hypot(moved.x - 48, moved.z - 57) > 0.5);
  await title(a.page);
  await until(() => room.players.size === 1, 'one peer remains in game');
  assert.equal(b.player.socket.readyState, 1);
  await a.page.locator('#title-start').click();
  assert.equal(await a.page.locator('#screen-setup').isVisible(), true);
  assert.equal(room.players.size, 1, 'no join before confirmation');
  await shot(a.page, '02-select-again');
  await a.page.locator('#setup-back').click();
  await a.page.locator('#title-start').click();
  await a.page.locator('#setup-form .character-choice:has(input[value="bear-female"])').click();
  await shot(a.page, '03-difficulty');
  await a.page.locator('#setup-flow [data-choose-difficulty="hard"]').click();
  await a.page.locator('#setup-flow-no').click();
  await a.page.locator('#setup-flow [data-choose-difficulty="easy"]').click();
  await a.page.locator('#setup-flow-yes').click();
  await until(() => room.players.has(a.player.id), 'title start reconnects');
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await a.page
    .locator('#world[data-player-model="desert-fennec-mage"]')
    .waitFor({ timeout: 90000 });
  assert.equal(a.player.species, 'bear');
  assert.equal(a.player.difficulty, 'easy');
  assert.ok(Math.hypot(a.player.x - 49.1, a.player.z - 58) < 1);
  assert.ok(Math.hypot(a.player.x - moved.x, a.player.z - moved.z) > 0.5);
  assert.deepEqual(a.player.inventory, inventory);
  assert.deepEqual({ x: b.player.x, z: b.player.z, inventory: b.player.inventory }, peerBefore);
  assert.equal(room.camp.wood, 7);
  assert.equal(room.resources[0].amount, 1);
  await shot(a.page, '04-new-character-at-camp');
  pass(
    'Title Start always asks character and difficulty, supports Back, and returns to camp with supplies and the peer unchanged',
  );

  await a.page.locator('#world').focus();
  await a.page.keyboard.down('s');
  await sleep(1200);
  await a.page.keyboard.up('s');
  await sleep(350);
  const resumePosition = { x: a.player.x, z: a.player.z };
  const oldSocket = a.player.socket;
  oldSocket.terminate();
  await until(
    () => a.player.socket !== oldSocket && room.players.has(a.player.id),
    'automatic reconnection',
  );
  assert.deepEqual({ x: a.player.x, z: a.player.z }, resumePosition);
  assert.equal(await a.page.locator('#screen-setup').isVisible(), false);
  assert.equal(a.player.species, 'bear');
  assert.deepEqual(a.player.inventory, inventory);
  pass('A dropped connection resumes in place without setup or losing items');

  await title(a.page);
  await a.page.reload();
  await a.page.locator('#title-start').click();
  await a.page.setViewportSize({ width: 390, height: 844 });
  await shot(a.page, '05-small-setup');
  await select(a.page, 'cat-female', 'hard');
  await until(() => room.players.has(a.player.id) && a.player.species === 'cat', 'second start');
  assert.equal(a.player.difficulty, 'hard');
  assert.deepEqual(a.player.inventory, inventory);
  assert.ok(Math.hypot(a.player.x - 49.1, a.player.z - 58) < 1);
  pass(
    'Repeated title starts and a reload retain possessions and reopen selection on a narrow screen',
  );
  assert.deepEqual(errors, []);
  console.log(`Evidence: ${folder}`);
} finally {
  await writeFile(`${folder}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
  await game.close();
}
