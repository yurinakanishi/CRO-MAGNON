// Real UI actions and shared time in an isolated unsaved game. Stage positions are QA fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/companion-524/squad-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const roomName = '524-DOTS-QA',
  contexts = [],
  peers = [],
  checks = [],
  errors = [],
  records = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(35);
  }
}
function pass(text) {
  checks.push(text);
  console.log('PASS', text);
}
function observe(seen, m) {
  Object.assign(seen.state, m);
  for (const b of m.orbBots ?? []) if (b.kind === '524') seen.phases.add(b.mode);
}
async function open(name, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  const page = await context.newPage(),
    seen = { state: {}, phases: new Set() };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') observe(seen, m);
    }),
  );
  await page.addInitScript(
    ({ name, graphics }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-graphics-quality', graphics);
    },
    { name, graphics: process.env.QA_GRAPHICS ?? 'auto' },
  );
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
const observe524=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){const result=observe524.apply(this,args);window.qa=this;window.qaFrames??=[];
const bot=this.state.orbBots?.find(b=>b.kind==='524');
const owner=bot&&this.players.get(bot.ownerId);const pose=owner?.actor?.orbBotPose;
qaFrames.push({now:this.serverNow(),throwAt:bot?.throwAt,companion:this.companion524Renderer?.diagnostics(),
model:owner?.actor?.asset.modelKey,gesture:pose?.gesture,weight:pose?.weight,
duplicates:[...(this.orbBotRenderer?.bots.values()??[])].filter(e=>e.state.kind==='524').length});
if(qaFrames.length>5000)qaFrames.shift();return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  await page.waitForFunction(() => window.qa?.companion524Renderer?.actor);
  return { page, seen, p: game.rooms.get(roomName).players.get(seen.id) };
}
let room, a, b, failure;
const owned = (owner) => room.orbBots.filter((bot) => bot.ownerId === owner.p.id);
const mascot = () => room.orbBots.find((bot) => bot.kind === '524');
async function stage(owner, x, z) {
  stopActor(owner.p);
  Object.assign(owner.p, { x, z, facing: 0, warpSequence: (owner.p.warpSequence ?? 0) + 1 });
  await sleep(650);
  await owner.page.locator('#world').focus();
}
async function menu(owner) {
  await owner.page.keyboard.press('Escape');
  await owner.page.locator('[data-controller-menu="bots"]').click();
}
async function select(owner, kind) {
  await menu(owner);
  await owner.page.locator(`[data-bot-kind="${kind}"]`).click();
  await owner.page.locator('#modal-close').click();
  await owner.page.locator('#world').focus();
}
async function recall(owner, screenshot) {
  await owner.page.locator('#world').focus();
  await owner.page.keyboard.press('q');
  if (screenshot) {
    await sleep(350);
    await owner.page.screenshot({ path: screenshot });
  }
  await until(() => owned(owner).every((bot) => bot.mode === 'following'), 'all recalled', 30000);
  await sleep(400);
}
try {
  a = await open('524 owner', 'cro-female');
  room = game.rooms.get(roomName);
  room.enemies = [];
  b = await open('524 observer', 'howkey-female');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Observer${i}`);
    const seen = { state: {}, phases: new Set() };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'state') observe(seen, m);
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  await until(() => room.players.size === 5 && room.orbBots.length === 45, 'five clients');
  assert.equal(mascot(), undefined);
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind]').count(), 9);
  await a.page.locator('#modal-close').click();
  pass('two Chrome pages and three peers start with nine dots each and one original camp 524');
  const c = room.companion524;
  await stage(a, c.x, c.z + 1.6);
  await stage(b, c.x + 3, c.z + 2);
  await a.page.evaluate(() => {
    qa.yaw = 1.05;
    qa.pitch = 0.17;
    qa.targetDistance = 4;
  });
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('v');
  await until(() => c.petContactAt > 0, 'pet hand contact');
  assert.equal(mascot(), undefined);
  await sleep(1900);
  await a.page.screenshot({ path: `${out}/pet-happy.png` });
  await until(() => mascot()?.ownerId === a.p.id, '524 joins dots after happy');
  await until(
    () =>
      [a, b, ...peers].every(
        (v) => v.seen.state.orbBots?.filter((bot) => bot.kind === '524').length === 1,
      ),
    'five clients one 524',
  );
  assert.equal(owned(a).length, 10);
  assert.equal(owned(b).length, 9);
  await menu(a);
  assert.equal(await a.page.locator('[data-bot-kind]').count(), 10);
  assert.equal(await a.page.locator('[data-bot-kind="524"]').count(), 1);
  await a.page.screenshot({ path: `${out}/ten-members.png` });
  await a.page.locator('#modal-close').click();
  const petFrames = await a.page.evaluate(() => qaFrames.filter((f) => f.companion?.hearts > 0));
  assert.ok(petFrames.length > 0);
  records.push({ petHeartFrames: petFrames.length });
  pass(
    'real pet shows hearts, completes, then adds only the petter’s tenth menu member in all five clients',
  );
  let site;
  for (let x = 35; x < 67 && !site; x++)
    for (let z = 54; z < 67; z++) {
      const p = { ...a.p, x, z, facing: 0 },
        plan = botThrowPlan(p, room.collision, [], '524');
      if (room.collision.free(p, 1) && plan && plan.landing.z - z > 7.5) {
        site = { x, z };
        break;
      }
    }
  assert.ok(site);
  await stage(a, site.x, site.z);
  await stage(b, site.x + 3, site.z);
  for (const viewer of [a, b])
    await viewer.page.evaluate(() => {
      qa.yaw = 2.25;
      qa.pitch = 0.5;
      qa.targetDistance = 8;
    });
  await select(a, 'white');
  for (let i = 0; i < 10; i++) {
    await a.page.keyboard.press('c');
    await sleep(45);
  }
  await until(() => owned(a).every((bot) => bot.mode === 'waiting'), 'ten landing spots');
  await until(
    () => [a, b, ...peers].every((viewer) => viewer.seen.phases.has('waiting')),
    'landing snapshot reaches all five clients',
  );
  assert.equal(mascot().sequence, 1);
  for (const viewer of [a, b, ...peers])
    for (const mode of ['windup', 'airborne', 'landing', 'waiting'])
      assert.ok(viewer.seen.phases.has(mode), mode);
  const spots = owned(a).map(({ id, x, y, z }) => ({ id, x, y, z }));
  await a.page.screenshot({ path: `${out}/ten-thrown.png` });
  const before = { x: a.p.x, z: a.p.z };
  await a.page.keyboard.down('s');
  await sleep(1100);
  await a.page.keyboard.up('s');
  await until(() => Math.hypot(a.p.x - before.x, a.p.z - before.z) > 0.4, 'real walking');
  await sleep(1500);
  assert.deepEqual(
    owned(a).map(({ id, x, y, z }) => ({ id, x, y, z })),
    spots,
  );
  await a.page.screenshot({ path: `${out}/waiting-after-walk.png` });
  await recall(a);
  assert.equal(mascot().mode, 'following');
  pass(
    'ten C presses throw every member once; 524 waits with the dots through real walking, then Q recalls all ten',
  );
  // Character changes preserve the recruited body; check its hand alignment and both gestures.
  for (const model of CHARACTER_MODELS) {
    if (a.p.species !== model.species || a.p.gender !== model.gender) {
      await a.page.keyboard.press('Escape');
      await a.page.locator('[data-controller-menu="character"]').click();
      await a.page
        .locator(
          `#character-switch-form .character-choice:has(input[value="${model.species}-${model.gender}"])`,
        )
        .click();
      await a.page.locator('#character-confirm-yes').click();
      await until(
        () =>
          a.page.evaluate(
            (key) => qa.players.get(qa.selfId)?.actor?.asset.modelKey === key,
            model.key,
          ),
        'character loaded',
      );
      if (await a.page.locator('#modal').isVisible()) await a.page.keyboard.press('Escape');
    }
    await stage(a, site.x, site.z);
    await select(a, '524');
    await sleep(500);
    const start = Date.now();
    await a.page.keyboard.press('c');
    await until(() => mascot().mode === 'airborne', '524 in flight');
    await a.page.screenshot({ path: `${out}/throw-${model.key}.png` });
    await until(() => mascot().mode === 'waiting', '524 throw');
    await recall(a, `${out}/call-${model.key}.png`);
    for (const [index, viewer] of [a, b].entries()) {
      const frames = await viewer.page.evaluate(
        (start) => qaFrames.filter((f) => f.now >= start),
        start,
      );
      assert.ok(frames.every((f) => f.duplicates === 0));
      assert.ok(
        frames.some(
          (f) =>
            f.model === model.key && f.companion?.visible && f.companion.squadMode === 'airborne',
        ),
      );
      const hand = frames.filter(
        (f) =>
          f.model === model.key &&
          f.companion?.squadMode === 'windup' &&
          f.weight === 1 &&
          f.now - f.throwAt >= 125,
      );
      assert.ok(hand.length > 0, `${model.key} viewer ${index}: hand samples`);
      const maxError = Math.max(...hand.map((f) => f.companion.handError));
      assert.ok(maxError < 0.001, `${model.key} viewer ${index}: hand ${maxError}`);
      assert.ok(
        frames.some((f) => f.model === model.key && f.gesture === 'call' && f.weight > 0.5),
        `${model.key}: call`,
      );
      records.push({
        character: model.key,
        viewer: index,
        samples: frames.length,
        maxHandError: maxError,
      });
    }
  }
  pass(
    'all nine player rigs throw the same visible 524 from their animated hand and call it back in both Chrome views, without a duplicate model',
  );
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.page.setViewportSize({ width, height });
    await menu(a);
    assert.equal(await a.page.locator('[data-bot-kind]').count(), 10);
    assert.equal(await a.page.locator('#orb-bot-controls,.orb-controls').count(), 0);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await a.page.screenshot({ path: `${out}/menu-${width}x${height}.png` });
    await a.page.locator('#modal-close').click();
  }
  await a.page.setViewportSize({ width: 1280, height: 800 });
  pass('ten choices fit portrait and landscape; no dedicated dots HUD returns');
  // A second person pets through the same UI; the first menu updates while open.
  await stage(b, c.x, c.z + 1.5);
  await menu(a);
  await sleep(600);
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('v');
  await until(() => mascot()?.ownerId === b.p.id, 'second pet transfers');
  await until(
    () =>
      a.page
        .locator('[data-bot-kind]')
        .count()
        .then((n) => n === 9),
    'old open menu removes 524',
  );
  await a.page.locator('#modal-close').click();
  assert.equal(room.orbBots.filter((bot) => bot.kind === '524').length, 1);
  await menu(b);
  assert.equal(await b.page.locator('[data-bot-kind]').count(), 10);
  await b.page.locator('#modal-close').click();
  pass('a second completed pet transfers the one 524 and updates the previous owner’s open menu');
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('Escape');
  await b.page.locator('[data-controller-menu="dismiss524"]').click();
  await until(() => !mascot(), 'dismiss removes squad member');
  assert.equal(c.squadPlayerId, null);
  assert.equal(room.companion524.id, c.id);
  await until(
    () => b.page.evaluate(() => qa.companion524Renderer.diagnostics().visible),
    'original visible after dismissal',
  );
  pass('camp dismissal removes the tenth slot and keeps the original visible NPC');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await a.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  for (const [i, viewer] of [a, b].entries())
    if (viewer) {
      const frames = await viewer.page.evaluate(() => window.qaFrames ?? []).catch(() => []);
      await writeFile(`${out}/frames-${i}.json`, JSON.stringify(frames));
    }
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
          'Two real Chrome pages and three protocol peers, unsaved isolated game, real-time UI inputs. Player staging and enemy removal are QA fixtures. No physical controller or sustained FPS claim.',
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
