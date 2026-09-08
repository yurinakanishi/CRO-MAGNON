// Real Chrome, real rendering/server/DOM; only navigator.getGamepads is simulated.
// No controller shim or test hooks are installed in production code.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { isLand } from '../dist/shared/paleo-geography.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
import WebSocket from 'ws';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || 'output/playwright/gamepad-20260908';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await sleep(50);
  }
}
const errors = [],
  checks = [],
  fixtures = [],
  speeds = [],
  peers = [];
let browser,
  page,
  current = 'load';
const passed = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Controller QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
    window.qaPad = {
      id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      index: 2,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    window.qaDevices = [null, null, window.qaPad];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        if (window.qaDenied) throw new DOMException('QA denied', 'SecurityError');
        return window.qaDevices;
      },
    });
  });
  await page.goto(`${base}/?room=PAD-QA`);
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  await page.locator('#world').focus();
  const room = game.rooms.get('PAD-QA'),
    player = () => [...room.players.values()].find((p) => p.name === 'Controller QA');
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=PAD-QA&name=Observer${i}`),
      peer = { ws, states: [] };
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes);
      if (message.type === 'state') peer.states.push(message);
    });
    peers.push(peer);
    await until(() => peer.states.length, 'observer connection');
  }
  await until(() => room.players.size === 5, 'five players');
  const axes = async (x = 0, y = 0, rx = 0, ry = 0, ms = 140) => {
    await page.evaluate(
      (values) => {
        window.qaPad.axes = values;
      },
      [x, y, rx, ry],
    );
    await sleep(ms);
  };
  const button = async (index, held) =>
    page.evaluate(
      ({ index, held }) => {
        window.qaPad.buttons[index] = { pressed: held, value: held ? 1 : 0 };
      },
      { index, held },
    );
  const tap = async (index) => {
    await button(index, true);
    await sleep(140);
    await button(index, false);
    await sleep(180);
  };
  const select = async (selector) => {
    for (let i = 0; i < 70; i++) {
      if (
        await page
          .locator(selector)
          .evaluateAll((els) => els.some((el) => el.classList.contains('gamepad-focus')))
      )
        return;
      await tap(PAD.down);
    }
    throw new Error(`Menu item unreachable: ${selector}`);
  };
  const position = () => ({ x: player().x, z: player().z });
  const delta = (point) => Math.hypot(player().x - point.x, player().z - point.z);
  const stage = async (point, label) => {
    await axes();
    stopActor(player());
    Object.assign(player(), point);
    fixtures.push({ label, ...point });
    await sleep(400);
  };
  // Stage in a measured clear patch near the spawn; retain actual world collision.
  let clear;
  const start = position();
  for (let x = start.x - 14; x <= start.x + 14 && !clear; x += 2)
    for (let z = start.z - 14; z <= start.z + 14 && !clear; z += 2)
      if (
        isLand(x, z) &&
        room.collision.free({ x, z }, 5) &&
        [...room.players.values(), ...room.animals].every(
          (a) => a.id === player().id || Math.hypot(x - a.x, z - a.z) > 7,
        )
      )
        clear = { x, z };
  assert.ok(clear);
  await stage(clear, 'clear ground near normal spawn');

  current = 'analog gait';
  await axes(0.5, 0, 0, 0, 450);
  assert.equal(player().running, false);
  assert.ok(player().speed > 0.1);
  const walkSpeed = player().speed;
  speeds.push({ mode: 'shallow walk', speed: walkSpeed });
  await axes(1, 0, 0, 0, 450);
  assert.equal(player().running, true);
  assert.ok(player().speed > walkSpeed * 2);
  speeds.push({ mode: 'deep run', speed: player().speed });
  await axes(0.72, 0);
  assert.equal(player().runningRequested, true);
  await axes(0.6, 0);
  assert.equal(player().runningRequested, false);
  await axes();
  await sleep(150);
  const stopped = position();
  await sleep(220);
  assert.ok(delta(stopped) < 0.001);
  passed('analog walk/run, threshold hysteresis and neutral stop on real server');
  await until(
    () =>
      peers.every((p) =>
        p.states.some((s) => s.players.some((p) => p.name === 'Controller QA' && p.running)),
      ),
    'run synchronized',
  );
  passed('five participants receive the controller-driven movement');

  current = 'camera and attack';
  const yaw = Number(await page.locator('#world').getAttribute('data-camera-yaw'));
  await axes(0, 0, 0.8, -0.4, 800);
  await axes();
  await sleep(650);
  assert.ok(
    Math.abs(Number(await page.locator('#world').getAttribute('data-camera-yaw')) - yaw) > 0.1,
  );
  const sequence = player().attackSequence;
  await button(PAD.square, true);
  await sleep(1300);
  await button(PAD.square, false);
  await sleep(220);
  assert.equal(player().attackSequence, sequence + 1);
  await tap(PAD.r2);
  assert.equal(player().attackSequence, sequence + 2);
  passed('right-stick camera, square and R2 attack, held button fires once');
  // The shared action rules reject gathering during the current attack animation.
  await sleep(800);
  const gathered = player().gathered;
  await tap(PAD.cross);
  await until(() => player().gathered > gathered, 'cross gathers nearby resource');
  passed('cross gathers a real nearby resource through the existing action handler');
  await page.screenshot({ path: `${output}/01-controller-game.png` });

  current = 'menu guards';
  await axes(1);
  await tap(PAD.options);
  assert.equal(await page.locator('#modal').evaluate((d) => d.open), true);
  await sleep(200);
  const menuPosition = position(),
    menuAttack = player().attackSequence;
  await tap(PAD.square);
  await sleep(300);
  assert.ok(delta(menuPosition) < 0.001);
  assert.equal(player().attackSequence, menuAttack);
  await axes();
  await select('[data-controller-menu="inventory"]');
  await tap(PAD.cross);
  assert.equal(await page.locator('#modal-craft').count(), 1);
  await tap(PAD.circle);
  await axes(1);
  await tap(PAD.options);
  await axes();
  await tap(PAD.circle);
  await axes();
  passed(
    'OPTIONS stops movement; menus consume held axes and attack; D-pad/X opens inventory; circle closes',
  );

  current = 'inventory and map';
  player().inventory.wood = 15;
  player().inventory.stone = 2;
  fixtures.push({ label: 'craft supplies', wood: 15, stone: 2 });
  await sleep(500);
  await tap(PAD.left);
  await select('#modal-craft');
  await tap(PAD.cross);
  await until(() => player().tool, 'craft through menu');
  assert.equal(player().inventory.wood, 12);
  assert.equal(player().inventory.stone, 0);
  await tap(PAD.up);
  await select('#expedition-destination');
  const beforeDestination = await page.locator('#expedition-destination').inputValue();
  await tap(PAD.right);
  assert.notEqual(await page.locator('#expedition-destination').inputValue(), beforeDestination);
  await tap(PAD.cross);
  assert.notEqual(
    await page.locator('.gamepad-focus').getAttribute('id'),
    'expedition-destination',
  );
  await tap(PAD.circle);
  await tap(PAD.right);
  assert.equal(await page.locator('#modal').evaluate((d) => d.open), true);
  await tap(PAD.circle);
  passed('inventory crafting uses server costs; map select changes with left/right; journal opens');

  current = 'disconnect and focus';
  await axes(1);
  await page.evaluate(() => {
    window.qaDevices = [];
  });
  await sleep(250);
  const disconnectedPosition = position();
  await sleep(300);
  assert.ok(delta(disconnectedPosition) < 0.001);
  await page.evaluate(() => {
    window.qaDevices = [null, null, window.qaPad];
  });
  await sleep(220);
  assert.ok(delta(disconnectedPosition) < 0.001);
  await axes();
  await axes(0.5);
  assert.ok(delta(disconnectedPosition) > 0.02);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(220);
  const blurred = position();
  await sleep(220);
  assert.ok(delta(blurred) < 0.001);
  await axes();
  await axes(0.5);
  await page.locator('#chat-input').focus();
  await sleep(220);
  const chatting = position();
  await tap(PAD.square);
  assert.ok(delta(chatting) < 0.001);
  await page.locator('#world').focus();
  await sleep(180);
  assert.ok(delta(chatting) < 0.001);
  await axes();
  passed('disconnect, reconnect with held stick, blur and chat focus stop and require neutral');

  current = 'keyboard coexistence';
  await page.locator('#run-button').evaluate((b) => b.click());
  await sleep(150);
  await axes(0.5);
  assert.equal(player().runningRequested, false);
  await axes();
  await page.keyboard.down('w');
  await sleep(300);
  assert.ok(player().moving);
  await page.keyboard.up('w');
  await sleep(200);
  await axes(1);
  assert.equal(player().runningRequested, true);
  await axes();
  passed('keyboard run mode cannot override analog gait; keyboard remains usable');

  current = 'mammoth';
  const animal = room.animals[0];
  stopActor(animal);
  animal.nextRoam = animal.age + 10000;
  await stage(
    { x: animal.x + animal.radius + player().radius + 0.6, z: animal.z },
    'beside existing mammoth',
  );
  await tap(PAD.triangle);
  await until(() => player().mountId, 'controller mount');
  await axes(0.5, 0, 0, 0, 350);
  assert.equal(animal.runningRequested, false);
  speeds.push({ mode: 'mammoth shallow', speed: animal.speed });
  await axes(1, 0, 0, 0, 350);
  assert.equal(animal.runningRequested, true);
  assert.ok(animal.moving);
  speeds.push({ mode: 'mammoth deep', speed: animal.speed });
  await axes();
  await tap(PAD.triangle);
  await until(() => !player().mountId, 'controller dismount');
  passed('triangle mounts/dismounts existing mammoth; analog gait controls the mount');

  current = 'boat';
  await stage({ x: 21, z: 125 }, 'known usable shore; remaining 12 wood from craft fixture');
  await tap(PAD.left);
  await select('#modal-boat-craft');
  await tap(PAD.cross);
  await until(() => room.boats.length === 1, 'controller boat craft');
  await sleep(550);
  await tap(PAD.triangle);
  await until(() => player().boatId, 'controller board');
  const boat = room.boats[0];
  const boatStart = position();
  const cameraYaw = Number(await page.locator('#world').getAttribute('data-camera-yaw'));
  const length = Math.hypot(boat.mooring.x - boat.shore.x, boat.mooring.z - boat.shore.z);
  const dx = (boat.mooring.x - boat.shore.x) / length,
    dz = (boat.mooring.z - boat.shore.z) / length;
  const sx = Math.cos(cameraYaw) * dx - Math.sin(cameraYaw) * dz;
  const sy = Math.sin(cameraYaw) * dx + Math.cos(cameraYaw) * dz;
  await axes(sx * 0.5, sy * 0.5, 0, 0, 200);
  assert.equal(boat.runningRequested, false);
  speeds.push({ mode: 'boat shallow', speed: boat.speed });
  await axes(sx, sy, 0, 0, 200);
  assert.equal(boat.runningRequested, true);
  speeds.push({ mode: 'boat deep', speed: boat.speed });
  assert.ok(delta(boatStart) > 0.1);
  await axes();
  await tap(PAD.triangle);
  await until(() => !player().boatId, 'controller land');
  passed('inventory builds a boat; triangle boards/lands; stick controls boat gait');

  current = 'responsive menus and API failure';
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await tap(PAD.options);
    await select('[data-controller-menu="help"]');
    await tap(PAD.cross);
    assert.equal(await page.locator('.gamepad-help').count(), 1);
    const overflow = await page.locator('#modal').evaluate((d) => d.scrollWidth - d.clientWidth);
    assert.ok(overflow <= 1, `dialog overflow ${overflow}`);
    const scrollBefore = await page.locator('#modal').evaluate((d) => d.scrollTop);
    await page.screenshot({ path: `${output}/help-${viewport.width}x${viewport.height}.png` });
    await axes(0, 0, 0, 1, 500);
    await axes();
    assert.ok((await page.locator('#modal').evaluate((d) => d.scrollTop)) > scrollBefore);
    await tap(PAD.circle);
  }
  await page.evaluate(() => {
    window.qaPad.mapping = '';
  });
  await sleep(200);
  assert.equal(await page.locator('#world').getAttribute('data-gamepad-status'), 'unsupported');
  await page.evaluate(() => {
    window.qaDenied = true;
  });
  await sleep(200);
  assert.equal(await page.locator('#world').getAttribute('data-gamepad-status'), 'unavailable');
  await page.evaluate(() => {
    window.qaDenied = false;
    window.qaPad.mapping = 'standard';
  });
  await axes();
  passed('portrait/landscape controller help fits; unmapped and blocked API fail safely');
  const id = player().id,
    inventory = { ...player().inventory };
  await page.reload();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  await page.locator('#world').focus();
  await sleep(500);
  assert.equal(player().id, id);
  assert.deepEqual(player().inventory, inventory);
  await axes(0.5);
  assert.equal(player().runningRequested, false);
  assert.ok(player().moving);
  await axes();
  passed('same-tab reload preserves player inventory and re-arms the connected controller');
  assert.deepEqual(errors, []);
  const report = {
    status: 'passed',
    at: new Date().toISOString(),
    browser: 'Chrome headless, real WebGL',
    input: 'navigator.getGamepads simulated standard DualShock 4; physical controller untested',
    realBrowsers: 1,
    protocolObservers: 4,
    checks,
    fixtures,
    speeds,
    errors,
    snapshots: peers.map((p) => p.states.length),
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  const report = {
    status: 'failed',
    current,
    error: error.stack,
    checks,
    errors,
    fixtures,
    speeds,
  };
  await writeFile(`${output}/failure.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  for (const peer of peers) peer.ws.terminate();
  await browser?.close();
  await game.close();
}
