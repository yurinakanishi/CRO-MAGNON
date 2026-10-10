// Local profile, isolated memory-only room. Inspect actual game materials/lights.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/cave-524-frieze-20261006/final-r02';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  shots = [],
  checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (b) => createHash('sha256').update(b).digest('hex');
let failure, id;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('websocket', (ws) =>
  ws.on('framereceived', ({ payload }) => {
    const m = JSON.parse(String(payload));
    if (m.type === 'welcome') id = m.id;
  }),
);
await page.addInitScript(() => {
  localStorage.setItem('cro-name', 'MuralReview');
  localStorage.setItem('cro-graphics-quality', 'standard');
});
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  assert.ok(source.includes('this.camera.lookAt(aim);'));
  await route.fulfill({
    response,
    body:
      source.replace(
        'this.camera.lookAt(aim);',
        'this.camera.lookAt(aim);if(window.reviewView){this.camera.position.set(...reviewView.eye);this.camera.lookAt(...reviewView.target);this.camera.fov=reviewView.fov??70;this.camera.updateProjectionMatrix();}',
      ) +
      '\nconst renderReview524=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){const r=renderReview524.apply(this,a);window.qa=this;return r;};',
  });
});
async function ready() {
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(() => window.qa?.landmarks.caveCharacter524?.image?.complete, null, {
    timeout: 60000,
  });
}
async function shot(name, view) {
  await page.evaluate((view) => {
    window.reviewView = view;
  }, view);
  await sleep(900);
  await page.screenshot({ path: `${out}/${name}.png` });
  shots.push({ name, view, viewport: page.viewportSize() });
  console.log('CAPTURE', name);
}
try {
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await ready();
  const room = game.rooms.get('LOCAL_VERIFY');
  assert.ok(room?.players.has(id));
  room.enemies = [];
  room.behemoth = null;
  room.sabertooth = null;
  room.camp.caveFireLit = true;
  const p = room.players.get(id),
    center = caveWorldAt(-21.2);
  async function place(side) {
    stopActor(p);
    Object.assign(p, caveWorldAt(-21.2, side * 3.5), {
      facing: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      warpSequence: (p.warpSequence ?? 0) + 1,
    });
    await sleep(900);
  }
  await place(1);
  const west = {
    eye: [center.x + 1.1, 2.5, center.z],
    target: [center.x - 5.7, 2.1, center.z],
    fov: 75,
  };
  await shot('524-whole-wall', west);
  await shot('524-close', {
    eye: [center.x - 1.4, 2.3, center.z],
    target: [center.x - 5.7, 2.05, center.z],
    fov: 64,
  });
  room.camp.caveFireLit = false;
  await shot('524-torch', west);
  room.camp.caveFireLit = true;
  await place(-1);
  await shot('rimo-opposite', {
    eye: [center.x - 1.1, 2.5, center.z],
    target: [center.x + 5.7, 2.1, center.z],
    fov: 75,
  });
  await place(1);
  await page.evaluate(() => {
    qa.yaw = Math.PI / 2;
    qa.pitch = 0.1;
    qa.targetDistance = 4.5;
  });
  await shot('normal-camera', null);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await shot(`normal-${width}x${height}`, null);
  }
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const image = await page.evaluate(() => ({
    src: qa.landmarks.caveCharacter524.image.src,
    width: qa.landmarks.caveCharacter524.image.naturalWidth,
    height: qa.landmarks.caveCharacter524.image.naturalHeight,
  }));
  assert.equal(new URL(image.src).pathname, asset.characterPigment.url);
  assert.equal(image.width, 2171);
  assert.equal(image.height, 724);
  assert.equal(
    hash(Buffer.from(await (await fetch(image.src)).arrayBuffer())),
    asset.characterPigment.sha256,
  );
  checks.push('Generated RGBA is loaded intact through the local game manifest');
  await page.reload();
  // The local profile returns to the title; re-enter through its visible UI.
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await ready();
  assert.equal(
    new URL(await page.evaluate(() => qa.landmarks.caveCharacter524.image.src)).pathname,
    asset.characterPigment.url,
  );
  checks.push('Same new pigment is loaded after rejoin; saved rooms are untouched');
  checks.push(
    'Whole wall, close view, hearth off, opposite Rimo and three viewport sizes captured with actual game lights',
  );
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e.stack ?? e);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(failure);
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        checks,
        shots,
        errors,
        failure,
        fixture:
          'Local environment, memory-only game. Player placement, hearth state and observation camera are QA setup; unmodified game lighting, geometry and materials.',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, checks, errors, failure }));
if (failure) process.exitCode = 1;
