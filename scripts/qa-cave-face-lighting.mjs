// Controlled lighting comparison in real Chrome. The camera, pose and torch time
// are identical between the old/new ambient intensities. Placement is a QA fixture.
// Record of 2026-10-15. Since 2026-10-23 characters wear the outdoor daylight in the cave and
// neither the cave's fill nor the torch lights them (src/actor-daylight.ts), so its "fill lifts
// the face" checks no longer hold: use scripts/qa-cave-character-daylight.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { CAVE_LIGHT } from '../dist/shared/cave-light.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/cave-face-lighting-20261015';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [];
let page, failure;
try {
  for (const character of ['cro-male', 'cro-female']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
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
            `\nconst qaRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;window.qaThree=THREE;return qaRender.apply(this,args);};`,
        });
      });
    }
    await page.addInitScript(() => localStorage.setItem('cro-name', 'Face Lighting QA'));
    const roomId = character === 'cro-male' ? 'FACEMALE' : 'FACEFEMALE';
    await page.goto(`http://127.0.0.1:${port}/?room=${roomId}`);
    await page.locator('#title-start').click();
    await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
    await page.locator('#setup-flow-yes').click();
    await page.locator('#mascot-start').click();
    await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
    await page.evaluate(() => {
      qaCave.movement.facing = 0;
      qaCave.yaw = 0;
      qaCave.pitch = 0.06;
    });
    await page.waitForTimeout(500);
    for (const lit of [true, false]) {
      if (!lit) await page.locator('[data-cave-torch]').click();
      const comparison = await page.evaluate(
        ({ intensity, lit }) => {
          const cave = qaCave,
            renderer = qaWorld.renderer,
            T = qaThree;
          const hemisphere = cave.scene.children.find((node) => node.isHemisphereLight);
          if (Math.abs(hemisphere.intensity - intensity) > 0.001)
            throw Error('Wrong live cave intensity');
          cave.torch.update(true, 2, 0, renderer.getPixelRatio(), lit);
          const head = cave.actor.root.getObjectByName('Head');
          if (!head) throw Error('Missing delivered head bone');
          const focus = head.getWorldPosition(new T.Vector3());
          focus.y += cave.actor.asset.heightMetres * 0.075;
          const camera = cave.camera.clone();
          camera.position.copy(focus).add(new T.Vector3(0, 0.02, 2.6));
          camera.lookAt(focus);
          camera.updateMatrixWorld();
          const width = qaWorld.canvas.width,
            height = qaWorld.canvas.height;
          // Sample the central face, excluding the torch-facing hair rim and white collar.
          const faceSize = cave.actor.asset.heightMetres * 0.14;
          const radius = Math.round(
            (faceSize * height) / (2 * Math.tan((camera.fov * Math.PI) / 360) * 2.6) / 2,
          );
          const center = focus.clone().project(camera);
          const cx = Math.round(((center.x + 1) * width) / 2),
            cy = Math.round(((center.y + 1) * height) / 2);
          const capture = (value) => {
            hemisphere.intensity = value;
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
              image: qaWorld.canvas.toDataURL('image/png'),
              mean: values.reduce((sum, value) => sum + value, 0) / values.length,
              p95: values[Math.floor(values.length * 0.95)],
              clippedFraction: values.filter((value) => value >= 250).length / values.length,
            };
          };
          const before = capture(1.2),
            after = capture(intensity);
          return {
            before,
            after,
            roi: { cx, cy, radius },
            torch: cave.torch.light.intensity,
            width,
            height,
          };
        },
        { intensity: CAVE_LIGHT.hemisphere, lit },
      );
      for (const version of ['before', 'after']) {
        const data = comparison[version];
        await writeFile(
          `${out}/${character}-${lit ? 'lit' : 'unlit'}-${version}.png`,
          Buffer.from(data.image.split(',')[1], 'base64'),
        );
        delete data.image;
      }
      assert.ok(comparison.after.mean > comparison.before.mean, 'Face fill increases');
      assert.ok(comparison.after.mean < comparison.before.mean * 1.2, 'Small, bounded lift');
      assert.ok(
        comparison.after.clippedFraction <= comparison.before.clippedFraction,
        'The fill must not add white clipping to the face',
      );
      checks.push({ character, lit, ...comparison });
      console.log('PASS', character, lit ? 'torch on' : 'torch off', JSON.stringify(comparison));
    }
    await page.locator('[data-cave-torch]').click();
    await page.screenshot({ path: `${out}/${character}-normal-view.png` });
    if (character === 'cro-male') {
      await page.locator('[data-cave-proceed]:enabled').waitFor({ timeout: 240000 });
      await page.locator('[data-cave-proceed]').click();
      await page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
      const room = game.rooms.get(roomId),
        player = [...room.players.values()][0];
      // Fixture only; the actual start/proceed/torch controls above use UI events.
      Object.assign(player, caveWorldAt(-21), { y: 0, facing: 0, caveTorchOff: false });
      await page.waitForFunction(
        (intensity) => Math.abs(qaWorld.hemisphere.intensity - intensity) < 0.001,
        CAVE_LIGHT.hemisphere,
        { timeout: 30000 },
      );
      assert.equal(await page.locator('#world').getAttribute('data-cave-torch-lit'), 'true');
      await page.screenshot({ path: `${out}/world-cave.png` });
      checks.push({
        liveCave: true,
        hemisphere: await page.evaluate(() => qaWorld.hemisphere.intensity),
      });
      console.log('PASS live cave uses the same diffuse fill');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error);
  if (page && !page.isClosed())
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, failure: failure?.stack, checks, errors }, null, 2),
  );
  await browser.close();
  await game.close?.();
  process.exit(failure ? 1 : 0);
}
