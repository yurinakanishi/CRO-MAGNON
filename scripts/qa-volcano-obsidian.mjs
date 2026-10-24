// Disposable solo Chrome sessions at the West Asian volcano's obsidian (2026-10-22).
// A human on a PC warps there through the real map, mines two outcrops, takes the stop's stone
// and wood, then knaps a blade and hafts a spear in the bag; the ape on a phone mines the third.
// The only fixture is a standing place beside each pile, applied inside the patched worker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { INITIAL_RESOURCES, VOLCANO_OBSIDIAN } from '../dist/shared/world.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { gatherRange, interactionVisible } from '../dist/shared/interactions.mjs';
import { characterModel } from '../dist/shared/characters.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const output = process.argv[2] || 'output/playwright/volcano-obsidian-20261022';
await mkdir(output, { recursive: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function saveHashes() {
  const hashes = {};
  for (const name of await readdir('.cro-magnon-save').catch(() => [])) {
    const file = `.cro-magnon-save/${name}`;
    if ((await stat(file)).isFile()) hashes[name] = sha(await readFile(file));
  }
  return hashes;
}
const savesBefore = await saveHashes();

const fire = WARP_POINTS.find((p) => p.id === 'fire-volcano');
const nearFire = (r) => Math.hypot(r.x - fire.x, r.z - fire.z) < 15;
const stone = INITIAL_RESOURCES.find((r) => r.type === 'stone' && nearFire(r));
const wood = INITIAL_RESOURCES.find((r) => r.type === 'wood' && nearFire(r));
const collision = new CollisionWorld();
function standing(resource, species) {
  const radius = characterModel({ species }).radius ?? 0.32;
  for (let d = 0.3; d <= gatherRange({ radius }) + 1e-9; d += 0.01)
    for (let a = 0; a < 360; a += 2) {
      const p = {
        x: resource.x + Math.sin((a * Math.PI) / 180) * d,
        z: resource.z + Math.cos((a * Math.PI) / 180) * d,
      };
      if (collision.free(p, radius) && interactionVisible(collision, p, resource))
        return { ...p, facing: Math.atan2(resource.x - p.x, resource.z - p.z), distance: d };
    }
  throw Error(`No standing place by ${resource.id} for ${species}`);
}

const WORKER_FIXTURE = `
const qaHandle = scope.onmessage;
scope.onmessage = (event) => {
  if (event.data?.type !== 'qa-fixture') return qaHandle(event);
  enqueue(async () => {
    const room = runtime.game.rooms.get('SOLO'), p = [...room.players.values()][0];
    const { place } = event.data;
    Object.assign(p, { x: place.x, z: place.z, facing: place.facing, target: null, path: [],
      dx: 0, dz: 0, warpSequence: (p.warpSequence ?? 0) + 1 });
  });
};`;
const RENDER_HOOK = `
const qaRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) { window.qaRenderer = this; return qaRender.apply(this, args); };`;

const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  browser: browser.version(),
  base,
  outcrops: VOLCANO_OBSIDIAN.map(({ id, x, z }) => ({ id, x, z })),
  checks: [],
  errors: [],
  forbidden: [],
};
const pass = (label) => {
  report.checks.push(label);
  console.log('PASS', label);
};
let page, failure;

async function start(character, phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: phone,
    hasTouch: phone,
  });
  await context.addInitScript(() => {
    window.soloQA = { state: null, id: '', sent: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes('solo-worker')) return;
        soloQA.worker = this;
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'message') return;
          const message = JSON.parse(data.data);
          if (message.type === 'welcome') soloQA.id = message.id;
          if (message.type === 'state') soloQA.state = { ...soloQA.state, ...message };
        });
      }
      postMessage(data, ...rest) {
        if (this === soloQA.worker && data?.type === 'command')
          soloQA.sent.push({ ...JSON.parse(data.data), qaAt: Math.round(performance.now()) });
        return super.postMessage(data, ...rest);
      }
    };
  });
  const target = await context.newPage();
  target.on('pageerror', (error) => report.errors.push(String(error)));
  target.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  target.on('websocket', (socket) => report.forbidden.push(socket.url()));
  target.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) report.forbidden.push(request.url());
  });
  await target.route('**/src/solo-worker.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + WORKER_FIXTURE });
  });
  await target.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + RENDER_HOOK });
  });
  const tap = (selector) =>
    phone ? target.locator(selector).tap() : target.locator(selector).click();
  await target.goto(base);
  await tap('#title-start');
  await target.locator('#setup-form input[name="name"]').fill('黒曜石QA');
  await tap(`#setup-form input[value="${character}"]`);
  await tap('#setup-flow-yes');
  if (
    (await target.locator('[data-starting-mascot="524"]').getAttribute('aria-pressed')) !== 'true'
  )
    await tap('[data-starting-mascot="524"]');
  await tap('#mascot-start');
  await enterPreparedWorld(target, phone);
  await target.waitForFunction(() => soloQA.state?.players?.some((p) => p.id === soloQA.id));
  return { page: target, tap, phone };
}
const self = (who) => who.page.evaluate(() => soloQA.state.players.find((p) => p.id === soloQA.id));
const place = (who, spot) =>
  who.page.evaluate((place) => soloQA.worker.postMessage({ type: 'qa-fixture', place }), spot);
