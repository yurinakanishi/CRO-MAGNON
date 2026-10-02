// Real-time full-body turns in two Chrome clients plus three peers, without a user save.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { WebSocket } from 'ws';
import { BOT_ORDER, botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/bot-spin/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const roomName = 'BOT-SPIN-QA',
  viewers = [],
  peers = [],
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
        `
const renderSpin=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){const value=renderSpin.apply(this,args);window.qa=this;window.spinFrames??=[];
const now=this.serverNow();
for(const b of this.state.orbBots??[]){if(b.ownerId!==window.spinOwner)continue;
const root=b.kind==='524'?this.companion524Renderer.tilt:this.orbBotRenderer.bots.get(b.id)?.actor.root;
if(!root)continue;
spinFrames.push({now,kind:b.kind,mode:b.mode,sequence:b.sequence,pitch:root.rotation.x,phase:(now-b.throwAt-260)/900});}
if(spinFrames.length>10000)spinFrames.splice(0,spinFrames.length-10000);return value;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
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
  owner = await open('Spin owner');
  room = game.rooms.get(roomName);
  room.enemies = [];
  const observer = await open('Spin observer');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Peer${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five clients');
  for (const viewer of viewers)
    await viewer.page.evaluate((id) => {
      window.spinOwner = id;
    }, owner.p.id);
  const c = room.companion524;
  await stage(owner, c.x, c.z + 1.6, Math.PI);
  await stage(observer, c.x + 3, c.z + 2, 0);
  await owner.page.locator('#world').focus();
  await owner.page.keyboard.press('v');
  await until(() => c.squadPlayerId === owner.p.id && owned().length === 10, 'recruit 524');
  let site;
  for (let x = 35; x < 67 && !site; x++)
    for (let z = 54; z < 67; z++) {
      const p = { ...owner.p, x, z, facing: 0 },
        plan = botThrowPlan(p, room.collision);
      if (room.collision.free(p, 0.9) && plan && plan.landing.z - z > 7.5) {
        site = { x, z };
        break;
      }
    }
  assert.ok(site);
  await stage(owner, site.x, site.z, 0);
  await stage(observer, site.x + 3, site.z, Math.PI);
  await owner.page.evaluate(() => {
    qa.yaw = Math.PI + 0.25;
    qa.pitch = 0.28;
    qa.targetDistance = 7.5;
  });
  await checkFacing('initial formation faces forward');
  await owner.page.locator('#world').focus();
  for (let i = 0; i < 10; i++) {
    await owner.page.keyboard.press('c');
    await sleep(35);
  }
  await owner.page.screenshot({ path: `${out}/dots-in-flight.png` });
  await until(
    () => owned().find((bot) => bot.kind === '524')?.mode === 'airborne',
    '524 in flight',
  );
  await sleep(350);
  await owner.page.screenshot({ path: `${out}/524-in-flight.png` });
  await until(() => owned().every((bot) => bot.mode === 'waiting'), 'ten landed bots');
  await sleep(350);
  for (const [index, viewer] of viewers.entries()) {
    const frames = await viewer.page.evaluate(() => window.spinFrames ?? []);
    await writeFile(`${out}/frames-${index}.json`, JSON.stringify(frames));
    for (const kind of BOT_ORDER) {
      const flight = frames.filter(
        (f) => f.kind === kind && f.sequence === 1 && f.mode === 'airborne',
      );
      assert.ok(flight.length >= 5, `${kind}: at least five rendered flight poses`);
      const angles = flight.map((f) => f.pitch),
        min = Math.min(...angles),
        max = Math.max(...angles);
      assert.ok(min < 0.7 && max > 5.7, `${kind}: complete visible turn ${min}..${max}`);
      assert.ok(
        angles.some((a) => a > 2.5 && a < 3.8),
        `${kind}: visibly upside down`,
      );
      assert.ok(
        angles.every(
          (a, i) => a >= 0 && a <= Math.PI * 2 && (i === 0 || a >= angles[i - 1] - 1e-9),
        ),
        `${kind}: turns once without a loop reset`,
      );
      const landed = frames.filter((f) => f.kind === kind && f.mode === 'waiting');
      assert.ok(
        landed.length > 0 && landed.every((f) => f.pitch === 0),
        `${kind}: upright on landing`,
      );
      records.push({
        viewer: index,
        kind,
        flightFrames: flight.length,
        minPitch: min,
        maxPitch: max,
      });
    }
  }
  console.log('PASS all ten companions turn once and land upright in both Chrome clients');
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
  for (const facing of [Math.PI / 2]) {
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
          'Two Chrome clients plus three protocol peers, nine dots and recruited 524; real UI throw/recall. Positions, player headings and camera are isolated QA fixtures. No user save.',
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, passed: !failure, records: records.length }));
if (failure) process.exitCode = 1;
