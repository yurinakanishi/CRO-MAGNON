// Supplemental visual checks for the final HUD, casting view and real-distance LOD.
// Only the independent in-memory QA world's positions and camera are prepared.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.env.HOWKEY_DETAIL_OUT || 'output/playwright/howkey/detail-r01';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
});
const page = await context.newPage(),
  errors = [],
  checks = [],
  observations = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id, peer, failure;
async function until(fn, label) {
  const end = Date.now() + 15000;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(30);
  }
}
async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
}
function pass(text) {
  checks.push(text);
  console.log('PASS', text);
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('websocket', (ws) =>
  ws.on('framereceived', ({ payload }) => {
    const msg = JSON.parse(String(payload));
    if (msg.type === 'welcome') id = msg.id;
  }),
);
await page.addInitScript(() => localStorage.setItem('cro-name', 'Howkey'));
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      `
const draw=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){const result=draw.apply(this,args);window.qa=this;return result;};`,
  });
});
try {
  await page.goto(`http://127.0.0.1:${port}/?room=HOWKEY-DETAIL`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="howkey-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  const room = game.rooms.get('HOWKEY-DETAIL'),
    p = room.players.get(id);
  room.enemies = [];
  stopActor(p);
  Object.assign(p, { x: 76, z: 68, facing: Math.PI });
  await page.evaluate(() => {
    qa.yaw = 2.65;
    qa.pitch = 0.06;
    qa.targetDistance = 2.5;
  });
  await sleep(1100);
  assert.match(
    await page.locator('#my-portrait').evaluate((e) => getComputedStyle(e).backgroundImage),
    /howkey-scientist\/portrait.png/,
  );
  assert.equal(
    await page.locator('#my-portrait').evaluate((e) => getComputedStyle(e, ':before').display),
    'none',
  );
  const loaded = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/models/howkey-scientist/portrait.png';
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  assert.deepEqual(loaded, [420, 480]);
  await shot('howkey-in-game');
  pass('final HUD uses the actual Howkey portrait with no generic face overlay');
  // Aim first; orbit the QA camera after the real F command locks the shot.
  await page.evaluate(() => {
    qa.yaw = 0;
    qa.pitch = 0.1;
  });
  await page.locator('#world').focus();
  const sequence = p.attackSequence;
  await page.keyboard.press('f');
  await until(() => p.attackSequence > sequence, 'science cast input');
  await page.evaluate(() => {
    qa.yaw = 2.25;
    qa.targetDistance = 2.7;
  });
  await sleep(190);
  const charge = await page.evaluate(() => ({
    count: qa.spells.count,
    clip: qa.players.get(qa.selfId).actor.animation.name,
  }));
  assert.equal(charge.clip, 'Attack');
  assert.ok(charge.count >= 54);
  observations.push({ charge });
  await shot('science-charge-front');
  await until(() => room.projectiles.some((p) => p.kind === 'science'), 'science pulse launch');
  await sleep(90);
  await shot('science-flight-side');
  pass('real F creates the visible blue-green orbit and forward science pulse');
  await sleep(1700);
  peer = new WebSocket(
    `ws://127.0.0.1:${port}/ws?room=HOWKEY-DETAIL&name=Howkey%20LOD&species=howkey&gender=female`,
  );
  await new Promise((r, j) => {
    peer.once('open', r);
    peer.once('error', j);
  });
  await until(() => room.players.size === 2, 'LOD peer');
  const remote = [...room.players.values()].find((v) => v.id !== id);
  assert.equal(remote.species, 'howkey');
  stopActor(remote);
  Object.assign(remote, { x: p.x, z: p.z - 36, facing: Math.PI });
  await page.evaluate(() => {
    qa.yaw = 0;
    qa.pitch = 0.13;
    qa.targetDistance = 5;
  });
  await page.waitForFunction(
    (id) => qa.players.get(id)?.actor?.root.userData.actorDetail?.level === 1,
    remote.id,
  );
  const inspect = () =>
    page.evaluate((id) => {
      const a = qa.players.get(id).actor,
        d = a.root.userData.actorDetail;
      return {
        level: d.level,
        distance: qa.players.get(id).model.position.distanceTo(qa.camera.position),
        sha: a.asset.sha256,
        triangles: d.meshes.reduce(
          (n, e) =>
            n + (e.mesh.geometry.index?.count || e.mesh.geometry.attributes.position.count) / 3,
          0,
        ),
        skinned: d.meshes.every(
          (e) => !!e.mesh.skeleton && !!e.mesh.geometry.attributes.skinWeight,
        ),
      };
    }, remote.id);
  const far = await inspect();
  assert.ok(far.distance > 30 && far.skinned);
  assert.equal(far.triangles, 9960);
  await shot('lod-far');
  Object.assign(remote, { x: p.x + 1.4, z: p.z - 2.5 });
  await page.waitForFunction(
    (id) => qa.players.get(id)?.actor?.root.userData.actorDetail?.level === 0,
    remote.id,
  );
  const near = await inspect();
  assert.ok(near.distance < 26 && near.skinned);
  assert.equal(near.triangles, 66406);
  const asset = JSON.parse(await readFile('public/models/howkey-scientist/asset.json', 'utf8'));
  assert.equal(near.sha, asset.sha256);
  observations.push({ far, near });
  await shot('lod-return');
  pass('actual distance switches the animated Howkey mesh to 9960 triangles and restores 66406');
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e);
  await shot('failure').catch(() => {});
  throw e;
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        pass: !failure,
        failure,
        checks,
        errors,
        observations,
        fixtures: ['isolated in-memory world', 'safe positions', 'camera for inspection'],
      },
      null,
      2,
    ) + '\n',
  );
  peer?.close();
  await context.close();
  await browser.close();
  await game.close();
}
