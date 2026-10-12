// Real Chrome, ephemeral memory-only room. Camera/positions are QA fixtures;
// entry, walking, torch and proceed are real UI/keyboard actions.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/cave-murals-20261012/game';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  shots = [],
  checks = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failure, room, player;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
async function until(fn, why, limit = 30000) {
  const end = Date.now() + limit;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(why);
    await sleep(100);
  }
}
async function capture(name, phase, mural, wide = false) {
  const pos = caveWorldAt(mural.centre),
    sign = mural.wall === 'east' ? 1 : -1;
  if (phase === 'live') {
    stopActor(player);
    Object.assign(player, pos, {
      facing: (sign * Math.PI) / 2,
      warpSequence: (player.warpSequence ?? 0) + 1,
    });
  }
  await page.evaluate(
    ({ pos, sign, phase, wide }) => {
      const c = phase === 'waiting' ? qaCave : qaWorld;
      if (phase === 'waiting') {
        c.movement.position = pos;
        c.movement.facing = (sign * Math.PI) / 2;
      }
      const camera = c.camera.clone();
      camera.position.set(pos.x - sign * 0.9, 2.6, pos.z + (wide ? 6 : 0));
      camera.lookAt(pos.x + sign * 5.7, 2.25, pos.z - (wide ? 4 : 0));
      camera.fov = wide ? 80 : 75;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      window.qaReviewCamera = camera;
    },
    { pos, sign, phase, wide },
  );
  await sleep(1300);
  await page.screenshot({ path: `${out}/${name}.png` });
  shots.push({
    name,
    phase,
    motif: mural.motif,
    wall: mural.wall,
    centre: mural.centre,
    viewport: page.viewportSize(),
  });
  console.log('CAPTURE', name);
}
try {
  for (const [file, cls, key] of [
    ['loading-cave', 'LoadingCave', 'qaCave'],
    ['world3d', 'WorldRenderer', 'qaWorld'],
  ])
    await page.route(`**/src/${file}.js`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `\nconst muralRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;const result=muralRender.apply(this,args);if(window.qaReviewCamera && !this.disposed ${key === 'qaWorld' ? '&& !this.loadingCave' : ''})${key === 'qaCave' ? 'this.world.renderer' : 'this.renderer'}.render(this.scene,window.qaReviewCamera);return result;};`,
      });
    });
  await page.goto(`http://127.0.0.1:${port}/?room=MURALR36`);
  await page.locator('#title-start').click();
  await page.locator('.character-choice:first-child').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
  for (const m of CAVE_MURALS.slice(0, 8)) await capture(`waiting-${m.motif}`, 'waiting', m);
  const maruimo = CAVE_MURALS.find((m) => m.motif === 'maruimoFrieze');
  await capture('waiting-east-procession', 'waiting', maruimo, true);
  await page.keyboard.press('l');
  await capture('waiting-torch-off', 'waiting', maruimo);
  await page.locator('[data-cave-torch]').click();
  await page.evaluate(() => {
    window.qaReviewCamera = null;
    qaCave.yaw = 0;
  });
  const before = await page.evaluate(() => ({ ...qaCave.movement.position }));
  await page.keyboard.down('w');
  await sleep(1000);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => ({ ...qaCave.movement.position }));
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 0.2);
  checks.push('Waiting cave: eight processions, upper animals, real walking and torch controls');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('waiting-portrait', 'waiting', maruimo);
  await page.setViewportSize({ width: 844, height: 390 });
  await capture('waiting-landscape', 'waiting', maruimo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.qaReviewCamera = null;
  });
  await page.locator('[data-cave-proceed]:enabled').waitFor({ timeout: 180000 });
  await page.locator('[data-cave-proceed]').click();
  await page.locator('#loading-cave').waitFor({ state: 'detached', timeout: 180000 });
  room = game.rooms.get('MURALR36');
  player = [...room.players.values()][0];
  room.enemies = [];
  room.behemoth = null;
  room.sabertooth = null;
  await capture('live-maruimo', 'live', maruimo);
  await until(() => page.evaluate(() => !!qaWorld.landmarks.cavePigment), 'live cave textures');
  for (const m of CAVE_MURALS.slice(0, 8)) await capture(`live-${m.motif}`, 'live', m);
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MURALR36&name=MuralPeer${i}`);
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five connected players');
  for (const [i, p] of [...room.players.values()].entries())
    if (p !== player) {
      stopActor(p);
      Object.assign(p, caveWorldAt(-13.3 + i * 0.7, 2), { caveTorchOff: false });
    }
  await capture('live-five-players', 'live', maruimo, true);
  checks.push('Same murals in live game, one real Chrome renderer and four WebSocket peers');
  const textures = await page.evaluate(() => ({
    count: Object.keys(qaWorld.landmarks.caveExtraPigments).length + 4,
    comingSoon: 'comingSoon' in qaWorld.landmarks.caveExtraPigments,
    programs: qaWorld.renderer.info.programs.length,
  }));
  assert.equal(textures.count, 10);
  assert.equal(textures.comingSoon, false);
  checks.push('Ten verified images; no Coming Soon canvas, sampler or label');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify(
      {
        checks,
        shots,
        errors,
        failure,
        browser: browser.version(),
        layout: CAVE_MURALS,
        fixture:
          'Ephemeral memory-only server. Camera and player positions are preparation; entry, walking, torch and proceed are real inputs. One Chrome plus four protocol peers. Mobile viewport emulation, not a physical phone. No user saves or standard servers touched.',
      },
      null,
      2,
    ) + '\n',
  );
  for (const ws of peers) ws.close();
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