const outcropScale = (who, id) =>
  who.page.evaluate((id) => window.qaRenderer.resources.get(id)?.model.scale.x ?? null, id);

async function gather(who, resource, species, label, kind) {
  const spot = standing(resource, species);
  await place(who, spot);
  await who.page.waitForFunction(
    ({ x, z }) => {
      const p = soloQA.state.players.find((p) => p.id === soloQA.id);
      return Math.hypot(p.x - x, p.z - z) < 0.01;
    },
    spot,
    { timeout: 30000 },
  );
  if (who.phone)
    await who.page
      .locator('[data-touch-action="interact"]', { hasText: label })
      .waitFor({ timeout: 30000 });
  else
    await who.page.waitForFunction(
      (label) =>
        !document.querySelector('#interaction-hint').hidden &&
        document.querySelector('#interaction-hint span').textContent === label,
      label,
      { timeout: 30000 },
    );
  // The game takes one action per 450 ms; walking between piles takes a player longer.
  await who.page.waitForFunction(() => {
    const last = soloQA.sent.findLast((m) => m.action === 'gather');
    return !last || performance.now() - last.qaAt > 500;
  });
  const before = (await self(who)).inventory[kind] ?? 0;
  if (who.phone) await who.page.locator('[data-touch-action="interact"]').tap();
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('e');
  }
  await who.page.waitForFunction(
    ({ kind, before }) =>
      (soloQA.state.players.find((p) => p.id === soloQA.id).inventory[kind] ?? 0) === before + 1,
    { kind, before },
    { timeout: 15000 },
  );
  assert.equal(
    (await who.page.evaluate(() => soloQA.sent.findLast((m) => m.action === 'gather'))).targetId,
    resource.id,
  );
  return spot;
}

async function craft(who, id, text) {
  await who.tap(`[data-craft="${id}"]`);
  await who.page.waitForFunction(
    (text) => document.querySelector('#inventory-craft-result')?.textContent === text,
    text,
    { timeout: 15000 },
  );
}

