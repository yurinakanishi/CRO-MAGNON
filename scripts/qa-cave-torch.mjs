// Isolated memory-only room; placement fixtures never touch the user's saved game.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { caveWorldAt, CAVE_HEARTH } from '../dist/shared/camp-cave-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/cave-torch/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const roomName = 'TORCH-QA',
  errors = [],
  checks = [],
  captures = [],
  peers = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, why, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(why);
    await sleep(50);
  }
}
function pass(text) {
  checks.push(text);
  console.log('PASS', text);
}
let failure, a, b, room;
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(),
    seen = { id: null, state: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const m = JSON.parse(String(payload));
      if (m.type === 'welcome') seen.id = m.id;
      if (m.type === 'state') seen.state = m;
    }),
  );
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-graphics-quality', 'standard');
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
      function caveReviewCamera(w) {
        const c=w.camera.clone(); const z=-21.2,t=-z/72.64,x=38*t*t*(3-2*t);
        c.position.set(35-x-1,9.85,125.15-z);c.lookAt(35-x+5.6,9.8,125.15-z);c.fov=55;c.updateProjectionMatrix();c.updateMatrixWorld();return c;
      }
      const originalTorchFrame=WorldRenderer.prototype.render;
      WorldRenderer.prototype.render=function(...args){const r=originalTorchFrame.apply(this,args);window.qa=this;if(window.caveReview)this.renderer.render(this.scene,caveReviewCamera(this));return r;};
      window.cavePixels=()=>{const w=window.qa;w.renderer.render(w.scene,caveReviewCamera(w));const gl=w.renderer.getContext(),width=w.canvas.width,height=w.canvas.height,p=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,p);let n=0,sum=0,bright=0,black=0;for(let y=Math.floor(height*.15);y<height*.85;y+=3)for(let x=Math.floor(width*.1);x<width*.9;x+=3){const i=(y*width+x)*4,l=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;sum+=l;n++;if(l>30)bright++;if(l<6)black++;}return{mean:sum/n,bright:bright/n,black:black/n,safetyScale:w.graphics.scale};};
    `,
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  console.log('LOAD', name);
  try {
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 180000 });
  } catch (error) {
    console.log(
      'LOAD STATE',
      await page.locator('#world').evaluate((el) => ({ ...el.dataset })),
      errors,
    );
    await page.screenshot({ path: `${out}/load-failure-${name}.png` });
    throw error;
  }
  console.log('READY', name);
  await until(() => seen.id && game.rooms.get(roomName)?.players.has(seen.id), 'join');
  await page.waitForFunction(() => !!window.qa?.players.get(window.qa.selfId)?.torch, null, {
    timeout: 60000,
  });
  return {
    page,
    seen,
    get p() {
      return game.rooms.get(roomName).players.get(seen.id);
    },
  };
}
async function place(user, point, facing = Math.PI / 2) {
  stopActor(user.p);
  Object.assign(user.p, point, { facing, warpSequence: (user.p.warpSequence ?? 0) + 1 });
  await sleep(900);
  await user.page.locator('#world').focus();
}
async function capture(label, review = true) {
  await a.page.evaluate((review) => {
    window.caveReview = review;
  }, review);
  await sleep(600);
  const pixels = review ? await a.page.evaluate(() => window.cavePixels()) : null;
  const state = await a.page.evaluate(() => {
    const q = window.qa,
      e = q.players.get(q.selfId);
    return {
      position: e.model.position.toArray(),
      torch: e.torch.root.visible,
      handGap: e.torch.root.position.distanceTo(
        e.torch.pose.grip.getWorldPosition(e.torch.root.position.clone()),
      ),
      light: e.torch.light.position.toArray(),
      sun: q.sun.intensity,
      ambient: q.hemisphere.intensity,
      darkness: q.canvas.dataset.caveDarkness,
    };
  });
  await a.page.screenshot({ path: `${out}/${label}.png` });
  const record = { label, pixels, ...state };
  captures.push(record);
  console.log('CAPTURE', JSON.stringify(record));
  return record;
}
try {
  a = await open('Torch A');
  room = game.rooms.get(roomName);
  room.enemies = [];
  room.camp.caveFireLit = false;
  assert.equal(await a.page.evaluate(() => qa.players.get(qa.selfId).torch.root.visible), false);
  await place(a, caveWorldAt(13), 0);
  await a.page.evaluate(() => {
    qa.yaw = Math.PI;
    qa.pitch = 0.12;
    qa.targetDistance = 4.2;
  });
  await a.page.keyboard.down('w');
  await sleep(3300);
  await a.page.keyboard.up('w');
  await until(
    () => a.page.evaluate(() => qa.players.get(qa.selfId).torch.root.visible),
    'walk across mouth equips torch',
  );
  await capture('entry-normal', false);
  pass('real keyboard walk from the apron enters the cave and equips the left-hand torch');
  await place(a, caveWorldAt(-21.2, -3.35));
  await a.page.waitForFunction(() => !!qa.landmarks?.caveRimoPigment?.image?.complete, null, {
    timeout: 90000,
  });
  await sleep(2500);
  const near = await capture('near-lit');
  await a.page.keyboard.press('l');
  await until(() => a.p.caveTorchOff, 'L stows');
  const dark = await capture('near-dark');
  assert.ok(near.pixels.mean > dark.pixels.mean * 4 + 2, 'the torch reveals the mural');
  await a.page.keyboard.press('l');
  await until(() => !a.p.caveTorchOff, 'L equips');
  await place(a, caveWorldAt(-21.2, 0));
  const far = await capture('far-lit');
  assert.ok(far.pixels.mean < near.pixels.mean * 0.4, 'distant mural stays dark');
  pass('torch off and distant wall remain dark; a close torch reveals only the nearby mural');
  await place(a, caveWorldAt(-21.2, -3.35));
  await a.page.evaluate(() => {
    window.caveReview = false;
    qa.yaw = -Math.PI / 2;
    qa.pitch = 0.1;
    qa.targetDistance = 3.2;
  });
  await capture('mural-normal', false);
  b = await open('Torch B');
  await place(b, caveWorldAt(-18, -2));
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomName}&name=TorchPeer${i}`),
      seen = { state: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'state') seen.state = m;
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push({ ws, seen });
  }
  assert.equal(room.players.size, 5);
  await a.page.keyboard.press('l');
  await until(() => a.p.caveTorchOff, 'own torch stow');
  await until(
    () =>
      [b, ...peers].every(
        (v) => v.seen.state?.players.find((p) => p.id === a.seen.id)?.caveTorchOff === true,
      ),
    'five clients see personal torch switch',
  );
  assert.equal(b.p.caveTorchOff ?? false, false);
  // Consecutive generic actions share the existing 450 ms server cooldown.
  await until(() => Date.now() - a.p.lastAction >= 500, 'action cooldown');
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-controller-menu="caveTorch"]').click();
  await until(() => !a.p.caveTorchOff, 'menu equip');
  pass('5 clients share each personal torch; L and menu preserve the other player’s torch');
  await place(b, { x: 55, z: 55 });
  await place(a, { x: CAVE_HEARTH.x, z: CAVE_HEARTH.z - 1 });
  await a.page.keyboard.press('e');
  await until(() => room.camp.caveFireLit, 'hearth E');
  await sleep(600);
  await a.page.keyboard.press('e');
  await until(() => !room.camp.caveFireLit, 'hearth E off');
  pass('the shared hearth still lights and extinguishes with E');
  await place(a, caveWorldAt(-21.2, -3.35));
  // One fixed graphics profile: the settings panel offers no quality selector.
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-pause-tab="settings"]').click();
  assert.equal(await a.page.locator('[data-graphics]').count(), 0);
  await a.page.locator('#modal-close').click();
  await capture('mural-fixed-profile', false);
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.page.setViewportSize({ width, height });
    await a.page.keyboard.press('Escape');
    const button = a.page.locator('[data-controller-menu="caveTorch"]');
    await button.scrollIntoViewIfNeeded();
    assert.ok(await button.isVisible());
    await a.page.screenshot({ path: `${out}/menu-${width}.png` });
    await a.page.locator('#modal-close').click();
  }
  await a.page.setViewportSize({ width: 1280, height: 800 });
  await a.page.keyboard.press('l');
  await until(() => a.p.caveTorchOff, 'leave unlit');
  await place(a, caveWorldAt(13));
  await until(() => !a.p.caveTorchOff, 'outside resets');
  await sleep(2500);
  const outdoor = await capture('exit-normal', false);
  assert.equal(outdoor.torch, false);
  assert.ok(outdoor.ambient > 1.9);
  await place(a, caveWorldAt(-21.2, -3.35));
  await until(
    () => a.page.evaluate(() => qa.players.get(qa.selfId).torch.root.visible),
    'reentry lights',
  );
  pass('fixed profile, phone portrait/landscape, exit daylight restoration and re-entry work');
  assert.deepEqual(errors, []);
  pass('no browser page or console errors');
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, failure, checks, captures, errors }, null, 2),
  );
  for (const peer of peers) peer.ws.close();
  await browser.close();
  await game.close();
  console.log('Evidence:', out);
}
if (failure) process.exitCode = 1;
