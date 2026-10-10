// Real browser controls and real time in an isolated in-memory server; no user save is opened.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { BOT_KINDS, botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.SHAPE_QA_OUT ?? `output/playwright/shape-bots/game-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [],
  peers = [],
  errors = [],
  checks = [],
  records = [],
  roomName = 'SHAPE-BOTS-QA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(35);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
function observeState(seen, message) {
  Object.assign(seen.state, message);
  seen.phases ??= [];
  seen.lastPhase ??= new Map();
  for (const bot of message.orbBots ?? []) {
    const key = `${bot.sequence}/${bot.mode}`;
    if (seen.lastPhase.get(bot.id) === key) continue;
    seen.lastPhase.set(bot.id, key);
    seen.phases.push({
      id: bot.id,
      kind: bot.kind,
      sequence: bot.sequence,
      mode: bot.mode,
      time: message.serverTime,
    });
  }
}
let room, a, b, failure;
function bots(owner) {
  return room.orbBots.filter((b) => b.ownerId === owner.p.id);
}
async function open(name, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  const page = await context.newPage(),
    seen = { id: null, state: {}, commands: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.commands.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') observeState(seen, m);
    });
  });
  await page.addInitScript((name) => localStorage.setItem('cro-name', name), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nconst observeOrb=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=observeOrb.apply(this,args);window.qa=this;window.qaFrames??=[];qaFrames.push({now:this.serverNow(),bots:this.orbBotRenderer?.diagnostics(),hands:[...this.players.values()].filter(e=>e.actor).map(e=>({id:e.state.id,model:e.actor.asset.modelKey,weight:e.actor.orbBotPose.weight,error:e.actor.orbBotPose.contact.distanceTo(e.actor.orbBotPose.requested)}))});if(qaFrames.length>1500)qaFrames.shift();return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  assert.equal(await page.locator('#setup-form .character-choice').count(), 9);
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  await page.waitForFunction(() => window.qa?.orbBotRenderer?.bots.size >= 9, { timeout: 30000 });
  return { page, seen, p: game.rooms.get(roomName).players.get(seen.id) };
}
async function camera(player, yaw = 0.7, distance = 3.1) {
  await player.page.evaluate(
    ({ yaw, distance }) => {
      qa.yaw = yaw;
      qa.pitch = 0.21;
      qa.targetDistance = distance;
    },
    { yaw, distance },
  );
}
async function measureFrames(player) {
  return player.page.evaluate(async () => {
    const start = performance.now(),
      firstFrame = qa.renderer.info.render.frame;
    let previous = start,
      frame = firstFrame;
    const intervals = [];
    await new Promise((resolve) => {
      const sample = (now) => {
        if (qa.renderer.info.render.frame !== frame) {
          intervals.push(now - previous);
          previous = now;
          frame = qa.renderer.info.render.frame;
        }
        if (now - start >= 5000) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const elapsed = performance.now() - start;
    const ordered = intervals.slice().sort((a, b) => a - b);
    const gl = qa.renderer.getContext(),
      info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      elapsedMilliseconds: elapsed,
      frames: frame - firstFrame,
      averageFps: ((frame - firstFrame) * 1000) / elapsed,
      intervalP50: ordered[Math.floor(ordered.length * 0.5)],
      intervalP95: ordered[Math.floor(ordered.length * 0.95)],
      renderer: { ...qa.renderer.info.render },
      memory: { ...qa.renderer.info.memory },
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      scope:
        'Five-second observation in two instrumented headless Chrome pages with five network players; not a sustained or physical-device benchmark.',
    };
  });
}
async function fixture(player, x, z) {
  stopActor(player.p);
  Object.assign(player.p, { x, z, facing: 0, warpSequence: (player.p.warpSequence ?? 0) + 1 });
  await sleep(650);
  await player.page.locator('#world').focus();
}
async function hold(player, kind) {
  await player.page.locator(`#orb-bot-controls [data-bot-kind="${kind}"]`).click();
  await player.page.locator('#world').focus();
  await player.page.keyboard.press('c');
  await until(() => bots(player).some((b) => b.kind === kind && b.mode === 'held'), `hold ${kind}`);
  await sleep(550);
  await player.page.screenshot({
    path: `${out}/held-${player.p.species}-${player.p.gender}-${kind}.png`,
  });
  const rows = await player.page.evaluate(() => qa.orbBotRenderer.diagnostics());
  const b = rows.find((b) => b.kind === kind && b.ownerId === player.p.id);
  assert.ok(b && b.handError < 0.001, `held contact ${kind}: ${b?.handError}`);
  records.push({
    heldModel: `${player.p.species}-${player.p.gender}`,
    kind,
    handError: b.handError,
  });
}
async function throwReturn(
  player,
  kind,
  recall = false,
  trigger = () => player.page.keyboard.press('c'),
) {
  const before = bots(player).find((b) => b.kind === kind).sequence;
  await trigger();
  await until(
    () => bots(player).some((b) => b.kind === kind && b.sequence === before + 1),
    'throw command',
  );
  await until(() => bots(player).some((b) => b.kind === kind && b.mode === 'airborne'), 'flight');
  if (recall) {
    await sleep(250); // The existing action gate is 450 ms, including the throw command.
    await player.page.keyboard.press('q');
    await until(() => bots(player).find((b) => b.kind === kind)?.recall, 'recall reached server');
  }
  await player.page.waitForFunction(
    ({ id, kind }) =>
      qa.orbBotRenderer
        .diagnostics()
        .some((b) => b.ownerId === id && b.kind === kind && b.mode === 'airborne'),
    { id: player.p.id, kind },
    { timeout: 3000 },
  );
  await player.page.screenshot({ path: `${out}/flight-${player.p.species}-${kind}.png` });
  await until(
    () => bots(player).find((b) => b.kind === kind)?.mode === 'following',
    'automatic return',
    20000,
  );
  assert.ok(
    Math.hypot(
      bots(player).find((b) => b.kind === kind).x - player.p.x,
      bots(player).find((b) => b.kind === kind).z - player.p.z,
    ) < 3,
  );
  const row = bots(player).find((b) => b.kind === kind);
  await until(
    () =>
      [a, b, ...peers].every((v) =>
        v.seen.state.orbBots?.some(
          (b) => b.id === row.id && b.sequence === row.sequence && b.mode === 'following',
        ),
      ),
    'all five see reunion',
  );
  for (const viewer of [a, b, ...peers]) {
    const phases = viewer.seen.phases.filter(
      (event) => event.id === row.id && event.sequence === row.sequence,
    );
    for (const mode of ['windup', 'airborne', 'landing', 'returning', 'catching', 'following'])
      assert.ok(
        phases.some((event) => event.mode === mode),
        `${kind}: peer missed ${mode}`,
      );
  }
  const rendered = await player.page.evaluate(
    ({ id, sequence }) =>
      qaFrames
        .map((frame) => ({
          now: frame.now,
          bot: frame.bots?.find((b) => b.id === id && b.sequence === sequence),
        }))
        .filter((frame) => frame.bot),
    { id: row.id, sequence: row.sequence },
  );
  assert.ok(rendered.some((frame) => frame.bot.mode === 'airborne' && frame.bot.visible));
  records.push({
    kind,
    model: `${player.p.species}-${player.p.gender}`,
    sequence: row.sequence,
    recall,
    rendered,
  });
}
try {
  a = await open('Bot carrier A', 'cro-female');
  room = game.rooms.get(roomName);
  room.enemies = [];
  b = await open('Bot carrier B', 'howkey-female');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=BotObserver${i}`),
      seen = { state: {} };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') observeState(seen, m);
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  await until(
    () => room.players.size === 5 && room.orbBots.length === 45,
    'five players and 45 bots',
  );
  const sixth = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Sixth`);
  await new Promise((resolve) => {
    sixth.on('error', () => resolve());
    sixth.on('close', () => resolve());
  });
  assert.equal(room.players.size, 5);
  pass('two Chrome players and three wire peers, 45 unique bots, sixth rejected');
  // The QA fixtures only move isolated test players, never the normal server or user saves.
  const site = (() => {
    for (let x = 35; x < 67; x += 1)
      for (let z = 54; z < 67; z += 1) {
        const p = { ...a.p, x, z, facing: 0 };
        const plan = botThrowPlan(p, room.collision);
        if (room.collision.free(p, 0.9) && plan && plan.landing.z - z > 7.5) return { x, z };
      }
    throw Error('No clear QA lane');
  })();
  await fixture(a, site.x, site.z);
  await fixture(b, site.x + 3, site.z);
  for (const [index, peer] of peers.entries()) {
    const player = room.players.get(peer.seen.id);
    assert.ok(player);
    const position = room.collision.nearestFree(
      { x: site.x + (index - 1) * 1.7, z: site.z + 3 },
      player.radius,
      [],
      3,
    );
    assert.ok(position);
    stopActor(player);
    Object.assign(player, position, { warpSequence: (player.warpSequence ?? 0) + 1 });
  }
  await camera(a, 0, 12);
  await sleep(1400);
  const scene = await a.page.evaluate(() => ({
    players: qa.players.size,
    bots: qa.orbBotRenderer.diagnostics().length,
    visibleBots: qa.orbBotRenderer.diagnostics().filter((b) => b.visible).length,
    renderer: { ...qa.renderer.info.render },
    memory: { ...qa.renderer.info.memory },
    loadMilliseconds: qa.worldAssets.loadMilliseconds,
    heap: performance.memory?.usedJSHeapSize ?? null,
  }));
  assert.equal(scene.players, 5);
  assert.equal(scene.bots, 45);
  assert.equal(scene.visibleBots, 45);
  records.push({ fivePlayerScene: scene });
  await a.page.screenshot({ path: `${out}/five-players-45-bots.png` });
  records.push({ widePerformance: await measureFrames(a) });
  await camera(a);
  await camera(b, -0.7, 4);
  records.push({ closePerformance: await measureFrames(a) });
  if (process.env.ORB_QA_SHADOW_REVIEW) {
    await sleep(500);
    await a.page.screenshot({ path: `${out}/shadow-before.png` });
    await a.page.evaluate(() => {
      for (const { actor } of qa.orbBotRenderer.bots.values())
        for (const entry of actor.root.userData.actorDetail.meshes)
          entry.mesh.receiveShadow = false;
    });
    await sleep(300);
    await a.page.screenshot({ path: `${out}/shadow-disabled.png` });
    await a.page.evaluate(() => {
      for (const { actor } of qa.orbBotRenderer.bots.values())
        for (const entry of actor.root.userData.actorDetail.meshes) entry.mesh.receiveShadow = true;
    });
  }
  assert.equal(await a.page.locator('#orb-bot-controls .orb-choice').count(), 9);
  const portraits = await a.page
    .locator('#orb-bot-controls .orb-choice img')
    .evaluateAll((images) =>
      images.map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        source: image.src,
      })),
    );
  assert.equal(portraits.length, 4);
  assert.ok(portraits.every((image) => image.loaded));
  await a.page.locator('#world').focus();
  for (const kind of [...BOT_KINDS.slice(1), BOT_KINDS[0]]) {
    await a.page.keyboard.press('z');
    await until(
      async () =>
        (await a.page
          .locator(`#orb-bot-controls [data-bot-kind="${kind}"]`)
          .getAttribute('aria-pressed')) === 'true',
      `keyboard selection ${kind}`,
    );
  }
  pass('four portrait buttons load and Z cycles through all nine kinds back to the first');
  for (const kind of BOT_KINDS) {
    await hold(a, kind);
    await throwReturn(a, kind, kind === 'triangle' || kind === 'purple');
    await sleep(550);
  }
  pass(
    'all nine exact models selected, held at the hand, thrown, landed and automatically rejoined on all five clients',
  );
  await hold(a, 'beret');
  await hold(b, 'heart');
  await Promise.all([throwReturn(a, 'beret'), throwReturn(b, 'heart')]);
  assert.ok(bots(a).every((bot) => bot.ownerId === a.p.id));
  assert.ok(bots(b).every((bot) => bot.ownerId === b.p.id));
  pass('two owners throw different companions at once and each receives their own bot');
  // Move the remote owner, allowing the ordinary camera-distance gate to choose
  // low geometry. Keep each original skeleton/material reference for comparison.
  await a.page.evaluate((owner) => {
    window.orbLodBefore = new Map(
      [...qa.orbBotRenderer.bots.entries()]
        .filter(([, e]) => e.state.ownerId === owner)
        .map(([id, e]) => [
          id,
          e.actor.root.userData.actorDetail.meshes.map((m) => ({
            material: m.mesh.material,
            skeleton: m.mesh.skeleton,
          })),
        ]),
    );
  }, b.p.id);
  await fixture(b, site.x, site.z - 20);
  const lodReport = () =>
    a.page.evaluate(
      (owner) =>
        [...qa.orbBotRenderer.bots.entries()]
          .filter(([, e]) => e.state.ownerId === owner)
          .map(([id, e]) => {
            const detail = e.actor.root.userData.actorDetail;
            return {
              id,
              kind: e.state.kind,
              level: detail.level,
              distance: e.actor.root.position.distanceTo(qa.camera.position),
              triangles: detail.meshes.reduce(
                (total, m) => total + m.mesh.geometry.index.count / 3,
                0,
              ),
              expected: detail.level ? e.actor.asset.lods[0].triangles : e.actor.asset.triangles,
              shared: detail.meshes.every(
                (m, i) =>
                  m.mesh.material === orbLodBefore.get(id)[i].material &&
                  m.mesh.skeleton === orbLodBefore.get(id)[i].skeleton,
              ),
            };
          }),
      b.p.id,
    );
  await until(async () => (await lodReport()).every((e) => e.level === 1), 'nine distant bot LODs');
  const distant = await lodReport();
  assert.equal(distant.length, 9);
  assert.ok(distant.every((e) => e.distance > 11 && e.triangles === e.expected && e.shared));
  await a.page.screenshot({ path: `${out}/nine-lods-far.png` });
  await fixture(b, site.x + 1, site.z);
  await until(
    async () => (await lodReport()).every((e) => e.level === 0),
    'nine bot LODs restored',
  );
  const close = await lodReport();
  assert.ok(close.every((e) => e.distance < 7 && e.triangles === e.expected && e.shared));
  records.push({ distant, close });
  await a.page.screenshot({ path: `${out}/nine-lods-return.png` });
  pass(
    'all nine bot meshes switch at actual distance and reuse the exact original skeleton and material',
  );
  await fixture(b, site.x + 3, site.z);
  for (const model of CHARACTER_MODELS.slice(1)) {
    await a.page.keyboard.press('Escape');
    await a.page.locator('[data-controller-menu="character"]').click();
    await a.page
      .locator(
        `#character-switch-form .character-choice:has(input[value="${model.species}-${model.gender}"])`,
      )
      .click();
    await a.page.locator('#character-confirm-yes').click();
    await until(
      () => a.p.species === model.species && a.p.gender === model.gender,
      'character change',
    );
    await a.page.locator('#modal').waitFor({ state: 'hidden', timeout: 10000 });
    await a.page.waitForFunction(
      (key) => qa.players.get(qa.selfId)?.actor?.asset.modelKey === key,
      model.key,
      { timeout: 60000 },
    );
    await fixture(a, site.x, site.z);
    await camera(a, 0.7, model.species === 'bear' ? 2 : 3.2);
    const kind = ['beret', 'frog', 'triangle', 'heart'][CHARACTER_MODELS.indexOf(model) % 4];
    await hold(a, kind);
    await throwReturn(a, kind);
    await sleep(550);
  }
  pass('all nine playable characters hold and throw with their delivered rig');
  await hold(a, 'frog');
  const sequence = a.p.attackSequence;
  await a.page.keyboard.press('f');
  await until(() => a.p.attackSequence > sequence, 'attack');
  assert.ok(!bots(a).some((b) => b.mode === 'held' || b.mode === 'windup'));
  await sleep(1800);
  pass('attack releases the hand safely and keeps existing combat available');
  const before = { x: a.p.x, z: a.p.z };
  await a.page.keyboard.down('w');
  await sleep(1200);
  await a.page.keyboard.up('w');
  await until(() => Math.hypot(a.p.x - before.x, a.p.z - before.z) > 0.5, 'walk');
  await sleep(2400);
  assert.ok(bots(a).every((b) => Math.hypot(b.x - a.p.x, b.z - a.p.z) < 4));
  pass('walking companions catch the moving owner');
  await a.page.evaluate(() => {
    window.qaPad = {
      id: 'ORB QA standard controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [window.qaPad],
    });
  });
  await a.page.locator('#orb-bot-controls [data-bot-kind="heart"]').click();
  await a.page.locator('#world').focus();
  await sleep(500);
  const padTap = async (button) => {
    await a.page.evaluate(async (button) => {
      qaPad.buttons[button] = { pressed: true, value: 1 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      qaPad.buttons[button] = { pressed: false, value: 0 };
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    }, button);
  };
  await padTap(10);
  await until(() => bots(a).some((b) => b.kind === 'heart' && b.mode === 'held'), 'L3 hold');
  await sleep(550);
  await throwReturn(a, 'heart', false, () => padTap(10));
  const commandsBeforeRecall = a.seen.commands.length;
  await padTap(12);
  assert.ok(a.seen.commands.slice(commandsBeforeRecall).some((m) => m.action === 'recallBots'));
  await a.page.evaluate(() => {
    qaPad.connected = false;
  });
  pass('simulated standard-controller L3 holds/throws and D-pad up recalls through the real UI');
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="bots"]').click();
  assert.equal(await a.page.locator('.orb-menu [data-bot-kind]').count(), 9);
  await a.page.locator('.orb-menu [data-bot-kind="triangle"]').click();
  await a.page.locator('.orb-menu [data-bot-action="recall"]').click();
  assert.equal(await a.page.locator('#modal').isVisible(), false);
  pass('menu exposes all nine choices and recall');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.page.setViewportSize({ width, height });
    await sleep(200);
    await a.page.screenshot({ path: `${out}/game-${width}x${height}.png` });
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const box = await a.page.locator('#orb-bot-controls').boundingBox();
    assert.ok(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
    );
    await a.page.locator('#orb-bot-controls [data-bot-action="recall"]').click();
  }
  pass('portrait and landscape controls fit and remain clickable');
  // Non-empty fixtures make save preservation meaningful without touching user saves.
  a.p.inventory.wood = 3;
  a.p.inventory.berry = 2;
  const inventory = structuredClone(a.p.inventory);
  await a.page.reload();
  await a.page.locator('#title-start').click();
  await a.page
    .locator(`#setup-form .character-choice:has(input[value="${a.p.species}-${a.p.gender}"])`)
    .click();
  await a.page.locator('#setup-flow-yes').click();
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => room.players.size === 5 && room.orbBots.length === 45, 'reload rejoin');
  a.p = room.players.get(a.seen.id);
  assert.deepEqual(a.p.inventory, inventory);
  assert.equal(new Set(room.orbBots.map((b) => b.id)).size, 45);
  assert.deepEqual(
    bots(a).map((bot) => bot.kind),
    BOT_KINDS,
  );
  pass('reload retains non-empty inventory and recreates exactly nine owned companions');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
  if (a) await a.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  for (const p of [a, b].filter(Boolean))
    records.push({
      page: p.p.id,
      frames: await p.page.evaluate(() => window.qaFrames ?? []).catch(() => []),
    });
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        checks,
        records,
        errors,
        failure,
        passed: !failure,
        scope:
          'Two real Chrome pages and three protocol peers in an isolated unsaved room. Player positions and enemy removal are explicit QA fixtures; inputs, flight and return use real time. No sustained FPS or physical controller claim.',
      },
      null,
      2,
    ) + '\n',
  );
  for (const { ws } of peers) ws.close();
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
else console.log(JSON.stringify({ out, checks: checks.length, passed: true }));
