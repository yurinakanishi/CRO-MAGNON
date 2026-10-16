// Real Chrome on a disposable solo origin. Camera changes below use mouse/touch input;
// the renderer hook only observes the camera that each frame was drawn with.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const output = process.argv[2] || 'output/playwright/companion-ground-camera';
const before = process.argv.includes('--before');
const phone = process.argv.includes('--phone');
const landscape = process.argv.includes('--landscape');
const mascot = process.argv.find((a) => a.startsWith('--mascot='))?.slice(9) || 'beret';
const slope = process.argv.includes('--slope');
const fixture = process.argv
  .find((a) => a.startsWith('--fixture='))
  ?.slice(10)
  .split(',')
  .map(Number);
if (fixture) assert.ok(fixture.length === 2 && fixture.every(Number.isFinite));
await mkdir(output, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  delivered = [];
let page, failure;
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
try {
  for (const file of [
    'src/main.js',
    'src/world3d.js',
    'src/companion-view.js',
    'src/companion-camera.js',
    'src/orb-bot-renderer.js',
    'src/companion-524-renderer.js',
    'src/rimo-neko-renderer.js',
    'shared/terrain.mjs',
  ]) {
    const response = await fetch(new URL(file, base));
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    assert.equal(response.status, 200);
    const hash = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, sha(await readFile(`dist/${file}`)));
    delivered.push({ file, sha256: hash });
  }
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone,
    isMobile: phone,
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => errors.push(`Unexpected socket: ${ws.url()}`));
  if (fixture)
    await page.route('**/src/solo-worker.js', async (route) => {
      const response = await route.fetch();
      // Fixture preparation only, in this disposable worker; all camera operations use UI.
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
import { botGroundHeight as qaGround } from '/shared/orb-bots.mjs';
const qaStart = SoloRuntime.prototype.start;
SoloRuntime.prototype.start = async function(...args) {
  await qaStart.apply(this,args);
  const room=this.game.rooms.get('SOLO'), p=[...room.players.values()][0];
  const [x,z]=${JSON.stringify(fixture)};
  p.x=x; p.z=z+1.3; p.warpSequence=(p.warpSequence??0)+1;
  for(const b of room.orbBots) {
    Object.assign(b,{x,z,y:qaGround(x,z),mode:'waiting',speed:0,
      warpSequence:p.warpSequence,lastOwner:{x:p.x,z:p.z}});
  }
};`,
      });
    });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
const qaRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function(...args) {
  const result = qaRender.apply(this, args);
  window.qa = this;
  if (this.companionView && window.cameraSamples) {
    const eye = this.camera.position, focus = this.focus;
    const horizontal = Math.hypot(eye.x - focus.x, eye.z - focus.z);
    const sight=focus.clone().sub(eye), sightLength=sight.length();
    const blocked=this.sweepCamera(eye,sight.normalize(),Math.max(0,sightLength-.05),0)<sightLength-.051;
    const sample = {
      phase: window.cameraPhase, at: performance.now(),
      eye: eye.toArray(), focus: focus.toArray(),
      yaw: this.yaw, actualYaw: Math.atan2(eye.x-focus.x,eye.z-focus.z), pitch: this.pitch, actualPitch: Math.atan2(eye.y - focus.y, horizontal),
      horizontal, distance: eye.distanceTo(focus), requestedDistance: this.targetDistance,
      groundClearance: eye.y - cameraFloorHeight(eye.x, eye.z),
      reach: nearPlaneReach(this.camera),
      target: this.viewedId, player: [this.state.players[0].x,this.state.players[0].z],
      centerBlocked: blocked,
    };
    cameraSamples.push(sample);
  }
  return result;
};`,
    });
  });
  const tap = (selector) => (phone ? page.locator(selector).tap() : page.locator(selector).click());
  await page.goto(base);
  await tap('#title-start');
  await page.locator('#setup-form input[name="name"]').fill('地面カメラQA');
  await tap('#setup-form input[value="cro-male"]');
  await tap('#setup-flow-yes');
  await tap('[data-starting-mascot-none]');
  await tap(`[data-starting-mascot="${mascot}"]`);
  await tap('#mascot-start');
  await enterPreparedWorld(page, phone);
  if (landscape) {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(350);
  }
  if (process.argv.includes('--scan')) {
    const candidates = await page.evaluate(async () => {
      const { botGroundHeight } = await import('/shared/orb-bots.mjs');
      const { nearPlaneReach } = await import('/src/mesh-ray-grid.js');
      const bad = [];
      const point = qa.focus.clone(),
        direction = point.clone(),
        out = point.clone();
      const reach = nearPlaneReach(qa.camera);
      for (let x = 32; x <= 56; x += 1)
        for (let z = 65; z <= 100; z += 1) {
          point.set(x, botGroundHeight(x, z) + 0.14, z);
          for (let i = 0; i < 24; i++) {
            const yaw = (i * Math.PI) / 12,
              pitch = -0.5;
            direction.set(
              Math.sin(yaw) * Math.cos(pitch),
              Math.sin(pitch),
              Math.cos(yaw) * Math.cos(pitch),
            );
            qa.landmarks?.mountainCamera?.frame();
            const length = qa.cameraReach(point, direction, 0.5232462236657343, reach, out);
            const horizontal = Math.hypot(out.x, out.z) * length;
            if (horizontal < 0.08) bad.push({ x, z, y: point.y, yaw, length, horizontal });
          }
        }
      return bad.toSorted((a, b) => a.horizontal - b.horizontal);
    });
    await writeFile(`${output}/scan.json`, JSON.stringify(candidates, null, 2));
    console.log('Hypothetical ground probe', candidates.length, candidates.slice(0, 5));
  }
  if (slope) {
    // Ordinary walking from the camp towards the hillside, before inspecting.
    await page.keyboard.down('s');
    await page.waitForTimeout(7500);
    await page.keyboard.up('s');
    await page.keyboard.down('a');
    await page.waitForTimeout(3500);
    await page.keyboard.up('a');
    await page.waitForTimeout(1500);
  }
  await tap('.mascot-target-toggle');
  await page.locator('[data-mascot-command="inspect"]:not([disabled])').waitFor();
  const previousView = await page.evaluate(() => ({
    yaw: qa.yaw,
    pitch: qa.pitch,
    distance: qa.targetDistance,
    player: [qa.state.players[0].x, qa.state.players[0].z],
  }));
  await tap('[data-mascot-command="inspect"]');
  await page.waitForFunction(() => !!qa.viewedId);
  // Close the target strip so a landscape swipe starts on the world, not on a card.
  await tap('.mascot-target-toggle');
  await page.waitForTimeout(1500);
  console.log(
    'Inspect ready',
    await page.evaluate(() => ({
      target: qa.viewedId,
      position: qa.focus.toArray(),
      distance: qa.targetDistance,
    })),
  );
  await page.evaluate(() => {
    window.cameraSamples = [];
    window.cameraPhase = 'initial';
  });
  await page.screenshot({ path: `${output}/initial.png` });
  const cdp = phone ? await context.newCDPSession(page) : null;
  async function drag(dx, dy, steps = 24) {
    const { width, height } = page.viewportSize();
    const x = width * 0.55 - dx / 2,
      y = height * 0.58 - dy / 2;
    if (phone) {
      const points = (x, y) => [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(x, y) });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: points(x + (dx * i) / steps, y + (dy * i) / steps),
        });
        await page.waitForTimeout(35);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
        await page.waitForTimeout(35);
      }
      await page.mouse.up();
    }
  }
  async function phase(name, action) {
    await page.evaluate((name) => {
      window.cameraPhase = name;
    }, name);
    await action();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  await phase('lower', () => drag(0, -160));
  if (process.argv.includes('--probe')) {
    const probe = await page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const { nearPlaneReach } = await import('/src/mesh-ray-grid.js');
      const reach = nearPlaneReach(qa.camera),
        aim = qa.focus.clone(),
        rows = [];
      const ray = new THREE.Raycaster(
        aim.clone().add(new THREE.Vector3(0, 2, 0)),
        new THREE.Vector3(0, -1, 0),
      );
      const heights = ray
        .intersectObjects(
          qa.landmarks.mountainCamera.drawn().map((c) => c.mesh),
          false,
        )
        .map((h) => h.point.toArray());
      rows.push({ aim: aim.toArray(), floor: qa.cameraFloor(aim.x, aim.z, reach), heights });
      for (const yaw of [0, 1, 2, 3, 4, 5])
        for (let y = aim.y + 0.15; y < aim.y + 1; y += 0.1) {
          const point = aim
            .clone()
            .set(aim.x + Math.sin(yaw) * 0.46, y, aim.z + Math.cos(yaw) * 0.46);
          const d = point.clone().sub(aim),
            n = d.length();
          d.normalize();
          rows.push({
            yaw,
            point: point.toArray(),
            n,
            floor: qa.cameraFloor(point.x, point.z, 0.265),
            box: qa.collision.cameraDistance(aim, d, n, reach),
            cave: qa.landmarks.caveCamera?.sweep(aim, d, n, reach),
            mountain: qa.landmarks.mountainCamera?.sweep(aim, d, n, reach),
            castle: qa.landmarks.castleCamera?.sweep(aim, d, n, reach),
            all: qa.sweepCamera(aim, d, n, reach),
          });
        }
      return rows;
    });
    await writeFile(`${output}/probe.json`, JSON.stringify(probe, null, 2));
  }
  for (let i = 0; i < 6; i++) await phase(`ground-orbit-${i}`, () => drag(180, 0, 32));
  await phase('zoom-near', async () => {
    if (phone) {
      const { width, height } = page.viewportSize();
      const pts = (gap) => [
        { id: 1, x: width * 0.7 - gap / 2, y: height * 0.65 },
        { id: 2, x: width * 0.7 + gap / 2, y: height * 0.65 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(60) });
      for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: pts(60 + i * 12),
        });
        await page.waitForTimeout(35);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.wheel(0, -2400);
    }
  });
  for (let i = 0; i < 6; i++) await phase(`near-orbit-${i}`, () => drag(180, 0, 32));
  await phase('raise', () => drag(0, 320, 48));
  const samples = await page.evaluate(() => cameraSamples);
  const summary = {
    frames: samples.length,
    minDistance: Math.min(...samples.map((s) => s.distance)),
    minHorizontal: Math.min(...samples.map((s) => s.horizontal)),
    maxPitch: Math.max(...samples.map((s) => s.actualPitch)),
    minGroundClearance: Math.min(...samples.map((s) => s.groundClearance)),
    blockedFraction: samples.filter((s) => s.centerBlocked).length / samples.length,
    worst: samples.toSorted((a, b) => a.horizontal - b.horizontal).slice(0, 10),
  };
  const ground = samples.filter((s) => s.phase.startsWith('ground-orbit-'));
  const near = samples.filter((s) => s.phase.startsWith('near-orbit-'));
  const groundYawSpan =
    Math.max(...ground.map((s) => s.yaw)) - Math.min(...ground.map((s) => s.yaw));
  summary.groundYawSpan = groundYawSpan;
  const meanHorizontal = (a) => a.reduce((n, s) => n + s.horizontal, 0) / a.length;
  summary.alignedFraction =
    [...ground, ...near].filter(
      (s) =>
        Math.abs(Math.atan2(Math.sin(s.actualYaw - s.yaw), Math.cos(s.actualYaw - s.yaw))) < 0.1,
    ).length /
    (ground.length + near.length);
  summary.zoomRatio = meanHorizontal(near) / meanHorizontal(ground);
  console.log(JSON.stringify({ ...summary, worst: summary.worst.slice(0, 1) }, null, 2));
  await writeFile(`${output}/samples.json`, JSON.stringify({ summary, samples }, null, 2));
  if (!before) {
    assert.ok(
      await page.evaluate(() => !!qa.viewedId),
      'inspection stays active throughout the gesture sequence',
    );
    assert.ok(summary.minGroundClearance > 0.1, 'camera stays above ground');
    assert.ok(groundYawSpan > 6, 'the gestures actually turn the camera through a full circle');
    assert.ok(summary.minHorizontal > 0.1, 'orbit does not collapse over the target');
    assert.ok(summary.maxPitch < 1.3, 'camera never snaps to a downward vertical view');
    assert.ok(
      summary.blockedFraction < 0.02,
      'the companion remains visible above the drawn ground',
    );
    assert.ok(
      summary.alignedFraction > 0.9,
      'the drawn camera follows the rotation, rather than freezing',
    );
    assert.ok(summary.zoomRatio < 0.8, 'zoom moves the drawn camera closer');
    pass(`Ground-level orbit and near zoom keep a stable view of ${mascot}`);
    const viewed = await page.evaluate(() => qa.viewedId);
    await tap('.mascot-target-toggle');
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => qa.viewedId),
      viewed,
      'reopening the target strip keeps the current closeup',
    );
    await tap('[data-mascot-command="endInspect"]');
    await page.waitForFunction(() => !qa.viewedId);
    const returned = await page.evaluate(() => ({
      yaw: qa.yaw,
      pitch: qa.pitch,
      distance: qa.targetDistance,
      player: [qa.state.players[0].x, qa.state.players[0].z],
    }));
    assert.deepEqual(
      returned,
      previousView,
      'Return restores exploration without moving the player',
    );
    pass('Return restores the original orbit and player position');
  }
  assert.deepEqual(errors, []);
  await cdp?.detach();
  await context.close();
} catch (error) {
  failure = error;
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        before,
        phone,
        landscape,
        mascot,
        slope,
        fixture,
        browser: browser.version(),
        base,
        checks,
        errors,
        delivered,
        failure: failure?.stack,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
if (failure) throw failure;