try {
  // PC: a human warps through the map and makes the whole spear at the volcano.
  const human = await start('cro-male', false);
  page = human.page;
  await human.page.locator('#world').focus();
  await human.page.keyboard.press('m');
  // The warp button appears once a destination is chosen.
  await human.page.locator('#map-warp').waitFor({ state: 'attached' });
  await human.page.locator('[data-warp-point="fire-volcano"]').click();
  await human.page.locator('[data-warp-point="fire-volcano"][aria-pressed="true"]').waitFor();
  assert.equal(await human.page.locator('#map-destination').innerText(), '西アジアの火山地帯');
  await human.page.locator('#map-warp:not([disabled])').waitFor();
  await human.page.screenshot({ path: `${output}/map-choose-volcano.png` });
  await human.page.locator('#map-warp').click();
  await human.page.waitForFunction(() => !document.querySelector('#modal').open);
  await human.page.waitForFunction(
    ({ x, z }) => {
      const p = soloQA.state.players.find((p) => p.id === soloQA.id);
      return Math.hypot(p.x - x, p.z - z) < 8;
    },
    fire,
    { timeout: 30000 },
  );
  // Look from the fire toward the outcrops, as on arrival.
  const centre = {
    x: VOLCANO_OBSIDIAN.reduce((s, r) => s + r.x, 0) / 3,
    z: VOLCANO_OBSIDIAN.reduce((s, r) => s + r.z, 0) / 3,
  };
  await human.page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
  await human.page.waitForFunction(
    (ids) => ids.every((id) => window.qaRenderer?.resources.get(id)?.model.visible),
    VOLCANO_OBSIDIAN.map((r) => r.id),
    { timeout: 60000 },
  );
  const me = await self(human);
  await human.page.evaluate(
    ({ me, centre }) => {
      const r = window.qaRenderer;
      r.yaw = Math.atan2(me.x - centre.x, me.z - centre.z);
      r.pitch = 0.42;
      r.targetDistance = 9;
    },
    { me, centre },
  );
  await human.page.waitForTimeout(1500);
  await human.page.screenshot({ path: `${output}/arrival-outcrops.png` });
  pass('The map warps to 西アジアの火山地帯; all three outcrop models are drawn beside the fire');

  const [first, second, third] = VOLCANO_OBSIDIAN;
  const startInventory = (await self(human)).inventory;
  const fullScale = await outcropScale(human, first.id);
  for (const outcrop of [first, second])
    await gather(human, outcrop, 'cro', '黒曜石を採掘する', 'obsidian');
  await human.page.waitForFunction(
    ({ id, full }) => window.qaRenderer.resources.get(id).model.scale.x < full - 1e-6,
    { id: first.id, full: fullScale },
  );
  await gather(human, stone, 'cro', '石を採集する', 'stone');
  await gather(human, wood, 'cro', '木材を採集する', 'wood');
  pass('E key mines two outcrops (each shrinks), then takes the stop’s stone and wood beside them');

  await human.page.locator('#world').focus();
  await human.page.keyboard.press('i');
  await human.page.locator('#inventory-crafting').waitFor();
  assert.equal(
    await human.page.locator('[data-recipe="blade"] .inventory-recipe-note').innerText(),
    '槍の材料・原石は西アジアの火山地帯で採れる',
  );
  await craft(human, 'blade', '黒曜石の刃を持ち物に追加しました。');
  await craft(human, 'spear', '黒曜石の槍を持ち物に追加しました。');
  await human.page.locator('#equipment-confirm').waitFor();
  await human.page.screenshot({ path: `${output}/bag-spear-made.png` });
  await human.tap('#equipment-confirm-yes');
  await human.page
    .locator('.inventory-grid .inventory-equipped[data-item="obsidianSpear"]')
    .waitFor();
  const made = await self(human);
  assert.equal(made.spearHead, 'obsidian');
  assert.equal(made.inventory.obsidian, startInventory.obsidian ?? 0);
  assert.equal(made.inventory.obsidianBlade, startInventory.obsidianBlade ?? 0);
  assert.equal(made.inventory.stone, startInventory.stone + 1, 'the hammerstone is kept');
  assert.equal(made.inventory.wood, startInventory.wood, 'the gathered wood became the haft');
  await human.page.keyboard.press('Escape');
  await human.page.waitForFunction(() => !document.querySelector('#modal').open);
  await human.page.waitForFunction(
    () => {
      const data = document.querySelector('#world').dataset;
      return data.weaponModel === 'obsidian-spear' && data.weaponVisible === 'true';
    },
    undefined,
    { timeout: 30000 },
  );
  await human.page.screenshot({ path: `${output}/holding-obsidian-spear.png` });
  pass(
    'The bag names where the raw stone is; blade then spear are made from what was gathered there, and the spear is held',
  );
  await human.page.context().close();

  // Phone: the broad ape mines the third outcrop by touch.
  const ape = await start('ape-male', true);
  page = ape.page;
  const spot = await gather(ape, third, 'ape', '黒曜石を採掘する', 'obsidian');
  await ape.page.screenshot({ path: `${output}/ape-phone-mined.png` });
  pass(`The ape mines by touch from ${spot.distance.toFixed(2)} m`);
  await ape.page.context().close();

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.forbidden, []);
  assert.deepEqual(await saveHashes(), savesBefore, 'the local save is untouched');
  pass('No browser errors, no socket or API traffic, and the local save is untouched');
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ ok: !failure, ...report, failure }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log('EVIDENCE', output);
}
if (failure) process.exitCode = 1;
