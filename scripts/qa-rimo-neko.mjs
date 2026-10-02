// UI interaction in an isolated, unsaved world. Positions/camera are explicit fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { verifyRimoHappyLifecycle } from './qa-rimo-happy-lifecycle.mjs';
const root = resolve(process.argv[2] || '.');
const load = (file) => import(pathToFileURL(join(root, 'dist', file)));
const { createGameServer } = await load('server.mjs');
const { CHARACTER_MODELS } = await load('shared/characters.mjs');
const { stopActor } = await load('shared/combat.mjs');
const { BRIDGE } = await load('shared/scenery-layout.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.env.QA_RIMO_OUT || 'output/playwright/rimo-neko/game-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen(),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  peers = [],
  samples = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function until(fn, label, timeout = 18000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(40);
  }
}
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
    seen = { state: {}, id: null, commands: [] };
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('BROWSER ERROR', String(e));
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => seen.commands.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = { ...seen.state, ...m };
    });
  });
  await page.route('**/src/world3d.js', async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      body:
        (await r.text()) +
        '\nconst rimoRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.qaRimo=this;window.qaThree=THREE;window.qaWalkHeight=walkHeight;return rimoRender.apply(this,args);};',
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
  await page.goto(`http://127.0.0.1:${port}/?room=RIMO-QA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => seen.id && game.rooms.get('RIMO-QA')?.players.has(seen.id), 'join');
  return { page, seen, p: game.rooms.get('RIMO-QA').players.get(seen.id) };
}
async function setSkin(a, c) {
  if (a.p.species === c.species && a.p.gender === c.gender) return;
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="character"]').click();
  await a.page
    .locator(
      `#character-switch-form .character-choice:has(input[value="${c.species}-${c.gender}"])`,
    )
    .click();
  await a.page.locator('#character-confirm-yes').click();
  await until(
    () =>
      a.page.evaluate(
        (key) => qaRimo.players.get(qaRimo.selfId)?.actor?.asset.modelKey === key,
        c.key,
      ),
    'selected skin',
  );
  if (await a.page.locator('#modal').isVisible()) await a.page.keyboard.press('Escape');
  await sleep(600);
}
async function camera(a) {
  await a.page.evaluate(() => {
    qaRimo.yaw = 1.12;
    qaRimo.pitch = 0.28;
    qaRimo.targetDistance = 3.0;
  });
}
async function shot(a, name) {
  await a.page.screenshot({ path: `${out}/${name}.png` });
}
async function settleFixture(viewers, position) {
  for (const viewer of viewers) {
    await until(
      () => viewer.page.evaluate(({ x, z }) => {
        const c = qaRimo.state.rimoNeko;
        return c && Math.hypot(c.x - x, c.z - z) < 0.1;
      }, position),
      'fixture snapshot received',
    );
    await viewer.page.evaluate(() => { qaRimo.rimoNekoRenderer.placed = false; });
    await until(
      () => viewer.page.evaluate(() => {
        const c = qaRimo.state.rimoNeko, p = qaRimo.rimoNekoRenderer.root.position;
        return Math.hypot(p.x - c.x, p.z - c.z) < 0.01;
      }),
      'fixture renderer settled',
    );
  }
}
async function tap(a, index) {
  for (const pressed of [false, true, false]) {
    await a.page.evaluate(
      ({ index, pressed }) => (qaPad.buttons[index] = { pressed, value: Number(pressed) }),
      { index, pressed },
    );
    await sleep(150);
  }
}
let failure, activeA, activeRoom;
try {
  const a = (activeA = await open()),
    room = (activeRoom = game.rooms.get('RIMO-QA')),
    c = room.rimoNeko;
  room.enemies = [];
  const b = await open();
  Object.assign(b.p, { x: 57, z: 55 });
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=RIMO-QA&name=RimoPeer${i}`),
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
  checks.push('two Chrome renderers and three socket participants');
  for (const p of room.players.values())
    if (p.id !== a.p.id) Object.assign(p, { x: 70, z: 50 + Math.random() * 3 });
  await a.page.bringToFront();
  for (const character of CHARACTER_MODELS) {
    stopActor(a.p);
    Object.assign(a.p, { x: 40, z: 56.8 });
    Object.assign(c, {
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
    await setSkin(a, character);
    await sleep(500);
    await camera(a);
    // The fixture teleports across camp obstacles. Place the renderers explicitly,
    // just as a freshly loaded world does, before measuring ordinary approach motion.
    for (const viewer of [a, b])
      await viewer.page.evaluate(() => {
        qaRimo.rimoNekoRenderer.placed = false;
      });
    await until(
      () =>
        a.page.evaluate(() => {
          const c = qaRimo.state.rimoNeko,
            p = qaRimo.rimoNekoRenderer.root.position;
          return Math.hypot(p.x - c.x, p.z - c.z) < 0.01;
        }),
      'fixture renderer settled',
    );
    await a.page.evaluate(() => {
      window.rimoFrames = [];
      window.rimoUntil = performance.now() + 5000;
      function frame() {
        const r = qaRimo,
          a = r.players.get(r.selfId)?.actor,
          c = r.state.rimoNeko;
        if (a && c)
          rimoFrames.push({
            at: r.serverNow(),
            petContactAt: c.petContactAt,
            weight: a.groundPettingPose.weight,
            depth: a.groundPettingPose.depth,
            gap: a.groundPettingPose.contact.distanceTo(a.groundPettingPose.requested),
            ...r.rimoNekoRenderer.diagnostics(),
          });
        if (performance.now() < rimoUntil) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      const stream = document.querySelector('#world').captureStream(30),
        recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 2500000,
        }),
        chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      window.rimoVideo = { stream, recorder, chunks };
      recorder.start();
    });
    await a.page.locator('#world').focus();
    await a.page.keyboard.press('v');
    await until(() => c.petContactAt > 0, character.key + ' contact');
    assert.equal(c.followPlayerId, null);
    await sleep(450);
    await shot(a, character.key + '-stroke');
    await until(() => c.followPlayerId === a.p.id, character.key + ' friendship');
    await sleep(900);
    assert.equal(b.seen.state.rimoNeko.petContactAt, c.petContactAt);
    assert.ok(peers.every(peer => peer.seen.rimoNeko?.petContactAt === c.petContactAt));
    await shot(a, character.key + '-happy');
    const result = await a.page.evaluate(async () => {
      window.rimoUntil = 0;
      const { stream, recorder, chunks } = rimoVideo;
      await new Promise((r) => {
        recorder.onstop = r;
        recorder.stop();
      });
      stream.getTracks().forEach((t) => t.stop());
      const video = await new Promise((r) => {
        const reader = new FileReader();
        reader.onload = () => r(reader.result.split(',')[1]);
        reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType }));
      });
      return { samples: rimoFrames, video };
    });
    await writeFile(`${out}/${character.key}.webm`, Buffer.from(result.video, 'base64'));
    const happy = result.samples.filter(s => s.reaction === 'happy');
    assert.ok(happy.some(s => s.hearts >= 3), character.key + ': completed pet emits hearts');
    assert.ok(result.samples.filter(s => s.reaction !== 'happy').every(s => s.hearts === 0));
    const contact = result.samples.filter(
        (s) =>
          s.weight > 0.99 &&
          s.petContactAt > 0 &&
          s.at - s.petContactAt > 150 &&
          s.at - s.petContactAt < 1500,
      ),
      maxGap = Math.max(...contact.map((s) => s.gap));
    checks.push({
      skin: character.key,
      samples: contact.length,
      maxGap,
      minDepth: Math.min(...contact.map((s) => s.depth)),
      happySamples: happy.length,
      maxHearts: Math.max(...happy.map(s => s.hearts)),
    });
    samples.push({ skin: character.key, frames: result.samples });
    console.log('PET', character.key, maxGap);
    await until(
      () =>
        b.seen.state.rimoNeko?.followPlayerId === a.p.id &&
        peers.every((p) => p.seen.rimoNeko?.followPlayerId === a.p.id),
      'five-client friendship',
    );
  }
  const lifecycle = await verifyRimoHappyLifecycle(a.page);
  checks.push({ scenario: 'happy lifecycle with actual GLB', checks: lifecycle });
  await setSkin(a, CHARACTER_MODELS[0]);
  await sleep(300);
  await a.page.locator('#world').focus();
  await a.page.evaluate(() => {
    qaRimo.yaw = 0;
  });
  await a.page.keyboard.down('w');
  await sleep(1700);
  await a.page.keyboard.up('w');
  await sleep(2200);
  assert.ok(distance(a.p, c) < 2.1);
  await shot(a, 'following');
  checks.push('walking follows, then settles at a comfortable distance');
  await a.page.evaluate(() => {
    window.rimoRunFrames = [];
    window.rimoRunUntil = performance.now() + 8000;
    function sample() {
      rimoRunFrames.push({ at:performance.now(), ...qaRimo.rimoNekoRenderer.diagnostics() });
      if(performance.now()<rimoRunUntil) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await a.page.keyboard.down('Shift');
  await a.page.keyboard.down('w');
  await until(() => a.page.evaluate(() => qaRimo.rimoNekoRenderer.diagnostics().clip === 'Run_Loop'), 'actual follow gallop');
  await sleep(900);
  await shot(a, 'gallop-follow');
  assert.equal(await b.page.evaluate(() => qaRimo.rimoNekoRenderer.diagnostics().clip), 'Run_Loop');
  await a.page.keyboard.up('w');
  await a.page.keyboard.down('d');
  await sleep(650);
  await a.page.keyboard.up('d');
  await a.page.keyboard.up('Shift');
  await until(() => a.page.evaluate(() => qaRimo.rimoNekoRenderer.diagnostics().clip === 'Idle_Loop'), 'gallop decelerates to idle');
  const runFrames=await a.page.evaluate(() => {window.rimoRunUntil=0;return rimoRunFrames;});
  assert.ok(runFrames.filter(f=>f.clip==='Run_Loop').length>10);
  assert.ok(Math.max(...runFrames.map(f=>f.speed))>1.5);
  assert.ok(runFrames.every(f=>Math.abs(f.position[1]-f.floor-.002)<1e-5));
  samples.push({scenario:'sprint, turn, slow and stop',frames:runFrames});
  checks.push('real sprint-follow gallop, remote renderer, turn, deceleration and ground placement');
  await a.page.keyboard.press('t');
  await until(() => c.mode === 'idle' && distance(c, c.home) < 0.06, 'return home', 25000);
  checks.push('T dismisses and the cat returns around obstacles');
  const slope = await a.page.evaluate(() => {
    for (let z=54;z<76;z+=1) for(let x=25;x<64;x+=1) {
      const from={x,z},to={x:x+6,z},rise=qaWalkHeight(x+3,z)-qaWalkHeight(x,z);
      const gradient=(qaWalkHeight(x+.2,z)-qaWalkHeight(x-.2,z))/.4;
      if(Math.abs(rise)>.12&&Math.abs(rise)<.55&&Math.abs(gradient)>.035&&Math.abs(gradient)<.18
        &&qaRimo.collision.segmentFree(from,to,.5)) return {x,z,rise,gradient};
    }
    throw Error('No measured, unobstructed mild slope fixture');
  });
  for(const terrain of [{name:'bridge',x:BRIDGE.x-2.5,z:BRIDGE.z},{name:'slope',...slope}]) {
    stopActor(a.p);
    Object.assign(a.p,{x:terrain.x+1.8,z:terrain.z});
    Object.assign(c,{x:terrain.x,z:terrain.z,facing:Math.PI/2,mode:'following',followPlayerId:a.p.id,
      petPlayerId:null,petAt:0,petContactAt:0,path:[],goal:null,nextPathAt:0,followSpeed:0,
      velocityX:0,velocityZ:0,ownerPosition:null,trail:[{...c.home}]});
    await settleFixture([a,b], terrain);
    await a.page.evaluate(()=>{qaRimo.yaw=0;qaRimo.pitch=.18;qaRimo.targetDistance=3.6;});
    await sleep(600);
    await a.page.evaluate(()=>{
      window.terrainFrames=[];window.terrainUntil=performance.now()+4000;
      const frame=()=>{const r=qaRimo.rimoNekoRenderer;terrainFrames.push({...r.diagnostics(),slope:[r.slope.rotation.x,r.slope.rotation.z]});if(performance.now()<terrainUntil)requestAnimationFrame(frame);};frame();
    });
    await a.page.locator('#world').focus();
    await a.page.keyboard.down('d');await sleep(750);await a.page.keyboard.up('d');
    await sleep(550);await shot(a,`terrain-${terrain.name}`);
    await sleep(1500);
    const frames=await a.page.evaluate(()=>{window.terrainUntil=0;return terrainFrames;});
    samples.push({scenario:terrain,frames});
    assert.ok(c.x>terrain.x+.8,`${terrain.name}: actual follow`);
    assert.ok(frames.every(f=>Math.abs(f.position[1]-f.floor-.002)<1e-5));
    if(terrain.name==='bridge') assert.ok(frames.some(f=>Math.abs(f.floor-.3)<1e-5));
    else assert.ok(frames.some(f=>Math.hypot(...f.slope)>.01));
    checks.push(`actual ${terrain.name} follow and ground alignment`);
  }
  stopActor(a.p);
  Object.assign(c,{...c.home,mode:'idle',followPlayerId:null,petPlayerId:null,petContactAt:0,path:[],goal:null,
    nextPathAt:0,velocityX:0,velocityZ:0,followSpeed:0,trail:[{...c.home}]});
  await settleFixture([a,b], c.home);
  // Actual melee input; only starting placement and camera are fixtures.
  for (const [index, dx, dz] of [
    [1, 0, -1],
    [2, 1, 0],
    [3, -1, 0],
  ]) {
    stopActor(a.p);
    Object.assign(a.p, {
      x: c.x - dx * 1.4,
      z: c.z - dz * 1.4,
      facing: Math.atan2(dx, dz),
      pendingStrike: null,
      attackAt: 0,
      attackSequence: 0,
    });
    await sleep(500);
    await a.page.evaluate(
      (yaw) => {
        qaRimo.yaw = yaw;
      },
      Math.atan2(-dx, -dz),
    );
    await a.page.locator('#world').focus();
    const start = { x: c.x, z: c.z },
      seq = c.hitSequence;
    await a.page.keyboard.press('f');
    await until(() => c.hitSequence === seq + 1, 'real attack');
    await a.page.evaluate(
      (yaw) => {
        qaRimo.yaw = yaw + 0.8;
        qaRimo.pitch = 0.18;
        qaRimo.targetDistance = 3;
      },
      Math.atan2(-dx, -dz),
    );
    await sleep(130);
    await shot(a, `hit-${index}`);
    await until(
      () => a.page.evaluate(() => qaRimo.rimoNekoRenderer.diagnostics().reaction === 'hiss'),
      'hiss after recoil',
    );
    await sleep(220);
    await shot(a, `hiss-${index}`);
    assert.ok((c.x - start.x) * dx + (c.z - start.z) * dz > 0.4);
    assert.equal(c.followPlayerId, null);
    assert.equal(c.health, undefined);
    const sequence = c.petSequence;
    await a.page.keyboard.press('v');
    await sleep(120);
    assert.equal(c.petSequence, sequence);
    await until(
      () =>
        b.seen.state.rimoNeko?.hitSequence === c.hitSequence &&
        peers.every((p) => p.seen.rimoNeko?.hitSequence === c.hitSequence),
      'five-client hit',
    );
    await sleep(2100);
  }
  checks.push(
    'three real directional hits: recoil, grounded hiss, blocked petting and five-client synchronization',
  );
  stopActor(a.p);
  Object.assign(a.p, { x: c.x, z: c.z + 1.5 });
  await sleep(500);
  await a.page.locator('#world').focus();
  await tap(a, 0);
  await until(() => c.petContactAt > 0, 'controller pet');
  await a.page.keyboard.down('w');
  await sleep(250);
  await a.page.keyboard.up('w');
  await until(() => !c.petPlayerId, 'movement interrupts');
  await sleep(300);
  assert.ok(
    (await a.page.evaluate(
      () => qaRimo.players.get(qaRimo.selfId).actor.groundPettingPose.weight,
    )) < 0.01,
  );
  checks.push('standard gamepad pet; walking interrupts and crouch fades out');
  Object.assign(a.p, { x: c.x, z: c.z + 1.5 });
  await sleep(550);
  await a.page.keyboard.press('v');
  await until(() => c.followPlayerId === a.p.id, 'pet before reload');
  await a.page.reload();
  await a.page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => !c.followPlayerId, 'reconnect clears follower');
  checks.push('reload does not retain a disconnected follower');
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(size);
    await sleep(300);
    await shot(a, `viewport-${size.width}`);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  checks.push('portrait and landscape controls');
  assert.ok(
    checks.filter((c) => c.skin).every((c) => c.samples > 5 && c.maxGap < 0.045),
    'every real skin reaches the animated head',
  );
  assert.deepEqual(errors, []);
  console.log('PASS', checks.length, 'verification groups');
} catch (e) {
  failure = String(e);
  if (activeA) {
    await shot(activeA, 'failure');
    await writeFile(
      `${out}/failure.json`,
      JSON.stringify(
        {
          cat: activeRoom.rimoNeko,
          player: activeA.p,
          commands: activeA.seen.commands.filter((c) => c.type === 'action'),
          view: await activeA.page.evaluate(() => ({
            frames: window.rimoFrames,
            cat: qaRimo.rimoNekoRenderer.diagnostics(),
            self: qaRimo.selfId,
            buttons: [...document.querySelectorAll('#companion524-controls button')].map((b) => ({
              id: b.id,
              hidden: b.hidden,
            })),
          })),
        },
        null,
        2,
      ) + '\n',
    );
  }
  throw e;
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        root,
        checks,
        errors,
        failure,
        fixtures: [
          'safe positions and matching renderer placement',
          'camera',
          'enemies removed in isolated world',
        ],
        requestedVideoFps: 30,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(`${out}/frames.json`, JSON.stringify(samples) + '\n');
  for (const p of peers) p.ws.close();
  await browser.close();
  await game.close();
}
