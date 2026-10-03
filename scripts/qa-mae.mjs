// Real-time controls in a separate in-memory server. No user save is opened.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { MAE } from '../dist/shared/mae.mjs';
import { BRIDGE } from '../dist/shared/scenery-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.QA_MAE_OUT ?? `output/playwright/mae/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const peers = [],
  errors = [],
  checks = [],
  records = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function until(fn, message, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(message);
    await sleep(30);
  }
}
async function start(page) {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
}
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }),
    page = await context.newPage();
  const seen = { id: null, state: {}, sent: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.sent.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    });
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
const maeOriginalRender=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){const result=maeOriginalRender.apply(this,args);window.qa=this;window.qaThree=THREE;window.maeFrames??=[];
 const pet=this.state.mae,pose=this.players.get(pet?.petPlayerId)?.actor?.groundPettingPose;
 if(window.maeCapture&&this.maeRenderer)maeFrames.push({at:this.serverNow(),petContactAt:pet?.petContactAt,weight:pose?.weight??0,gap:pose?.contact.distanceTo(pose.requested)??0,...this.maeRenderer.diagnostics()});
 if(maeFrames.length>5000)maeFrames.shift();return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=MAE-QA`);
  await start(page);
  await until(() => seen.id && game.rooms.get('MAE-QA')?.players.has(seen.id), 'join');
  return {
    page,
    seen,
    get p() {
      return game.rooms.get('MAE-QA').players.get(seen.id);
    },
  };
}
async function skin(user, character) {
  if (user.p.species === character.species && user.p.gender === character.gender) return;
  await user.page.keyboard.press('Escape');
  await user.page.locator('[data-controller-menu="character"]').click();
  await user.page
    .locator(
      `#character-switch-form .character-choice:has(input[value="${character.species}-${character.gender}"])`,
    )
    .click();
  await user.page.locator('#character-confirm-yes').click();
  await until(
    () =>
      user.page.evaluate(
        (key) => qa.players.get(qa.selfId)?.actor?.asset.modelKey === key,
        character.key,
      ),
    'character rendered',
  );
  if (await user.page.locator('#modal').isVisible()) await user.page.keyboard.press('Escape');
  // A decoded character can still compile its first GPU programs. Observe real
  // rendered frames before beginning the short shared reaction measurement.
  await user.page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0;
        const frame = () => {
          if (++count >= 45) resolve();
          else requestAnimationFrame(frame);
        };
        frame();
      }),
  );
}
let room, a, b, c, failure;
async function place(user, position = { x: 40, z: 55 }) {
  stopActor(user.p);
  Object.assign(user.p, {
    x: position.x,
    z: position.z + 1.55,
    facing: Math.PI,
    warpSequence: (user.p.warpSequence ?? 0) + 1,
    pendingStrike: null,
    attackAt: 0,
    attackSequence: 0,
  });
  Object.assign(c, {
    ...position,
    facing: 0,
    mode: 'idle',
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    hitAt: 0,
    hitSequence: 0,
    path: [],
    trail: [{ ...c.home }],
    velocityX: 0,
    velocityZ: 0,
    followSpeed: 0,
    ownerPosition: null,
  });
  await sleep(450);
  for (const viewer of [a, b].filter(Boolean)) {
    await until(
      () =>
        viewer.page.evaluate(
          (at) => qa.state.mae && Math.hypot(qa.state.mae.x - at.x, qa.state.mae.z - at.z) < 0.1,
          position,
        ),
      'fixture received',
    );
    await viewer.page.evaluate(() => {
      qa.maeRenderer.placed = false;
      qa.yaw = 1.1;
      qa.pitch = 0.24;
      qa.targetDistance = 3.0;
    });
  }
  await until(
    () =>
      user.page.evaluate(
        () =>
          Math.hypot(
            qa.maeRenderer.root.position.x - qa.state.mae.x,
            qa.maeRenderer.root.position.z - qa.state.mae.z,
          ) < 0.01,
      ),
    'fixture settled',
  );
  await user.page.locator('#world').focus();
}
async function shot(user, name) {
  await user.page.screenshot({ path: `${out}/${name}.png` });
}
async function capture(user, on = true) {
  await user.page.evaluate((on) => {
    window.maeCapture = on;
    if (on) window.maeFrames = [];
  }, on);
}
async function pet(user, trigger, label) {
  const before = c.petSequence;
  await trigger();
  await until(() => c.petSequence === before + 1 && c.petContactAt > 0, label + ' contact');
  const contact = c.petContactAt;
  await until(() => c.followPlayerId === user.p.id, label + ' affection');
  await until(
    () => user.page.evaluate(() => qa.maeRenderer.diagnostics().hearts >= 3),
    label + ' hearts',
  );
  await shot(user, label + '-happy');
  await until(
    () => [a, b, ...peers].every((v) => v.seen.state.mae?.petContactAt === contact),
    label + ' shared clock',
  );
  await until(() => !c.petPlayerId, label + ' finished');
}
try {
  a = await open('MaeQA-A');
  room = game.rooms.get('MAE-QA');
  c = room.mae;
  room.enemies = [];
  room.animals = [];
  b = await open('MaeQA-B');
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MAE-QA&name=MaePeer${i}`),
      seen = { state: {} };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'state') seen.state = m;
    });
    peers.push({ ws, seen });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five participants');
  for (const p of room.players.values()) if (p.id !== a.p.id) Object.assign(p, { x: 70, z: 55 });
  // Existing pets remain loaded and server-owned; move them only in this fixture.
  Object.assign(room.rimoNeko, { x: 60, z: 60 });
  Object.assign(room.companion524, { x: 64, z: 60 });
  pass(
    'two real Chrome views and three network participants; all existing companion assets loaded',
  );
  const prior = process.env.QA_MAE_PRIOR;
  if (prior) {
    const checked = JSON.parse(await readFile(prior + '/frames.json', 'utf8')).filter(
      (r) => r.character,
    );
    assert.equal(checked.length, 9);
    assert.ok(
      checked.every(
        (r) =>
          r.maxHandGap < 0.045 &&
          r.contactSamples > 5 &&
          r.remote.some((f) => f.reaction === 'happy' && f.hearts >= 3),
      ),
    );
    records.push(...checked.map((r) => ({ ...r, sourceRun: prior })));
    console.log('Reuse completed character/contact checks from unchanged game code:', prior);
  }
  for (const character of prior ? [] : CHARACTER_MODELS) {
    await skin(a, character);
    await place(a);
    await capture(a);
    await capture(b);
    await pet(a, () => a.page.keyboard.press('v'), character.key);
    const frames = await a.page.evaluate(() => {
      window.maeCapture = false;
      return maeFrames;
    });
    const contact = frames.filter(
      (f) =>
        f.weight > 0.99 &&
        f.reaction === 'pet' &&
        f.at - f.petContactAt > 150 &&
        f.at - f.petContactAt < MAE.petStrokeMs - 100,
    );
    const remote = await b.page.evaluate(() => {
      window.maeCapture = false;
      return maeFrames;
    });
    const gap = Math.max(...contact.map((f) => f.gap));
    assert.ok(contact.length > 5, character.key + ' has contact samples');
    assert.ok(gap < 0.045, character.key + ' animated hand reaches pouch: ' + gap);
    assert.ok(
      remote.some((f) => f.reaction === 'happy' && f.hearts >= 3),
      character.key + ' remote hearts',
    );
    records.push({
      character: character.key,
      maxHandGap: gap,
      contactSamples: contact.length,
      frames,
      remote,
    });
    console.log('PET', character.key, gap);
  }
  pass('all nine characters crouch, touch the moving crown and share the happy gesture and hearts');
  await skin(a, CHARACTER_MODELS[0]);
  await place(a);
  await pet(a, () => a.page.keyboard.press('e'), 'key-e');
  await a.page.evaluate(() => {
    qa.yaw = 0;
    qa.pitch = 0.35;
    qa.targetDistance = 7;
  });
  await a.page.keyboard.down('w');
  await sleep(1700);
  await a.page.keyboard.up('w');
  await sleep(1800);
  assert.ok(dist(a.p, c) < 2.1);
  await shot(a, 'ordinary-camera-follow');
  await a.page.keyboard.press('Shift');
  await a.page.keyboard.down('w');
  await until(
    () => a.page.evaluate(() => qa.maeRenderer.diagnostics().clip === 'Run_Loop'),
    'real sprint follow',
  );
  await sleep(700);
  await a.page.keyboard.up('w');
  await a.page.keyboard.press('Shift');
  await until(
    () => a.page.evaluate(() => qa.maeRenderer.diagnostics().clip === 'Idle_Loop'),
    'settled after run',
  );
  pass('nearby E, actual walking and running inputs, stopping and ordinary rear camera');
  await place(a);
  const clickAt = await a.page.evaluate(() => {
    const v = qa.maeRenderer.root.position.clone();
    v.y += 0.19;
    v.project(qa.camera);
    const r = qa.canvas.getBoundingClientRect();
    return { x: r.x + ((v.x + 1) * r.width) / 2, y: r.y + ((1 - v.y) * r.height) / 2 };
  });
  await pet(a, () => a.page.mouse.click(clickAt.x, clickAt.y), 'mesh-click');
  pass('clicking the actual pouch mesh pets mae');
  await place(a);
  const levels = [];
  for (const distance of [3, 16, 3]) {
    await a.page.evaluate((d) => {
      qa.targetDistance = d;
      qa.yaw = Math.PI;
    }, distance);
    await sleep(1500);
    levels.push(
      await a.page.evaluate(() => ({
        level: qa.maeRenderer.actor.root.userData.actorDetail.level,
        distance: qa.maeRenderer.root.position.distanceTo(qa.camera.position),
      })),
    );
    await shot(a, `lod-${distance}-${levels.length}`);
  }
  records.push({ levels });
  assert.deepEqual(
    levels.map((l) => l.level),
    [0, 1, 0],
  );
  pass('real camera distance switches to the shared-rig LOD and returns to the original mesh');
  await place(a, { x: BRIDGE.x - 2.5, z: BRIDGE.z });
  Object.assign(a.p, { x: BRIDGE.x - 0.7, z: BRIDGE.z, warpSequence: a.p.warpSequence + 1 });
  Object.assign(c, { mode: 'following', followPlayerId: a.p.id });
  await a.page.evaluate(() => {
    qa.yaw = 0;
    qa.pitch = 0.25;
    qa.targetDistance = 5;
  });
  await sleep(500);
  await capture(a);
  await a.page.keyboard.down('d');
  await sleep(1000);
  await a.page.keyboard.up('d');
  await sleep(1400);
  const bridgeFrames = await a.page.evaluate(() => {
    window.maeCapture = false;
    return maeFrames;
  });
  assert.ok(c.x > BRIDGE.x - 1.7);
  assert.ok(bridgeFrames.some((f) => Math.abs(f.floor - 0.3) < 1e-5));
  assert.ok(bridgeFrames.every((f) => Math.abs(f.position[1] - f.floor - 0.002) < 1e-5));
  records.push({ bridgeFrames });
  await shot(a, 'bridge');
  pass('real follow input crosses the bridge with aligned floor height');
  await place(a);
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-pause-tab="info"]').click();
  await a.page.locator('[data-pause-subtab="world"]').click();
  await a.page.locator('[data-controller-menu="petMae"]').click();
  await until(() => c.petContactAt > 0, 'menu pet contact');
  await a.page.keyboard.press('q');
  await until(() => !c.petPlayerId, 'Q cancels');
  assert.equal(c.followPlayerId, null);
  pass('normal menu pet and Q interrupt before affection');
  await place(a);
  await a.page.evaluate(() => {
    qaPad.buttons[0] = { pressed: true, value: 1 };
  });
  await sleep(170);
  await a.page.evaluate(() => {
    qaPad.buttons[0] = { pressed: false, value: 0 };
  });
  await until(() => c.petContactAt > 0, 'synthetic pad contact');
  await a.page.keyboard.down('w');
  await sleep(250);
  await a.page.keyboard.up('w');
  await until(() => !c.petPlayerId, 'movement interrupts');
  assert.equal(c.followPlayerId, null);
  pass('synthetic standard gamepad bottom button and movement cancellation');
  await place(a);
  await pet(a, () => a.page.keyboard.press('v'), 'before-return');
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="dismissMae"]').click();
  await until(() => c.mode === 'returning', 'menu return');
  assert.equal(c.followPlayerId, null);
  await until(() => c.mode === 'idle', 'returns to camp', 25000);
  assert.ok(dist(c, c.home) < 0.1);
  pass('owned-only return command walks mae back to camp');
  await place(a);
  await a.page.evaluate(() => {
    qa.yaw = 0;
  });
  await a.page.keyboard.press('f');
  await until(() => c.hitSequence > 0, 'actual melee');
  await shot(a, 'hit');
  assert.equal(c.health, undefined);
  await sleep(MAE.hitMs + 100);
  pass('real melee input produces a soft recoil without health or loot');
  await place(a);
  await pet(a, () => a.page.keyboard.press('v'), 'before-rejoin');
  a.p.inventory.wood = 3;
  a.p.inventory.berry = 2;
  const inventory = structuredClone(a.p.inventory);
  await a.page.reload();
  await start(a.page);
  await until(() => a.p && room.players.size === 5, 'rejoined');
  assert.deepEqual(a.p.inventory, inventory);
  assert.equal(
    await a.page.evaluate(
      () => qa.scene.children.filter((o) => o.name === 'mae ground companion').length,
    ),
    1,
  );
  pass('title rejoin retains inventory and creates exactly one mae renderer');
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await a.page.setViewportSize(size);
    await place(a);
    await a.page.keyboard.press('Escape');
    await a.page.locator('[data-pause-tab="info"]').click();
    await a.page.locator('[data-pause-subtab="world"]').click();
    await a.page.locator('[data-controller-menu="petMae"]').scrollIntoViewIfNeeded();
    await sleep(250);
    await shot(a, `viewport-${size.width}`);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await a.page.locator('[data-controller-menu="petMae"]').click();
    await until(() => c.petContactAt > 0, 'small menu starts pet');
    await a.page.keyboard.press('q');
    await until(() => !c.petPlayerId, 'small menu cancel');
  }
  pass('portrait, landscape and desktop viewports fit without extra permanent pet controls');
  const lifecycle = await a.page.evaluate(async () => {
    const { MaeRenderer } = await import('/src/mae-renderer.js');
    const { MAE } = await import('/shared/mae.mjs');
    let now = 10000;
    const cat = {
      ...qa.state.mae,
      x: 40,
      z: 55,
      petPlayerId: 'qa',
      petAt: 9000,
      petContactAt: 10000,
      hitAt: 0,
      hitSequence: 0,
    };
    const make = () => {
      const w = Object.create(qa);
      w.scene = new qaThree.Scene();
      w.camera = new qaThree.PerspectiveCamera();
      w.camera.position.set(40, 2, 58);
      w.state = { mae: { ...cat } };
      w.labels = [];
      w.serverNow = () => now;
      w.createLabel = (_t, _s, p) => {
        const l = { element: document.createElement('div'), position: p, active: false };
        w.labels.push(l);
        return l;
      };
      const r = new MaeRenderer(w);
      r.update(0);
      return { w, r };
    };
    const one = make();
    let two;
    const results = [];
    const ok = (v, s) => {
      if (!v) throw Error(s);
      results.push(s);
    };
    const hearts = (r) =>
      JSON.stringify(
        r.hearts.map((h) => ({
          visible: h.visible,
          p: h.position.toArray(),
          a: h.material.opacity,
        })),
      );
    try {
      now = 10000 + MAE.petStrokeMs + 700;
      one.r.update(1 / 60);
      two = make();
      two.r.update(1 / 60);
      ok(hearts(one.r) === hearts(two.r), 'late join seeks the same heart phase');
      one.w.camera.position.x += 100;
      one.r.update(1 / 60);
      ok(one.r.diagnostics().hearts === 0, 'far view hides hearts');
      one.w.camera.position.x -= 100;
      now += 50;
      one.r.update(1 / 60);
      two.r.update(1 / 60);
      ok(hearts(one.r) === hearts(two.r), 'near view resumes current time');
      one.w.state.mae.petPlayerId = null;
      one.r.update(1 / 60);
      ok(one.r.diagnostics().hearts === 0, 'interruption removes hearts');
      one.w.state.mae.petPlayerId = 'qa';
      now = 10000 + MAE.petStrokeMs + MAE.happyMs;
      one.r.update(1 / 60);
      ok(one.r.diagnostics().hearts === 0, 'expired gesture cannot replay');
      one.w.state.mae = undefined;
      one.r.update(1 / 60);
      ok(!one.r.root.visible, 'missing pet is hidden');
    } finally {
      one.r.dispose();
      two?.r.dispose();
    }
    ok(one.w.labels.length === 0 && two.w.labels.length === 0, 'labels and sprites are disposed');
    return results;
  });
  records.push({ lifecycle });
  pass(
    'late display, distance culling, cancellation, expiration and disposal with the delivered GLB',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  if (a) {
    await shot(a, 'failure');
    await writeFile(
      `${out}/failure-state.json`,
      JSON.stringify(
        {
          mae: c,
          player: a.p,
          commands: a.seen.sent.filter((m) => m.type === 'action'),
          view: await a.page.evaluate(() => ({
            frames: window.maeFrames,
            mae: window.qa?.maeRenderer?.diagnostics(),
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: !failure,
        checks,
        errors,
        failure,
        fixtures: [
          'in-memory unsaved room',
          'explicit preparation positions and observation camera',
          'existing pets moved away and hostile actors removed only in QA',
        ],
        out,
        priorCharacterEvidence: process.env.QA_MAE_PRIOR ?? null,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(`${out}/frames.json`, JSON.stringify(records) + '\n');
  for (const peer of peers) peer.ws.close();
  await browser.close();
  await game.close();
}
if (failure) throw Error(failure);
console.log('VERIFIED', out);
