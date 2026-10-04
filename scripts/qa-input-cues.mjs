// Real Chrome, isolated in-memory world; controller hardware alone is simulated.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = `output/playwright/input-cues/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const errors = [],
  checks = [],
  peers = [];
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
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, ms = 25000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(40);
  }
}
const roomName = 'INPUT-CUES';
let room, failure;
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(),
    seen = { id: null, state: {}, sent: [] };
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
      id: 'Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)',
      index: 0,
      connected: false,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => (window.qaPad.connected ? [window.qaPad] : []),
    });
  }, name);
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').waitFor();
  assert.equal(await page.locator('#title-howto').count(), 0);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  room = game.rooms.get(roomName);
  await page.locator('#world').focus();
  await page.locator('#input-cues').waitFor({ state: 'visible' });
  return { context, page, seen, player: () => room.players.get(seen.id) };
}
async function input(page, buttons = [], axes = [0, 0, 0, 0]) {
  await page.bringToFront();
  await page.evaluate(
    ({ buttons, axes }) => {
      qaPad.buttons = qaPad.buttons.map((_, i) => ({
        pressed: buttons.includes(i),
        value: buttons.includes(i) ? 1 : 0,
      }));
      qaPad.axes = axes;
    },
    { buttons, axes },
  );
  await sleep(200);
}
async function tap(page, button) {
  await input(page, [button]);
  await input(page);
}
async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
}
async function place(user, point) {
  stopActor(user.player());
  Object.assign(user.player(), { x: point.x, z: point.z, downedUntil: 0 });
  await sleep(500);
}
try {
  const a = await open('操作QA A');
  await shot(a.page, '01-keyboard');
  assert.equal(await a.page.locator('#input-cues').getAttribute('data-device'), 'keyboard');
  const before = { x: a.player().x, z: a.player().z };
  await a.page.keyboard.down('w');
  await sleep(420);
  assert.equal(
    await a.page.locator('[data-key="w"]').evaluate((el) => el.classList.contains('is-pressed')),
    true,
  );
  await a.page.keyboard.up('w');
  await until(
    () => Math.hypot(a.player().x - before.x, a.player().z - before.z) > 0.3,
    'keyboard moves',
  );
  await a.page.keyboard.press('h');
  assert.equal(await a.page.locator('#modal').evaluate((el) => el.open), false);
  await a.page.keyboard.press('Escape');
  assert.equal(await a.page.locator('#input-cues').isVisible(), false);
  await a.page.locator('[data-pause-tab="info"]').click();
  assert.equal(await a.page.locator('[data-pause-subtab="help"]').count(), 0);
  assert.doesNotMatch(
    await a.page.locator('#modal-body').innerText(),
    /操作説明|あそびかた|ESC で|Enter で/,
  );
  await shot(a.page, '02-menu');
  await a.page.locator('[data-pause-tab="crafting"]').click();
  assert.doesNotMatch(
    await a.page.locator('#modal-body').innerText(),
    /HP\+15|Bで乗船|相手を向いて F|ガイド/,
  );
  await a.page.locator('[data-controller-menu="bots"]').click();
  assert.doesNotMatch(
    await a.page.locator('.orb-menu').innerText(),
    /コントローラー|C ／|Q ／|クリック|撫でて仲間になった子だけ/,
  );
  await a.page.locator('#modal-close').click();
  pass('Keyboard move and key feedback; title, H, pause, crafting and bot manuals removed');

  await a.page.evaluate(() => {
    qaPad.connected = true;
  });
  await until(
    async () => (await a.page.locator('#input-cues').getAttribute('data-layout')) === 'switch-pro',
    'pad hotplug',
  );
  assert.equal(await a.page.locator('.controller-diagram').count(), 1);
  assert.equal(await a.page.locator('[data-pad-control="b7"] text').textContent(), 'ZR');
  await input(a.page, [], [0.55, 0, 0.5, 0]);
  assert.equal(
    await a.page
      .locator('[data-pad-control="ls"]')
      .evaluate((el) => el.classList.contains('is-pressed')),
    true,
  );
  assert.equal(
    await a.page
      .locator('[data-pad-control="rs"]')
      .evaluate((el) => el.classList.contains('is-pressed')),
    true,
  );
  await shot(a.page, '03-switch-sticks');
  await input(a.page);
  for (const button of [3, 4, 5, 6, 7, 11, 16]) {
    await input(a.page, [button]);
    assert.equal(
      await a.page
        .locator(`[data-pad-control="b${button}"]`)
        .evaluate((el) => el.classList.contains('is-pressed')),
      true,
      `highlight ${button}`,
    );
    await input(a.page);
    assert.equal(
      await a.page
        .locator(`[data-pad-control="b${button}"]`)
        .evaluate((el) => el.classList.contains('is-pressed')),
      false,
      `release ${button}`,
    );
  }
  await sleep(1000);
  const jumpSequence = a.player().jumpSequence;
  await a.page.locator('[data-cue="jump"]').click();
  await until(
    () => a.player().jumpSequence > jumpSequence,
    'click on a pad cue survives input switch',
  );
  await input(a.page);
  await input(a.page, [], [0, 0, 0.4, 0]);
  await input(a.page);
  await sleep(1000);
  pass(
    'Switch hotplug; both sticks, top button, L/R, ZL/ZR, stick click and center feedback release correctly',
  );

  await until(() => room.orbBots.length >= 9, 'bots ready');
  const home = room.orbBots.find((b) => b.kind === 'white');
  await place(a, { x: home.x, z: home.z + 1.7 });
  await a.page.locator('[data-cue="pet"]').waitFor();
  assert.equal(
    await a.page
      .locator('[data-pad-control="b0"]')
      .evaluate((el) => el.classList.contains('is-suggested')),
    true,
  );
  await shot(a.page, '04-pet-cue');
  await tap(a.page, 0);
  await until(
    () => room.orbBots.some((b) => b.petPlayerId === a.seen.id || b.ownerId === a.seen.id),
    'pad pet starts',
  );
  await until(() => room.orbBots.some((b) => b.ownerId === a.seen.id), 'pad pet completes');
  await a.page.locator('[data-cue="throw"]').waitFor();
  await tap(a.page, 10);
  await until(
    () => room.orbBots.some((b) => b.ownerId === a.seen.id && b.mode === 'waiting'),
    'throw lands',
  );
  await a.page.locator('[data-cue="recall"]').waitFor();
  assert.equal(
    await a.page
      .locator('[data-pad-control="b12"]')
      .evaluate((el) => el.classList.contains('is-suggested')),
    true,
  );
  await shot(a.page, '05-recall-cue');
  await tap(a.page, 12);
  await until(
    () => !room.orbBots.some((b) => b.ownerId === a.seen.id && b.mode === 'waiting'),
    'recall',
  );
  pass(
    'Nearby pet cue matches bottom button; pet, heart completion, throw and recall work on the server',
  );

  // Nearby recruited bots deliberately take E priority; dismiss them through the real menu.
  await tap(a.page, 9);
  await a.page.locator('[data-controller-menu="bots"]').click();
  await a.page.locator('[data-bot-action="dismissAll"]').click();
  await until(
    () => !room.orbBots.some((bot) => bot.ownerId === a.seen.id),
    'dismiss before gathering',
  );
  await input(a.page);
  await input(a.page, [], [0, 0, 0.4, 0]);
  await input(a.page);
  const berry = room.resources.find(
    (resource) =>
      resource.type === 'berry' &&
      resource.amount > 0 &&
      Math.hypot(resource.x - 50, resource.z - 50) < 60 &&
      Math.hypot(resource.x - 50, resource.z - 50) > 25,
  );
  assert.ok(berry);
  await place(a, room.collision.nearestFree(berry, a.player().radius, [], 2));
  await a.page.locator('[data-cue="interact"]').waitFor();
  assert.equal(
    await a.page
      .locator('[data-pad-control="b1"]')
      .evaluate((el) => el.classList.contains('is-suggested')),
    true,
  );
  const amount = berry.amount;
  await input(a.page, [1]);
  assert.equal(
    await a.page
      .locator('[data-pad-control="b1"]')
      .evaluate((el) => el.classList.contains('is-pressed')),
    true,
  );
  await shot(a.page, '05-gather-cue');
  await input(a.page);
  await until(() => berry.amount < amount, 'right button gathers');
  const attackSequence = a.player().attackSequence;
  await input(a.page, [2]);
  assert.equal(
    await a.page
      .locator('[data-pad-control="b2"]')
      .evaluate((el) => el.classList.contains('is-pressed')),
    true,
  );
  await input(a.page);
  assert.ok(a.player().attackSequence > attackSequence);
  pass(
    'Mouse click on a pad cue, right-button gathering, and left-button attack keep their real actions',
  );

  await tap(a.page, 9);
  assert.equal(await a.page.locator('#modal').evaluate((el) => el.open), true);
  assert.equal(await a.page.locator('#input-cues').isVisible(), false);
  await tap(a.page, 0);
  assert.equal(await a.page.locator('#modal').evaluate((el) => el.open), false);
  await tap(a.page, 8);
  await a.page.locator('#big-map').waitFor();
  assert.doesNotMatch(
    await a.page.locator('#modal-body').innerText(),
    /SHARE|OPTIONS|Enter|ポインタを合わせて/,
  );
  await tap(a.page, 8);
  assert.equal(await a.page.locator('#modal').evaluate((el) => el.open), false);
  for (const [id, kind] of [
    ['DualSense Wireless Controller', 'ps4'],
    ['Xbox Wireless Controller (XInput)', 'xbox'],
    ['USB Gamepad', 'generic'],
  ]) {
    await a.page.evaluate((id) => {
      qaPad.id = id;
    }, id);
    await input(a.page);
    await until(
      async () => (await a.page.locator('#input-cues').getAttribute('data-layout')) === kind,
      'device layout',
    );
    await shot(a.page, `06-${kind}`);
  }
  await a.page.keyboard.press('g');
  assert.equal(await a.page.locator('#input-cues').getAttribute('data-device'), 'keyboard');
  await input(a.page);
  await input(a.page, [], [0, 0, 0.4, 0]);
  assert.equal(await a.page.locator('#input-cues').getAttribute('data-device'), 'gamepad');
  await input(a.page);
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  await until(
    async () => (await a.page.locator('#input-cues').getAttribute('data-device')) === 'keyboard',
    'disconnect returns keyboard',
  );
  pass('Menu/map central buttons, back, PS/Xbox/generic layouts, last-used device and disconnect');

  const b = await open('操作QA B');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Peer${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five players');
  await b.page.bringToFront();
  assert.equal(await b.page.locator('#input-cues').getAttribute('data-device'), 'keyboard');
  await a.page.bringToFront();
  await a.page.evaluate(() => {
    qaPad.id = 'Nintendo Switch Pro Controller';
    qaPad.connected = true;
  });
  await input(a.page);
  await until(
    async () => (await a.page.locator('#input-cues').getAttribute('data-layout')) === 'switch-pro',
    'a pad again',
  );
  assert.equal(await b.page.locator('#input-cues').getAttribute('data-device'), 'keyboard');
  pass(
    'Two rendered players and three network peers share the room with independent input displays',
  );

  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await a.page.setViewportSize({ width, height });
    await a.page.locator('#world').focus();
    await sleep(450);
    assert.equal(await a.page.locator('#input-cues').isVisible(), true, `${width} visible`);
    const box = await a.page.locator('#input-cues').boundingBox();
    assert.ok(
      box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
      JSON.stringify(box),
    );
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await shot(a.page, `07-pad-${width}x${height}`);
  }
  await a.page.keyboard.press('Enter');
  await sleep(150);
  assert.equal(await a.page.locator('#input-cues').isVisible(), false, 'chat typing hides hints');
  await a.page.keyboard.type('こんにちは');
  await a.page.keyboard.press('Enter');
  pass('Portrait, landscape and desktop layouts fit; chat input suppresses gameplay cues');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error.stack);
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries())
    await shot(page, `failure-${index}`).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        checks,
        errors,
        failure: failure?.stack,
        url: `http://127.0.0.1:${port}`,
        fixture:
        'Two real Chrome clients, three WebSocket peers, simulated standard gamepads; position fixtures beside camp bots and berries. No persistent saves.',
        screenshots: out,
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
console.log('Evidence', out);
if (failure) process.exitCode = 1;
