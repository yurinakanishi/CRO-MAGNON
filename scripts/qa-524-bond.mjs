// Two real Chrome clients and an isolated on-disk save; never touches the user's world.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createPersistentGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/524-bond/${Date.now()}`;
await mkdir(out, { recursive: true });
const options = { port: 0, host: '127.0.0.1', saveDirectory: `${out}/save`, saveIntervalMs: 1000 };
let game = await createPersistentGameServer(options);
let { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const roomName = '524-BOND-QA',
  viewers = [],
  records = [],
  errors = [],
  reconnectMessages = [];
let restarting = false,
  failure,
  owner,
  observer;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
const room = () => game.rooms.get(roomName);
const player = (viewer) => room().players.get(viewer.id);
const bots = () => room().orbBots.filter((bot) => bot.ownerId === owner.id);
const bot524 = () => bots().find((bot) => bot.kind === '524');
async function enter(viewer) {
  await viewer.page.locator('#title-start').click();
  await viewer.page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await viewer.page.locator('#setup-flow-yes').click();
  await viewer.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await viewer.page.waitForFunction(() => window.qa?.companion524Renderer?.actor);
  await until(() => viewer.id && room()?.players.has(viewer.id), 'join');
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const viewer = { page, id: null };
  viewers.push(viewer);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (restarting && /WebSocket|ERR_CONNECTION_REFUSED/.test(text)) reconnectMessages.push(text);
    else errors.push(text);
  });
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'welcome') viewer.id = message.id;
    }),
  );
  await page.addInitScript((value) => localStorage.setItem('cro-name', value), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst renderBond=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const value=renderBond.apply(this,args);window.qa=this;return value;};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await enter(viewer);
  return viewer;
}
async function stage(viewer, x, z, facing) {
  stopActor(player(viewer));
  Object.assign(player(viewer), {
    x,
    z,
    facing,
    warpSequence: (player(viewer).warpSequence ?? 0) + 1,
  });
  await sleep(600);
}
async function viewState(viewer) {
  return viewer.page.evaluate(
    (ownerId) => ({
      companion: qa.state.companion524,
      bots: qa.state.orbBots.filter((b) => b.ownerId === ownerId),
      rendered: qa.companion524Renderer.diagnostics(),
      models524: qa.scene.children.filter((node) => node.name === '524 floating companion').length,
    }),
    owner.id,
  );
}
async function check(label, mode) {
  await until(() => bot524()?.mode === mode && bots().length === 10, label);
  const views = [];
  for (const viewer of viewers) {
    await until(async () => {
      const v = await viewState(viewer);
      return (
        v.companion.squadPlayerId === owner.id &&
        v.bots.length === 10 &&
        v.rendered.squadMode === mode &&
        v.rendered.visible
      );
    }, `${label}: rendered`);
    const view = await viewState(viewer);
    assert.equal(view.models524, 1);
    views.push(view);
  }
  records.push({ label, mode, views });
  console.log('PASS', label);
}
async function volley(label) {
  await owner.page.locator('#world').focus();
  for (let i = 0; i < 10; i++) {
    await owner.page.keyboard.press('c');
    await sleep(45);
  }
  await until(() => bots().length === 10 && bots().every((b) => b.mode === 'waiting'), label);
  await check(label, 'waiting');
}
async function recall(label) {
  await owner.page.locator('#world').focus();
  await owner.page.keyboard.press('q');
  await until(
    () => bots().length === 10 && bots().every((b) => b.mode === 'following' && b.speed === 0),
    label,
  );
  await check(label, 'following');
}
try {
  owner = await open('Bond owner');
  room().enemies = [];
  observer = await open('Bond observer');
  const c = room().companion524;
  await stage(owner, c.x, c.z + 1.6, Math.PI);
  await stage(observer, c.x + 3, c.z + 2, 0);
  await owner.page.locator('#world').focus();
  await owner.page.keyboard.press('v');
  await until(() => c.squadPlayerId === owner.id, 'one completed pet');
  player(owner).inventory.wood = 7;
  await stage(owner, 50, 50, 0);
  await stage(observer, 54, 51, Math.PI);
  await check('one pet gives a tenth companion', 'following');
  await volley('all ten are throwable');
  const waiting = { x: c.x, z: c.z };
  const firstId = owner.id;
  await owner.page.reload();
  await enter(owner);
  assert.equal(owner.id, firstId);
  assert.equal(room().companion524.petSequence, 1);
  assert.equal(player(owner).inventory.wood, 7);
  await check('reload preserves the bond and the waiting spot', 'waiting');
  assert.deepEqual({ x: c.x, z: c.z }, waiting);
  await recall('reload needs only a call, no second pet');
  await stage(owner, 50, 50, 0);
  await volley('524 can be thrown again after reload');
  const beforeRestart = { x: c.x, z: c.z };
  restarting = true;
  await game.close();
  const saved = JSON.parse(await readFile(`${out}/save/world.json`, 'utf8')).state;
  const savedRoom = saved.rooms.find((r) => r.name === roomName);
  assert.equal(savedRoom.companion524.squadPlayerId, firstId);
  assert.equal(savedRoom.companion524.squadMode, 'waiting');
  game = await createPersistentGameServer({ ...options, port });
  await game.listen();
  await until(
    () => room()?.players.has(firstId) && room()?.players.has(observer.id),
    'automatic reconnect after restart',
    45000,
  );
  restarting = false;
  await check('disk save and server restart preserve the waiting 524', 'waiting');
  assert.deepEqual({ x: room().companion524.x, z: room().companion524.z }, beforeRestart);
  assert.equal(player(owner).inventory.wood, 7);
  await recall('524 rejoins without petting after server restart');
  await volley('ten throws still work after server restart');
  await recall('all ten return after the final volley');
  await owner.page.evaluate(() => {
    qa.yaw = 0.8;
    qa.pitch = 0.28;
    qa.setZoom(2);
  });
  await owner.page.screenshot({ path: `${out}/reconnected-with-524.png` });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (owner) await owner.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: !failure,
        records,
        errors,
        reconnectMessages,
        failure,
        scope:
          'Two Chrome clients; actual pet/C/Q/reload and private on-disk server restart. Only positions and inventory are QA fixtures. Long elapsed time is covered by the deterministic domain tests, not a wall-clock soak.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, passed: !failure, records: records.length }));
if (failure) process.exitCode = 1;
