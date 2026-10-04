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
const out = `output/playwright/dots-rejoin/${Date.now()}`;
await mkdir(out, { recursive: true });
const visibility = await readLocalVisibility('local-visibility.json');
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true, visibility });
const game = createGameServer({ port: 0, host: '127.0.0.1', core, visibility });
const { port } = await game.listen();
const url = `http://127.0.0.1:${port}/?room=DOTS-REJOIN`;
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
const dots = () => room.orbBots.filter((x) => x.kind !== '524');
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
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst renderDotsQA=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const r=renderDotsQA.apply(this,args);window.qa=this;return r;};',
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
  await u.page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await u.page.locator('#setup-flow-yes').click();
  await u.page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
  room = game.rooms.get('DOTS-REJOIN');
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
try {
  a = await open('元の持ち主');
  room.enemies = [];
  b = await open('キャンプで待つ人');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=DOTS-REJOIN&name=observer-${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await stage(a, 44.75, 54.6);
  await a.page.keyboard.press('v');
  await until(() => dots().every((x) => x.ownerId === a.seen.id), 'all nine join');
  await a.page.keyboard.press('q');
  await until(() => dots().every((x) => !x.petPlayerId), 'pet cancelled');
  await stage(a, -32, 65);
  await until(
    () => dots().every((x) => gap(x, a.player()) < 3),
    'following at the reported remote location',
  );
  for (let i = 0; i < 9; i++) {
    await a.page.keyboard.press('c');
    await sleep(410);
  }
  await until(() => dots().every((x) => x.mode === 'waiting'), 'all nine wait where thrown');
  const landing = dots().map((x) => ({ id: x.id, x: x.x, z: x.z }));
  await stage(a, 115, 70);
  assert.ok(dots().every((x) => gap(x, a.player()) > 120));
  await menu(a, 9);
  await shot(a, '01-distant-nine-count');
  assert.deepEqual(
    dots().map((x) => ({ id: x.id, x: x.x, z: x.z })),
    landing,
  );
  pass(
    'all nine dots remain counted and recall stays enabled over 120m away, with landing positions preserved',
  );
  const oldId = a.seen.id;
  await a.page.reload();
  await enter(a);
  assert.equal(a.seen.id, oldId);
  await menu(a, 9);
  await shot(a, '02-rejoined-nine-count');
  await closeMenu(a);
  await a.page.keyboard.press('q');
  await until(
    () => dots().every((x) => x.ownerId === oldId && gap(x, a.player()) < 3),
    'distant recall after reload',
    45000,
  );
  pass(
    'reloading and rejoining preserves the original owner and nine-member count; Q recalls every distant dot',
  );
  await stage(a, -32, 65);
  await until(() => dots().every((x) => gap(x, a.player()) < 3), 'all travel with owner');
  await a.page.goto('about:blank');
  await until(() => !room.players.has(oldId), 'owner disconnected');
  await stage(b, 44.75, 54.6);
  await until(() => dots().every((x) => x.mode === 'home'), 'offline dots return to camp', 45000);
  assert.ok(dots().every((x) => x.ownerId === oldId));
  await until(
    () =>
      b.page.evaluate(() => qa.orbBotRenderer.diagnostics().filter((x) => x.visible).length === 9),
    'nine visible models at camp',
  );
  await shot(b, '03-offline-nine-at-camp');
  pass('all nine offline followers return visibly to camp while retaining their original bond');
  await b.page.keyboard.press('v');
  await until(
    () => dots().every((x) => x.ownerId === b.seen.id),
    'one accepted pet transfers all available companions',
  );
  await b.page.keyboard.down('s');
  await sleep(180);
  await b.page.keyboard.up('s');
  await until(() => dots().every((x) => !x.petPlayerId), 'walking interrupts gesture');
  assert.ok(dots().every((x) => x.ownerId === b.seen.id));
  await menu(b, 9);
  await shot(b, '04-new-connection-nine-count');
  await closeMenu(b);
  await b.page.keyboard.press('c');
  await until(() => dots().some((x) => x.mode === 'waiting'), 'transferred dot can be thrown');
  await b.page.keyboard.press('q');
  await until(() => dots().every((x) => gap(x, b.player()) < 3), 'transferred squad recalls');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await b.page.setViewportSize({ width, height });
    await menu(b, 9);
    await shot(b, `05-nine-count-${width}`);
    await closeMenu(b);
  }
  pass(
    'one V input recruits the available offline group after changing connection; interruption, throw, recall and both screen orientations preserve nine',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await shot(a, 'failure-owner').catch(() => {});
  if (b) await shot(b, 'failure-camp').catch(() => {});
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
