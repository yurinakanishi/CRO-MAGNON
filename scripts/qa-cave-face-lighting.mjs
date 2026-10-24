// Real Chrome on disposable solo origins. Face comparisons fix pose, camera and light time.
// Old/new face lighting is compared in the current chamber; near-face light and live-world
// spawn are QA fixtures. Start, torch and proceed use actual mouse/touch events.
// Record of 2026-10-17. Since 2026-10-23 characters wear the outdoor daylight in the cave and
// neither the cave's fill nor the torch lights them (src/actor-daylight.ts), so its "fill lifts
// the face" checks no longer hold: use scripts/qa-cave-character-daylight.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { CAVE_LIGHT, CAVE_TORCH } from '../dist/shared/cave-light.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';

const out = process.argv[2] || 'output/playwright/cave-face-lighting-20261017';
await mkdir(out, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { browser: browser.version(), checks: [], errors: [], forbidden: [] };
let page;
try {
  for (const [character, mobile] of [
    ['cro-female', false],
    ['cro-male', false],
    ['cro-magnon-boy-headband', false],
    ['bear-female', false],
    ['cro-magnon-girl-bear', true],
  ]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text());
    });
    page.on('websocket', (socket) => report.forbidden.push(socket.url()));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) report.forbidden.push(request.url());
    });
    await page.addInitScript(() => {
      window.qaHoldWorldReady = true;
    });
    for (const [file, cls, key] of [
      ['loading-cave', 'LoadingCave', 'qaCave'],
      ['world3d', 'WorldRenderer', 'qaWorld'],
    ]) {
      await page.route(`**/src/${file}.js`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `\nconst qaRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;window.qaThree=THREE;return qaRender.apply(this,args);};` +
            (file === 'loading-cave'
              ? `\nconst qaReady=LoadingCave.prototype.markWorldReady;LoadingCave.prototype.markWorldReady=function(){if(window.qaHoldWorldReady)window.qaReleaseWorldReady=()=>qaReady.call(this);else qaReady.call(this);};`
              : ''),
        });
      });
    }
    await page.route('**/src/solo-worker.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `\nconst qaStart=SoloRuntime.prototype.start;SoloRuntime.prototype.start=async function(...args){await qaStart.apply(this,args);const room=this.game.rooms.get('SOLO'),p=[...room.players.values()][0];Object.assign(p,${JSON.stringify(caveWorldAt(-21))},{y:0,facing:0,caveTorchOff:false});p.warpSequence=(p.warpSequence??0)+1;};`,
      });
    });
    const tap = (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    await page.goto(base);
    await tap('#title-start');
    await page.locator('#setup-form input[name="name"]').fill('洞窟の照明確認');
    await tap(`#setup-form input[value="${character}"]`);
    await tap('#setup-flow-yes');
    await tap('[data-starting-mascot-none]');
    await tap('#mascot-start');
    await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
    const proceed = page.locator('[data-cave-proceed]');
    assert.equal(await proceed.isDisabled(), true);
    assert.equal(await proceed.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.loading-cave-spinner').isVisible(), true);
    assert.equal(
      await proceed.locator('span').evaluate((span) => getComputedStyle(span).opacity),
      '0',
    );
    await page.evaluate(() => {
      qaCave.movement.facing = 0;
      qaCave.yaw = 0;
      qaCave.pitch = 0.06;
    });
    await page.waitForFunction(() => window.qaReleaseWorldReady, null, { timeout: 180000 });
    await page.evaluate(() => qaReleaseWorldReady());
    assert.equal(await proceed.innerText(), 'ゲームを始める');
    assert.equal(await proceed.getAttribute('aria-busy'), 'false');
    assert.equal(await proceed.isEnabled(), true);
    assert.equal(await page.locator('.loading-cave-spinner').isVisible(), false);
    await page.screenshot({ path: `${out}/${character}-normal-lit.png` });

    const comparisons = [];
    for (const lit of [true, false]) {
      if (!lit) await tap('[data-cave-torch]');
      await page.waitForFunction(
        (value) => document.querySelector('#world').dataset.caveTorchLit === String(value),
        lit,
      );
      const shots = await page.evaluate(
        ({ fill, torch, lit }) => {
          const cave = qaCave,
            renderer = qaWorld.renderer,
            T = qaThree;
          const hemisphere = cave.scene.children.find((node) => node.isHemisphereLight);
          if (Math.abs(hemisphere.intensity - fill.hemisphere) > 0.001)
            throw Error('Wrong live cave fill');
          const head = cave.actor.root.getObjectByName('Head');
          if (!head) throw Error('Missing delivered head bone');
          cave.torch.update(true, 2, 0, renderer.getPixelRatio(), lit);
          const focus = head.getWorldPosition(new T.Vector3());
          focus.y += cave.actor.asset.heightMetres * 0.075;
          const camera = cave.camera.clone();
          camera.position.copy(focus).add(new T.Vector3(0, 0.02, 1.8));
          camera.lookAt(focus);
          camera.updateMatrixWorld();
          const width = qaWorld.canvas.width,
            height = qaWorld.canvas.height;
          const radius = Math.round(
            (cave.actor.asset.heightMetres * 0.14 * height) /
              (4 * Math.tan((camera.fov * Math.PI) / 360) * 1.8),
          );
          const center = focus.clone().project(camera);
          const cx = Math.round(((center.x + 1) * width) / 2),
            cy = Math.round(((center.y + 1) * height) / 2);
          const light = cave.torch.light,
            original = light.position.clone();
          const towardFace = focus.clone().sub(camera.position).normalize();
          const faceHit = new T.Raycaster(camera.position, towardFace).intersectObject(
            cave.actor.root,
            true,
          )[0];
          if (!faceHit) throw Error('Near-light fixture must reach the delivered face surface');
          const nearFace = faceHit.point.clone().addScaledVector(towardFace, -0.02);
          const presets = [
            { name: 'before', intensity: 1.4, ground: '#69675c', torch: 12, decay: 2, distance: 5 },
            {
              name: 'after',
              intensity: fill.hemisphere,
              ground: fill.ground,
              torch: torch.intensity,
              decay: torch.decay,
              distance: torch.distance,
            },
          ];
          if (lit) presets.push({ ...presets[1], name: 'near-face' });
          const results = presets.map((preset) => {
            hemisphere.intensity = preset.intensity;
            hemisphere.groundColor.set(preset.ground);
            // Maximum flicker envelope. The near-face fixture challenges close-range glare.
            light.intensity = lit ? preset.torch * 1.08 : 0;
            light.decay = preset.decay;
            light.distance = preset.distance;
            light.position.copy(preset.name === 'near-face' ? nearFace : original);
            renderer.render(cave.scene, camera);
            const gl = renderer.getContext(),
              pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const values = [];
            for (let y = cy - radius; y < cy + radius; y++)
              for (let x = cx - radius; x < cx + radius; x++) {
                const i = (y * width + x) * 4;
                values.push(pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722);
              }
            values.sort((a, b) => a - b);
            return {
              name: preset.name,
              image: qaWorld.canvas.toDataURL('image/png'),
              mean: values.reduce((sum, value) => sum + value, 0) / values.length,
              p10: values[Math.floor(values.length * 0.1)],
              p95: values[Math.floor(values.length * 0.95)],
              clippedFraction: values.filter((value) => value >= 250).length / values.length,
              roi: { cx, cy, radius },
              nearFaceClearance:
                preset.name === 'near-face' ? nearFace.distanceTo(faceHit.point) : null,
              width,
              height,
            };
          });
          light.decay = torch.decay;
          light.distance = torch.distance;
          cave.torch.update(true, 2, 0, renderer.getPixelRatio(), lit);
          return results;
        },
        { fill: CAVE_LIGHT, torch: CAVE_TORCH, lit },
      );
      for (const shot of shots) {
        await writeFile(
          `${out}/${character}-${lit ? 'lit' : 'unlit'}-${shot.name}.png`,
          Buffer.from(shot.image.split(',')[1], 'base64'),
        );
        delete shot.image;
      }
      const [before, after, near] = shots;
      if (!lit) assert.ok(after.mean > before.mean * 1.35, `${character}: readable without torch`);
      assert.equal(after.clippedFraction, 0, `${character}: no central-face white clipping`);
      if (near) assert.equal(near.clippedFraction, 0, `${character}: no near-flame face clipping`);
      comparisons.push({ lit, shots });
    }
    await page.screenshot({ path: `${out}/${character}-normal-unlit.png` });
    await tap('[data-cave-torch]');
    await page.waitForFunction(
      () => document.querySelector('#world').dataset.caveTorchLit === 'true',
    );
    if (character === 'cro-male' || mobile) {
      await tap('[data-cave-proceed]');
      await page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
      await page.waitForFunction(
        (fill) =>
          Math.abs(qaWorld.hemisphere.intensity - fill) < 0.001 &&
          !!qaWorld.players.get(qaWorld.selfId)?.torch?.light.visible,
        CAVE_LIGHT.hemisphere,
        { timeout: 30000 },
      );
      const settings = await page.evaluate(() => {
        const torch = qaWorld.players.get(qaWorld.selfId).torch.light;
        return {
          intensity: qaWorld.hemisphere.intensity,
          ground: `#${qaWorld.hemisphere.groundColor.getHexString()}`,
          decay: torch.decay,
          distance: torch.distance,
          torch: torch.intensity,
        };
      });
      assert.equal(settings.ground, CAVE_LIGHT.ground);
      assert.equal(settings.decay, CAVE_TORCH.decay);
      assert.equal(settings.distance, CAVE_TORCH.distance);
      assert.ok(settings.torch <= CAVE_TORCH.intensity * 1.08);
      await page.evaluate(() => {
        qaWorld.yaw = 0;
        qaWorld.pitch = 0.06;
      });
      await page.waitForFunction(
        () => qaWorld.camera.position.z > qaWorld.players.get(qaWorld.selfId).model.position.z,
      );
      await page.screenshot({ path: `${out}/${character}-world-cave.png` });
      report.checks.push({ liveCave: true, character, mobile, settings });
    }
    report.checks.push({ character, mobile, comparisons, spinnerAndStart: true });
    console.log(
      'PASS',
      character,
      mobile ? 'phone' : 'desktop',
      'lighting, torch toggle and start button',
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.forbidden, []);
  report.ok = true;
} catch (error) {
  report.failure = error.stack;
  console.error(error);
  if (page && !page.isClosed())
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await game.close();
  process.exitCode = report.ok ? 0 : 1;
}
