// Real Chrome, five connections and real keys/ticks. Only profiles and a clear
// starting position are fixtures; the renderer observer does not alter playback.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { BRIDGE } from '../dist/shared/scenery-layout.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output =
  process.env.GAIT_QA_OUTPUT || 'output/playwright/human-joints/revision-10/game-final';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`,
  roomName = 'HUMAN-GAITS-QA',
  errors = [],
  records = [],
  peers = [];
let browser;
async function open(name) {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: output, size: { width: 1280, height: 800 } },
    }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    if (!localStorage.getItem('cro-species')) localStorage.setItem('cro-species', 'cro');
    if (!localStorage.getItem('cro-gender')) localStorage.setItem('cro-gender', 'female');
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
 const observe=WorldRenderer.prototype.render;
 WorldRenderer.prototype.render=function(...args){const result=observe.apply(this,args);window.gaitRenderer=this;window.gaitFrames??=[];const me=this.players.get(this.selfId);if(me?.actor)window.gaitFrames.push({t:performance.now(),dt:args[1],clip:me.actor.animation.name,speed:me.actor.animation.speed,rate:me.actor.animation.current?.getEffectiveTimeScale(),sha:me.actor.asset.sha256,actors:[...this.players.values()].filter(e=>e.actor).map(e=>({name:e.state.name,clip:e.actor.animation.name,sha:e.actor.asset.sha256}))});if(me?.actor?.asset.humanLocomotion && window.gaitFrames.length%3===0 && ['Walk_Loop','Run_Loop'].includes(me.actor.animation.name)){const ground=me.actor.animation.grounding, inverse=new THREE.Matrix4().copy(me.actor.root.matrixWorld).invert(),point=new THREE.Vector3();let floor=Infinity;for(const sample of ground.samples){sample.mesh.getVertexPosition(sample.index,point).applyMatrix4(sample.mesh.matrixWorld).applyMatrix4(inverse);floor=Math.min(floor,point.y)}window.gaitFrames.at(-1).floor=floor;window.gaitFrames.at(-1).blended=[...me.actor.animation.actions.values()].filter(a=>a.enabled&&a.isScheduled()&&a.getEffectiveWeight()>.001).length>1;}if(window.gaitFrames.length>2400)window.gaitFrames.shift();return result};`,
    });
  });
  await page.goto(`${base}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-submit').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 90000,
  });
  return page;
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await open('Gait A'),
    other = await open('Gait B');
  for (let i = 0; i < 3; i++) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?` +
        new URLSearchParams({ room: roomName, name: `Peer ${i}`, species: 'cro', gender: 'male' }),
    );
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    peers.push(socket);
  }
  await page.waitForFunction(() => gaitRenderer.players.size === 5);
  const room = game.rooms.get(roomName),
    me = () => [...room.players.values()].find((p) => p.name === 'Gait A');
  assert.equal(room.players.size, 5);
  // Keep the test formation out of the moving player's path.
  for (const p of room.players.values())
    if (p.name !== 'Gait A') {
      stopActor(p);
      Object.assign(p, { x: 72 + 2 * Number(p.name.at(-1) || 0), z: 76 });
      if (p.name === 'Gait B') p.x = 70;
    }
  for (const profile of CHARACTER_MODELS) {
    const expectedAsset = JSON.parse(
      await readFile(`public/models/${profile.key}/asset.json`, 'utf8'),
    );
    stopActor(me());
    Object.assign(me(), { x: 76, z: 68 });
    if (me().species !== profile.species || me().gender !== profile.gender) {
      await page.locator('#world').focus();
      await page.keyboard.press('Escape');
      await page.locator('[data-controller-menu="character"]').click();
      await page
        .locator(`#character-switch-form input[value="${profile.species}-${profile.gender}"]`)
        .check();
      await page.locator('#character-switch-form button[type="submit"]').click();
    }
    await page.waitForFunction(
      (key) => gaitRenderer.players.get(gaitRenderer.selfId)?.actor?.asset.modelKey === key,
      profile.key,
      { timeout: 60000 },
    );
    await page.locator('#world').focus();
    const phases = [];
    for (const [label, key, running] of [
      ['walk', 'w', false],
      ['run', 'w', true],
      ['walk-again', 'w', false],
    ]) {
      // Keep moving across both transitions; Shift toggles twice per profile.
      if (label !== 'walk') await page.keyboard.press('Shift');
      await page.evaluate(() => (window.gaitFrames = []));
      await other.evaluate(() => (window.gaitFrames = []));
      if (label === 'walk') await page.keyboard.down(key);
      await page.waitForTimeout(1600);
      const frames = await page.evaluate(() => window.gaitFrames),
        remote = await other.evaluate(() => window.gaitFrames);
      const expected = running ? 'Run_Loop' : 'Walk_Loop',
        steady = frames.filter((f) => f.t > frames[0].t + 400);
      await writeFile(`${output}/${profile.key}-${label}-frames.json`, JSON.stringify(frames));
      assert.ok(steady.length > 8, `${profile.key} ${label} samples`);
      assert.ok(
        steady.every((f) => f.sha === expectedAsset.sha256),
        `${profile.key}: exact delivered asset`,
      );
      assert.ok(
        steady.filter((f) => f.clip === expected).length / steady.length > 0.85,
        `${profile.key} ${label} clip: ${JSON.stringify(steady.map((f) => f.clip))}`,
      );
      assert.ok(
        remote.some((f) => f.actors.some((a) => a.name === 'Gait A' && a.clip === expected)),
        `${profile.key} remote ${label}`,
      );
      await page.screenshot({ path: `${output}/${profile.key}-${label}.png` });
      if (label === 'walk-again') {
        await page.keyboard.up(key);
        await page.waitForFunction(
          () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Idle_Loop',
        );
      }
      const floors = frames.filter((f) => Number.isFinite(f.floor));
      if (expectedAsset.humanLocomotion) {
        assert.ok(floors.length > 8, 'sampled live soles');
        assert.ok(
          Math.min(...floors.map((f) => f.floor)) > -0.005,
          profile.key + ' live floor ' + Math.min(...floors.map((f) => f.floor)),
        );
      }
      phases.push({
        minimumLocalSoleY: floors.length ? Math.min(...floors.map((f) => f.floor)) : null,
        sampledSoles: floors.length,
        label,
        clip: expected,
        frames: steady.length,
        sha: steady.at(-1).sha,
        rate: steady.at(-1).rate,
        meanFrameMs: steady.reduce((s, f) => s + f.dt * 1000, 0) / steady.length,
      });
    }
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Jump',
    );
    await page.waitForFunction(
      () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Idle_Loop',
    );
    await page.keyboard.press('f');
    await page.waitForFunction(
      () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Attack',
    );
    await page.waitForFunction(
      () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Idle_Loop',
    );
    assert.equal(
      await page.evaluate(() => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name),
      'Idle_Loop',
    );
    records.push({ key: profile.key, phases, jumpAndAttackRecovered: true });
    await writeFile(`${output}/progress.json`, JSON.stringify({ records, errors }, null, 2));
    console.log('PASS', profile.key);
  }
  // Traverse both sloping bridge approaches using actual movement and collision.
  // The starting point and camera are fixtures; the crossing and turn are not.
  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="character"]').click();
  await page.locator('#character-switch-form input[value="cro-female"]').check();
  await page.locator('#character-switch-form button[type="submit"]').click();
  await page.waitForFunction(
    () =>
      gaitRenderer.players.get(gaitRenderer.selfId)?.actor?.asset.modelKey === 'cro-magnon-woman',
  );
  stopActor(me());
  Object.assign(me(), { x: BRIDGE.x + BRIDGE.minX - 1, z: BRIDGE.z });
  await page.evaluate(() => {
    gaitRenderer.yaw = 0;
    gaitRenderer.pitch = 0.25;
    gaitRenderer.targetDistance = 4;
  });
  await page.waitForTimeout(600);
  await page.locator('#world').focus();
  await page.keyboard.down('d');
  const bridgeSamples = [];
  for (let i = 0; i < 120; i++) {
    if (i === 40) await page.keyboard.press('Shift');
    await page.waitForTimeout(50);
    bridgeSamples.push({ x: me().x, z: me().z, y: walkHeight(me().x, me().z) });
    if (Math.abs(me().x - BRIDGE.x) < 0.4)
      await page.screenshot({ path: `${output}/bridge-crossing.png` });
    if (me().x > BRIDGE.x + BRIDGE.maxX + 0.7) break;
  }
  await page.keyboard.up('d');
  assert.ok(me().x > BRIDGE.x + BRIDGE.maxX, 'crossed bridge eastward');
  await page.waitForTimeout(300);
  await page.keyboard.press('Shift');
  await page.keyboard.down('a');
  await page.waitForTimeout(1400);
  await page.keyboard.up('a');
  await page.waitForFunction(
    () => gaitRenderer.players.get(gaitRenderer.selfId).actor.animation.name === 'Idle_Loop',
  );
  await writeFile(
    `${output}/bridge.json`,
    JSON.stringify(
      {
        samples: bridgeSamples,
        heightRange:
          Math.max(...bridgeSamples.map((p) => p.y)) - Math.min(...bridgeSamples.map((p) => p.y)),
        crossed: true,
        turnedAndStopped: true,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${output}/bridge-turn-stop.png` });
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${output}/mobile-${size.width}.png` });
  }
  await page.reload();
  await page.locator('#title-start').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 90000,
  });
  assert.equal(
    await page.evaluate(() => gaitRenderer.players.get(gaitRenderer.selfId).actor.asset.modelKey),
    'cro-magnon-woman',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        records,
        errors,
        connections: 5,
        reloaded: true,
        fixtures:
          'Profiles and clear meadow start (76,68); peers beside the route; unchanged game time and real input',
      },
      null,
      2,
    ),
  );
} finally {
  for (const s of peers) s.close();
  await browser?.close();
  await game.close();
}
