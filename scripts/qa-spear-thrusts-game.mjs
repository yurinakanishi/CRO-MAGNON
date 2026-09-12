// Five connections, real F/WSAD/Shift/Space keys, unchanged game clock.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output =
  'output/playwright/spear-thrusts/game' +
  (process.env.SPEAR_REVIEW_VARIANT ? '/' + process.env.SPEAR_REVIEW_VARIANT : '');
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`,
  roomName = 'THRUST-QA',
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
const observeThrust=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){
 const result=observeThrust.apply(this,args);window.thrustRenderer=this;window.thrustFrames??=[];
 const actors=[...this.players.values()].filter(e=>e.actor).map(e=>{
  const a=e.actor.animation, record={name:e.state.name,clip:a.name,time:a.current?.time,key:e.actor.asset.modelKey,sha:e.actor.asset.sha256,variant:e.state.spearHead,weaponVisible:!!e.weapon?.visible};
  if(a.name==='Attack'&&e.weapon){
   e.model.updateMatrixWorld(true);const right=e.actor.root.getObjectByName('GripR'),left=e.actor.root.getObjectByName('GripL');
   if(right&&left){const direction=new THREE.Vector3(0,1,0).applyQuaternion(e.weapon.getWorldQuaternion(new THREE.Quaternion())),delta=left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3()));const along=delta.dot(direction);record.gripError=delta.addScaledVector(direction,-along).length();record.along=along;record.vertical=direction.y;record.gripY=e.weapon.worldToLocal(right.getWorldPosition(new THREE.Vector3())).y;}
  }return record;
 });window.thrustFrames.push({t:performance.now(),dt:args[1],actors});if(window.thrustFrames.length>1200)window.thrustFrames.shift();
 const striking=actors.find(a=>a.name==='Thrust A'&&a.clip==='Attack'&&a.time>=.32&&a.time<=.37);
 if(striking&&!window.thrustShot)window.thrustShot={time:striking.time,image:this.canvas.toDataURL('image/png')};
 return result;
};`,
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
  const page = await open('Thrust A'),
    other = await open('Thrust B');
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
  await page.waitForFunction(() => thrustRenderer.players.size === 5);
  const room = game.rooms.get(roomName),
    me = () => [...room.players.values()].find((p) => p.name === 'Thrust A');
  assert.equal(room.players.size, 5);
  let index = 0;
  for (const p of room.players.values())
    if (p.name !== 'Thrust A') {
      stopActor(p);
      Object.assign(p, { x: 70 + 2 * index++, z: 76 });
    }
  for (const profile of CHARACTER_MODELS.filter((m) => ['cro', 'nea'].includes(m.species))) {
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
      (key) => thrustRenderer.players.get(thrustRenderer.selfId)?.actor?.asset.modelKey === key,
      profile.key,
      { timeout: 60000 },
    );
    await page.locator('#world').focus();
    const attacks = [];
    for (const variant of ['wood', 'obsidian']) {
      stopActor(me());
      Object.assign(me(), { x: 76, z: 68, facing: 0, spearHead: variant, energy: 100 });
      await page.waitForTimeout(450);
      const before = me().attackSequence || 0;
      for (const p of [page, other])
        await p.evaluate(() => {
          window.thrustFrames = [];
          window.thrustShot = null;
        });
      await page.keyboard.press('f');
      await page.waitForFunction(
        () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Attack',
      );
      await page.screenshot({ path: `${output}/${profile.key}-${variant}.png` });
      await page.waitForFunction(
        () =>
          thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Idle_Loop',
      );
      assert.equal(me().attackSequence, before + 1);
      const local = await page.evaluate(() => thrustFrames),
        remote = await other.evaluate(() => thrustFrames);
      for (const [p, label] of [
        [page, 'local'],
        [other, 'remote'],
      ]) {
        const shot = await p.evaluate(() => window.thrustShot);
        assert.ok(shot, `${profile.key} ${variant} ${label} impact capture`);
        await writeFile(
          `${output}/${profile.key}-${variant}-${label}-impact.png`,
          Buffer.from(shot.image.split(',')[1], 'base64'),
        );
      }
      const samples = (frames) =>
        frames.flatMap((f) =>
          f.actors.filter(
            (a) => a.name === 'Thrust A' && a.clip === 'Attack' && a.time >= 0.15 && a.time <= 0.5,
          ),
        );
      const stable = samples(local),
        seen = samples(remote);
      assert.ok(stable.length >= 2, `${profile.key} ${variant} local samples`);
      assert.ok(seen.length >= 2, `${profile.key} ${variant} remote samples`);
      for (const a of [...stable, ...seen]) {
        assert.ok(a.gripError < 0.002, `${profile.key} ${variant} grip ${a.gripError}`);
        assert.ok(a.along > 0.24 && a.along < 0.4);
        assert.ok(Math.abs(a.gripY + 0.5) < 0.001, `${profile.key} holds the rear of the shaft`);
        assert.ok(a.weaponVisible);
        assert.equal(a.key, profile.key);
      }
      await writeFile(
        `${output}/${profile.key}-${variant}-frames.json`,
        JSON.stringify({ local, remote }, null, 2),
      );
      attacks.push({
        variant,
        localSamples: stable.length,
        remoteSamples: seen.length,
        maxGripError: Math.max(...[...stable, ...seen].map((a) => a.gripError)),
        sha256: stable[0].sha,
        sequence: me().attackSequence,
        meanFrameMs: local.reduce((s, f) => s + f.dt * 1000, 0) / local.length,
      });
      await page.waitForTimeout(250);
    }
    for (const running of [false, true]) {
      if (running) await page.keyboard.press('Shift');
      await page.keyboard.down('w');
      await page.waitForTimeout(400);
      await page.keyboard.press('f');
      await page.keyboard.up('w');
      await page.waitForFunction(
        () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Attack',
      );
      await page.waitForFunction(
        () =>
          thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Idle_Loop',
      );
      await page.waitForTimeout(250);
    }
    await page.keyboard.press('Shift');
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Jump',
    );
    await page.waitForFunction(
      () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Idle_Loop',
    );
    records.push({ key: profile.key, attacks, walkRunAttackRecovery: true, jumpRecovery: true });
    await writeFile(`${output}/progress.json`, JSON.stringify({ records, errors }, null, 2));
    console.log('PASS', profile.key);
  }
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
    await page.evaluate(
      () => thrustRenderer.players.get(thrustRenderer.selfId).actor.asset.modelKey,
    ),
    'neanderthal-hunter',
  );
  await page.locator('#world').focus();
  await page.keyboard.press('f');
  await page.waitForFunction(
    () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Attack',
  );
  await page.waitForFunction(
    () => thrustRenderer.players.get(thrustRenderer.selfId).actor.animation.name === 'Idle_Loop',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        records,
        connections: 5,
        reloadedAttack: true,
        errors,
        fixtures:
          'Clear meadow start (76,68), peers to one side, both spear inventory variants. Actual input and game time; observer does not alter rendering.',
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
