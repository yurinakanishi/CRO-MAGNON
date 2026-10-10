// Isolated, in-memory room. The normal server and the user's saves are never modified.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/bot-group-petting/${Date.now()}`;
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
const peers = [],
  errors = [],
  checks = [],
  roomName = 'GROUP-PET-QA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(25);
  }
}
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let room, a, b, failure;
const own = (user) => room.orbBots.filter((bot) => bot.ownerId === user.seen.id);
const pets = (user) => room.orbBots.filter((bot) => bot.petPlayerId === user.seen.id);
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
  const page = await context.newPage(),
    seen = { id: null, state: {}, history: [], sent: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.sent.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') {
        seen.state = m;
        seen.history.push(m.orbBots);
      }
    });
  });
  await page.addInitScript((name) => localStorage.setItem('cro-name', name), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
const originalGroupRender=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){
  const result=originalGroupRender.apply(this,args);window.qa=this;window.groupFrames??=[];
  const pets=this.state.orbBots?.filter(b=>b.petGroupLeaderId&&b.petPlayerId)??[];
  if(pets.length){
    const lead=pets.find(b=>b.id===b.petGroupLeaderId);const pose=this.players.get(lead?.petPlayerId)?.actor?.groundPettingPose;
    groupFrames.push({time:this.serverNow(),petAt:lead?.petAt,contactAt:lead?.petContactAt,
      target:lead?.id,player:lead?.petPlayerId,count:pets.length,weight:pose?.weight,
      handGap:pose?.contact.distanceTo(pose.requested),
      hearts:pets.map(b=>({id:b.id,visible:this.orbBotRenderer.bots.get(b.id)?.hearts?.filter(h=>h.visible).length??0})),
      visible:pets.filter(b=>this.orbBotRenderer.bots.get(b.id)?.actor.root.visible).length});
    if(groupFrames.length>3000)groupFrames.shift();
  }
  return result;
};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await start(page);
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
async function place(user, at) {
  stopActor(user.p);
  Object.assign(user.p, {
    x: at.x,
    z: at.z,
    facing: 0,
    warpSequence: (user.p.warpSequence ?? 0) + 1,
  });
  await sleep(700);
  await user.page.locator('#world').focus();
}
async function menu(user) {
  await user.page.keyboard.press('Escape');
  await user.page.locator('[data-controller-menu="bots"]').click();
}
async function closeMenu(user) {
  await user.page.locator('#modal-close').click();
  await user.page.locator('#world').focus();
}
async function group(user, trigger, count = 9, picture = false) {
  const before = user.seen.sent.length;
  await trigger();
  await until(() => pets(user).length === count, 'all group members start together');
  const selected = [...pets(user)],
    started = selected[0].petAt;
  assert.equal(new Set(selected.map((bot) => bot.petAt)).size, 1);
  assert.equal(new Set(selected.map((bot) => bot.petGroupLeaderId)).size, 1);
  await until(() => selected.every((bot) => bot.petContactAt), 'all arrive for one stroke');
  assert.equal(new Set(selected.map((bot) => bot.petContactAt)).size, 1);
  const contact = selected[0].petContactAt;
  if (picture) {
    await user.page.screenshot({ path: `${out}/all-petting.png` });
    await until(() => Date.now() > contact + ORB_BOTS.petStrokeMs + 180, 'hearts start together');
    await user.page.screenshot({ path: `${out}/all-hearts.png` });
  }
  await until(
    () => selected.every((bot) => !bot.petPlayerId && bot.ownerId === user.seen.id),
    'all complete together',
  );
  await until(
    () =>
      [a, b, ...peers].every((viewer) =>
        selected.every((bot) =>
          viewer.seen.state.orbBots?.some(
            (x) => x.id === bot.id && x.ownerId === user.seen.id && !x.petPlayerId,
          ),
        ),
      ),
    'all five observers receive ownership',
  );
  await user.page.waitForFunction(
    () => !window.qa.state.orbBots.some((bot) => bot.petPlayerId === window.qa.selfId),
  );
  const commands = user.seen.sent.slice(before).filter((m) => m.action === 'petBots');
  assert.equal(commands.length, 1, 'one input sends one group command');
  return started;
}
try {
  a = await open('Group A');
  room = game.rooms.get(roomName);
  room.enemies = [];
  b = await open('Group B');
  await place(b, { x: 48.5, z: 54 });
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=GroupObserver${i}`),
      seen = { state: {}, history: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'state') {
        seen.state = m;
        seen.history.push(m.orbBots);
      }
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  assert.equal(room.players.size, 5);
  await place(a, { x: 44.75, z: 54.25 });
  for (const viewer of [a, b, ...peers]) viewer.seen.history = [];
  const started = await group(a, () => a.page.keyboard.press('v'), 9, true);
  for (const viewer of [a, b, ...peers]) {
    const counts = viewer.seen.history.map(
      (bots) => bots?.filter((bot) => bot.ownerId === a.seen.id).length ?? 0,
    );
    assert.ok(counts.includes(9));
    assert.ok(
      counts.every((n) => n === 0 || n === 9),
      'no partial group on any client',
    );
  }
  for (const user of [a, b]) {
    const frames = await user.page.evaluate(() => window.groupFrames);
    const gesture = frames.filter((frame) => frame.petAt === started);
    await writeFile(
      `${out}/frames-${user === a ? 'a' : 'b'}.json`,
      JSON.stringify(gesture, null, 2),
    );
    assert.ok(
      gesture.some((f) => f.count === 9 && f.visible === 9 && f.hearts.every((h) => h.visible > 0)),
      'all nine display hearts in the same rendered frame',
    );
    assert.equal(
      new Set(gesture.map((f) => f.target)).size,
      1,
      'the single gesture never changes its target',
    );
    assert.ok(
      gesture.some((f) => f.weight > 0.99 && f.handGap < 0.045),
      'one crouched hand reaches the group',
    );
  }
  pass(
    'One V press: 9 concurrent approaches, one shared stroke, simultaneous rendered hearts on 2 screens, atomic recruitment on all 5 clients',
  );
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind]').count(), 9);
  await group(a, () => a.page.locator('[data-bot-action="petAll"]').click());
  assert.equal(own(a).length, 9);
  pass('Menu button repeats one simultaneous group gesture for all existing companions');
  await a.page.evaluate(() => {
    window.qaPad = {
      id: 'Group pet standard pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [qaPad] });
  });
  await sleep(400);
  await group(a, () =>
    a.page.evaluate(async () => {
      qaPad.buttons[0] = { pressed: true, value: 1 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      qaPad.buttons[0] = { pressed: false, value: 0 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    }),
  );
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  pass('Simulated controller: one bottom-button press starts the same simultaneous group gesture');
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('v');
  await until(() => pets(a).length === 9, 'repeat group');
  await a.page.keyboard.press('q');
  await until(() => pets(a).length === 0, 'Q interrupts whole group');
  assert.equal(own(a).length, 9);
  await sleep(600);
  await a.page.keyboard.press('c');
  await until(() => own(a).some((bot) => bot.mode === 'waiting'), 'C still throws');
  await a.page.keyboard.press('q');
  await until(() => own(a).every((bot) => bot.mode === 'following'), 'Q still recalls');
  pass('Q cancels the whole re-pet without losing bonds; C throw and Q recall still work');
  await menu(a);
  await a.page.locator('[data-bot-action="dismissAll"]').click();
  await until(
    () => room.orbBots.every((bot) => !bot.ownerId && bot.mode === 'home'),
    'all return home',
  );
  await place(a, { x: 44.75, z: 54.25 });
  await a.page.keyboard.press('v');
  await until(
    () => pets(a).length === 9 && pets(a).every((bot) => bot.petContactAt),
    'stroke before movement',
  );
  await a.page.keyboard.down('w');
  await sleep(250);
  await a.page.keyboard.up('w');
  await until(() => !pets(a).length, 'movement cancels entire group');
  assert.equal(own(a).length, 0);
  await until(() => room.orbBots.every((bot) => bot.mode === 'home'), 'interrupted group home');
  pass('Walking during the shared stroke cancels all 9; no partial new ownership');
  // Actual mesh click keeps the existing individual pet/transfer interaction.
  const white = room.orbBots.find((bot) => bot.kind === 'white');
  await place(b, { x: white.x, z: white.z - 0.7 });
  const target = await b.page.evaluate((id) => {
    const q = window.qa,
      v = q.orbBotRenderer.bots.get(id).actor.root.position.clone();
    v.y += 0.14;
    v.project(q.camera);
    const r = q.canvas.getBoundingClientRect();
    return { x: r.x + ((v.x + 1) * r.width) / 2, y: r.y + ((1 - v.y) * r.height) / 2 };
  }, white.id);
  await b.page.mouse.click(target.x, target.y);
  await until(() => white.ownerId === b.seen.id, 'individual clicked bot joins');
  assert.equal(own(b).length, 1);
  await place(b, { x: 47.8, z: 54.25 });
  await place(a, { x: 44.75, z: 54.25 });
  await menu(a);
  await group(a, () => a.page.locator('[data-bot-action="petAll"]').click(), 8);
  assert.equal(white.ownerId, b.seen.id);
  pass(
    'Click pets one dot; group petting recruits the remaining 8 without taking another player’s companion',
  );
  const playerId = a.seen.id;
  await a.page.reload();
  await start(a.page);
  await until(() => a.seen.id === playerId && room.players.has(playerId), 'same player rejoins');
  assert.equal(own(a).length, 8);
  assert.equal(white.ownerId, b.seen.id);
  assert.equal(pets(a).length, 0);
  pass('Browser reload/rejoin retains completed group bonds without replaying petting');
  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(size);
    await menu(a);
    const button = a.page.locator('[data-bot-action="petAll"]');
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.x + box.width <= size.width + 1 &&
        box.y >= 0 &&
        box.y + box.height <= size.height + 1,
    );
    assert.ok(!(await a.page.locator('.orb-menu').innerText()).includes('順番にまとめて'));
    await a.page.screenshot({ path: `${out}/menu-${size.width}.png` });
    await closeMenu(a);
  }
  pass(
    'Desktop, phone portrait and landscape: simultaneous-pet button remains visible and reachable',
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  pass('No browser console/page errors');
} catch (error) {
  failure = error;
  console.error(error);
  if (a) await a.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      { ok: !failure, checks, errors, failure: failure?.stack, bots: room?.orbBots },
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
