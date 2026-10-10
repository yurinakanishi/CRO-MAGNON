// Inspect the four new throws from the ordinary rear camera in an unsaved room.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { botThrowPlan } from '../dist/shared/orb-bots.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/shape-bots/flight-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  records = [];
page.on('pageerror', (error) => errors.push(String(error)));
let failure;
try {
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst shapeRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const r=shapeRender.apply(this,args);window.qa=this;return r;};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=SHAPE-FLIGHT-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.qa?.orbBotRenderer?.bots.size === 9);
  const room = game.rooms.get('SHAPE-FLIGHT-QA'),
    player = [...room.players.values()][0];
  room.enemies = [];
  let site;
  for (let x = 35; x < 67 && !site; x++)
    for (let z = 54; z < 67; z++) {
      const p = { ...player, x, z, facing: 0 },
        plan = botThrowPlan(p, room.collision);
      if (room.collision.free(p, 0.9) && plan && plan.landing.z - z > 7.5) {
        site = p;
        break;
      }
    }
  assert.ok(site);
  Object.assign(player, {
    x: site.x,
    z: site.z,
    facing: 0,
    warpSequence: (player.warpSequence ?? 0) + 1,
  });
  await page.evaluate(() => {
    qa.yaw = Math.PI;
    qa.pitch = 0.38;
    qa.targetDistance = 6;
  });
  await page.waitForTimeout(1200);
  for (const kind of ['beret', 'frog', 'triangle', 'heart']) {
    await page.locator(`#orb-bot-controls [data-bot-kind="${kind}"]`).click();
    await page.locator('#world').focus();
    await page.keyboard.press('c');
    await page.waitForFunction(
      (kind) =>
        [...qa.orbBotRenderer.bots.values()].some(
          (e) => e.state.kind === kind && e.state.mode === 'held',
        ),
      kind,
    );
    await page.waitForTimeout(600);
    await page.keyboard.press('c');
    await page.waitForFunction(
      (kind) =>
        [...qa.orbBotRenderer.bots.values()].some(
          (e) =>
            e.state.kind === kind &&
            e.state.mode === 'airborne' &&
            qa.serverNow() - e.state.phaseAt > 200,
        ),
      kind,
    );
    const projected = await page.evaluate((kind) => {
      const e = [...qa.orbBotRenderer.bots.values()].find((e) => e.state.kind === kind);
      const p = e.actor.root.position.clone();
      p.y += 0.14;
      p.project(qa.camera);
      return { kind, mode: e.state.mode, visible: e.actor.root.visible, ndc: p.toArray() };
    }, kind);
    assert.equal(projected.mode, 'airborne');
    assert.ok(
      projected.visible &&
        Math.abs(projected.ndc[0]) < 0.95 &&
        Math.abs(projected.ndc[1]) < 0.95 &&
        Math.abs(projected.ndc[2]) < 1,
      JSON.stringify(projected),
    );
    await page.screenshot({ path: `${out}/${kind}-airborne.png` });
    await page.waitForFunction(
      (kind) =>
        [...qa.orbBotRenderer.bots.values()].some(
          (e) => e.state.kind === kind && e.state.mode === 'following',
        ),
      kind,
    );
    await page.screenshot({ path: `${out}/${kind}-returned.png` });
    records.push(projected);
    await page.waitForTimeout(500);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: !failure,
        records,
        errors,
        failure,
        scope: 'Supplemental rear-camera visibility; isolated one-player room, all four new kinds.',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ out, passed: !failure, records: records.length }));
if (failure) throw Error(failure);
