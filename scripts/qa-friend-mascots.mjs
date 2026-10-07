// Real Chrome + four websocket observers in an isolated memory-only world (nothing is saved).
// node scripts/qa-friend-mascots.mjs [outDir]
// Checks every delivered contributor friend: camp placement, V petting with hearts and a
// synchronised contact clock, following, the selection cards, both cave friezes, and Howkey's
// flask in her right hand. Screens are reviewed by eye; assertions cover state and sync.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import sharp from 'sharp';
import { createGameServer } from '../dist/server.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
import { FRIEND_MASCOTS } from '../dist/shared/friend-mascots.mjs';
import { CAVE_MURALS, caveMuralHeight } from '../dist/src/cave-gallery-layout.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] ?? 'output/playwright/friend-mascots-20261007/r01';
// A second argument re-checks one part after a full run: `howkey` (flask) or `cave` (friezes).
const mode = process.argv[3] ?? 'all';
const onlyHowkey = mode === 'howkey';
await mkdir(out, { recursive: true });
const delivered = FRIEND_MASCOTS.filter((f) => existsSync(`public/models/${f.key}/asset.json`));
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen(),
  base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const peers = [],
  errors = [],
  checks = [],
  shots = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(60);
  }
}
async function openPage(name, character) {
  const page = await context.newPage();
  await page.bringToFront();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${name}: HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  let id;
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') id = m.id;
    }),
  );
  await page.addInitScript((n) => {
    localStorage.setItem('cro-name', n);
    localStorage.setItem('cro-graphics-quality', 'standard');
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    assert.ok(source.includes('this.camera.lookAt(aim);'));
    await route.fulfill({
      response,
      body:
        source.replace(
          'this.camera.lookAt(aim);',
          'this.camera.lookAt(aim);if(window.reviewView){this.camera.position.set(...reviewView.eye);this.camera.lookAt(...reviewView.target);this.camera.fov=reviewView.fov??60;this.camera.updateProjectionMatrix();}',
        ) +
        '\nconst originalRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){const r=originalRender.apply(this,a);window.qa=this;return r;};',
    });
  });
  await page.goto(`${base}/?room=FRIENDS`);
  await page.locator('#title-start').click();
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('[data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  // The online start shows the walkable loading cave; join when the world is ready.
  const ready =
    '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]';
  const deadline = Date.now() + 300000;
  while (!(await page.locator(ready).count())) {
    if (Date.now() > deadline) throw Error(`${name}: world never became ready`);
    const proceed = page.locator('[data-cave-proceed]:not([disabled])');
    if (await proceed.count()) await proceed.click().catch(() => {});
    await sleep(500);
  }
  await page.waitForFunction((n) => window.qa?.friendRenderers?.size === n, delivered.length, {
    timeout: 60000,
  });
  await until(() => !!id, `${name} welcome`);
  return { page, id: () => id };
}
async function shot(page, name, view) {
  await page.evaluate((v) => (window.reviewView = v ?? null), view);
  await sleep(500);
  await page.screenshot({ path: `${out}/${name}.png` });
  shots.push(name);
  console.log('CAPTURE', name);
}
let failure;
try {
  const me = await openPage('Friend QA', 'cro-female');
  const page = me.page;
  const room = game.rooms.get('FRIENDS');
  room.enemies = [];
  room.animals = [];
  room.behemoth = null;
  room.sabertooth = null;
  for (let i = 0; i < 4; i++) {
    const peer = {
      state: null,
      ws: new WebSocket(`ws://127.0.0.1:${port}/ws?room=FRIENDS&name=Observer${i}`),
    };
    peer.ws.on('message', (b) => {
      const m = JSON.parse(b);
      if (m.type === 'state') peer.state = m;
    });
    peers.push(peer);
    await new Promise((r, j) => {
      peer.ws.once('open', r);
      peer.ws.once('error', j);
    });
  }
  await until(() => room.players.size === 5, 'five participants');
  const p = room.players.get(me.id());
  for (const other of room.players.values())
    if (other.id !== p.id) Object.assign(other, { x: 70, z: 55 });
  if (mode === 'all') {
    // Camp overview of every friend at home.
    const camp = room.friends;
    const cx = camp.reduce((s, f) => s + f.x, 0) / camp.length,
      cz = camp.reduce((s, f) => s + f.z, 0) / camp.length;
    await shot(page, 'camp-overview', {
      eye: [cx + 1.5, 3.2, cz - 7.5],
      target: [cx, 0.3, cz],
      fov: 50,
    });
    const park = (body, i) =>
      Object.assign(body, {
        x: 64 + i * 0.7,
        z: 62,
        mode: 'idle',
        followPlayerId: null,
        petPlayerId: null,
        path: [],
        trail: [{ x: 64 + i * 0.7, z: 62 }],
      });
    for (const def of delivered) {
      const c = room.friends.find((f) => f.key === def.key);
      // Keep every other companion available but outside the nearest-pet radius.
      [
        ...room.friends.filter((f) => f !== c),
        room.kohaku,
        room.maruimo,
        room.mae,
        room.rimoNeko,
        room.companion524,
      ]
        .filter(Boolean)
        .forEach(park);
      for (const [i, bot] of (room.orbBots ?? []).entries())
        Object.assign(bot, {
          x: 64 + i * 0.4,
          z: 66,
          home: { x: 64 + i * 0.4, z: 66 },
          mode: 'home',
          ownerId: '',
          path: [],
        });
      Object.assign(c, {
        ...c.home,
        mode: 'idle',
        followPlayerId: null,
        petPlayerId: null,
        petAt: 0,
        petContactAt: 0,
        path: [],
        trail: [{ ...c.home }],
        facing: c.homeFacing,
      });
      stopActor(p);
      Object.assign(p, {
        x: c.home.x - Math.sin(c.homeFacing) * -1.5,
        z: c.home.z - Math.cos(c.homeFacing) * -1.5,
        facing: c.homeFacing + Math.PI,
        warpSequence: (p.warpSequence ?? 0) + 1,
      });
      await sleep(900);
      await shot(page, `${def.key}-home`, {
        eye: [c.x + Math.sin(c.homeFacing) * 1.4 + 0.5, 0.7, c.z + Math.cos(c.homeFacing) * 1.4],
        target: [c.x, 0.3, c.z],
        fov: 45,
      });
      await page.evaluate(() => (window.reviewView = null));
      await page.locator('#world').focus();
      await page.keyboard.press('v');
      await until(() => c.petContactAt > 0, `${def.key} V pet contact`);
      const contact = c.petContactAt;
      await until(
        () => page.evaluate((k) => qa.friendRenderers.get(k).diagnostics().hearts >= 2, def.key),
        `${def.key} hearts`,
      );
      await shot(page, `${def.key}-happy`);
      await until(
        () =>
          peers.every(
            (q) => q.state?.friends?.find((f) => f.key === def.key)?.petContactAt === contact,
          ),
        `${def.key} five shared contact clocks`,
      );
      await until(() => !c.petPlayerId, `${def.key} pet completed`);
      assert.equal(c.followPlayerId, p.id);
      pass(`${def.name}: V petting, hearts, synchronized on five clients, bonded`);
      Object.assign(c, {
        followPlayerId: null,
        mode: 'idle',
        ...c.home,
        path: [],
        trail: [{ ...c.home }],
      });
    }
    // Selection cards: 全選択 brings every friend along; a real W walk keeps them close.
    stopActor(p);
    Object.assign(p, { x: 50, z: 44, facing: Math.PI, warpSequence: (p.warpSequence ?? 0) + 1 });
    await sleep(800);
    await page.locator('#world').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="mascots"]').click();
    await sleep(400);
    for (const def of FRIEND_MASCOTS)
      assert.equal(await page.locator(`[data-mascot="${def.key}"]`).count(), 1, def.key);
    await page.locator('[data-mascot-all="select"]').click();
    await until(
      () =>
        delivered.every((d) => room.friends.find((f) => f.key === d.key).followPlayerId === p.id),
      'all friends selected',
    );
    await sleep(500);
    await page.screenshot({ path: `${out}/mascot-cards.png` });
    shots.push('mascot-cards');
    pass('friend cards listed and 全選択 bonds every friend');
    await page.keyboard.press('Escape');
    await sleep(300);
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    const before = room.friends.map((f) => ({ key: f.key, x: f.x, z: f.z }));
    await page.locator('#world').focus();
    await page.keyboard.down('w');
    await sleep(3000);
    await page.keyboard.up('w');
    await sleep(3000);
    for (const b of before.filter((b) => delivered.some((d) => d.key === b.key))) {
      const f = room.friends.find((g) => g.key === b.key);
      assert.ok(Math.hypot(f.x - b.x, f.z - b.z) > 1, `${b.key} follows`);
      assert.ok(Math.hypot(f.x - p.x, f.z - p.z) < 7, `${b.key} stays near`);
    }
    await shot(page, 'friends-following', {
      eye: [p.x + 3.2, 2.2, p.z + 3.5],
      target: [p.x, 0.4, p.z],
      fov: 55,
    });
    pass('selected friends follow a real W walk');
    // Howkey with her flask, seen by a second player.
  }
  if (mode === 'all' || mode === 'cave') {
    // Cave friezes on the west wall, lit by the hearth: walk up to it and light it with E.
    stopActor(p);
    Object.assign(p, caveWorldAt(-20, 1.4), {
      facing: Math.PI / 2,
      warpSequence: (p.warpSequence ?? 0) + 1,
    });
    await sleep(2500);
    await page.locator('#world').focus();
    if (!room.camp.caveFireLit) await page.keyboard.press('e');
    await until(() => room.camp.caveFireLit, 'cave hearth lit with E');
    for (const motif of ['friendsMeadow', 'friendsRiver']) {
      const m = CAVE_MURALS.find((x) => x.motif === motif);
      const centre = caveWorldAt(m.centre);
      stopActor(p);
      // Torches light the paintings: line the five connected visitors up along the wall,
      // each carrying the game's ordinary torch, about 1.6 m from the stone.
      [...room.players.values()].forEach((q, i) => {
        stopActor(q);
        Object.assign(q, caveWorldAt(m.centre - m.width / 2 + 0.5 + (i * (m.width - 1)) / 4, 4.1), {
          facing: -Math.PI / 2,
          warpSequence: (q.warpSequence ?? 0) + 1,
        });
      });
      await sleep(4000);
      await page.waitForFunction(
        () => !!qa.landmarks?.caveExtraPigments?.friendsRiver?.image?.complete,
        null,
        { timeout: 60000 },
      );
      const floor = walkHeight(centre.x, centre.z);
      const view = {
        eye: [centre.x + 1.4, floor + 2.9, centre.z],
        target: [centre.x - 5.7, floor + 2.25, centre.z],
        fov: 65,
      };
      await shot(page, `cave-${motif}`, view);
      const stats = await sharp(`${out}/cave-${motif}.png`)
        .extract({ left: 200, top: 150, width: 1000, height: 600 })
        .stats();
      const lum = stats.channels.slice(0, 3).reduce((t, c) => t + c.mean, 0) / 3;
      console.log('CAVE', motif, JSON.stringify({ floor, view, lum, player: [p.x, p.z] }));
      assert.ok(lum > 12, `${motif} capture is lit (mean ${lum.toFixed(1)})`);
    }
    pass('both contributor friezes rendered in the cave');
  }
  // A second 3D tab is throttled in the background: finish with the first one.
  if (mode === 'all' || mode === 'howkey') {
    await page.close();
    const howkey = await openPage('Howkey QA', 'howkey-female');
    const h = room.players.get(howkey.id());
    stopActor(h);
    const hx = 50,
      hz = 43.5,
      g = walkHeight(hx, hz);
    Object.assign(h, { x: hx, z: hz, facing: 0, warpSequence: (h.warpSequence ?? 0) + 1 });
    await until(
      () => howkey.page.evaluate(() => [...qa.players.values()].some((e) => e.flask)),
      'Howkey flask attached',
      60000,
    );
    await sleep(1200);
    const visible = await howkey.page.evaluate(() =>
      [...qa.players.values()].some((e) => e.flask?.visible),
    );
    assert.ok(visible, 'flask visible while idle');
    // Facing +z: her right hand is on the -x side.
    await shot(howkey.page, 'howkey-flask-front', {
      eye: [hx - 0.6, g + 1.05, hz + 2.4],
      target: [hx, g + 0.8, hz],
      fov: 42,
    });
    await shot(howkey.page, 'howkey-flask-side', {
      eye: [hx - 1.9, g + 0.95, hz + 0.5],
      target: [hx - 0.2, g + 0.7, hz],
      fov: 40,
    });
    pass('Howkey holds the Erlenmeyer flask in her right hand');
  }
} catch (error) {
  failure = String(error?.stack ?? error);
  console.error(failure);
} finally {
  for (const peer of peers) peer.ws.close();
  await browser.close();
  await game.close();
}
const summary = {
  delivered: delivered.map((d) => d.key),
  checks,
  shots,
  errors,
  failure: failure ?? null,
};
await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, errors: errors.length, failure: !!failure }));
if (failure || errors.length) process.exitCode = 1;
