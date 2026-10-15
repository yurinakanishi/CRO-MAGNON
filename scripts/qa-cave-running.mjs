// Real Chrome in an isolated, unsaved room. Fixtures set the starting position;
// keyboard/touch input and simulated gamepad state drive the actual cave renderer.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createGameServer } from '../dist/server.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/cave-running-20261015/after';
const observe = process.argv.includes('--observe');
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  issues = [],
  errors = [],
  pictures = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failure, page, release;
async function open(mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/*.glb', async (route) => {
    if (!/\/models\/(camp-cave|cro-magnon-hunter|firewood-log)\//.test(route.request().url()))
      await held;
    await route.continue().catch(() => {});
  });
  await page.route('**/src/loading-cave.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst qaRender=LoadingCave.prototype.render;LoadingCave.prototype.render=function(...args){window.qaCave=this;return qaRender.apply(this,args);};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=CAVERUN`);
  const click = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await click('#title-start');
  await click('.character-choice:has(input[value="cro-male"])');
  await click('#setup-flow-yes');
  await click('#mascot-start');
  await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
  return context;
}
async function place() {
  await page.evaluate((position) => {
    qaCave.movement.position = position;
    qaCave.movement.facing = Math.PI;
    qaCave.yaw = 0;
    qaCave.pitch = 0.1;
  }, caveWorldAt(-20));
}
async function sample(label, expected) {
  await sleep(320);
  const state = await page.evaluate(() => ({
    animation: document.querySelector('#world').dataset.caveAnimation,
    speed: qaCave.movement.speed,
    position: { ...qaCave.movement.position },
  }));
  checks.push({ label, expected, ...state });
  if (state.animation !== expected)
    issues.push(`${label}: ${state.animation}, expected ${expected}`);
  if (expected === 'Run_Loop' && state.speed < 1.5)
    issues.push(`${label}: insufficient speed ${state.speed}`);
  console.log('OBSERVED', label, JSON.stringify(state));
  return state;
}
async function picture(name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  // Same central cave rectangle at the same camera/position, excluding the UI.
  const stats = await sharp(path).extract({ left: 250, top: 150, width: 900, height: 550 }).stats();
  pictures.push({ name, meanRgb: stats.channels.slice(0, 3).map((c) => c.mean) });
}
try {
  const desktop = await open();
  await place();
  await sleep(450);
  await picture('torch-on');
  await page.locator('[data-cave-torch]').click();
  await sleep(450);
  await picture('torch-off');
  const lights = await page.evaluate(() =>
    qaCave.scene.children
      .filter((c) => c.isLight)
      .map((c) => ({ type: c.type, intensity: c.intensity })),
  );
  checks.push({ label: 'Cave lighting', lights });
  await page.locator('[data-cave-torch]').click();
  await page.keyboard.down('w');
  await sample('keyboard walk', 'Walk_Loop');
  await page.keyboard.press('Shift');
  const run = await sample('Shift tap keeps running after release', 'Run_Loop');
  await page.keyboard.press('Shift');
  const walk = await sample('second Shift tap returns to walking', 'Walk_Loop');
  if (!(run.speed > walk.speed * 1.5))
    issues.push('Shift toggle does not increase actual travel speed');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Shift');
  await sample('held Shift repeat does not toggle twice', 'Run_Loop');
  await page.keyboard.up('Shift');
  await sample('Shift keyup retains run mode', 'Run_Loop');
  await page.keyboard.up('w');
  await sample('key release stops travel', 'Idle_Loop');
  await place();
  await page.evaluate(() => {
    window.__cavePad = {
      connected: true,
      index: 0,
      id: 'QA',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => [window.__cavePad];
  });
  for (const [tilt, expected] of [
    [0.5, 'Walk_Loop'],
    [1, 'Run_Loop'],
    [0.74, 'Run_Loop'],
    [0.65, 'Walk_Loop'],
    [0.74, 'Walk_Loop'],
    [0, 'Idle_Loop'],
  ]) {
    await page.evaluate((tilt) => {
      __cavePad.axes[1] = -tilt;
    }, tilt);
    await sample(`gamepad tilt ${tilt}`, expected);
  }
  await place();
  await page.evaluate(() => {
    __cavePad.axes = [0.7, -0.7, 0, 0];
  });
  await sample('gamepad diagonal runs', 'Run_Loop');
  await page.evaluate(() => {
    __cavePad.axes = [0, 0, 0, 0];
  });
  // Opening a dialog discards held input. Closing cannot leave movement stuck.
  await page.locator('[data-cave-murals]').click();
  await page.keyboard.press('Shift');
  await page.locator('#modal-close').click();
  await page.keyboard.down('w');
  await sample('dialog closes with walk mode and accepts fresh input', 'Walk_Loop');
  await page.keyboard.up('w');
  await page.keyboard.press('Shift');
  await page.keyboard.down('w');
  await sample('run before blur', 'Run_Loop');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sample('blur discards held movement', 'Idle_Loop');
  await page.keyboard.up('w');
  await page.keyboard.down('w');
  await sample('fresh input after blur walks', 'Walk_Loop');
  await page.keyboard.up('w');
  await sleep(350);
  await place();
  await page.keyboard.press('w');
  await page.keyboard.down('w');
  const dash = await sample(
    'double-tapped movement runs after the second press is held',
    'Run_Loop',
  );
  if (!(dash.speed > walk.speed * 1.5))
    issues.push('double-tapped movement does not increase actual travel speed');
  await page.screenshot({ path: `${out}/double-tap-run.png` });
  await page.keyboard.up('w');
  await sample('releasing double-tapped movement stops travel', 'Idle_Loop');
  await page.keyboard.down('w');
  await sample('next single press walks after dash release', 'Walk_Loop');
  await page.keyboard.down('w');
  await page.keyboard.down('w');
  await sample('held movement repeat does not start a dash', 'Walk_Loop');
  await page.keyboard.up('w');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.down('ArrowUp');
  await sample('double-tapped arrow key runs', 'Run_Loop');
  await page.keyboard.down('d');
  await page.keyboard.up('ArrowUp');
  await sample('dash continues while another direction remains held', 'Run_Loop');
  await page.keyboard.up('d');
  await sample('releasing all directions ends the dash', 'Idle_Loop');
  await place();
  await page.keyboard.press('w');
  await sleep(350);
  await page.keyboard.down('w');
  await sample('taps more than 300ms apart walk', 'Walk_Loop');
  await page.keyboard.up('w');
  await page.keyboard.press('a');
  await page.keyboard.down('d');
  await sample('two different direction keys do not start a dash', 'Walk_Loop');
  await page.keyboard.up('d');
  await page.keyboard.press('w');
  await page.keyboard.down('w');
  await sample('double-tapped dash before dialog', 'Run_Loop');
  await page.locator('[data-cave-murals]').click();
  await page.keyboard.up('w');
  await sample('dialog stops the dash', 'Idle_Loop');
  await page.locator('#modal-close').click();
  await page.keyboard.down('w');
  await sample('fresh movement after dialog walks', 'Walk_Loop');
  await page.keyboard.up('w');
  await sleep(350);
  await page.keyboard.press('w');
  await page.keyboard.down('w');
  await sample('double-tapped dash before blur', 'Run_Loop');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sample('blur stops the dash', 'Idle_Loop');
  await page.keyboard.up('w');
  await page.keyboard.down('w');
  await sample('fresh movement after dash blur walks', 'Walk_Loop');
  await page.keyboard.up('w');
  release();
  await desktop.close();

  const mobile = await open(true);
  await place();
  const stick = await page.locator('.loading-cave-stick').boundingBox();
  const x = stick.x + stick.width / 2,
    y = stick.y + stick.height / 2;
  const cdp = await mobile.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  for (const [dy, expected] of [
    [-20, 'Walk_Loop'],
    [-42, 'Run_Loop'],
    [-30, 'Run_Loop'],
    [-24, 'Walk_Loop'],
    [-30, 'Walk_Loop'],
  ]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + dy, id: 1 }],
    });
    await sample(`touch displacement ${dy}`, expected);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sample('touch release stops travel', 'Idle_Loop');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 42, id: 1 }],
  });
  await sample('second touch can run', 'Run_Loop');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sample('touch cancellation stops travel', 'Idle_Loop');
  await page.screenshot({ path: `${out}/mobile.png` });
  await cdp.detach();
  release();
  await mobile.close();
  assert.equal(game.rooms.size, 0, 'loading cave never joins or changes a saved room');
  assert.deepEqual(errors, []);
  if (!observe) assert.deepEqual(issues, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (page && !page.isClosed())
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  release?.();
  const sourceSha256 = {};
  for (const file of [
    'src/loading-cave.ts',
    'shared/cave-light.mts',
    'scripts/qa-cave-running.mjs',
  ])
    sourceSha256[file] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        observe,
        ok: !failure && !issues.length,
        failure,
        checks,
        issues,
        errors,
        pictures,
        sourceSha256,
        environment:
          'Headless real Chrome, desktop 1440x900 and emulated touch 390x844; simulated standard gamepad; no physical phone/pad',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
  process.exit(failure ? 1 : 0);
}
