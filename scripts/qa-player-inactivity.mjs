import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import {
  IDLE_CLOSE_CODE,
  IDLE_MESSAGE,
  IDLE_TIMEOUT_MS,
} from '../dist/shared/player-inactivity.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = `output/playwright/player-inactivity-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
// Verify native tab focus in an isolated off-screen window, leaving the user's browser alone.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=-32000,-32000'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [],
  checks = [],
  observations = [],
  welcomes = [],
  sent = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('websocket', (socket) => {
  socket.on('framereceived', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'welcome') welcomes.push(message);
  });
  socket.on('framesent', ({ payload }) => {
    const message = JSON.parse(String(payload));
    sent[message.type] = (sent[message.type] || 0) + 1;
  });
});
try {
  await page.addInitScript(() => {
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=INACTIVITY-QA&autostart=1`);
  const canvas = page.locator('#world[data-world-asset="ready"][data-character-asset="ready"]');
  // These real key presses are preparation while first-time assets load, never idle-test evidence.
  const preparing = setInterval(() => {
    page.keyboard.press('Shift').catch(() => {});
  }, 2000);
  try {
    await canvas.waitFor({ timeout: 90000 });
  } finally {
    clearInterval(preparing);
  }
  await until(() => welcomes.length === 1, 'first welcome');
  const room = game.rooms.get('INACTIVITY-QA');
  let player = room.players.get(welcomes[0].id);
  player.inventory.wood = 7; // Isolated test belongings; this server has no save directory.
  player.gathered = 9;
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="mascots"]').click();
  await page.locator('[data-mascot="524"]').click();
  await until(() => player.mascot === '524', 'mascot selection');
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowRight');
  await sleep(250);
  const background = await page.context().newPage();
  // Disable Playwright's focus emulation and observe the native tab focus change,
  // rather than dispatching a synthetic blur or visibility event.
  const tabLifecycle = await context.newCDPSession(page);
  const backgroundLifecycle = await context.newCDPSession(background);
  await tabLifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await backgroundLifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await background.goto('about:blank');
  await background.bringToFront();
  await until(() => page.evaluate(() => !document.hasFocus()), 'actual tab loses input focus');
  await background.keyboard.up('ArrowRight');
  await until(() => player.dx === 0 && player.dz === 0, 'tab switch stops held movement');
  const resumePosition = { x: player.x, z: player.z };
  const lastInputAt = player.lastActivityAt;
  const tabState = await page.evaluate(() => ({
    hidden: document.hidden,
    focused: document.hasFocus(),
  }));
  assert.equal(room.players.size, 1);
  assert.equal(player.dx, 0);
  assert.equal(player.dz, 0);
  await until(
    () => room.players.size === 0,
    '30-second background-tab exit',
    IDLE_TIMEOUT_MS + 5000,
  );
  const idleElapsedMs = Date.now() - lastInputAt;
  assert.ok(
    idleElapsedMs >= IDLE_TIMEOUT_MS && idleElapsedMs < IDLE_TIMEOUT_MS + 1500,
    `${idleElapsedMs} ms`,
  );
  observations.push({
    label: 'actual tab activation and loss of input focus',
    tabState,
    idleElapsedMs,
    heartbeatsSent: sent.ping,
  });
  assert.ok(sent.ping >= 5, 'heartbeats continued without extending activity');
  assert.equal(room.sessions.get(welcomes[0].session).player.inventory.wood, 7);
  assert.equal(room.companions.length + room.orbBots.length, 0);
  pass('Actual tab switch stops movement and frees the slot after 30 seconds despite heartbeats');
  await page.bringToFront();
  await tabLifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.locator('#retry-session').waitFor();
  assert.equal(await page.locator('#setup-error').textContent(), IDLE_MESSAGE);
  assert.equal(await page.locator('#retry-session').textContent(), '続きから再開する');
  await page.screenshot({ path: `${folder}/idle-exit.png` });
  await sleep(6000);
  assert.equal(room.players.size, 0);
  assert.equal(welcomes.length, 1);
  pass('Returning to the tab shows the reason and never reconnects automatically');
  await page.locator('#retry-session').click();
  await until(() => welcomes.length === 2 && room.players.size === 1, 'explicit resume');
  assert.equal(welcomes[1].id, welcomes[0].id);
  assert.equal(welcomes[1].resumed, true);
  player = room.players.get(welcomes[1].id);
  assert.equal(player.inventory.wood, 7);
  assert.equal(player.gathered, 9);
  assert.equal(player.mascot, '524');
  assert.ok(Math.hypot(player.x - resumePosition.x, player.z - resumePosition.z) < 0.01);
  pass('Manual resume restores the same traveller, position, belongings and companion');

  async function checkInput(label, operate) {
    await sleep(1100); // Let the activity-report throttle open before one real input.
    player.lastActivityAt = Date.now() - 29000; // Boundary preparation, not a measured 30-second wait.
    const seeded = player.lastActivityAt;
    await operate();
    await until(() => player.lastActivityAt > seeded, label);
    await sleep(1150);
    assert.ok(room.players.has(player.id), label);
    observations.push({ label, method: 'prepared deadline + real input' });
    pass(label);
  }
  await checkInput('Mouse camera input alone renews activity', async () => {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up({ button: 'right' });
  });
  assert.equal(player.dx, 0);
  assert.equal(player.dz, 0);
  await checkInput('Keyboard and menu selection renew activity', async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="settings"]').click();
  });
  await checkInput('Simulated controller scrolling renews activity without movement', async () => {
    await page.evaluate(() => {
      window.qaPad.axes = [0, 0, 0, 0.7];
    });
    await sleep(250);
    await page.evaluate(() => {
      window.qaPad.axes = [0, 0, 0, 0];
    });
  });
  await page.keyboard.press('Escape');
  await checkInput('Typing an unsent chat message renews activity', async () => {
    await page.locator('#chat-toggle').click();
    await page.locator('#chat-input').click();
    await page.keyboard.type('still typing');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await checkInput('Simulated mobile touch input renews activity', async () => {
    const box = await canvas.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
  await page.keyboard.press('Escape');
  await sleep(1100);
  player.lastActivityAt = Date.now() - 29000;
  await page.dispatchEvent('#world', 'pointermove', { clientX: 120, clientY: 200 });
  await until(() => room.players.size === 0, 'synthetic events do not count');
  await page.locator('#retry-session').waitFor();
  pass('Synthetic DOM events and an open menu cannot keep an idle player connected');
  await page.locator('#retry-session').click();
  await until(() => room.players.size === 1, 'resume for close-code fallback');
  room.players.values().next().value.socket.close(IDLE_CLOSE_CODE, 'Idle timeout');
  await page.locator('#retry-session').waitFor();
  await sleep(3500);
  assert.equal(room.players.size, 0);
  pass('The idle close code alone prevents automatic retries even without an explanation frame');
  assert.deepEqual(errors, []);
  const hashes = {};
  for (const file of [
    'dist/src/main.js',
    'dist/application/game-core.mjs',
    'dist/shared/player-inactivity.mjs',
  ])
    hashes[file] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  const report = {
    checkedAt: new Date().toISOString(),
    status: 'passed',
    host: 'isolated Node port 0 without saves',
    browser: 'Chrome headed in an isolated off-screen window',
    checks,
    observations,
    sent,
    errors,
    hashes,
    unverified: ['physical gamepad', 'actual smartphone', 'Safari', 'live public deployment'],
  };
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  console.log('Evidence:', folder);
} finally {
  await browser.close();
  await game.close();
}
