// Isolated in-memory world: normal UI and input, with documented camera/position fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = `output/playwright/female-faces/game-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 }),
  { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  errors = [],
  records = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const observer = `\nconst faceOriginalRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=faceOriginalRender.apply(this,args);window.faceRenderer=this;window.faceFrames??=[];const players=[...this.players.values()].filter(e=>e.actor).map(e=>({name:e.state.name,key:e.actor.asset.modelKey,sha:e.actor.asset.sha256,clip:e.actor.animation.name,jumpHeight:jumpHeight(e.state,this.serverNow()),cameraDistance:e.model.position.distanceTo(this.camera.position),lod:e.actor.root.userData.actorDetail?.level,meshes:e.actor.root.userData.actorDetail?.meshes.length}));window.faceFrames.push({t:performance.now(),players});if(window.faceFrames.length>1000)window.faceFrames.shift();return result;};`;
async function select(page, value) {
  await page.locator(`#setup-form .character-choice:has(input[value="${value}"])`).click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 90000,
  });
}
async function open(name, value) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + observer });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=FEMALE-FACE-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill(name);
  await select(page, value);
  return page;
}
try {
  const page = await open('Face A', 'cro-female'),
    other = await open('Face B', 'nea-female');
  for (let i = 0; i < 3; i++) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?` +
        new URLSearchParams({
          room: 'FEMALE-FACE-QA',
          name: `Peer ${i}`,
          species: i % 2 ? 'nea' : 'cro',
          gender: i === 2 ? 'male' : 'female',
        }),
    );
    await new Promise((r, j) => {
      socket.once('open', r);
      socket.once('error', j);
    });
    peers.push(socket);
  }
  await page.waitForFunction(() => faceRenderer.players.size === 5);
  const room = game.rooms.get('FEMALE-FACE-QA');
  // Remove combat hazards only in this disposable appearance-test world.
  room.enemies = [];
  room.poisonShots = [];
  room.poisonSplashes = [];
  for (const [i, p] of [...room.players.values()].entries()) {
    stopActor(p);
    Object.assign(p, { x: 76 + i * 2, z: 68 });
  }
  await sleep(1000);
  console.log('Five clients ready; appearance fixtures prepared.');
  for (const [p, name, key] of [
    [page, 'Face A', 'cro-magnon-woman'],
    [other, 'Face B', 'neanderthal-woman'],
  ]) {
    const a = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    await p.waitForFunction(
      ({ sha, name }) =>
        faceFrames.at(-1)?.players.some((a) => a.name === name && a.sha === sha && a.meshes === 2),
      { sha: a.sha256, name },
    );
    await p.screenshot({ path: `${folder}/${key}-normal.png` });
    const phases = [];
    await p.bringToFront();
    await p.locator('#world').focus();
    for (const [label, run] of [
      ['walk', false],
      ['run', true],
    ]) {
      await p.evaluate(() => (window.faceFrames = []));
      if (run) await p.keyboard.press('Shift');
      await p.keyboard.down('w');
      await sleep(1500);
      await p.keyboard.up('w');
      const frames = await p.evaluate(() => faceFrames),
        clip = run ? 'Run_Loop' : 'Walk_Loop';
      assert.ok(
        frames.some((f) =>
          f.players.some(
            (actor) => actor.name === name && actor.clip === clip && actor.sha === a.sha256,
          ),
        ),
        label,
      );
      const remote = await (p === page ? other : page).evaluate(() => faceFrames);
      assert.ok(
        remote.some((f) => f.players.some((a) => a.name === name && a.clip === clip)),
        `remote ${label}`,
      );
      phases.push({ label, frames: frames.length });
      await p.screenshot({ path: `${folder}/${key}-${label}.png` });
      await sleep(300);
    }
    await p.keyboard.press('Shift');
    await p.keyboard.press('f');
    await p.waitForFunction(
      (name) =>
        faceFrames.some((f) => f.players.some((a) => a.name === name && a.clip === 'Attack')),
      name,
    );
    await sleep(900);
    await p.keyboard.press('Space');
    await p.waitForFunction(
      (name) =>
        faceFrames.some((frame) =>
          frame.players.some((actor) => actor.name === name && actor.jumpHeight > 0.2),
        ),
      name,
    );
    await p.screenshot({ path: `${folder}/${key}-jump.png` });
    await sleep(900);
    // Inspection camera only; the rendered model/animation remains untouched.
    await p.evaluate(() => {
      faceRenderer.yaw = Math.PI;
      faceRenderer.pitch = 0.1;
      faceRenderer.targetDistance = 3.2;
    });
    await sleep(500);
    await p.screenshot({ path: `${folder}/${key}-front.png` });
    records.push({ key, sha256: a.sha256, phases, attack: true, jump: true, remote: true });
    console.log(`${key}: walk, run, attack, jump and remote animation passed.`);
  }
  const actorB = [...room.players.values()].find((p) => p.name === 'Face B');
  const actorA = [...room.players.values()].find((p) => p.name === 'Face A');
  for (const [observer, near, far, key] of [
    [page, actorA, actorB, 'neanderthal-woman'],
    [other, actorB, actorA, 'cro-magnon-woman'],
  ]) {
    stopActor(far);
    Object.assign(far, { x: near.x + 4, z: near.z + 36 });
    await observer.bringToFront();
    await observer.waitForFunction(
      (name) =>
        faceFrames
          .at(-1)
          .players.some(
            (a) => a.name === name && a.lod === 1 && a.meshes === 2 && a.cameraDistance > 30,
          ),
      far.name,
    );
    await observer.screenshot({ path: `${folder}/${key}-distant-lod.png` });
    Object.assign(far, { x: near.x + 3, z: near.z });
    await observer.waitForFunction(
      (name) =>
        faceFrames
          .at(-1)
          .players.some(
            (a) => a.name === name && a.lod === 0 && a.meshes === 2 && a.cameraDistance < 10,
          ),
      far.name,
    );
  }
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${folder}/viewport-${size.width}.png` });
  }
  await page.reload();
  await page.locator('#title-start').click();
  await select(page, 'cro-female');
  await page.waitForFunction(
    () => faceRenderer.players.get(faceRenderer.selfId)?.actor?.asset.faceRepair,
  );
  await page.screenshot({ path: `${folder}/reload.png` });
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        status: 'passed',
        records,
        connections: 5,
        lodRoundTrip: true,
        reload: true,
        errors,
        fixtures:
          'In-memory test world; combat enemies removed, initial coordinates prepared and a front inspection camera. Walking/running/attack/jump and title selection use real controls.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'passed', folder, records, errors }));
} finally {
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
