// Real browser controls and real time in an isolated in-memory server; no user save is opened.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { BOT_KINDS, botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.VOLLEY_QA_OUT ?? `output/playwright/bot-volley/game-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [],
  peers = [],
  errors = [],
  checks = [],
  records = [],
  roomName = 'BOT-VOLLEY-QA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(35);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
function observeState(seen, message) {
  Object.assign(seen.state, message);
  seen.phases ??= [];
  seen.lastPhase ??= new Map();
  for (const bot of message.orbBots ?? []) {
    const key = `${bot.sequence}/${bot.mode}`;
    if (seen.lastPhase.get(bot.id) === key) continue;
    seen.lastPhase.set(bot.id, key);
    seen.phases.push({
      id: bot.id,
      kind: bot.kind,
      sequence: bot.sequence,
      mode: bot.mode,
      time: message.serverTime,
    });
  }
}
let room, a, b, failure;
function bots(owner) {
  return room.orbBots.filter((b) => b.ownerId === owner.p.id);
}
async function open(name, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  const page = await context.newPage(),
    seen = { id: null, state: {}, commands: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.commands.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') observeState(seen, m);
    });
  });
  await page.addInitScript((name) => localStorage.setItem('cro-name', name), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nconst observeOrb=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=observeOrb.apply(this,args);window.qa=this;window.qaFrames??=[];window.qaGestures??={};const hands=[...this.players.values()].filter(e=>e.actor).map(e=>({id:e.state.id,model:e.actor.asset.modelKey,weight:e.actor.orbBotPose.weight,gesture:e.actor.orbBotPose.gesture,hand:e.actor.orbBotPose.contact.toArray(),error:e.actor.orbBotPose.contact.distanceTo(e.actor.orbBotPose.requested)}));for(const h of hands)if(h.weight>0.5&&h.gesture){const k=h.id+'/'+h.model+'/'+h.gesture;qaGestures[k]=(qaGestures[k]??0)+1;}qaFrames.push({now:this.serverNow(),bots:this.orbBotRenderer?.diagnostics(),hands});if(qaFrames.length>1500)qaFrames.shift();return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  assert.equal(await page.locator('#setup-form .character-choice').count(), 9);
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  await page.waitForFunction(() => window.qa?.orbBotRenderer?.bots.size >= 9, { timeout: 30000 });
  return { page, seen, p: game.rooms.get(roomName).players.get(seen.id) };
}
async function fixture(player, x, z) {
  stopActor(player.p);
  Object.assign(player.p, { x, z, facing: 0, warpSequence: (player.p.warpSequence ?? 0) + 1 });
  await sleep(650);
  await player.page.locator('#world').focus();
}
async function botMenu(player) {
  await player.page.keyboard.press('Escape');
  await player.page.locator('[data-controller-menu="bots"]').click();
}
async function selectBot(player, kind) {
  await botMenu(player);
  await player.page.locator(`.orb-menu [data-bot-kind="${kind}"]`).click();
  await player.page.locator('#modal-close').click();
  await player.page.locator('#world').focus();
}
async function recall(player, trigger = () => player.page.keyboard.press('q')) {
  await trigger();
  await until(
    () => bots(player).every((bot) => bot.mode === 'following'),
    'all nine recalled',
    30000,
  );
  await sleep(300);
}
async function allSee(player, mode) {
  await until(
    () =>
      [a, b, ...peers].every(
        (viewer) =>
          viewer.seen.state.orbBots?.filter((bot) => bot.ownerId === player.p.id).length === 9 &&
          viewer.seen.state.orbBots
            .filter((bot) => bot.ownerId === player.p.id)
            .every((bot) => bot.mode === mode),
      ),
    `five clients see ${mode}`,
  );
}
try {
  a = await open('Volley A', 'cro-female');
  room = game.rooms.get(roomName);
  room.enemies = []; // Explicit isolated QA fixture only.
  b = await open('Volley B', 'howkey-female');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Observer${i}`);
    const seen = { state: {} };
    ws.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'welcome') seen.id = message.id;
      if (message.type === 'state') observeState(seen, message);
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  await until(() => room.players.size === 5 && room.orbBots.length === 45, 'five players');
  const sixth = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Sixth`);
  await new Promise((resolve) => {
    sixth.on('error', resolve);
    sixth.on('close', resolve);
  });
  assert.equal(room.players.size, 5);
  pass('two Chrome pages and three protocol peers; 45 unique bots; sixth player refused');
  let site;
  for (let x = 35; x < 67 && !site; x++)
    for (let z = 54; z < 67; z++) {
      const p = { ...a.p, x, z, facing: 0 },
        plan = botThrowPlan(p, room.collision);
      if (room.collision.free(p, 0.9) && plan && plan.landing.z - z > 7.5) {
        site = { x, z };
        break;
      }
    }
  assert.ok(site);
  await fixture(a, site.x, site.z);
  await fixture(b, site.x + 3, site.z);
  await a.page.evaluate(() => {
    qa.yaw = Math.PI;
    qa.pitch = 0.38;
    qa.targetDistance = 9;
  });
  await sleep(800);
  await selectBot(a, 'white');
  await a.page.locator('#world').focus();
  const commandsStart = a.seen.commands.length;
  for (let i = 0; i < 9; i++) {
    await a.page.keyboard.press('c');
    await sleep(80);
  }
  assert.equal(
    a.seen.commands.slice(commandsStart).filter((m) => m.action === 'throwBot').length,
    9,
  );
  assert.equal(
    a.seen.commands.slice(commandsStart).filter((m) => m.action === 'holdBot').length,
    0,
  );
  await until(() => bots(a).every((bot) => bot.sequence === 1), 'nine presses accepted');
  await a.page.screenshot({ path: `${out}/continuous-throw.png` });
  await until(() => bots(a).every((bot) => bot.mode === 'waiting'), 'nine wait at landing', 18000);
  await allSee(a, 'waiting');
  const landed = bots(a).map((bot) => ({ id: bot.id, x: bot.x, y: bot.y, z: bot.z }));
  await a.page.screenshot({ path: `${out}/all-nine-waiting.png` });
  for (const viewer of [a, b, ...peers]) {
    const phases = viewer.seen.phases.filter((event) => landed.some((bot) => bot.id === event.id));
    assert.deepEqual(
      phases.filter((e) => e.mode === 'airborne').map((e) => e.kind),
      BOT_KINDS,
    );
    for (const kind of BOT_KINDS)
      for (const mode of ['windup', 'airborne', 'landing', 'waiting'])
        assert.ok(
          phases.some((e) => e.kind === kind && e.mode === mode),
          `${kind} missing ${mode}`,
        );
  }
  assert.equal(await a.page.locator('#orb-bot-controls').count(), 0);
  await a.page.keyboard.press('c');
  await sleep(1600);
  assert.deepEqual(
    bots(a).map((bot) => ({ id: bot.id, x: bot.x, y: bot.y, z: bot.z })),
    landed,
  );
  assert.ok(bots(a).every((bot) => bot.sequence === 1));
  const rendered = await a.page.evaluate(() =>
    qaFrames.map((f) => ({ now: f.now, bots: f.bots, hands: f.hands })),
  );
  records.push({ landed, rendered });
  for (const kind of BOT_KINDS)
    assert.ok(
      rendered.some((f) =>
        f.bots.some(
          (bot) =>
            bot.ownerId === a.p.id && bot.kind === kind && bot.mode === 'airborne' && bot.visible,
        ),
      ),
    );
  pass('nine C presses launch all nine once in order; every peer sees flight, landing and waiting');
  const before = { x: a.p.x, z: a.p.z };
  await a.page.keyboard.down('s');
  await sleep(1200);
  await a.page.keyboard.up('s');
  await until(() => Math.hypot(a.p.x - before.x, a.p.z - before.z) > 0.5, 'owner walks away');
  await sleep(1000);
  assert.deepEqual(
    bots(a).map((bot) => ({ id: bot.id, x: bot.x, y: bot.y, z: bot.z })),
    landed,
  );
  await a.page.screenshot({ path: `${out}/owner-walks-bots-stay.png` });
  await recall(a);
  await allSee(a, 'following');
  await a.page.screenshot({ path: `${out}/all-nine-recalled.png` });
  pass('walking leaves deployed bots in place; one Q recalls all nine on every client');
  await fixture(a, site.x, site.z);
  // Each tap means one throw. A held keyboard key must not empty the squad.
  await selectBot(a, 'white');
  await a.page.locator('#world').focus();
  const count = () => bots(a).reduce((sum, bot) => sum + bot.sequence, 0);
  const total = count();
  await a.page.keyboard.down('c');
  await sleep(1200);
  await a.page.keyboard.up('c');
  await until(() => bots(a).some((bot) => bot.mode === 'waiting'), 'held key shot');
  assert.equal(count(), total + 1);
  await recall(a);
  pass('holding C does not auto-fire extra companions');
  // Pointer controls live in the pause menu; there is no permanent bot HUD.
  const pointerTotal = count();
  for (let i = 0; i < 3; i++) {
    await botMenu(a);
    await a.page.locator('.orb-menu [data-bot-action="use"]').click();
    await until(
      () => bots(a).filter((bot) => bot.mode === 'waiting').length === i + 1,
      'menu throw',
    );
  }
  await until(
    () => bots(a).filter((bot) => bot.mode === 'waiting').length === 3,
    'three pointer throws',
  );
  assert.equal(count(), pointerTotal + 3);
  await recall(a, async () => {
    await botMenu(a);
    await a.page.locator('.orb-menu [data-bot-action="recall"]').click();
  });
  pass('three pause-menu throws deploy three bots; one menu recall reunites them');
  await a.page.locator('#world').focus();
  await b.page.locator('#world').focus();
  for (const player of [a, b]) {
    await player.page.keyboard.press('c');
    await player.page.keyboard.press('c');
  }
  await until(
    () => [a, b].every((p) => bots(p).filter((bot) => bot.mode === 'waiting').length === 2),
    'both owners deployed',
  );
  await recall(a);
  assert.equal(bots(b).filter((bot) => bot.mode === 'waiting').length, 2);
  await recall(b);
  pass('simultaneous owners keep separate throw queues and recall only their own bots');
  // Recall within the old 450 ms action gate cancels the remaining windup/queue.
  for (let i = 0; i < 4; i++) await a.page.keyboard.press('c');
  await a.page.keyboard.press('q');
  await until(
    () => !bots(a).some((bot) => ['queued', 'windup'].includes(bot.mode)),
    'immediate recall cancels queue',
  );
  await until(() => bots(a).every((bot) => bot.mode === 'following'), 'immediate reunion');
  for (let i = 0; i < 4; i++) await a.page.keyboard.press('c');
  await a.page.keyboard.press('Escape');
  await until(
    () => !bots(a).some((bot) => ['queued', 'windup'].includes(bot.mode)),
    'menu cancels queue',
  );
  await a.page.locator('#modal-close').click();
  await a.page.locator('#world').focus();
  await recall(a);
  pass('immediate recall and opening a menu cancel pending throws without delayed launches');
  await a.page.evaluate(() => {
    window.qaPad = {
      id: 'Volley standard pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [qaPad] });
  });
  await sleep(400);
  const padTap = (button) =>
    a.page.evaluate(async (button) => {
      qaPad.buttons[button] = { pressed: true, value: 1 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      qaPad.buttons[button] = { pressed: false, value: 0 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    }, button);
  const padTotal = count();
  await padTap(10);
  await padTap(10);
  await until(() => bots(a).filter((bot) => bot.mode === 'waiting').length === 2, 'L3 two throws');
  assert.equal(count(), padTotal + 2);
  await recall(a, () => padTap(12));
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  pass('simulated pad: two L3 presses throw two bots; D-pad up recalls both');
  for (const model of CHARACTER_MODELS.slice(1)) {
    await a.page.keyboard.press('Escape');
    await a.page.locator('[data-controller-menu="character"]').click();
    await a.page
      .locator(
        `#character-switch-form .character-choice:has(input[value="${model.species}-${model.gender}"])`,
      )
      .click();
    await a.page.locator('#character-confirm-yes').click();
    await until(
      () => a.p.species === model.species && a.p.gender === model.gender,
      'character change',
    );
    await a.page.locator('#modal').waitFor({ state: 'hidden' });
    await a.page.waitForFunction(
      (key) => qa.players.get(qa.selfId)?.actor?.asset.modelKey === key,
      model.key,
    );
    await fixture(a, site.x, site.z);
    await selectBot(a, 'heart');
    await a.page.locator('#world').focus();
    await a.page.keyboard.press('c');
    await until(
      () => bots(a).some((bot) => bot.kind === 'heart' && bot.mode === 'airborne'),
      'character throws',
    );
    await a.page.screenshot({ path: `${out}/throw-${model.key}.png` });
    await recall(a);
  }
  pass('all nine existing character rigs throw with one command and recall normally');
  for (const [viewerIndex, viewer] of [a, b].entries()) {
    const gestures = await viewer.page.evaluate(() => window.qaGestures);
    records.push({ viewerIndex, gestures });
    for (const model of CHARACTER_MODELS)
      for (const gesture of ['throw', 'call'])
        assert.ok(
          gestures[`${a.p.id}/${model.key}/${gesture}`] > 0,
          `viewer ${viewerIndex}: ${model.key} ${gesture} animation missing`,
        );
  }
  pass('both Chrome views render throwing and calling gestures for all nine character rigs');
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="bots"]').click();
  assert.equal(await a.page.locator('.orb-menu [data-bot-kind]').count(), 9);
  assert.match(await a.page.locator('.orb-menu').innerText(), /その場所で待ちます/);
  await a.page.locator('.orb-menu [data-bot-action="recall"]').click();
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await a.page.setViewportSize({ width, height });
    await sleep(200);
    assert.equal(await a.page.locator('#orb-bot-controls,.orb-controls').count(), 0);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await a.page.screenshot({ path: `${out}/${width}x${height}.png` });
  }
  pass('bot controls remain in the pause menu; no dedicated HUD in desktop, portrait or landscape');
  a.p.inventory.wood = 3;
  a.p.inventory.berry = 2;
  const inventory = structuredClone(a.p.inventory);
  await a.page.reload();
  await a.page.locator('#title-start').click();
  await a.page
    .locator(`#setup-form .character-choice:has(input[value="${a.p.species}-${a.p.gender}"])`)
    .click();
  await a.page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await a.page.locator('#setup-flow-yes').click();
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => room.players.size === 5 && room.orbBots.length === 45, 'reload');
  a.p = room.players.get(a.seen.id);
  assert.deepEqual(a.p.inventory, inventory);
  assert.equal(new Set(room.orbBots.map((bot) => bot.id)).size, 45);
  pass('reload keeps non-empty inventory and exactly nine bots per owner');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await a.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: !failure,
        checks,
        records,
        errors,
        failure,
        scope:
          'Two real Chrome pages plus three protocol peers, isolated unsaved world; positions/enemy removal/inventory are QA fixtures. Real-time keyboard/pointer and simulated standard Gamepad inputs. No physical device or sustained FPS claim.',
      },
      null,
      2,
    ),
  );
  for (const { ws } of peers) ws.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, passed: !failure, checks: checks.length }));
if (failure) process.exitCode = 1;
