// Real Chrome, isolated in-memory world. First approach and following use ordinary
// controls. Explicit fixture placement is confined to direction/occlusion cases.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { COMPANION_524, nearCompanion524 } from '../dist/shared/companion-524.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.env.QA_524_OUT || 'output/playwright/companion-524/game';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  observations = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function until(fn, label, timeout = 15000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error(`Timeout: ${label}`);
    await sleep(60);
  }
}
const pass = (description) => {
  checks.push(description);
  console.log(`PASS ${description}`);
};
async function open(name, autostart = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const seen = { state: {}, id: null, commands: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = { ...seen.state, ...m };
    });
    socket.on('framesent', ({ payload }) => seen.commands.push(JSON.parse(String(payload))));
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst render524=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.qa524=this;window.qaThree=THREE;return render524.apply(this,args);};',
    });
  });
  await page.addInitScript(() => {
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=MASCOT-QA${autostart ? '&autostart=1' : ''}`);
  if (!autostart) {
    await page.locator('#title-start').click();
    await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
    await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
    await page.locator('#setup-flow-yes').click();
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get('MASCOT-QA')?.players.has(seen.id), 'join');
  const p = game.rooms.get('MASCOT-QA').players.get(seen.id);
  p.name = name;
  return { page, seen, p };
}
async function shot(a, label) {
  await a.page.screenshot({ path: `${out}/${label}.png` });
  observations.push({
    label,
    at: Date.now(),
    state: structuredClone(a.seen.state.companion524),
    view: await a.page.evaluate(() => qa524.companion524Renderer.diagnostics()),
  });
}
async function tap(a, button, delay = 120) {
  await a.page.bringToFront();
  await a.page.locator('#world').focus();
  for (const pressed of [false, true, false]) {
    await a.page.evaluate(
      ({ button, pressed }) => {
        qaPad.buttons[button] = { pressed, value: pressed ? 1 : 0 };
      },
      { button, pressed },
    );
    await sleep(delay);
  }
}
async function walk(a, goal) {
  const room = game.rooms.get('MASCOT-QA');
  const path = room.collision.path(a.p, goal, a.p.radius);
  assert.ok(path.length, 'player can walk to scenario');
  await a.page.bringToFront();
  await a.page.locator('#world').focus();
  for (const target of path) {
    if (distance(a.p, target) < 0.35) continue;
    await a.page.evaluate(
      (yaw) => {
        qa524.yaw = yaw;
      },
      Math.atan2(a.p.x - target.x, a.p.z - target.z),
    );
    await a.page.keyboard.down('w');
    try {
      await until(
        () => distance(a.p, target) < 0.35,
        `walk ${JSON.stringify(target)} from ${JSON.stringify({ x: a.p.x, z: a.p.z })}`,
        22000,
      );
    } finally {
      await a.page.keyboard.up('w');
    }
    await sleep(180);
  }
}
async function fixturePlayer(a, c, dx, dz) {
  stopActor(a.p);
  Object.assign(a.p, {
    x: c.x - dx * 1.7,
    z: c.z - dz * 1.7,
    facing: Math.atan2(dx, dz),
    pendingStrike: null,
    attackAt: 0,
    attackSequence: 0,
  });
  assert.ok(game.rooms.get('MASCOT-QA').collision.free(a.p, a.p.radius));
  await sleep(450);
  await a.page.evaluate(
    (yaw) => {
      qa524.yaw = yaw;
    },
    Math.atan2(-dx, -dz),
  );
  await a.page.locator('#world').focus();
}

try {
  const a = await open('524検証A');
  const room = game.rooms.get('MASCOT-QA'),
    c = room.companion524;
  const home = { ...c.home };
  await shot(a, '01-initial-camp');
  assert.equal(await a.page.locator('#pet524-button').isVisible(), false);
  const t0 = await a.page.evaluate(() => qa524.companion524Renderer.actor.mixer.time);
  await sleep(400);
  const t1 = await a.page.evaluate(() => qa524.companion524Renderer.actor.mixer.time);
  assert.notEqual(t0, t1);
  pass('Exact Candidate 14 appears beside the camp; Floating_Ripple advances while idle');
  await walk(a, { x: home.x, z: home.z + 1.8 });
  await until(() => nearCompanion524(a.p, c, room.collision, Date.now()), 'normal approach');
  await until(() => a.page.locator('#pet524-button').isVisible(), 'pet prompt');
  await shot(a, '02-near-pet-prompt');
  pass('Ordinary title selection and walking from the initial spawn reach the pet prompt');

  const b = await open('524検証B', true);
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MASCOT-QA&name=Peer${i}`);
    const seen = { state: {} };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'state') seen.state = { ...seen.state, ...m };
    });
    peers.push({ ws, seen });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five participants');
  const commandsBefore = a.seen.commands.length;
  await tap(a, 0);
  await until(() => c.petSequence === 1, 'Cross pet');
  await until(
    () =>
      b.seen.state.companion524?.petSequence === 1 &&
      peers.every((p) => p.seen.state.companion524?.petSequence === 1),
    'pet synchronized',
  );
  assert.equal(c.followPlayerId, a.p.id);
  assert.deepEqual(
    a.seen.commands
      .slice(commandsBefore)
      .filter((m) => m.type === 'action')
      .map((m) => m.action),
    ['pet524'],
  );
  await shot(a, '03-cross-happy-hearts');
  assert.ok(observations.at(-1).view.hearts > 0);
  pass(
    'Bottom/Cross pets once, plays a happy floating reaction and hearts, and synchronizes to all five clients',
  );

  // Empty peripheral participants stay out of the movement route.
  for (const p of room.players.values())
    if (p.id !== a.p.id) {
      stopActor(p);
      Object.assign(p, {
        x: 70 + room.players.size,
        z: 62 + [...room.players.keys()].indexOf(p.id) * 2,
      });
    }
  await sleep(2000);
  await walk(a, { x: home.x - 2, z: home.z + 10 });
  await sleep(1600);
  assert.ok(distance(c, a.p) < 3.3);
  const behind = (c.x - a.p.x) * Math.sin(a.p.facing) + (c.z - a.p.z) * Math.cos(a.p.facing);
  assert.ok(behind < -0.8);
  await shot(a, '04-following');
  pass('524 follows behind normal player movement while continuing the floating clip');

  await tap(a, 9);
  await a.page.locator('[data-controller-menu="dismiss524"]').waitFor();
  await a.page.locator('[data-controller-menu="dismiss524"]').focus();
  // Menu confirmation is the real controller ○, with focus placement recorded as setup.
  await a.page.evaluate(() => {
    qaPad.buttons[1] = { pressed: true, value: 1 };
  });
  await sleep(180);
  await a.page.evaluate(() => {
    qaPad.buttons[1] = { pressed: false, value: 0 };
  });
  await until(() => c.mode === 'returning', 'controller dismissal');
  await shot(a, '05-returning');
  await until(() => c.mode === 'idle' && distance(c, home) < 0.05, 'back at camp', 25000);
  pass(
    'OPTIONS → return-to-camp → Circle releases following; 524 floats back to the original point',
  );

  await walk(a, { x: home.x, z: home.z + 1.7 });
  await sleep(800);
  // Repeated attacks with real keyboard F; only setup coordinates/facing change.
  for (const [index, dx, dz] of [
    [1, 0, -1],
    [2, 0, -1],
    [3, 1, 0],
    [4, -1, 0],
  ]) {
    await fixturePlayer(a, c, dx, dz);
    const before = { x: c.x, z: c.z },
      seq = c.hitSequence;
    await a.page.keyboard.press('f');
    await until(() => c.hitSequence === seq + 1, `hit ${index}`);
    await sleep(140);
    await shot(a, `06-hit-${index}`);
    await sleep(700);
    assert.ok((c.x - before.x) * dx + (c.z - before.z) * dz > 0.55);
    assert.ok(observations.at(-1).view.y - observations.at(-1).view.floor > 0.9);
    await until(
      () =>
        b.seen.state.companion524?.hitSequence === c.hitSequence &&
        peers.every((p) => p.seen.state.companion524?.hitSequence === c.hitSequence),
      'hit synchronized',
    );
  }
  pass(
    'Four real F impacts move 524 incrementally in three directions; recoil stays airborne and is shared by five clients',
  );
  assert.equal(c.health, undefined);
  assert.equal(c.followPlayerId, null);
  assert.ok(room.players.get(a.p.id).energy > 0);

  // Pet again by keyboard; reload must not strand a follower with a stale owner.
  await fixturePlayer(a, c, 0, -1);
  await a.page.keyboard.press('v');
  await until(() => c.followPlayerId === a.p.id, 'keyboard pet');
  await a.page.setViewportSize({ width: 390, height: 844 });
  await sleep(350);
  await shot(a, '07-narrow-happy');
  const buttonBounds = await a.page.locator('#companion524-controls').boundingBox();
  assert.ok(buttonBounds.x >= 0 && buttonBounds.x + buttonBounds.width <= 390);
  await a.page.locator('#dismiss524-button').click();
  await until(() => c.followPlayerId === null, 'touch dismissal');
  await a.page.setViewportSize({ width: 844, height: 390 });
  await shot(a, '08-landscape-return');
  await until(() => c.mode === 'idle', 'return after touch', 25000);
  pass('Keyboard V and narrow-screen tap work; portrait and landscape controls remain on screen');

  await a.page.setViewportSize({ width: 1280, height: 800 });
  await fixturePlayer(a, c, 0, -1);
  await a.page.keyboard.press('v');
  await until(() => c.followPlayerId === a.p.id, 'pet before reload');
  const idBefore = a.p.id;
  await a.page.reload();
  await a.page.locator('#title-start').click();
  await a.page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await a.page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await a.page.locator('#setup-flow-yes').click();
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => c.mode === 'idle', 'return on reconnect', 15000);
  assert.equal(a.seen.id, idBefore);
  a.p = room.players.get(idBefore);
  await shot(a, '09-reloaded');
  pass(
    'Reload preserves player session; loss of the follower connection safely returns 524 to camp',
  );

  // Inspect every source vertex at 17 times, with the delivered skin and real
  // wrapper reactions. This is animation inspection, not gameplay interaction.
  const surface = await a.page.evaluate(async () => {
    const T = qaThree,
      r = qa524;
    const { companion524Pose } = await import('/src/companion-524-renderer.js');
    const actor = r.worldAssets.createAnimal('yellow-524-mascot', 'Floating_Ripple');
    const stage = new T.Group(),
      tilt = new T.Group();
    actor.root.scale.setScalar(1.15);
    tilt.add(actor.root);
    stage.add(tilt);
    actor.update(0.3);
    let minimum = Infinity,
      samples = 0,
      vertices = 0,
      loopError = 0;
    const first = [];
    for (const reaction of ['idle', 'happy', 'hit'])
      for (let i = 0; i <= 16; i++) {
        const now = 10000 + i * (reaction === 'idle' ? 250 : reaction === 'happy' ? 112.5 : 40.625);
        const state = {
          ...r.state.companion524,
          facing: 0,
          petAt: 10000,
          hitAt: 10000,
          petSequence: reaction === 'happy' ? 1 : 0,
          hitSequence: reaction === 'hit' ? 1 : 0,
          hitDirectionX: 0.707,
          hitDirectionZ: -0.707,
        };
        const pose = companion524Pose(state, now);
        stage.position.y = pose.height;
        tilt.rotation.set(pose.pitch, 0, pose.roll);
        actor.mixer.setTime(i / 4);
        stage.updateMatrixWorld(true);
        const v = new T.Vector3();
        let offset = 0;
        actor.root.traverse((mesh) => {
          if (!mesh.isSkinnedMesh) return;
          mesh.skeleton.update();
          for (let j = 0; j < mesh.geometry.attributes.position.count; j++) {
            mesh.getVertexPosition(j, v).applyMatrix4(mesh.matrixWorld);
            if (![v.x, v.y, v.z].every(Number.isFinite)) throw Error('Nonfinite surface');
            minimum = Math.min(minimum, v.y);
            vertices++;
            if (reaction === 'idle' && i === 0) first.push(v.x, v.y, v.z);
            if (reaction === 'idle' && i === 16)
              loopError = Math.max(
                loopError,
                Math.hypot(v.x - first[offset], v.y - first[offset + 1], v.z - first[offset + 2]),
              );
            offset += 3;
          }
        });
        samples++;
      }
    actor.dispose();
    const gl = r.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      minimum,
      samples,
      vertices,
      loopError,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      triangles: r.renderer.info.render.triangles,
      memory: r.renderer.info.memory,
      loadMs: r.worldAssets.loadMilliseconds,
      fps: r.canvas.dataset.fps,
    };
  });
  assert.ok(surface.minimum > 0.2, JSON.stringify(surface));
  assert.ok(surface.loopError < 1e-5);
  observations.push({ surface });
  pass(
    'Every delivered skinned vertex stays above the floor in 51 idle/happy/hit poses; floating loop closes',
  );

  // Late/far visibility seeks the shared phase instead of freezing the old pose.
  await a.page.evaluate(() => {
    const r = qa524;
    const c = r.companion524Renderer;
    r.camera.position.set(c.root.position.x + 100, c.root.position.y, c.root.position.z);
    c.update(0.016);
    if (c.root.visible) throw Error('Far companion should be culled');
  });
  await sleep(700);
  assert.equal(await a.page.evaluate(() => qa524.companion524Renderer.root.visible), true);
  await shot(a, '10-final');
  assert.deepEqual(errors, []);
  pass('Far/near rendering resumes correctly; browser console and page errors are zero');
  console.log(`Evidence: ${out}`);
} finally {
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors, observations }, null, 2));
  for (const p of peers) p.ws.close();
  await browser.close();
  await game.close();
}
