// Disposable in-memory room only. Positions are fixtures; pet/cancel/move/throw use actual UI.
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
const out = `output/playwright/pet-on-start/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({
  port: 0,
  host: '127.0.0.1',
  persistentSessions: true,
  keepEmptyRooms: true,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [],
  checks = [],
  peers = [];
let a, b, room, failure;
async function until(check, label, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw Error(label);
    await sleep(40);
  }
}
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = { id: null, state: {}, states: [] };
  seen.sent = [];
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
        seen.states.push(m);
      }
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
        '\nconst petStartRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const r=petStartRender.apply(this,args);window.qa=this;return r;};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=PET-START`);
  const user = { context, page, seen, player: () => room.players.get(seen.id) };
  await enter(user);
  return user;
}
async function enter(user) {
  await user.page.locator('#title-start').click();
  await user.page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await user.page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await user.page.locator('#setup-flow-yes').click();
  await user.page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
  room = game.rooms.get('PET-START');
  await until(() => user.seen.id && room.players.has(user.seen.id), 'joined');
  await user.page.locator('#world').focus();
}
async function stage(target, gap = 1.8) {
  await a.page.bringToFront();
  stopActor(a.player());
  Object.assign(a.player(), {
    x: target.x,
    z: target.z + gap,
    facing: Math.PI,
    warpSequence: (a.player().warpSequence ?? 0) + 1,
  });
  assert.ok(room.collision.free(a.player(), a.player().radius), 'fixture starts on a safe point');
  await a.page.evaluate(() => qa.focusPlayer(0));
  await a.page.locator('#world').focus();
  await sleep(600);
}
const shot = (name) => a.page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
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
  await sleep(180);
}
try {
  a = await open('撫で始める人');
  room.enemies = [];
  b = await open('見ている人');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=PET-START&name=observer-${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(
    () => a.seen.state.players?.length === 5 && b.seen.state.players?.length === 5,
    'five connections',
  );
  assert.equal(a.seen.state.mae, undefined);
  await stage(room.rimoNeko);
  assert.match(await a.page.locator('[data-cue="pet"]').innerText(), /りもねこ/);
  const sequence = room.rimoNeko.petSequence;
  await a.page.keyboard.press('v');
  await until(() => room.rimoNeko.petSequence > sequence, 'cat pet starts');
  assert.equal(room.rimoNeko.followPlayerId, a.seen.id);
  await a.page.keyboard.down('s');
  await sleep(450);
  await a.page.keyboard.up('s');
  await until(() => !room.rimoNeko.petPlayerId, 'walking cancels cat gesture');
  for (const client of [a, b]) {
    await until(
      () => client.seen.states.some((s) => s.rimoNeko?.petSequence > sequence),
      'shared cat start',
    );
    const first = client.seen.states.find((s) => s.rimoNeko?.petSequence > sequence).rimoNeko;
    assert.equal(first.followPlayerId, a.seen.id);
    assert.equal(first.petContactAt, 0);
  }
  await a.page.keyboard.down('s');
  await sleep(1100);
  await a.page.keyboard.up('s');
  await sleep(1700);
  assert.equal(room.rimoNeko.followPlayerId, a.seen.id);
  assert.ok(Math.hypot(room.rimoNeko.x - a.player().x, room.rimoNeko.z - a.player().z) < 3.5);
  await shot('01-cat-after-cancel');
  pass(
    'cat bonds in the first state seen by both Chrome clients, before contact, and follows after immediate walking cancellation',
  );

  await stage(room.companion524, 0.8);
  assert.match(await a.page.locator('[data-cue="pet"]').innerText(), /524/);
  await a.page.locator('[data-cue="pet"]').click();
  await until(() => room.companion524.petPlayerId === a.seen.id, '524 pet starts');
  assert.equal(room.companion524.squadPlayerId, a.seen.id);
  await a.page.keyboard.press('q');
  await until(
    () => !room.companion524.petPlayerId && !room.orbBots.find((x) => x.kind === '524')?.busy,
    '524 cancelled',
  );
  await until(
    () =>
      !a.seen.state.companion524?.petPlayerId &&
      a.seen.state.orbBots?.some((x) => x.kind === '524' && x.ownerId === a.seen.id && !x.busy),
    'client receives cancellation',
  );
  await a.page.locator('[data-cue="throw"]').waitFor();
  await a.page.keyboard.press('c');
  await until(
    () => room.orbBots.find((x) => x.kind === '524')?.mode === 'waiting',
    '524 throw after cancellation',
  );
  assert.equal(b.seen.state.companion524.squadPlayerId, a.seen.id);
  await shot('02-524-thrown-after-cancel');
  await a.page.keyboard.press('q');
  await until(
    () => room.orbBots.find((x) => x.kind === '524')?.mode === 'following',
    '524 recalled',
  );
  pass(
    'click-started 524 stays bonded after immediate Q cancellation and can be thrown and recalled',
  );

  await stage({ x: 44.75, z: 55.2 }, 0);
  await pad();
  assert.match(await a.page.locator('[data-cue="pet"]').innerText(), /bot/);
  await pad([0]);
  await pad();
  await until(
    () => room.orbBots.filter((x) => x.kind !== '524' && x.petPlayerId === a.seen.id).length === 9,
    'gamepad starts all nine',
  );
  assert.equal(room.orbBots.filter((x) => x.kind !== '524' && x.ownerId === a.seen.id).length, 9);
  await pad([], [0.8, 0, 0, 0]);
  await pad();
  await until(() => room.orbBots.every((x) => !x.petPlayerId), 'stick interrupts all gestures');
  assert.equal(room.orbBots.filter((x) => x.kind !== '524' && x.ownerId === a.seen.id).length, 9);
  await until(
    () => b.seen.state.orbBots.filter((x) => x.ownerId === a.seen.id).length === 10,
    'observer sees nine plus 524',
  );
  await shot('03-pad-group-after-cancel');
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  await until(
    async () =>
      (await a.page.locator('#world').getAttribute('data-gamepad-status')) === 'disconnected',
    'pad disconnect',
  );
  await a.page.keyboard.press('q');
  await sleep(1700);
  const at = room.orbBots.find((x) => x.kind === 'white');
  await stage({ x: at.x, z: at.z }, 0.8);
  // The prior 524 throw remains selected; cycle once to the first of the newly bonded dots.
  await a.page.keyboard.press('z');
  await a.page.locator('[data-cue="throw"]').waitFor();
  await a.page.keyboard.press('c');
  await until(
    () =>
      room.orbBots.some((x) => x.kind !== '524' && x.ownerId === a.seen.id && x.mode === 'waiting'),
    'dot can be thrown',
  );
  await a.page.keyboard.press('q');
  await sleep(2000);
  pass(
    'Switch bottom button recruits all nine immediately; left-stick cancellation retains all nine and throwing still works',
  );

  const oldId = a.seen.id;
  await a.page.reload();
  await enter(a);
  assert.equal(a.seen.id, oldId);
  await until(
    () => a.seen.state.orbBots.filter((x) => x.ownerId === oldId).length === 10,
    'rejoin preserves ten squad members',
  );
  assert.equal(room.rimoNeko.followPlayerId, oldId);
  assert.equal(room.orbBots.filter((x) => x.kind === '524').length, 1);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.page.setViewportSize({ width, height });
    await sleep(500);
    await shot(`04-rejoined-${width}`);
  }
  pass(
    'reloading and rejoining retains cat, 524 and all nine bots without duplicate models, in portrait and landscape',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a)
    await writeFile(
      `${out}/failure-state.json`,
      JSON.stringify(
        { sent: a.seen.sent.filter((m) => m.type === 'action'), state: a.seen.state },
        null,
        2,
      ),
    );
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
