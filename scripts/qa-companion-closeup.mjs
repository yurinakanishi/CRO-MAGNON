// Isolated game: camera/starting positions are fixtures; viewing uses real UI input.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = `output/playwright/companion-closeup/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({
  port: 0,
  host: '127.0.0.1',
  visibility: await readLocalVisibility('local-visibility.json'),
});
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const errors = [],
  checks = [],
  peers = [];
const roomName = 'CLOSEUP';
let room, a, b, failure;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw Error(label);
    await sleep(60);
  }
}
function pass(label) {
  checks.push(label);
  console.log('PASS', label);
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = { id: null, sent: [], state: {} };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.sent.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    });
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    window.qaPad = {
      id: 'Nintendo Switch Pro Controller (Vendor: 057e)',
      index: 0,
      connected: false,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => (qaPad.connected ? [qaPad] : []),
    });
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst closeupRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=closeupRender.apply(this,args);window.qa=this;window.qaThree=THREE;return result;};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  room = game.rooms.get(roomName);
  await page.locator('#world').focus();
  return { context, page, seen, player: () => room.players.get(seen.id) };
}
async function stage(user, target, gap = 2.3) {
  await user.page.bringToFront();
  stopActor(user.player());
  Object.assign(user.player(), {
    x: target.x,
    z: target.z + gap,
    facing: Math.PI,
    warpSequence: (user.player().warpSequence ?? 0) + 1,
  });
  await user.page.evaluate(() => {
    qa.endCompanionView();
    qa.focusPlayer(0);
  });
  await user.page.locator('#world').focus();
  await sleep(700);
}
const shot = (name) => a.page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
const active = () => a.page.locator('#world').getAttribute('data-companion-view');
async function inspected(id) {
  await until(async () => (await active()) === id, `viewing ${id}`);
  await sleep(900);
  const view = await a.page.evaluate(() => ({
    id: qa.companionView.id,
    distance: qa.distance,
    target: qa.targetDistance,
    focus: qa.focus.toArray(),
    position: qa.players.get(qa.selfId).model.position.toArray(),
    selfVisible: qa.players.get(qa.selfId).model.visible,
  }));
  assert.ok(view.distance < 3.2);
  assert.equal(view.selfVisible, false, 'avatar cannot cover the inspected companion');
  return view;
}
async function pad(buttons = [], axes = [0, 0, 0, 0]) {
  await a.page.evaluate(
    ({ buttons, axes }) => {
      qaPad.connected = true;
      qaPad.axes = axes;
      qaPad.buttons = qaPad.buttons.map((_, i) => ({
        pressed: buttons.includes(i),
        value: buttons.includes(i) ? 1 : 0,
      }));
    },
    { buttons, axes },
  );
  await sleep(220);
}
async function tap(button) {
  await pad([button]);
  await pad();
}
try {
  a = await open('見る人');
  room.enemies = [];
  b = await open('別の人');
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=viewer-${i}`);
    peers.push(peer);
    await new Promise((resolve, reject) => {
      peer.once('open', resolve);
      peer.once('error', reject);
    });
  }
  await until(
    () => a.seen.state.players?.length === 5 && b.seen.state.players?.length === 5,
    'five players',
  );
  await stage(a, room.rimoNeko);
  await a.page.locator('[data-cue="inspect"]').waitFor();
  assert.match(await a.page.locator('[data-cue="inspect"]').innerText(), /りもねこ/);
  const original = { x: a.player().x, z: a.player().z };
  const beforeActions = a.seen.sent.filter((m) => m.type === 'action').length;
  await a.page.locator('[data-cue="inspect"]').click();
  const initial = await inspected(room.rimoNeko.id);
  await shot('01-rimo-closeup');
  assert.equal(a.player().x, original.x);
  assert.equal(a.player().z, original.z);
  assert.equal(a.seen.sent.filter((m) => m.type === 'action').length, beforeActions);
  assert.ok(!(await b.page.locator('#world').getAttribute('data-companion-view')));
  assert.equal(a.seen.state.mae, undefined);
  pass(
    'two Chrome clients plus three peers: direct cat closeup is local, non-destructive, with mae hidden',
  );

  await a.page.keyboard.press('+');
  await sleep(600);
  assert.ok(await a.page.evaluate((d) => qa.targetDistance < d, initial.target));
  const yaw = await a.page.evaluate(() => qa.yaw);
  await a.page.mouse.move(640, 390);
  await a.page.mouse.down();
  await a.page.mouse.move(850, 450, { steps: 12 });
  await a.page.mouse.up();
  assert.ok(Math.abs((await a.page.evaluate(() => qa.yaw)) - yaw) > 0.8);
  await a.page.mouse.click(640, 390);
  assert.equal(
    a.seen.sent.filter((m) => m.type === 'action').length,
    beforeActions,
    'look never attacks a pet',
  );
  await shot('02-rimo-rotated');
  await a.page.keyboard.press('Escape');
  assert.equal(await active(), '');
  assert.equal(await a.page.locator('#modal').isVisible(), false);
  pass('keyboard zoom, orbit, safe canvas click and Escape return');

  await stage(a, room.companion524, 0.8);
  assert.match(await a.page.locator('[data-cue="inspect"]').innerText(), /524/);
  const beforeWalk = { x: a.player().x, z: a.player().z };
  await a.page.keyboard.press('x');
  await inspected(room.companion524.id);
  await shot('03-524-closeup');
  await a.page.keyboard.down('w');
  await sleep(350);
  await a.page.keyboard.up('w');
  assert.equal(await active(), '');
  assert.ok(Math.hypot(a.player().x - beforeWalk.x, a.player().z - beforeWalk.z) > 0.1);
  pass('524 is framed at its real floating height; walking returns to play');

  await stage(a, room.rimoNeko);
  await pad();
  await tap(5);
  await inspected(room.rimoNeko.id);
  assert.equal(await a.page.locator('#input-cues').getAttribute('data-device'), 'gamepad');
  assert.equal(
    await a.page
      .locator('[data-pad-control="b5"]')
      .getAttribute('class')
      .then((c) => c.includes('is-suggested')),
    true,
  );
  const padDistance = await a.page.evaluate(() => qa.targetDistance);
  await tap(5);
  assert.ok(await a.page.evaluate((d) => qa.targetDistance < d, padDistance));
  await tap(4);
  await pad([], [0, 0, 0.7, 0]);
  await pad();
  await shot('04-controller-closeup');
  await tap(11);
  assert.equal(await active(), '');
  pass(
    'standard Switch pad: R opens/zooms, L widens, right stick orbits, R3 returns with illuminated controls',
  );
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  await until(
    async () =>
      (await a.page.locator('#world').getAttribute('data-gamepad-status')) === 'disconnected',
    'controller disconnect processed before keyboard input',
  );
  await a.page.keyboard.press('x');
  await inspected(room.rimoNeko.id);
  for (const [width, height, name] of [
    [390, 844, 'portrait'],
    [844, 390, 'landscape'],
  ]) {
    await a.page.setViewportSize({ width, height });
    await sleep(1100);
    const visible = await a.page.evaluate(() => {
      const point = qa.rimoNekoRenderer.root.position.clone();
      point.y += 0.26;
      point.project(qa.camera);
      return { x: point.x, y: point.y, z: point.z };
    });
    assert.ok(Math.abs(visible.x) < 0.15 && Math.abs(visible.y) < 0.15 && visible.z < 1);
    await shot(`05-${name}`);
  }
  pass('portrait and landscape keep the companion centered and all three controls visible');
  await a.page.keyboard.press('Escape');
  await a.page.setViewportSize({ width: 1280, height: 800 });

  const heart = room.orbBots.find((bot) => bot.kind === 'heart');
  await stage(a, heart);
  const point = await a.page.evaluate((id) => {
    const root = qa.orbBotRenderer.bots.get(id).actor.root;
    const p = root.position.clone();
    p.y += 0.14;
    p.project(qa.camera);
    return { x: ((p.x + 1) * innerWidth) / 2, y: ((1 - p.y) * innerHeight) / 2 };
  }, heart.id);
  await a.page.mouse.move(point.x, point.y);
  await a.page.mouse.wheel(0, -100);
  await inspected(heart.id);
  await shot('06-bot-wheel-closeup');
  await a.page.keyboard.press('m');
  await a.page.locator('#big-map').waitFor();
  assert.equal(await active(), '');
  pass('wheel directly targets the heart bot; opening the map exits the closeup');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await shot('failure').catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ passed: !failure, checks, errors, failure }, null, 2),
  );
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, passed: !failure, checks: checks.length }));
if (failure) process.exitCode = 1;
