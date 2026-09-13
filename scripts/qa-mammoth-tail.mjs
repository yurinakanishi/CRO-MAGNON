// Real-Chrome check of the single-tail mammoth (2026-09-13): the reviewer is
// placed behind mammoth-1 on the served page against the isolated fixture host
// and the rump is photographed from behind and from the rear quarter.
// Usage: node scripts/qa-mammoth-tail.mjs [out-dir]
import { fork } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/mammoth-tail-r11-game');
const expectedAsset = JSON.parse(await readFile('public/models/woolly-mammoth/asset.json', 'utf8'));
const peers = [];
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  checks = [],
  screenshots = [];
let child,
  base,
  ready = false,
  rid = 0;
const pending = new Map();
const request = (kind, extra = {}) =>
  new Promise((resolve, reject) => {
    const id = ++rid;
    pending.set(id, { resolve, reject });
    child.send({ id, kind, ...extra });
  });
async function until(fn, label, limit = 30000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > limit) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
async function shot(page, name) {
  const file = path.join(out, name + '.png');
  await page.screenshot({ path: file });
  screenshots.push(file);
}
const mammoth = (page) =>
  page.evaluate(() => {
    const r = window.monsterReview,
      a = (r.state.animals || []).find((a) => a.id === 'mammoth-1'),
      me = r.players.get(r.selfId);
    return a
      ? {
          x: a.x,
          z: a.z,
          facing: a.facing,
          scale: a.scale,
          radius: a.radius,
          phase: a.phase,
          me: me ? { x: me.state.x, z: me.state.z } : null,
          modelUrl: [...document.querySelectorAll('#world')].map((w) => w.dataset.animals)[0],
        }
      : null;
  });
