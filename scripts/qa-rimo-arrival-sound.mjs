// Supplementary checks: ordinary initial arrival, magic and the real sound setting.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.env.QA_RIMO_EXTRA_OUT || 'output/playwright/rimo-neko/arrival-sound-r07';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen(),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
  errors = [],
  checks = [],
  commands = [],
  attacks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error(label);
}
let id;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('websocket', (ws) => {
  ws.on('framesent', ({ payload }) => commands.push(JSON.parse(String(payload))));
  ws.on('framereceived', ({ payload }) => {
    const m = JSON.parse(String(payload));
    if (m.type === 'welcome') id = m.id;
  });
});
await page.route('**/src/world3d.js', async (route) => {
  const r = await route.fetch();
  await route.fulfill({
    response: r,
    body:
      (await r.text()) +
      '\nconst observe=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.rimoWorld=this;return observe.apply(this,args);};',
  });
});
await page.route('**/src/cat-hiss.js', async (route) => {
  const r = await route.fetch();
  await route.fulfill({
    response: r,
    body: (await r.text()).replace(
      'export function playCatHiss(context, gainValue) {',
      'export function playCatHiss(context, gainValue) { window.rimoHisses=(window.rimoHisses||0)+1;',
    ),
  });
});
let failure;
try {
  await page.goto(`http://127.0.0.1:${port}/?room=RIMO-ARRIVAL&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  const room = game.rooms.get('RIMO-ARRIVAL'),
    p = room.players.get(id),
    c = room.rimoNeko;
  const initial = { player: { x: p.x, z: p.z }, cat: { x: c.x, z: c.z } };
  const yaw = Math.atan2(p.x - c.x, p.z - c.z);
  await page.evaluate((yaw) => {
    rimoWorld.yaw = yaw;
    rimoWorld.pitch = 0.22;
    rimoWorld.targetDistance = 3;
  }, yaw);
  await page.locator('#world').focus();
  if (Math.hypot(p.x - c.x, p.z - c.z) > 2.1) {
    await page.keyboard.down('w');
    await until(() => Math.hypot(p.x - c.x, p.z - c.z) < 2.1, 'walk from spawn');
    await page.keyboard.up('w');
  }
  await sleep(200);
  await page.keyboard.press('v');
  await until(() => c.petContactAt > 0, 'initial camp pet');
  await sleep(600);
  await page.screenshot({ path: `${out}/initial-camp-pet.png` });
  await until(() => c.followPlayerId === id, 'initial friendship');
  await sleep(950);
  checks.push({ check: 'initial camp arrival and V pet without position fixtures', initial });
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  await page.locator('[data-setting="sound"]').click();
  await until(
    () =>
      page
        .locator('[data-setting="sound"]')
        .getAttribute('aria-pressed')
        .then((x) => x === 'true'),
    'sound enabled',
  );
  await page.locator('[data-controller-menu="character"]').click();
  await page
    .locator('#character-switch-form .character-choice:has(input[value="bear-female"])')
    .click();
  await page.locator('#character-confirm-yes').click();
  await until(() => p.species === 'bear', 'mage selected');
  await until(
    () =>
      page.evaluate(
        () =>
          rimoWorld.players.get(rimoWorld.selfId)?.actor?.asset.modelKey === 'desert-fennec-mage',
      ),
    'mage GLB',
  );
  if (await page.locator('#modal').isVisible()) await page.keyboard.press('Escape');
  await sleep(500);
  for (const audible of [true, false]) {
    if (!audible) {
      await sleep(2700);
      await page.keyboard.press('Escape');
      await page.locator('[data-pause-tab="settings"]').click();
      await page.locator('[data-setting="sound"]').click();
      await until(
        () =>
          page
            .locator('[data-setting="sound"]')
            .getAttribute('aria-pressed')
            .then((x) => x === 'false'),
        'muted setting',
      );
      await page.locator('[data-controller-menu="resume"]').click();
      await page.locator('#modal').waitFor({ state: 'hidden' });
    }
    await until(
      () => !p.attackSequence || Date.now() - p.attackAt > attackProfile(p).cooldownMs + 100,
      'magic recharge',
    );
    const seq = c.hitSequence;
    await page.evaluate(
      (yaw) => {
        rimoWorld.yaw = yaw + 1;
      },
      Math.atan2(p.x - c.x, p.z - c.z),
    );
    await page.locator('#world').focus();
    await sleep(350);
    const screen = await page.evaluate(() => {
      const r = rimoWorld,
        cat = r.rimoNekoRenderer;
      const v = cat.actor.root
        .getObjectByName('Head')
        .getWorldPosition(cat.root.position.clone())
        .project(r.camera);
      const rect = document.querySelector('#world').getBoundingClientRect();
      return {
        x: rect.x + ((v.x + 1) * rect.width) / 2,
        y: rect.y + ((1 - v.y) * rect.height) / 2,
      };
    });
    attacks.push({
      audible,
      player: { x: p.x, z: p.z, facing: p.facing },
      cat: { x: c.x, z: c.z, seq },
      screen,
      ui: await page.evaluate(() => ({
        modal: document.querySelector('#modal').open,
        active: document.activeElement.outerHTML.slice(0, 500),
        now: rimoWorld.serverNow(),
        self: rimoWorld.state.players.find((p) => p.id === rimoWorld.selfId),
      })),
    });
    if (audible) await page.mouse.click(screen.x, screen.y);
    else await page.keyboard.press('f');
    await until(() => c.hitSequence === seq + 1, 'magic impact');
    await sleep(1100);
    assert.equal(
      await page.evaluate(() => window.rimoHisses),
      1,
      audible ? 'one audible hiss' : 'muted hiss is silent',
    );
    checks.push(
      audible
        ? 'actual magic triggers one hiss through the enabled audio setting'
        : 'muting suppresses subsequent hiss audio',
    );
  }
  const rms = await page.evaluate(async () => {
    const { playCatHiss } = await import('/src/cat-hiss.js');
    const c = new OfflineAudioContext(1, 48000, 48000);
    playCatHiss(c, 0.14);
    const b = await c.startRendering(),
      s = b.getChannelData(0);
    return {
      start: s[0],
      rms: Math.sqrt(s.reduce((n, x) => n + x * x, 0) / s.length),
      tail: Math.max(...s.slice(35000).map(Math.abs)),
    };
  });
  assert.ok(rms.rms > 0.01);
  assert.equal(rms.start, 0);
  assert.equal(rms.tail, 0);
  checks.push({ check: 'hiss audio renders a finite attack/release envelope', ...rms });
  assert.deepEqual(errors, []);
  console.log('PASS', checks.length, 'arrival/audio checks');
} catch (e) {
  failure = String(e);
  const room = game.rooms.get('RIMO-ARRIVAL');
  await writeFile(
    `${out}/failure-state.json`,
    JSON.stringify(
      {
        cat: room?.rimoNeko,
        player: room?.players.get(id),
        attacks,
        commands: commands.filter((c) => c.type === 'action'),
      },
      null,
      2,
    ) + '\n',
  );
  await page.screenshot({ path: `${out}/failure.png` });
  throw e;
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      { checks, errors, failure, positionFixtures: false, physicalSpeakerVerified: false },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await game.close();
}
