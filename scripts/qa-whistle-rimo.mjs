// Isolated in-memory server: never joins or edits the user's saved game.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = `output/playwright/whistle-rimo/${Date.now()}`;
await mkdir(out, { recursive: true });
const visibility = await readLocalVisibility('local-visibility.json');
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true, visibility });
const game = createGameServer({ port: 0, host: '127.0.0.1', core, visibility });
const { port } = await game.listen();
const url = `http://127.0.0.1:${port}/?room=WHISTLE-RIMO`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const errors = [],
  checks = [],
  peers = [];
let room, a, b, failure;
const dots = () => room.orbBots.filter((x) => x.home);
const cat = () => room.orbBots.find((x) => x.kind === 'rimo-neko');
async function until(check, label, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
const shot = (u, name) => u.page.screenshot({ path: `${out}/${name}.png` });
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = { id: null, state: {}, actions: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'action') seen.actions.push(m);
    });
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    });
  });
  await page.addInitScript((name) => {
    if (location.protocol === 'http:') localStorage.setItem('cro-name', name);
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
        '\nconst renderDotsQA=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const r=renderDotsQA.apply(this,args);window.qa=this;if(window.trackCat && this.rimoNekoRenderer){window.catFrames??=[];window.catFrames.push({...this.rimoNekoRenderer.diagnostics(),now:this.serverNow(),throwAt:this.rimoNekoRenderer.squadBot?.throwAt});}return r;};',
    });
  });
  await page.goto(url);
  const user = { context, page, seen, player: () => room.players.get(seen.id) };
  await enter(user);
  return user;
}
async function enter(u) {
  await u.page.locator('#title-start').click();
  await u.page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await u.page.locator('#setup-flow-yes').click();
  await u.page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
  room = game.rooms.get('WHISTLE-RIMO');
  await until(() => room.players.has(u.seen.id), 'joined');
  await u.page.locator('#world').focus();
}
async function stage(u, x, z) {
  stopActor(u.player());
  const point = room.collision.nearestFree({ x, z }, u.player().radius, [], 3);
  assert.ok(point);
  Object.assign(u.player(), point, {
    facing: Math.PI,
    warpSequence: (u.player().warpSequence ?? 0) + 1,
  });
  await u.page.bringToFront();
  await u.page.evaluate(() => qa.focusPlayer(0));
  await u.page.locator('#world').focus();
  await sleep(650);
}
async function menu(u, count) {
  await u.page.keyboard.press('Escape');
  await u.page.getByRole('button', { name: 'botたちを選ぶ・呼ぶ・帰す', exact: true }).click();
  await until(
    async () =>
      (await u.page.locator('.orb-menu h2').textContent()) === `仲間のbotたち · ${count}匹`,
    'stable menu count',
  );
  if (count) assert.equal(await u.page.locator('[data-bot-action="recall"]').isEnabled(), true);
}
async function closeMenu(u) {
  await u.page.keyboard.press('Escape');
  await u.page.locator('#world').focus();
}

