// Isolated world: only observation/mount preparation changes coordinates.
// Mounting, approaching the cliff, turning away and dismounting use real keys.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { mammothGroundFree } from '../dist/shared/mammoth-navigation.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = 'output/playwright/mammoth-ground-2026-09-22';
await mkdir(out, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  peers = [],
  samples = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.route('**/src/main.js', async (route) => {
  await route.fulfill({
    contentType: 'text/javascript',
    body:
      `
      import { WorldRenderer as QAWorld } from '/src/world3d.js';
      import { mammothGroundFree as qaGround } from '/shared/mammoth-navigation.mjs';
      const qaRender = QAWorld.prototype.render;
      window.qaFrames = [];
      QAWorld.prototype.render = function(...args) {
        window.qaWorld = this;
        const result = qaRender.apply(this, args);
        if(window.qaCollect) for(const m of this.mammoths) {
          const state = this.state.animals?.find(a => a.id === m.id);
          if(state?.phase === 'alive') window.qaFrames.push({
            id:m.id, x:m.model.position.x, y:m.model.position.y, z:m.model.position.z,
            safe:qaGround(m.model.position,state.radius), clip:m.actor.name,
            serverX:state.x, serverZ:state.z
          });
        }
        return result;
      };
    ` + (await readFile('dist/src/main.js', 'utf8')),
  });
});
const until = async (condition, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await sleep(50);
  }
};
const start = async () => {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-male"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 120000,
  });
};
const shot = async (label) => {
  await page.screenshot({ path: `${out}/${label}.png` });
};
let summary = {};
try {
  await page.goto(`http://127.0.0.1:${port}/?room=MAMMOTH-GROUND`);
  await start();
  const room = game.rooms.get('MAMMOTH-GROUND');
  room.enemies = [];
  const animal = room.animals[1];
  const player = [...room.players.values()][0];
  for (let i = 0; i < 4; i++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MAMMOTH-GROUND&name=Observer${i}`);
    socket.states = [];
    socket.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'state') socket.states.push(m);
    });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    peers.push(socket);
  }
  await until(() => room.players.size === 5, 'five players');
  stopActor(player);
  Object.assign(player, { x: animal.x + 2, z: animal.z - 6.7 });
  await sleep(1500);
  await page.evaluate(() => {
    const w = qaWorld;
    w.yaw = Math.PI;
    w.pitch = 0.32;
    w.targetDistance = 12;
    window.qaCollect = true;
  });
  const before = { x: animal.x, z: animal.z };
  for (let i = 0; i < 160; i++) {
    for (const a of room.animals) {
      assert.ok(mammothGroundFree(a, a.radius), `${a.id}: safe grazing`);
      samples.push({ id: a.id, x: a.x, z: a.z, phase: 'graze' });
    }
    await sleep(100);
  }
  assert.ok(Math.hypot(animal.x - before.x, animal.z - before.z) > 0.3, 'natural wandering');
  await shot('grazing-on-gentle-ground');
  checks.push('Both herds wander on body-wide gentle terrain during real server ticks.');
  stopActor(animal);
  Object.assign(animal, {
    x: animal.home.x,
    z: animal.home.z - 2.5,
    facing: 0,
    nextRoam: animal.age + 600,
    clip: 'Idle_Loop',
  });
  assert.ok(mammothGroundFree(animal, animal.radius));
  assert.ok(room.collision.free(animal, animal.radius));
  stopActor(player);
  Object.assign(player, { x: animal.x + animal.radius + 0.7, z: animal.z });
  await sleep(1000);
  await page.evaluate(() => {
    const w = qaWorld;
    w.prediction.enabled = true;
    w.prediction.reset();
    w.yaw = Math.PI;
    w.pitch = 0.32;
    w.targetDistance = 13;
  });
  await page.locator('#world').focus();
  await page.keyboard.press('r');
  await until(() => player.mountId === animal.id, 'R mounts mammoth');
  const rideStart = { x: animal.x, z: animal.z };
  await page.keyboard.down('w');
  await until(() => animal.moving, 'mounted walk');
  await sleep(600);
  await shot('mounted-walk');
  await page.keyboard.press('Shift');
  await until(() => animal.runningRequested, 'run requested');
  for (let i = 0; i < 100; i++) {
    assert.ok(mammothGroundFree(animal, animal.radius));
    samples.push({ id: animal.id, x: animal.x, z: animal.z, phase: 'ride-to-cliff' });
    await sleep(100);
  }
  const stopped = { x: animal.x, z: animal.z };
  assert.ok(stopped.z > rideStart.z + 0.5, 'mammoth approached the cliff');
  assert.equal(animal.moving, false, 'held run input stops at slope boundary');
  const beyond = room.collision.move(animal, 0, 0.15, animal.radius);
  assert.ok(beyond.z > animal.z + 0.14, 'not stopped by a rock or harvest resource');
  assert.equal(mammothGroundFree(beyond, animal.radius), false, 'continuation would climb cliff');
  await shot('stopped-before-cliff');
  await page.keyboard.up('w');
  await page.evaluate(() => {
    qaWorld.yaw = 0;
  });
  await page.keyboard.down('w');
  await sleep(2300);
  await page.keyboard.up('w');
  assert.ok(animal.z < stopped.z - 1, 'can freely turn away from cliff');
  await page.keyboard.press('r');
  await until(() => !player.mountId, 'R dismounts');
  await shot('turned-away-and-dismounted');
  checks.push(
    'Real R/W/Shift inputs mount, walk and run toward the cliff; stop before it and turn away; R dismounts.',
  );
  const frames = await page.evaluate(() => {
    window.qaCollect = false;
    return qaFrames;
  });
  assert.ok(frames.length > 100);
  assert.equal(frames.filter((f) => !f.safe).length, 0, 'no rendered mammoth enters the slope');
  for (const peer of peers) {
    assert.ok(peer.states.length > 20);
    for (const state of peer.states)
      for (const a of state.animals || [])
        if (a.phase === 'alive')
          assert.ok(mammothGroundFree(a, a.radius), 'all peers see safe positions');
  }
  checks.push(
    'Local mounted prediction, rendered smoothing and all four network peers retain the slope boundary.',
  );
  const savedAnimal = { x: animal.x, z: animal.z };
  await page.reload();
  await start();
  await page.waitForFunction(() => qaWorld.state.animals?.length === 2);
  assert.ok(mammothGroundFree(animal, animal.radius));
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await shot(`reload-${width}`);
  }
  checks.push(
    'Reload keeps the shared herd and both portrait/landscape views render without errors.',
  );
  summary = {
    rideStart,
    stopped,
    stoppedHeight: mountainHeight(stopped.x, stopped.z),
    savedAnimal,
    renderedSamples: frames.length,
    unsafeRenderedSamples: frames.filter((f) => !f.safe).length,
    peerSnapshots: peers.map((p) => p.states.length),
    checks,
    errors,
    fixtures: [
      'Only the isolated world: enemies suppressed; observer and rider placed near the mammoth; mammoth placed 2.5 m toward the plain from its home before mounting; camera and prediction enabled.',
    ],
    normalSaveModified: false,
    clocksChanged: false,
  };
  await writeFile(`${out}/frames.json`, JSON.stringify(frames));
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(String(error));
  console.error(error);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    `${out}/summary.json`,
    JSON.stringify({ ...summary, checks, errors, samples }, null, 2),
  );
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ checks, errors, ...summary, samples: samples.length }, null, 2));
