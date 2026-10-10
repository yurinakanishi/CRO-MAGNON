// Isolated in-memory server. Never opens or edits the user's save.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { BOT_KINDS, ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/dot-friendship/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const contexts = [],
  peers = [],
  errors = [],
  checks = [],
  roomName = 'DOT-FRIEND-QA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
let room, a, b, failure;
const own = (user) => room.orbBots.filter((bot) => bot.ownerId === user.seen.id);
const bot = (kind) => room.orbBots.find((b) => b.kind === kind);
async function start(page) {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  const page = await context.newPage(),
    seen = { id: null, state: {}, pets: [], hands: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    }),
  );
  await page.addInitScript((name) => localStorage.setItem('cro-name', name), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nconst dotRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const r=dotRender.apply(this,args);window.qa=this;window.dotFrames??=[];const p=this.state.orbBots?.find(b=>b.petPlayerId===this.selfId);if(p){const actor=this.players.get(this.selfId)?.actor;dotFrames.push({id:p.id,owner:p.ownerId,contactAt:p.petContactAt,time:this.serverNow(),weight:actor?.groundPettingPose.weight,handGap:actor?.groundPettingPose.contact.distanceTo(actor.groundPettingPose.requested),hearts:this.orbBotRenderer?.bots.get(p.id)?.hearts?.filter(h=>h.visible).length??0});if(dotFrames.length>3000)dotFrames.shift();}return r;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  try {
    await start(page);
  } catch (error) {
    await page.screenshot({ path: `${out}/load-failure-${name.replaceAll(' ', '-')}.png` });
    throw error;
  }
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  await page.waitForFunction(() => window.qa?.orbBotRenderer?.bots.size === 9, null, {
    timeout: 60000,
  });
  return {
    page,
    seen,
    get p() {
      return game.rooms.get(roomName).players.get(seen.id);
    },
  };
}
async function place(user, at, offset = -0.43) {
  stopActor(user.p);
  Object.assign(user.p, {
    x: at.x,
    z: at.z + offset,
    facing: 0,
    warpSequence: (user.p.warpSequence ?? 0) + 1,
  });
  await sleep(650);
  await user.page.locator('#world').focus();
}
async function pet(user, kind) {
  const target = bot(kind);
  await place(user, target);
  const targetOnScreen = await user.page.evaluate((id) => {
    const q = window.qa,
      v = q.orbBotRenderer.bots.get(id).actor.root.position.clone();
    v.y += 0.14;
    v.project(q.camera);
    const r = q.canvas.getBoundingClientRect();
    return { x: r.x + ((v.x + 1) * r.width) / 2, y: r.y + ((1 - v.y) * r.height) / 2 };
  }, target.id);
  await user.page.mouse.click(targetOnScreen.x, targetOnScreen.y);
  await until(() => target.petPlayerId === user.seen.id, `pet starts ${kind}`);
  assert.notEqual(target.ownerId, user.seen.id);
  if (kind === 'white') {
    await until(() => target.petContactAt, 'white stroke');
    await sleep(350);
    await user.page.screenshot({ path: `${out}/petting-white.png` });
  }
  await until(() => target.ownerId === user.seen.id, `pet completes ${kind}`);
  await until(
    () =>
      [a, b, ...peers].every(
        (viewer) =>
          viewer.seen.state.orbBots?.find((x) => x.id === target.id)?.ownerId === user.seen.id,
      ),
    `all see ${kind}`,
  );
}
async function menu(user) {
  await user.page.keyboard.press('Escape');
  await user.page.locator('[data-controller-menu="bots"]').click();
}
async function closeMenu(user) {
  await user.page.locator('#modal-close').click();
  await user.page.locator('#world').focus();
}
try {
  a = await open('Dot A');
  room = game.rooms.get(roomName);
  room.enemies = [];
  b = await open('Dot B');
  await place(b, { x: 55, z: 55 });
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=DotObserver${i}`),
      seen = { state: {} };
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
  assert.equal(room.players.size, 5);
  assert.equal(room.orbBots.length, 9);
  assert.equal(own(a).length, 0);
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind]').count(), 0);
  assert.ok((await a.page.locator('[data-bot-status]').textContent()).includes('ひとり'));
  assert.ok(await a.page.locator('[data-bot-action="use"]').isDisabled());
  await closeMenu(a);
  const homes = room.orbBots.map((b) => ({ id: b.id, x: b.x, z: b.z }));
  await a.page.keyboard.press('c');
  await a.page.keyboard.press('q');
  await sleep(400);
  assert.deepEqual(
    room.orbBots.map((b) => ({ id: b.id, x: b.x, z: b.z })),
    homes,
  );
  pass(
    '5 connections: 9 shared home dots, no automatic followers, empty menu and no-op throw/recall',
  );
  await place(a, bot('white'));
  await a.page.keyboard.press('v');
  await until(() => bot('white').busy, 'start interrupted pet');
  await a.page.keyboard.down('w');
  await sleep(400);
  await a.page.keyboard.up('w');
  await until(() => !bot('white').busy, 'movement cancels');
  assert.equal(bot('white').ownerId, '');
  await until(() => bot('white').mode === 'home', 'cancelled dot home');
  pass('movement cancels pet without recruitment');
  await pet(a, 'white');
  await sleep(500);
  await a.page.screenshot({ path: `${out}/one-friend.png` });
  const frames = await a.page.evaluate(() => window.dotFrames);
  assert.ok(frames.some((f) => f.weight > 0.99 && f.handGap < 0.045));
  assert.ok(frames.some((f) => f.hearts > 0));
  assert.equal(own(a).length, 1);
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind]').count(), 1);
  await closeMenu(a);
  await a.page.keyboard.press('c');
  await until(() => bot('white').mode === 'waiting', 'throw then wait');
  await a.page.keyboard.press('q');
  await until(() => bot('white').mode === 'following', 'recall');
  pass(
    'Individual click pet: crouched hand contact, hearts, one menu member, C throw and Q recall',
  );
  for (const kind of BOT_KINDS.slice(1)) await pet(a, kind);
  await sleep(800);
  assert.equal(own(a).length, 9);
  await a.page.screenshot({ path: `${out}/nine-friends.png` });
  pass('all 9 dots recruited individually through mesh clicks and shared by 5 clients');
  await pet(b, 'heart');
  assert.equal(own(a).length, 8);
  assert.equal(own(b).length, 1);
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind="heart"]').count(), 0);
  await a.page.locator('[data-bot-kind="blue"]').click();
  await a.page.locator('[data-bot-action="dismiss"]').click();
  await until(() => !bot('blue').ownerId, 'selected blue dismissed');
  assert.equal(own(a).length, 7);
  assert.equal(bot('heart').ownerId, b.seen.id);
  await menu(a);
  await a.page.locator('[data-bot-action="dismissAll"]').click();
  await until(() => own(a).length === 0, 'all dismissed');
  assert.equal(own(b).length, 1);
  pass('completed pet transfers one dot; selected/all return cannot dismiss another player’s dot');
  await b.page.keyboard.press('Escape');
  await b.page.locator('[data-controller-menu="travelAlone"]').click();
  await until(
    () => room.orbBots.every((b) => b.mode === 'home' && !b.ownerId),
    'all original homes',
    40000,
  );
  assert.ok(room.orbBots.every((b) => Math.hypot(b.x - b.home.x, b.z - b.home.z) < 0.01));
  await pet(a, 'frog');
  await sleep(700);
  const owner = a.seen.id;
  await a.page.reload();
  await start(a.page);
  await until(() => a.seen.id === owner && room.players.has(owner), 'same saved player');
  assert.equal(bot('frog').ownerId, owner);
  assert.equal(own(a).length, 1);
  pass(
    'solo action returns the last dot to its original home; re-petting and browser rejoin keep one bond',
  );
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(size);
    await menu(a);
    const button = a.page.locator('[data-bot-action="dismissAll"]');
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= size.width + 1);
    await a.page.screenshot({ path: `${out}/menu-${size.width}.png` });
    await closeMenu(a);
  }
  await a.page.setViewportSize({ width: 1280, height: 800 });
  await menu(a);
  await a.page.screenshot({ path: `${out}/menu-desktop.png` });
  await a.page.locator('[data-bot-action="dismissAll"]').click();
  await until(() => own(a).length === 0, 'final empty');
  pass('desktop, phone portrait and landscape: reachable return controls and solo state');
  assert.equal(errors.length, 0, errors.join('\n'));
  pass('no browser console/page errors');
  await writeFile(`${out}/pet-frames.json`, JSON.stringify(frames, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
  if (a) await a.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        ok: !failure,
        checks,
        errors,
        failure: failure?.stack,
        homes: room?.orbBots.map((b) => ({
          kind: b.kind,
          home: b.home,
          mode: b.mode,
          ownerId: b.ownerId,
        })),
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.ws.close();
  await browser.close();
  await game.close();
  console.log('Evidence:', out);
  if (failure) process.exitCode = 1;
}