async function pad(u, buttons) {
  await u.page.evaluate((buttons) => {
    qaPad.connected = true;
    qaPad.buttons = qaPad.buttons.map((_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    }));
  }, buttons);
  await sleep(150);
}
async function dismiss(u) {
  await menu(u, room.orbBots.filter((x) => x.ownerId === u.seen.id).length);
  await u.page.locator('[data-bot-action="dismissAll"]').click();
  await until(() => !room.orbBots.some((x) => x.ownerId === u.seen.id), 'dismissed');
  await until(
    () => dots().every((x) => gap(x, x.home) < 0.1) && gap(room.rimoNeko, room.rimoNeko.home) < 0.1,
    'home',
    45000,
  );
}
async function selectCat(u) {
  await menu(u, room.orbBots.filter((x) => x.ownerId === u.seen.id).length);
  await u.page.locator('[data-bot-kind="rimo-neko"]').click();
  await closeMenu(u);
}
try {
  a = await open('笛を吹く人');
  room.enemies = [];
  b = await open('見ている人');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=WHISTLE-RIMO&name=observer-${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(
    () => a.seen.state.players?.length === 5 && b.seen.state.players?.length === 5,
    'five players',
  );
  await stage(a, 48, 54);
  await menu(a, 0);
  assert.ok(await a.page.locator('[data-bot-action="recall"]').isEnabled());
  await shot(a, '01-zero-companions-whistle-enabled');
  await closeMenu(a);
  await until(
    () => a.page.locator('[data-cue="recall"]').isVisible(),
    'whistle cue before friendship',
  );
  await shot(a, '02-whistle-cue-in-world');
  await a.page.keyboard.press('q');
  await until(
    () => room.orbBots.filter((x) => x.ownerId === a.seen.id).length === 11,
    'one whistle invites eleven',
  );
  await until(() => room.orbBots.every((x) => gap(x, a.player()) < 3), 'all eleven approach');
  for (const u of [a, b])
    await until(
      () => u.seen.state.orbBots.filter((x) => x.ownerId === a.seen.id).length === 11,
      'shared count',
    );
  assert.equal(room.rimoNeko.petSequence, 0);
  await shot(a, '03-whistle-gathered');
  await stage(b, 49, 54);
  await b.page.keyboard.press('q');
  await sleep(350);
  assert.ok(room.orbBots.every((x) => x.ownerId === a.seen.id));
  pass(
    'zero-owner Q recruits nine dots, 524 and cat in both views; a connected other player cannot whistle them away',
  );

  await a.page.bringToFront();
  a.player().facing = Math.PI;
  await sleep(400);
  await selectCat(a);
  for (const u of [a, b])
    await u.page.evaluate(() => {
      window.catFrames = [];
      window.trackCat = true;
    });
  await a.page.keyboard.press('c');
  await until(() => cat()?.mode === 'airborne', 'cat airborne');
  await sleep(280);
  await shot(a, '04-cat-in-flight');
  await until(() => cat()?.mode === 'waiting', 'cat lands');
  await sleep(500);
  for (const [i, u] of [a, b].entries()) {
    const frames = await u.page.evaluate(() => {
      window.trackCat = false;
      return window.catFrames;
    });
    await writeFile(`${out}/flight-${i}.json`, JSON.stringify(frames, null, 2));
    const airborne = frames.filter((f) => f.mode === 'airborne');
    assert.ok(airborne.length >= 3, `view ${i}: flight frames`);
    assert.ok(
      airborne.some((f) => Math.cos(f.pitch) < -0.7),
      `view ${i}: inverted midway`,
    );
    const hands = frames.filter(
      (f) => f.mode === 'windup' && f.now - f.throwAt >= 120 && f.handError !== null,
    );
    assert.ok(hands.length > 0, `view ${i}: hand frames`);
    assert.ok(
      hands.every((f) => f.handError < 0.03),
      `view ${i}: same hand contact`,
    );
    const drawn = await u.page.evaluate(() => ({
      cat: qa.rimoNekoRenderer.diagnostics(),
      duplicates: [...qa.orbBotRenderer.bots.keys()].filter((k) => k.includes('rimo')),
    }));
    assert.deepEqual(drawn.duplicates, []);
    assert.equal(drawn.cat.mode, 'waiting');
    assert.equal(drawn.cat.pitch, 0);
  }
  const landing = { x: cat().x, z: cat().z };
  await shot(a, '05-cat-waiting');
  await a.page.keyboard.down('s');
  await sleep(900);
  await a.page.keyboard.up('s');
  await sleep(1000);
  assert.equal(gap(room.rimoNeko, landing), 0);
  await a.page.keyboard.press('q');
  await until(() => cat()?.mode === 'following' && gap(cat(), a.player()) < 3, 'cat returns');
  pass(
    'C holds the original cat exactly at the hand in both views, turns once, lands upright, waits through walking and returns with Q',
  );

  await selectCat(a);
  await a.page.keyboard.press('c');
  await until(() => cat()?.mode === 'waiting', 'waiting before reload');
  const id = a.seen.id,
    at = { x: cat().x, z: cat().z };
  const inv = structuredClone(a.player().inventory);
  await a.page.reload();
  await enter(a);
  assert.equal(a.seen.id, id);
  assert.deepEqual(a.player().inventory, inv);
  await until(
    () => a.seen.state.orbBots?.some((x) => x.kind === 'rimo-neko' && x.mode === 'waiting'),
    'waiting after rejoin',
  );
  assert.equal(gap(cat(), at), 0);
  await menu(a, 11);
  await shot(a, '06-rejoin-eleven');
  await closeMenu(a);
  await a.page.keyboard.press('q');
  await until(
    () => cat()?.mode === 'following' && gap(cat(), a.player()) < 3,
    'rejoined cat returns',
  );
  pass('reload and title re-entry retain eleven companions, inventory, cat landing and recall');

  await dismiss(a);
  await stage(a, 48, 54);
  await pad(a, []);
  await pad(a, [12]);
  await pad(a, []);
  await until(
    () => room.orbBots.filter((x) => x.ownerId === a.seen.id).length === 11,
    'pad zero-owner whistle',
  );
  await until(() => cat()?.mode === 'following' && gap(cat(), a.player()) < 3, 'pad gathering');
  await selectCat(a);
  a.player().facing = Math.PI;
  await sleep(200);
  await pad(a, [10]);
  await pad(a, []);
  await until(() => cat()?.mode === 'waiting', 'L3 cat throw');
  await pad(a, [12]);
  await pad(a, []);
  await until(() => cat()?.mode === 'following' && gap(cat(), a.player()) < 3, 'D-pad recall');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.page.setViewportSize({ width, height });
    await menu(a, 11);
    assert.ok(await a.page.locator('[data-bot-kind="rimo-neko"]').isVisible());
    await shot(a, `07-cat-selection-${width}`);
    await closeMenu(a);
    assert.equal((await a.page.locator('[data-cue]').count()) <= 3, true);
  }
  pass(
    'synthetic Switch pad gathers from zero, L3 throws cat and D-pad up recalls; both viewport orientations show selection',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await shot(a, 'failure-owner').catch(() => {});
  if (b) await shot(b, 'failure-observer').catch(() => {});
  await writeFile(`${out}/failure-state.json`, JSON.stringify({ a: a?.seen, b: b?.seen }, null, 2));
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
