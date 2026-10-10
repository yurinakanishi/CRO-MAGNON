// In-game QA for the 2026-10-07 face remake: all four human characters in one isolated in-memory room.
// node scripts/face-remake/qa-face-remake-game.mjs   (after node scripts/build.mjs)
// Real UI selection and real keys for walk / run / attack / jump; the remote pages must see the same clips.
// Fixtures (documented in the report): combat enemies removed, start coordinates set, an inspection camera for the
// face close-ups and a server-side move for the 28 m LOD round trip. No saved game is loaded or written.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../../dist/server.mjs';
import { stopActor } from '../../dist/shared/combat.mjs';
const { chromium } = await import(
  'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const folder = `output/playwright/face-remake/game-${Date.now()}`;
await mkdir(folder, { recursive: true });
const ROOM = 'FACE-REMAKE-QA';
const game = createGameServer({ host: '127.0.0.1', port: 0 }),
  { port } = await game.listen();
const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    // four game tabs: keep the background ones rendering so remote animation can be observed
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  }),
  errors = [],
  records = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const observer = `\nconst qaRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=qaRender.apply(this,args);window.qaRenderer=this;window.qaFrames??=[];const players=[...this.players.values()].filter(e=>e.actor).map(e=>({name:e.state.name,key:e.actor.asset.modelKey,sha:e.actor.asset.sha256,clip:e.actor.animation.name,jumpHeight:jumpHeight(e.state,this.serverNow()),cameraDistance:e.model.position.distanceTo(this.camera.position),lod:e.actor.root.userData.actorDetail?.level,meshes:e.actor.root.userData.actorDetail?.meshes.length}));window.qaFrames.push({t:performance.now(),players});if(window.qaFrames.length>1000)window.qaFrames.shift();return result;};`;
