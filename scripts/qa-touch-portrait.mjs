// Real Chrome with native CDP multi-touch in an isolated, unsaved game server.
// Preparation only places actors; each validated command comes from a finger event.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { qaGamePackage } from './qa-game-package.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { RIMO_NEKO } from '../dist/shared/rimo-neko.mjs';
import { BOT_KINDS } from '../dist/shared/orb-bots.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/touch-portrait-20261006/${Date.now()}`;
const { createGameServer, packageRoot, packageId } = await qaGamePackage();
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1', assetRoot: packageRoot });
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
  checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, ms = 25000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
let room, phone, failure;
async function open(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: 1,
  });
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
  await page.goto(`http://127.0.0.1:${port}/?room=TOUCH-QA`);
  const tap = async (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  if (mobile) await page.screenshot({ path: `${out}/00-title.png` });
  await tap('#title-start');
  if (mobile) await page.screenshot({ path: `${out}/01-selection.png` });
  await tap('#setup-form .character-choice:has(input[value="cro-female"])');
  await tap('#setup-flow-yes');
  await enterPreparedWorld(page, mobile);
  await until(() => seen.id && game.rooms.get('TOUCH-QA')?.players.has(seen.id), 'join');
  room = game.rooms.get('TOUCH-QA');
  return {
    context,
    page,
    seen,
    tap,
    player: () => room.players.get(seen.id),
    cdp: await context.newCDPSession(page),
  };
}
async function shot(name) {
  await sleep(200);
  await phone.page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
}
async function touch(type, points = []) {
  await phone.cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ radiusX: 5, radiusY: 5, force: 1, ...p })),
  });
}
async function center(selector) {
  const r = await phone.page.locator(selector).boundingBox();
  assert.ok(r, selector);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function stick(dx, dy) {
  const p = await center('#touch-stick');
  await touch('touchStart', [{ id: 1, ...p }]);
  await touch('touchMove', [{ id: 1, x: p.x + dx, y: p.y + dy }]);
  return { id: 1, x: p.x + dx, y: p.y + dy };
}
async function place(x, z) {
  stopActor(phone.player());
  Object.assign(phone.player(), { x, z, downedUntil: 0, invulnerableUntil: Date.now() + 60000 });
  await sleep(500);
}
async function camera() {
  return phone.page.locator('#world').evaluate((el) => ({
    yaw: +el.dataset.cameraYaw,
    pitch: +el.dataset.cameraPitch,
    fov: +el.dataset.cameraFov,
  }));
}
async function layouts() {
  const layout = await phone.page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#touch-controls button')]
      .filter((el) => el.getClientRects().length && !el.hidden)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          action: el.dataset.touchAction || 'stick',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          hit:
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') ===
            el,
        };
      });
    return {
      width: innerWidth,
      height: innerHeight,
      scroll: document.documentElement.scrollWidth,
      buttons,
      keys: [...document.querySelectorAll('kbd')].filter((el) => el.getClientRects().length).length,
      chatHeight: document.querySelector('.chat-panel')?.getBoundingClientRect().height ?? 0,
    };
  });
  assert.equal(layout.keys, 0);
  assert.ok(layout.chatHeight <= 60, `collapsed chat height ${layout.chatHeight}`);
  assert.ok(layout.scroll <= layout.width);
  for (const b of layout.buttons)
    assert.ok(
      b.w >= 44 &&
        b.h >= 44 &&
        b.hit &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.w <= layout.width + 1 &&
        b.y + b.h <= layout.height + 1,
      JSON.stringify(b),
    );
  for (let a = 0; a < layout.buttons.length; a++)
    for (let b = a + 1; b < layout.buttons.length; b++) {
      const p = layout.buttons[a],
        q = layout.buttons[b];
      assert.ok(
        Math.min(p.x + p.w, q.x + q.w) <= Math.max(p.x, q.x) + 1 ||
          Math.min(p.y + p.h, q.y + q.h) <= Math.max(p.y, q.y) + 1,
        `overlap ${p.action}/${q.action}`,
      );
    }
  return layout;
}
try {
  phone = await open(true);
  await phone.page.locator('#touch-controls').waitFor({ state: 'visible' });
  assert.equal(await phone.page.locator('#input-cues').isVisible(), false);
  assert.doesNotMatch(
    await phone.page.locator('#world').getAttribute('aria-label'),
    /WASD|スティック/,
  );
  assert.ok((await camera()).fov > 57);
  await layouts();
  await shot('02-portrait-camp');
  pass(
    'Portrait touch UI starts without a keyboard/controller; no key hints and finger targets >=44px',
  );

  await place(76, 68);
  let before = { x: phone.player().x, z: phone.player().z };
  await stick(0, -23);
  await sleep(700);
  assert.equal(phone.player().running, false);
  assert.ok(Math.hypot(phone.player().x - before.x, phone.player().z - before.z) > 0.2);
  await touch('touchEnd');
  await sleep(350);
  before = { x: phone.player().x, z: phone.player().z };
  await sleep(400);
  assert.ok(Math.hypot(phone.player().x - before.x, phone.player().z - before.z) < 0.02);
  await stick(0, -44);
  await sleep(600);
  assert.equal(phone.player().running, true);
  await touch('touchCancel');
  await sleep(350);
  assert.equal(phone.player().moving, false);
  pass(
    'Shallow thumb walks, deep thumb runs; release and OS cancellation immediately stop server movement',
  );

  await place(76, 68);
  await sleep(1200); // Renderer diagnostics publish once each second.
  const startCam = await camera(),
    held = await stick(40, 0);
  const directionStart = { x: phone.player().x, z: phone.player().z };
  await sleep(750);
  const directionMiddle = { x: phone.player().x, z: phone.player().z };
  await until(
    async () => Math.abs((await camera()).yaw - startCam.yaw) > 0.1,
    'camera follows travel',
  );
  await touch('touchStart', [held, { id: 2, x: 230, y: 340 }]);
  await touch('touchMove', [held, { id: 2, x: 320, y: 360 }]);
  await sleep(1200);
  const manual = await camera();
  await touch('touchMove', [held, { id: 2, x: 320, y: 360 }]);
  await sleep(1200);
  assert.ok(Math.abs((await camera()).yaw - manual.yaw) < 0.02);
  const travelCommands = phone.seen.sent
    .filter((m) => m.type === 'move' && Math.hypot(m.dx, m.dz) > 0.5)
    .slice(-5);
  assert.ok(
    travelCommands.length >= 2 &&
      travelCommands.every(
        (m) => Math.hypot(m.dx - travelCommands[0].dx, m.dz - travelCommands[0].dz) < 0.001,
      ),
    'held stick retains its world direction while the view turns',
  );
  await touch('touchEnd');
  await sleep(300);
  const idleCam = await camera();
  await sleep(2450);
  assert.ok(
    Math.abs((await camera()).yaw - idleCam.yaw) < 0.02,
    'idle view stays where the player looked',
  );
  await shot('03-multitouch-orbit');
  pass(
    'Moving follows smoothly; simultaneous native second-finger orbit wins, held travel input stays fixed, idle view stays put',
  );

  await phone.tap('[data-touch-action="center"]');
  await phone.page.locator('[data-touch-action="jump"]:not(:disabled)').waitFor();
  const jumpBefore = phone.player().jumpSequence || 0;
  await phone.tap('[data-touch-action="jump"]');
  await until(() => phone.player().jumpSequence > jumpBefore, 'jump by touch');
  await until(() => phone.page.locator('[data-touch-action="attack"]').isEnabled(), 'land');
  const attackBefore = phone.player().attackSequence || 0;
  await phone.tap('[data-touch-action="attack"]');
  await until(() => phone.player().attackSequence > attackBefore, 'attack by touch');
  pass('Semantic jump and attack buttons execute through the server once per tap');

  await sleep(1200);
  await place(76, 68);
  await until(() => phone.page.locator('[data-touch-action="jump"]').isEnabled(), 'jump ready');
  const heldJumpBefore = phone.player().jumpSequence,
    heldWalk = await stick(0, -23);
  const jumpPoint = await center('[data-touch-action="jump"]');
  await touch('touchStart', [heldWalk, { id: 2, ...jumpPoint }]);
  await until(
    () => phone.player().jumpSequence > heldJumpBefore,
    'second finger jumps while walking',
  );
  await sleep(1650);
  await touch('touchEnd');
  await sleep(350);
  assert.equal(phone.player().jumpSequence, heldJumpBefore + 1);
  pass(
    'A second finger triggers jump during walking; holding and releasing it never fires a second jump',
  );

  await sleep(1100);
  await place(RIMO_NEKO.home.x + 1, RIMO_NEKO.home.z);
  await phone.page.locator('[data-touch-action="pet"]').waitFor();
  await phone.tap('[data-touch-action="pet"]');
  await until(() => room.rimoNeko.followPlayerId === phone.seen.id, 'pet joins immediately');
  await sleep(600);
  await place(76, 68);
  await phone.page.locator('[data-touch-action="throw"]').waitFor();
  await phone.tap('[data-touch-action="throw"]');
  await until(
    () =>
      room.orbBots.some(
        (b) => b.kind === 'rimo-neko' && ['airborne', 'landing', 'waiting'].includes(b.mode),
      ),
    'throw cat',
  );
  await phone.page.locator('[data-touch-action="recall"]').waitFor();
  await phone.tap('[data-touch-action="recall"]');
  await until(
    () => room.orbBots.some((b) => b.kind === 'rimo-neko' && b.mode === 'following'),
    'recall cat',
  );
  pass('Touch pet, throw and whistle preserve companion ownership and perform their real actions');

  await stick(0, -44);
  await sleep(200);
  const finger = await center('[data-touch-action="menu"]');
  const activeStick = await center('#touch-stick');
  await touch('touchStart', [
    { id: 1, x: activeStick.x, y: activeStick.y - 44 },
    { id: 2, ...finger },
  ]);
  await touch('touchEnd');
  await phone.page.locator('#modal[open]').waitFor();
  await until(() => !phone.player().moving, 'menu stops');
  assert.equal(await phone.page.locator('#touch-controls').isVisible(), false);
  await phone.tap('[data-pause-tab="settings"]');
  assert.doesNotMatch(
    await phone.page.locator('#pause-panel-settings').innerText(),
    /未接続|コントローラー/,
  );
  assert.match(await phone.page.locator('#pause-panel-settings').innerText(), /なぞる/);
  await shot('04-touch-settings');
  await phone.tap('[data-pause-tab="mascots"]');
  assert.deepEqual(
    new Set(
      await phone.page
        .locator('[data-mascot]')
        .evaluateAll((cards) => cards.map((c) => c.dataset.mascot)),
    ),
    new Set([...BOT_KINDS, 'rimo-neko', '524']),
  );
  await shot('05-touch-companions');
  await phone.tap('#modal-close');
  await phone.page.locator('#touch-controls').waitFor({ state: 'visible' });
  await sleep(300);
  assert.equal(phone.player().moving, false);
  await phone.tap('#map-button');
  await phone.page.locator('#big-map').waitFor();
  await phone.tap('#map-zoom-in');
  await shot('06-touch-map');
  await phone.tap('#modal-close');
  assert.equal(
    await phone.page.locator('[data-touch-action="journal"], #adventure-button').count(),
    0,
  );
  pass(
    'Touch menu stops a held thumb; settings, the released companion roster and map are directly usable; journal is absent',
  );

  for (const size of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await phone.page.setViewportSize(size);
    await sleep(400);
    await layouts();
    await shot(`08-${size.width}x${size.height}`);
    await phone.tap('[data-touch-action="menu"]');
    await phone.tap('[data-pause-tab="mascots"]');
    assert.deepEqual(
      new Set(
        await phone.page
          .locator('[data-mascot]')
          .evaluateAll((cards) => cards.map((c) => c.dataset.mascot)),
      ),
      new Set([...BOT_KINDS, 'rimo-neko', '524']),
    );
    assert.equal(
      await phone.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await shot(`09-menu-${size.width}x${size.height}`);
    await phone.tap('#modal-close');
  }
  pass(
    '320x568 and 430x932 portrait plus 844x390 landscape retain readable, non-overlapping touch controls and menus',
  );

  await phone.page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
  await phone.tap('[data-touch-action="chat"]');
  await until(() => phone.page.locator('#touch-controls').isHidden(), 'chat stops controls');
  await phone.tap('#chat-toggle');
  const peer = await open(false);
  await phone.page.bringToFront();
  assert.equal(await peer.page.locator('#touch-controls').isVisible(), false);
  assert.equal(await peer.page.locator('#input-cues').getAttribute('data-device'), 'keyboard');
  await place(76, 68);
  await stick(0, -44);
  await sleep(600);
  await touch('touchEnd');
  await until(
    () =>
      peer.seen.state.players?.some(
        (p) =>
          p.id === phone.seen.id &&
          Math.hypot(p.x - phone.player().x, p.z - phone.player().z) < 0.15,
      ),
    'peer sees touch movement',
  );
  await phone.page.reload();
  await phone.page.locator('#title-start').waitFor();
  await phone.tap('#title-start');
  await phone.tap('#setup-form .character-choice:has(input[value="cro-female"])');
  await phone.tap('#setup-flow-yes');
  await enterPreparedWorld(phone.page, true);
  await phone.page.locator('#touch-controls').waitFor({ timeout: 120000 });
  await shot('10-reconnected');
  pass(
    'Chat cannot leak movement; desktop keeps its keyboard UI; peer receives touch movement and mobile UI survives reload',
  );
  assert.equal(
    phone.seen.sent.filter((m) => m.type === 'action' && ['attack', 'jump'].includes(m.action))
      .length,
    3,
  );
  assert.deepEqual(errors, []);
  pass('No duplicate attack/jump commands or browser exceptions');
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  if (phone) await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify({ packageId, checks, errors, failure, physicalDeviceTested: false }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log(out);
}
