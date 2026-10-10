// Real-time recall and rendered headings in an isolated game with no user save.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/bot-facing/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const roomName = 'BOT-FACING-QA',
  viewers = [],
  records = [],
  errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const viewer = { page, seen: {} };
  viewers.push(viewer);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'welcome') viewer.seen.id = message.id;
    }),
  );
  await page.addInitScript((value) => localStorage.setItem('cro-name', value), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst renderFacing=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const value=renderFacing.apply(this,args);window.qa=this;return value;};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.qa?.companion524Renderer?.actor);
  await until(
    () => viewer.seen.id && game.rooms.get(roomName)?.players.has(viewer.seen.id),
    'join',
  );
  viewer.p = game.rooms.get(roomName).players.get(viewer.seen.id);
  return viewer;
}
let room, owner, failure;
const owned = () => room.orbBots.filter((bot) => bot.ownerId === owner.p.id);
async function stage(viewer, x, z, facing) {
  stopActor(viewer.p);
  Object.assign(viewer.p, {
    x,
    z,
    facing,
    warpSequence: (viewer.p.warpSequence ?? 0) + 1,
  });
  await sleep(700);
}
async function rendered(viewer) {
  return viewer.page.evaluate((ownerId) => {
    const p = qa.players.get(ownerId);
    const bots = [...qa.orbBotRenderer.bots.values()]
      .filter((entry) => entry.state.ownerId === ownerId)
      .map(({ actor, state }) => ({
        kind: state.kind,
        mode: state.mode,
        visible: actor.root.visible,
        facing: actor.root.rotation.y,
      }));
    const c = qa.companion524Renderer;
    bots.push({
      kind: '524',
      mode: c.diagnostics().squadMode,
      visible: c.root.visible,
      facing: c.root.rotation.y,
    });
    return { playerFacing: p.model.rotation.y, bots };
  }, owner.p.id);
}
async function checkFacing(label) {
  await until(
    () =>
      owned().every(
        (bot) =>
          bot.mode === 'following' &&
          bot.speed === 0 &&
          Math.cos(bot.facing - owner.p.facing) > 0.999999,
      ),
    label,
  );
  for (const bot of owned()) assert.ok(Math.cos(bot.facing - owner.p.facing) > 0.999999);
  for (const [index, viewer] of viewers.entries()) {
    await until(async () => {
      const view = await rendered(viewer);
      return (
        view.bots.length === 10 &&
        view.bots.every(
          (bot) =>
            bot.visible &&
            bot.mode === 'following' &&
            Math.cos(bot.facing - view.playerFacing) > 0.9999,
        )
      );
    }, `${label}: rendered headings in view ${index}`);
    records.push({
      label,
      viewer: index,
      serverFacing: owner.p.facing,
      ...(await rendered(viewer)),
    });
  }
  console.log('PASS', label);
}
try {
  owner = await open('Facing owner');
  room = game.rooms.get(roomName);
  room.enemies = [];
  const observer = await open('Facing observer');
  const c = room.companion524;
  await stage(owner, c.x, c.z + 1.6, Math.PI);
  await stage(observer, c.x + 3, c.z + 2, 0);
  await owner.page.locator('#world').focus();
  await owner.page.keyboard.press('v');
  await until(() => c.squadPlayerId === owner.p.id && owned().length === 10, 'recruit 524');
  await stage(owner, 50, 50, 0);
  await stage(observer, 54, 51, Math.PI);
  await owner.page.evaluate(() => {
    qa.yaw = 0.8;
    qa.pitch = 0.28;
    qa.setZoom(2);
  });
  await checkFacing('initial formation faces forward');
  await owner.page.locator('#world').focus();
  for (let i = 0; i < 10; i++) {
    await owner.page.keyboard.press('c');
    await sleep(35);
  }
  await until(() => owned().every((bot) => bot.mode === 'waiting'), 'ten landed bots');
  const waiting = owned().map(({ id, x, z, facing }) => ({ id, x, z, facing }));
  owner.p.facing = 0.7;
  await sleep(650);
  assert.deepEqual(
    owned().map(({ id, x, z, facing }) => ({ id, x, z, facing })),
    waiting,
  );
  owner.p.facing = 0;
  await sleep(250);
  await owner.page.keyboard.press('q');
  await checkFacing('ten recalled companions face forward in both clients');
  await owner.page.screenshot({ path: `${out}/recalled-front.png` });
  for (const facing of [Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
    owner.p.facing = facing;
    await checkFacing(`formation turned to ${facing.toFixed(3)} radians`);
  }
  await owner.page.screenshot({ path: `${out}/turned-front.png` });
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
        failure,
        scope:
          'Two Chrome clients, nine dots and recruited 524; real UI throw/recall. Positions, player headings and camera are isolated QA fixtures. No user save.',
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