async function lookAt(page, target, distance, pitch) {
  await page.evaluate(
    ({ target, distance, pitch }) => {
      const r = window.monsterReview,
        p = r.players.get(r.selfId)?.state;
      r.yaw = p ? Math.atan2(p.x - target.x, p.z - target.z) : 0;
      r.pitch = pitch;
      r.distance = distance;
      r.targetDistance = distance;
    },
    { target, distance, pitch },
  );
}
async function place(page, p) {
  await request('place', { x: p.x, z: p.z });
  await until(
    () =>
      page.evaluate(
        ({ x, z }) => {
          const r = window.monsterReview,
            me = r.players.get(r.selfId);
          return me && Math.hypot(me.model.position.x - x, me.model.position.z - z) < 0.5;
        },
        { x: p.x, z: p.z },
      ),
    'placed',
  );
}
const contexts = [];
try {
  child = fork(new URL('./qa-violet-behemoth-host.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  child.on('message', (m) => {
    if (m.ready) {
      base = `http://127.0.0.1:${m.port}`;
      ready = true;
    }
    if (m.reply) {
      const p = pending.get(m.reply);
      pending.delete(m.reply);
      m.ok ? p?.resolve(m.value) : p?.reject(Error(m.error));
    }
  });
  await until(() => {
    if (child.exitCode !== null) throw Error(log);
    return ready;
  }, 'host');
  const context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
  });
  contexts.push(context);
  const page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Monster A');
    localStorage.setItem('cro-species', 'bear');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + '/?room=BEHEMOTH-QA');
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('Monster A');
  await page.locator('#setup-submit').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => page.evaluate(() => !!window.monsterReview?.selfId), 'renderer');
  // Verify the exact currently adopted structural repair.
  const served = await page.evaluate(async () => {
    const manifest = await (await fetch('/models/woolly-mammoth/asset.json')).json();
    const bytes = new Uint8Array(await (await fetch(manifest.url)).arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      url: manifest.url,
      sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      bytes: bytes.length,
    };
  });
  assert.equal(served.url, '/models/woolly-mammoth/model-tail-r11.glb');
  assert.equal(served.sha256, expectedAsset.sha256);
  checks.push(`Served ${served.url} (${served.bytes} bytes, sha256 ${served.sha256})`);
  let m = await mammoth(page);
  assert.ok(m, 'mammoth-1 in state');
  const behind = (d, side = 0) => ({
    x: m.x - Math.sin(m.facing) * d + Math.cos(m.facing) * side,
    z: m.z - Math.cos(m.facing) * d - Math.sin(m.facing) * side,
  });
  const otherContext = await context
    .browser()
    .newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(otherContext);
  const other = await otherContext.newPage();
  other.on('pageerror', (e) => errors.push(String(e)));
  await other.goto(base + '/?room=BEHEMOTH-QA');
  await other.locator('#title-start').click();
  await other.locator('#setup-form input[name="name"]').fill('Monster B');
  await other.locator('#setup-submit').click();
  await other.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 120000,
  });
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(
      base.replace('http', 'ws') +
        '/ws?' +
        new URLSearchParams({
          room: 'BEHEMOTH-QA',
          name: `Tail peer ${i}`,
          species: 'cro',
          gender: 'male',
        }),
    );
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    peers.push(ws);
  }
  await page.waitForFunction(() => monsterReview.players.size === 5);
  await other.waitForFunction(() => monsterReview.players.size === 5);
  await request('mammothStage');
  m=await mammoth(page);
  await request('place', { player: 'Monster B', ...behind(7, 3) });
  await lookAt(other, { x: m.x, z: m.z }, 5, 0.15);
  await place(page, behind(9));
  await lookAt(page, { x: m.x, z: m.z }, 7, 0.18);
  await until(
    () => page.evaluate(() => Number(document.querySelector('#world').dataset.landmarks ?? 1) >= 0),
    'scene',
  );
  await sleep(2500);
  await shot(page, '01-behind');
  await place(page, behind(8, 5));
  await lookAt(page, { x: m.x, z: m.z }, 7, 0.2);
  await sleep(1200);
  await shot(page, '02-rear-quarter');
  await place(page, behind(8, -5));
  await lookAt(page, { x: m.x, z: m.z }, 7, 0.2);
  await sleep(1200);
  await shot(page, '03-rear-quarter-other');
  // Close behind the rump, camera low: the attachment seams at reading distance.
  await place(page, behind(6));
  await lookAt(page, { x: m.x, z: m.z }, 3.5, 0.05);
  await sleep(1200);
  await shot(page, '04-rear-close');
  const after = await mammoth(page);
  checks.push(
    `mammoth-1 at (${after.x.toFixed(1)}, ${after.z.toFixed(1)}) scale ${after.scale}, phase ${after.phase}`,
  );
  await shot(other, '05-other-player');
  const live = await mammoth(page);
  await place(page, { x: live.x + live.radius + .7, z: live.z });
  await page.locator('#world').focus();
  await page.keyboard.press('r');
  await page.waitForFunction(
    () => monsterReview.players.get(monsterReview.selfId)?.state.mountId === 'mammoth-1',
  );
  await page.keyboard.down('w');
  await page.waitForFunction(
    () => monsterReview.mammoths.find((m) => m.id === 'mammoth-1')?.actor.name === 'Walk_Loop',
  );
  await sleep(1100);
  await shot(page, '07-mounted-walk');
  await page.keyboard.press('Shift');
  await page.waitForFunction(
    () => monsterReview.mammoths.find((m) => m.id === 'mammoth-1')?.actor.name === 'Run_Loop',
  );
  await other.waitForFunction(
    () => monsterReview.mammoths.find((m) => m.id === 'mammoth-1')?.actor.name === 'Run_Loop',
  );
  await sleep(1100);
  await shot(page, '08-mounted-run');
  await shot(other, '09-observer-run');
  await page.keyboard.up('w');
  await page.waitForFunction(
    () => monsterReview.mammoths.find((m) => m.id === 'mammoth-1')?.actor.name === 'Idle_Loop',
  );
  await page.keyboard.press('r');
  await page.waitForFunction(() => !monsterReview.players.get(monsterReview.selfId)?.state.mountId);
  checks.push(
    'Real R mount, W walk, Shift run, remote run synchronization, stop and R dismount passed',
  );
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await sleep(500);
    await shot(page, `06-${size.width}x${size.height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 120000,
  });
  await page.waitForFunction(() =>
    monsterReview?.mammoths.some((m) => m.id === 'mammoth-1' && m.actor),
  );
  checks.push(
    'Two Chrome pages + three sockets; five-player presence, rear views, portrait/landscape and reload passed',
  );
} catch (e) {
  errors.push('FAIL ' + (e.stack || e));
} finally {
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify({ checks, errors, screenshots }, null, 2),
  );
  for (const context of contexts) await context.close();
  for (const peer of peers) peer.close();
  if (child?.connected) await request('stop').catch(() => {});
}
console.log(JSON.stringify({ checks, errors: errors.slice(0, 5), screenshots }, null, 2));
process.exit(errors.length ? 1 : 0);
