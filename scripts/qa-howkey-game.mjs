// Real controls and real ticks in a loopback-only, in-memory world.
// Positions, resource inventory and one pending enemy strike are stated fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { BRIDGE } from '../dist/shared/scenery-layout.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.env.HOWKEY_QA_OUT || 'output/playwright/howkey/game-r01';
await mkdir(out, { recursive: true });
const asset = JSON.parse(await readFile('public/models/howkey-scientist/asset.json', 'utf8')),
  game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen(),
  browser = await chromium.launch({ channel: 'chrome', headless: true }),
  contexts = [],
  peers = [],
  errors = [],
  checks = [],
  records = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  roomName = 'HOWKEY-QA';
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(40);
  }
}
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function open(name, scientist) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  });
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
      if (m.type === 'state') Object.assign(seen.state, m);
    });
  });
  await page.addInitScript((name) => localStorage.setItem('cro-name', name), name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
const observe=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=observe.apply(this,args);window.qa=this;window.qaThree=THREE;window.qaWalkHeight=walkHeight;const e=this.players.get(this.selfId),a=e?.actor;if(a){const row={at:performance.now(),serverNow:this.serverNow(),clip:a.animation.name,sha:a.asset.sha256,rate:a.animation.current?.getEffectiveTimeScale(),speed:a.animation.speed,groundPetWeight:a.groundPettingPose.weight,groundPetDepth:a.groundPettingPose.depth,groundPetGap:a.groundPettingPose.contact.distanceTo(a.groundPettingPose.requested),particles:this.spells.count,projectiles:this.state.projectiles,actors:[...this.players.values()].filter(v=>v.actor).map(v=>({id:v.state.id,clip:v.actor.animation.name,sha:v.actor.asset.sha256}))};if(a.animation.grounding?.samples && ['Walk_Loop','Run_Loop'].includes(row.clip)){const inv=new THREE.Matrix4().copy(a.root.matrixWorld).invert(),p=new THREE.Vector3();let floor=Infinity;for(const s of a.animation.grounding.samples){s.mesh.getVertexPosition(s.index,p).applyMatrix4(s.mesh.matrixWorld).applyMatrix4(inv);floor=Math.min(floor,p.y)}row.soleY=floor;}window.qaFrames??=[];qaFrames.push(row);if(qaFrames.length>2400)qaFrames.shift();}return result;};`,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  assert.equal(await page.locator('#setup-form .character-choice').count(), 8);
  const selector = scientist ? 'howkey-female' : 'cro-male';
  await page.locator(`#setup-form .character-choice:has(input[value="${selector}"])`).click();
  if (scientist) await page.screenshot({ path: `${out}/selection.png` });
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  return { page, seen, p: game.rooms.get(roomName).players.get(seen.id) };
}
async function shot(a, name) {
  await a.page.screenshot({ path: `${out}/${name}.png` });
}
async function frames(a, label) {
  const rows = await a.page.evaluate(() => window.qaFrames?.splice(0) || []);
  records.push({ label, frames: rows });
  return rows;
}
async function camera(a, yaw = 1.0, distance = 3) {
  await a.page.evaluate(
    ({ yaw, distance }) => {
      qa.yaw = yaw;
      qa.pitch = 0.23;
      qa.targetDistance = distance;
    },
    { yaw, distance },
  );
}
async function reset(a, x, z) {
  stopActor(a.p);
  Object.assign(a.p, { x, z, pendingStrike: null, attackAt: 0 });
  await sleep(550);
  await a.page.locator('#world').focus();
  await a.page.evaluate(() => (qaFrames = []));
}
async function skin(a, value) {
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="character"]').click();
  await a.page
    .locator(`#character-switch-form .character-choice:has(input[value="${value}"])`)
    .click();
  await a.page.locator('#character-confirm-yes').click();
  await until(() => a.p.species === value.split('-')[0], 'server skin');
  if (await a.page.locator('#modal').isVisible()) await a.page.keyboard.press('Escape');
  await sleep(900);
}
let a, b, room, failure;
try {
  a = await open('Howkey A', true);
  room = game.rooms.get(roomName);
  const shaman = room.enemies.find((e) => e.modelKey === 'crow-shaman');
  room.enemies = [];
  b = await open('Howkey B', false);
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=Peer${i}`),
      seen = {};
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'state') Object.assign(seen, m);
    });
    peers.push({ ws, seen });
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
  }
  await until(() => room.players.size === 5, 'five participants');
  for (const p of room.players.values())
    if (p.id !== a.p.id) {
      stopActor(p);
      Object.assign(p, { x: 70, z: 70 + peers.findIndex((v) => v.id === p.id) * 2 });
    }
  assert.equal(a.p.species, 'howkey');
  await until(
    () =>
      b.page.evaluate(
        (id) => qa.players.get(id)?.actor?.asset.modelKey === 'howkey-scientist',
        a.p.id,
      ),
    'remote Howkey',
  );
  assert.equal(
    await a.page.evaluate(() => qa.players.get(qa.selfId).actor.asset.sha256),
    asset.sha256,
  );
  pass('eight-card initial selection, exact Howkey GLB, two renderers and five participants');
  await a.page.bringToFront();
  await reset(a, 76, 68);
  await camera(a, 0, 3);
  await a.page.keyboard.down('w');
  await sleep(1300);
  await shot(a, 'walk');
  let rows = await frames(a, 'walk');
  assert.ok(rows.filter((r) => r.clip === 'Walk_Loop').length > 12);
  await a.page.keyboard.press('Shift');
  await sleep(1500);
  await shot(a, 'run');
  rows = await frames(a, 'run');
  const running = rows.filter((r) => r.clip === 'Run_Loop');
  assert.ok(running.length > 15);
  assert.ok(running.every((r) => r.rate <= 1.501));
  const soles = running.filter((r) => Number.isFinite(r.soleY));
  assert.ok(soles.length > 10 && Math.min(...soles.map((r) => r.soleY)) > -0.006);
  const elapsed = running.at(-1).at - running[0].at;
  records.push({
    observedRunFps: ((running.length - 1) * 1000) / elapsed,
    frames: running.length,
    milliseconds: elapsed,
  });
  assert.ok(
    (await frames(b, 'remote-run')).some((r) =>
      r.actors.some((p) => p.id === a.p.id && p.clip === 'Run_Loop'),
    ),
  );
  await a.page.keyboard.up('w');
  await a.page.keyboard.down('d');
  await sleep(600);
  await a.page.keyboard.up('d');
  await a.page.keyboard.press('Shift');
  await until(
    () => a.page.evaluate(() => qa.players.get(qa.selfId).actor.animation.name === 'Idle_Loop'),
    'stop',
  );
  pass('walk, run, live sole clearance, remote run, turn and stop');
  await a.page.keyboard.press('Space');
  await until(
    () => a.page.evaluate(() => qa.players.get(qa.selfId).actor.animation.name === 'Jump'),
    'jump',
  );
  await shot(a, 'jump');
  await sleep(1100);
  await a.page.keyboard.press('g');
  await until(
    () => a.page.evaluate(() => qa.players.get(qa.selfId).actor.animation.name === 'Wave'),
    'wave',
  );
  await sleep(550);
  await shot(a, 'wave');
  await sleep(1200);
  pass('jump, wave and recovery');
  await reset(a, 40, 56.8);
  const cat = room.rimoNeko;
  Object.assign(cat, {
    x: 40,
    z: 55,
    facing: 0,
    mode: 'idle',
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    path: [],
    velocityX: 0,
    velocityZ: 0,
  });
  await camera(a);
  await sleep(500);
  await a.page.evaluate(() => (qa.rimoNekoRenderer.placed = false));
  await a.page.keyboard.press('v');
  await until(() => cat.petContactAt > 0, 'cat pet contact');
  await sleep(600);
  await shot(a, 'pet-rimo');
  await until(() => cat.followPlayerId === a.p.id, 'cat friendship');
  rows = await frames(a, 'pet-rimo');
  const contacts = rows.filter(
    (r) =>
      r.groundPetWeight > 0.99 &&
      r.serverNow - cat.petContactAt > 150 &&
      r.serverNow - cat.petContactAt < 1400,
  );
  assert.ok(contacts.length > 5 && Math.max(...contacts.map((r) => r.groundPetGap)) < 0.045);
  assert.ok(contacts.every((r) => r.groundPetDepth > 0.025));
  await until(
    () => peers.every((p) => p.seen.rimoNeko?.followPlayerId === a.p.id),
    'friendship sync',
  );
  await a.page.keyboard.press('t');
  await sleep(1800);
  pass('Howkey crouches and strokes the cat; friendship synchronizes to all five');
  const companion = room.companion524;
  await reset(a, 44, 56.8);
  Object.assign(companion, {
    x: 44,
    z: 55,
    mode: 'idle',
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    path: [],
    velocityX: 0,
    velocityZ: 0,
  });
  await sleep(500);
  await a.page.keyboard.press('v');
  await until(() => companion.petContactAt > 0, '524 hand contact');
  await sleep(450);
  await shot(a, 'pet-524');
  await until(() => companion.followPlayerId === a.p.id, '524 friendship');
  await a.page.keyboard.press('t');
  await sleep(1200);
  pass('hand petting and friendship with 524');
  // Clear, deterministic firing lane; target is the game's existing cat.
  await reset(a, 40, 56.8);
  Object.assign(cat, {
    x: 40,
    z: 52.8,
    mode: 'idle',
    followPlayerId: null,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    path: [],
    velocityX: 0,
    velocityZ: 0,
  });
  await camera(a, 0, 3.5);
  await sleep(500);
  await a.page.evaluate(() => (qa.rimoNekoRenderer.placed = false));
  const hit = cat.hitSequence,
    seq = a.p.attackSequence,
    energy = a.p.energy;
  await a.page.keyboard.press('f');
  await until(() => a.p.attackSequence > seq, 'science input');
  await sleep(170);
  await shot(a, 'science-charge');
  await until(() => room.projectiles.some((p) => p.kind === 'science'), 'science launch');
  await shot(a, 'science-pulse');
  await until(() => cat.hitSequence === hit + 1, 'science hit');
  assert.ok(a.p.energy <= energy - 2.9);
  rows = await frames(a, 'science');
  assert.ok(rows.some((r) => r.clip === 'Attack' && r.particles >= 50));
  assert.ok(rows.some((r) => r.projectiles?.some((p) => p.kind === 'science')));
  await until(
    () =>
      b.seen.state.rimoNeko?.hitSequence === cat.hitSequence &&
      peers.every((p) => p.seen.rimoNeko?.hitSequence === cat.hitSequence),
    'science hit sync',
  );
  await sleep(450);
  await shot(a, 'science-hiss');
  pass('real F windup, science orbit, pulse, energy cost and synchronized hit reaction');
  // Use ordinary inventory/menu actions against explicit resource fixtures.
  Object.assign(a.p.inventory, { wood: 8, stone: 7, berry: 4 });
  a.p.tool = false;
  a.p.energy = 50;
  await reset(a, room.camp.x + 1, room.camp.z + 1);
  await a.page.keyboard.press('2');
  await until(() => a.p.tool, 'craft');
  await sleep(400);
  await shot(a, 'craft');
  await sleep(1400);
  await a.page.keyboard.press('i');
  await a.page.locator('.inventory-card[data-item="berry"]').click();
  await a.page.locator('.item-actions button[data-item-action="eat"]').click();
  await until(() => a.p.inventory.berry === 3, 'eat');
  if (await a.page.locator('#modal').isVisible()) await a.page.keyboard.press('Escape');
  await sleep(350);
  await shot(a, 'eat');
  await sleep(1300);
  await a.page.keyboard.press('3');
  await until(() => a.p.inventory.wood === 0, 'contribute');
  await sleep(300);
  await shot(a, 'give');
  await sleep(1300);
  pass('craft, inventory food and camp contribution');
  const resource = room.resources.find((r) => r.type === 'berry' && r.amount > 0);
  assert.ok(resource);
  const near = room.collision.nearestFree(
    { x: resource.x + 0.7, z: resource.z },
    a.p.radius,
    [],
    3,
  );
  await reset(a, near.x, near.z);
  const gathered = a.p.gathered;
  await a.page.keyboard.press('1');
  await until(() => a.p.gathered > gathered, 'gather resource');
  await sleep(400);
  await shot(a, 'gather');
  await sleep(1000);
  pass('real nearby resource gathering');
  const inventory = structuredClone(a.p.inventory);
  await skin(a, 'cro-female');
  assert.deepEqual(a.p.inventory, inventory);
  await skin(a, 'howkey-female');
  assert.deepEqual(a.p.inventory, inventory);
  pass('switch to an existing character and back preserves inventory');
  await reset(a, BRIDGE.x + BRIDGE.minX - 1, BRIDGE.z);
  await camera(a, 0, 4);
  await a.page.keyboard.press('Shift');
  await a.page.keyboard.down('d');
  const bridge = [];
  for (let i = 0; i < 150; i++) {
    await sleep(50);
    bridge.push({ x: a.p.x, z: a.p.z, y: walkHeight(a.p.x, a.p.z) });
    if (Math.abs(a.p.x - BRIDGE.x) < 0.4) await shot(a, 'bridge');
    if (a.p.x > BRIDGE.x + BRIDGE.maxX + 0.5) break;
  }
  await a.page.keyboard.up('d');
  await a.page.keyboard.press('Shift');
  assert.ok(a.p.x > BRIDGE.x + BRIDGE.maxX);
  records.push({ label: 'bridge', samples: bridge });
  pass('bridge ascent and descent with real collision and movement');
  const mammoth = room.animals.find((v) => v.phase === 'alive' && !v.riderId);
  assert.ok(mammoth);
  stopActor(mammoth);
  const mountPoint = room.collision.nearestFree(
    { x: mammoth.x + mammoth.radius + a.p.radius + 0.15, z: mammoth.z },
    a.p.radius,
    [],
    4,
  );
  await reset(a, mountPoint.x, mountPoint.z);
  await a.page.keyboard.press('r');
  await until(() => a.p.mountId === mammoth.id, 'mount mammoth');
  await sleep(500);
  await shot(a, 'riding');
  await a.page.keyboard.down('w');
  await sleep(600);
  await a.page.keyboard.up('w');
  await a.page.keyboard.press('r');
  await until(() => !a.p.mountId, 'dismount');
  await sleep(400);
  assert.equal(
    await a.page.evaluate(() => qa.players.get(qa.selfId).actor.animation.name),
    'Idle_Loop',
  );
  pass('mammoth seating, movement, dismount and rig recovery');
  // One normal enemy strike triggers the real four-second defeat/recovery flow.
  room.enemies = [shaman];
  stopActor(shaman);
  Object.assign(shaman, {
    x: shaman.home.x,
    z: shaman.home.z,
    phase: 'alive',
    health: 75,
    hitUntil: 0,
    targetId: a.p.id,
    returning: false,
    aggroAfter: 0,
  });
  await reset(a, shaman.x, shaman.z + shaman.radius + a.p.radius + 0.2);
  Object.assign(a.p, { energy: 10, invulnerableUntil: 0 });
  const now = Date.now();
  shaman.attackAt = now;
  shaman.attackSequence++;
  shaman.attackLockUntil = now + 1000;
  shaman.pendingAttack = { targetId: a.p.id, facing: 0, impactAt: now + 550 };
  await until(() => a.p.downedUntil > 0, 'enemy hit downs Howkey');
  await sleep(1000);
  await shot(a, 'downed');
  assert.equal(
    await a.page.evaluate(() => qa.players.get(qa.selfId).actor.animation.name),
    'Downed',
  );
  await until(() => !a.p.downedUntil, 'automatic recovery');
  room.enemies = [];
  await sleep(300);
  assert.equal(a.p.species, 'howkey');
  pass('enemy damage, Downed and automatic camp recovery');
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(size);
    await a.page.keyboard.press('Escape');
    await a.page.locator('[data-controller-menu="character"]').click();
    const card = a.page.locator(
      '#character-switch-form .character-choice:has(input[value="howkey-female"])',
    );
    await card.scrollIntoViewIfNeeded();
    await shot(a, `selection-${size.width}`);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await a.page.keyboard.press('Escape');
  }
  pass('portrait and landscape selection, all eight cards accessible');
  await a.page.setViewportSize({ width: 1280, height: 800 });
  await a.page.reload();
  await a.page.locator('#title-start').click();
  assert.equal(await a.page.locator('#setup-form input[value="howkey-female"]').isChecked(), true);
  await a.page.locator('#setup-form .character-choice:has(input[value="howkey-female"])').click();
  await a.page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await a.page.locator('#setup-flow-yes').click();
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(
    () =>
      a.page.evaluate(
        () => qa.players.get(qa.selfId)?.actor?.asset.modelKey === 'howkey-scientist',
      ),
    'reload Howkey',
  );
  await shot(a, 'reload');
  pass('reload retains Howkey');
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e);
  if (a) {
    await shot(a, 'failure');
    await writeFile(
      `${out}/failure-state.json`,
      JSON.stringify(
        { player: a.p, state: a.seen.state, commands: a.seen.commands.slice(-30) },
        null,
        2,
      ),
    );
  }
  throw e;
} finally {
  if (a) await frames(a, 'final');
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        sha256: asset.sha256,
        checks,
        errors,
        failure,
        pass: !failure,
        fixtures: [
          'separate in-memory world',
          'safe positions and camera',
          'inventory/resources for action paths',
          'one prepared enemy strike',
        ],
        physicalControllerTested: false,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(`${out}/frames.json`, JSON.stringify(records) + '\n');
  for (const p of peers) p.ws.close();
  for (const c of contexts) await c.close();
  await browser.close();
  await game.close();
}
