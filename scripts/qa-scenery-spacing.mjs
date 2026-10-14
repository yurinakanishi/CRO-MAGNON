// Real Chrome, isolated memory-only room: looks at the steepest flanks of the camp mountain and
// the cave's foothill, where scenery used to stand on the slope (user request 2026-10-14), and
// photographs them. The viewpoints are chosen from the server terrain: steep ground with the
// most scattered scenery around it. Player and camera positions are preparation; nothing here
// is an input test.
// node scripts/qa-scenery-spacing.mjs [output]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { MOUNTAIN_BOUNDS } from '../dist/shared/camp-mountain.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { footprintGrade, footprintRadius, MAX_GRADE } from '../dist/shared/scenery-spacing.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/scenery-spacing-${Date.now()}`;
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Steep flanks (grade over 0.5 across 8 m) ranked by the scenery within 25 m of them.
const all = [...SCENERY.trees, ...SCENERY.rocks, ...SCENERY.grass, ...SCENERY.props];
const steep = [];
for (let x = MOUNTAIN_BOUNDS.minX; x <= MOUNTAIN_BOUNDS.maxX; x += 8)
  for (let z = MOUNTAIN_BOUNDS.minZ; z <= MOUNTAIN_BOUNDS.maxZ; z += 8) {
    const grade = footprintGrade(x, z, 4);
    if (grade < 0.5) continue;
    const around = all.filter((o) => Math.abs(o.x - x) < 25 && Math.abs(o.z - z) < 25).length;
    steep.push({ x, z, grade, around });
  }
steep.sort((a, b) => b.around - a.around);
const views = [];
for (const point of steep)
  if (views.length < 4 && views.every((v) => Math.hypot(v.x - point.x, v.z - point.z) > 60))
    views.push(point);
assert.ok(views.length >= 2, 'steep flanks to look at');
// Stand 28 m downhill of each flank and look up at it.
for (const view of views) {
  const e = 2,
    gx = walkHeight(view.x + e, view.z) - walkHeight(view.x - e, view.z),
    gz = walkHeight(view.x, view.z + e) - walkHeight(view.x, view.z - e),
    length = Math.hypot(gx, gz) || 1;
  view.eye = { x: view.x - (gx / length) * 28, z: view.z - (gz / length) * 28 };
}

const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
// The 30-second idle exit would end this unattended photography; keep the clock fresh.
const keepActive = setInterval(() => {
  for (const room of game.rooms.values())
    for (const player of room.players.values()) player.lastActivityAt = Date.now();
}, 5000);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  shots = [];
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nconst spacingRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.qaWorld=this;const result=spacingRender.apply(this,args);if(window.qaReviewCamera&&!this.disposed&&!this.loadingCave)this.renderer.render(this.scene,window.qaReviewCamera);return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=SPACINGQA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  const room = game.rooms.get('SPACINGQA'),
    player = [...room.players.values()][0];
  room.enemies = [];
  for (const [i, view] of views.entries()) {
    stopActor(player);
    Object.assign(player, view.eye, { warpSequence: (player.warpSequence ?? 0) + 1 });
    await page.waitForFunction(() => !!window.qaWorld, null, { timeout: 30000 });
    // Let the distance-ordered streaming bring in the scenery around the new place.
    await sleep(9000);
    const target = { x: view.x, y: walkHeight(view.x, view.z), z: view.z },
      eye = { ...view.eye, y: walkHeight(view.eye.x, view.eye.z) + 7 };
    await page.evaluate(
      ({ eye, target }) => {
        const camera = window.qaWorld.camera.clone();
        camera.position.set(eye.x, eye.y, eye.z);
        camera.lookAt(target.x, target.y, target.z);
        camera.fov = 60;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        window.qaReviewCamera = camera;
      },
      { eye, target },
    );
    await sleep(1500);
    const file = `${out}/flank-${i + 1}.png`;
    await page.screenshot({ path: file });
    await page.evaluate(() => (window.qaReviewCamera = null));
    // What stands near this flank, by the same measure the scatter uses.
    const near = (o) => Math.hypot(o.x - view.x, o.z - view.z) < 25;
    const worst = (items, kind) =>
      Math.max(
        0,
        ...items
          .filter(near)
          .map((o) => footprintGrade(o.x, o.z, footprintRadius(o), kind === 'grass')),
      );
    shots.push({
      file,
      flank: { x: view.x, z: view.z, grade: Number(view.grade.toFixed(3)) },
      eye: view.eye,
      steepestFootprint: {
        tree: Number(worst(SCENERY.trees, 'tree').toFixed(3)),
        rock: Number(worst(SCENERY.rocks, 'rock').toFixed(3)),
        grass: Number(worst(SCENERY.grass, 'grass').toFixed(3)),
      },
    });
    console.log('SHOT', JSON.stringify(shots.at(-1)));
  }
  for (const shot of shots) {
    assert.ok(shot.steepestFootprint.rock <= MAX_GRADE.rock, shot.file);
    assert.ok(shot.steepestFootprint.grass <= MAX_GRADE.grass, shot.file);
  }
  assert.deepEqual(errors, []);
  console.log('PASS', `${shots.length} steep flanks photographed; no browser errors`);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
} finally {
  clearInterval(keepActive);
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        shots,
        errors,
        failure,
        fixture:
          'Memory-only server; player and camera positions are preparation. Viewpoints are chosen from the server terrain, not hand-picked.',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