const characters = [
  { value: 'cro-male', key: 'cro-magnon-hunter', name: 'Face CM', prims: 3 },
  { value: 'cro-female', key: 'cro-magnon-woman', name: 'Face CW', prims: 2 },
  { value: 'nea-male', key: 'neanderthal-hunter', name: 'Face NH', prims: 3 },
  { value: 'nea-female', key: 'neanderthal-woman', name: 'Face NW', prims: 2 },
];
async function select(page, value) {
  await page.locator(`#setup-form .character-choice:has(input[value="${value}"])`).click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', { timeout: 120000 });
}
async function open(c) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`${c.key}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${c.key}: ${m.text()}`);
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + observer });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill(c.name);
  await select(page, c.value);
  return page;
}
try {
  const pages = [];
  for (const c of characters) pages.push(await open(c));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?` + new URLSearchParams({ room: ROOM, name: 'Peer', species: 'cro', gender: 'female' }));
  await new Promise((r, j) => {
    socket.once('open', r);
    socket.once('error', j);
  });
  peers.push(socket);
  await pages[0].waitForFunction(() => qaRenderer.players.size === 5, null, { timeout: 60000 });
  const room = game.rooms.get(ROOM);
  room.enemies = [];
  room.poisonShots = [];
  room.poisonSplashes = [];
  for (const [i, p] of [...room.players.values()].entries()) {
    stopActor(p);
    Object.assign(p, { x: 74 + i * 2.5, z: 68 });
  }
  await sleep(1200);
  console.log('Five connections ready; fixtures prepared.');
  for (const [i, c] of characters.entries()) {
    const p = pages[i],
      other = pages[(i + 1) % pages.length];
    const a = JSON.parse(await readFile(`public/models/${c.key}/asset.json`, 'utf8'));
    await p.bringToFront();
    await p.waitForFunction(
      ({ sha, name, prims }) => qaFrames.at(-1)?.players.some((x) => x.name === name && x.sha === sha && x.meshes === prims),
      { sha: a.sha256, name: c.name, prims: c.prims },
      { timeout: 60000 },
    );
    await p.locator('#world').focus();
    const phases = [];
    for (const [label, run] of [
      ['walk', false],
      ['run', true],
    ]) {
      await p.evaluate(() => (window.qaFrames = []));
      await other.evaluate(() => (window.qaFrames = []));
      if (run) await p.keyboard.press('Shift');
      await p.keyboard.down('w');
      await sleep(1600);
      await p.screenshot({ path: `${folder}/${c.key}-${label}.png` });
      await p.keyboard.up('w');
      const clip = run ? 'Run_Loop' : 'Walk_Loop';
      const frames = await p.evaluate(() => qaFrames);
      assert.ok(frames.some((f) => f.players.some((x) => x.name === c.name && x.clip === clip && x.sha === a.sha256)), `${c.key} ${label}`);
      const remote = await other.evaluate(() => qaFrames);
      assert.ok(remote.some((f) => f.players.some((x) => x.name === c.name && x.clip === clip)), `${c.key} remote ${label}`);
      phases.push({ label, localFrames: frames.length, remoteFrames: remote.length });
      await sleep(300);
    }
    await p.keyboard.press('Shift');
    // back to open ground (fixture): the run may end next to a gatherable resource, where F is not an attack
    const self = [...room.players.values()].find((x) => x.name === c.name);
    stopActor(self);
    Object.assign(self, { x: 74 + i * 2.5, z: 66 });
    await sleep(800);
    await p.keyboard.press('f');
    await p.waitForFunction((name) => qaFrames.some((f) => f.players.some((x) => x.name === name && x.clip === 'Attack')), c.name);
    await sleep(900);
    await p.keyboard.press('Space');
    await p.waitForFunction((name) => qaFrames.some((f) => f.players.some((x) => x.name === name && x.jumpHeight > 0.2)), c.name);
    await sleep(1000);
    // Inspection camera only: look at the face from the front and from the side.
    for (const [label, yaw] of [
      ['face-front', 0],
      ['face-side', Math.PI / 2],
    ]) {
      await p.evaluate((y) => {
        qaRenderer.yaw = qaRenderer.players.get(qaRenderer.selfId).model.rotation.y + y;
        qaRenderer.pitch = 0.05;
        qaRenderer.targetDistance = 1.6;
      }, yaw);
      await sleep(700);
      await p.screenshot({ path: `${folder}/${c.key}-${label}.png` });
    }
    await p.evaluate(() => {
      qaRenderer.targetDistance = 6;
    });
    records.push({ key: c.key, sha256: a.sha256, phases, attack: true, jump: true, remote: true });
    console.log(`${c.key}: walk, run, attack, jump, remote and face views passed.`);
  }
  // 28 m LOD round trip seen from the first page (server-side position fixture).
  const near = [...room.players.values()].find((x) => x.name === characters[0].name);
  for (const c of characters.slice(1)) {
    const far = [...room.players.values()].find((x) => x.name === c.name);
    stopActor(far);
    Object.assign(far, { x: near.x + 4, z: near.z + 38 });
    await pages[0].bringToFront();
    await pages[0].waitForFunction(
      ({ name, prims }) => qaFrames.at(-1).players.some((x) => x.name === name && x.lod === 1 && x.meshes === prims && x.cameraDistance > 30),
      { name: c.name, prims: c.prims },
      { timeout: 30000 },
    );
    await pages[0].screenshot({ path: `${folder}/${c.key}-distant-lod.png` });
    Object.assign(far, { x: near.x + 3, z: near.z });
    await pages[0].waitForFunction(
      ({ name }) => qaFrames.at(-1).players.some((x) => x.name === name && x.lod === 0 && x.cameraDistance < 12),
      { name: c.name },
      { timeout: 30000 },
    );
  }
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await pages[1].setViewportSize(size);
    await sleep(600);
    await pages[1].screenshot({ path: `${folder}/viewport-${size.width}.png` });
  }
  await pages[1].reload();
  await pages[1].locator('#title-start').click();
  await select(pages[1], 'cro-female');
  await pages[1].waitForFunction(() => qaRenderer.players.get(qaRenderer.selfId)?.actor?.asset.faceRemake);
  await pages[1].screenshot({ path: `${folder}/reload.png` });
  assert.deepEqual(errors, []);
  const report = {
    status: 'passed',
    records,
    connections: 5,
    lodRoundTrip: characters.slice(1).map((c) => c.key),
    viewports: ['1280x800', '390x844', '844x390'],
    reload: true,
    errors,
    fixtures:
      'Isolated in-memory room; combat enemies removed, start coordinates set, inspection camera for face views and a server-side move for the LOD round trip. Selection, walking, running, attack and jump use the real UI and keys.',
  };
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', folder, records: records.length, errors }));
} finally {
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
