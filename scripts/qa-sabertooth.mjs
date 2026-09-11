// Real-Chrome QA of the sabertooth enemy: two rendering pages plus three socket
// peers against an isolated in-memory server. Usage: node scripts/qa-sabertooth.mjs <out-dir>
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const KEY = 'sabertooth-tiger',
  ROOM = 'CAT-QA';
const out = path.resolve(process.argv[2] || 'output/playwright/sabertooth');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  checks = [],
  samples = [],
  screenshots = [];
let child,
  base,
  ready = false,
  rid = 0;
const pending = new Map(),
  peers = [],
  contexts = [];
const request = (kind, extra = {}) =>
  new Promise((resolve, reject) => {
    const id = ++rid;
    pending.set(id, { resolve, reject });
    child.send({ id, kind, ...extra });
  });
async function until(fn, label, limit = 20000) {
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
async function sample(page, stage) {
  const data = await page.evaluate((KEY) => {
    const r = window.monsterReview,
      e = [...r.enemies.values()].find((e) => e.state.modelKey === KEY);
    return {
      at: r.serverNow(),
      fps: r.canvas?.dataset?.fps,
      enemy: e
        ? {
            state: e.state,
            visible: e.model.visible,
            clip: e.actor?.name,
            hash: e.actor?.asset.sha256,
          }
        : null,
      players: r.players.size,
      diagnostics: document.querySelector('#world').dataset.enemyAnimations,
    };
  }, KEY);
  samples.push({ stage, ...data });
  return data;
}
async function look(page, distance = 9) {
  await page.evaluate(
    ({ KEY, distance }) => {
      const r = window.monsterReview;
      const p = r.players.get(r.selfId)?.state;
      const e = [...r.enemies.values()].find((e) => e.state.modelKey === KEY)?.state;
      r.yaw = p && e ? Math.atan2(p.x - e.x, p.z - e.z) : 0;
      r.pitch = 0.2;
      r.distance = distance;
      r.targetDistance = distance;
    },
    { KEY, distance },
  );
}
async function play(name, species) {
  const context = await chromium.launchPersistentContext(path.join(out, name.replaceAll(' ', '-')), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [
      '--use-angle=d3d11',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  contexts.push(context);
  const page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(
    ({ name, species }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', species);
      localStorage.setItem('cro-gender', 'female');
    },
    { name, species },
  );
  await page.goto(base + '/?room=' + ROOM);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill(name);
  await page.locator('#setup-submit').click();
  await page.locator('#guide-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => page.evaluate(() => !!window.monsterReview?.selfId), 'renderer');
  return page;
}
const enemyLoaded = (page) =>
  page.evaluate(
    (KEY) =>
      [...window.monsterReview.enemies.values()].some(
        (e) => e.state.modelKey === KEY && e.actor && e.model.visible,
      ),
    KEY,
  );
async function watch(page, other, stage, count, ms = 200) {
  for (let i = 0; i < count; i++) {
    await sleep(ms);
    await sample(page, stage);
    if (other) await sample(other, stage);
  }
}
const energyA = async () => (await request('state')).players.find((p) => p.name === 'Monster A').energy;
try {
  child = fork(new URL('./qa-sabertooth-host.mjs', import.meta.url), [], {
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
  const a = await play('Monster A', 'cro'),
    b = await play('Monster B', 'ape');
  for (let i = 0; i < 3; i++) {
    const s = new WebSocket(
      base.replace('http:', 'ws:') +
        '/ws?' +
        new URLSearchParams({ room: ROOM, name: 'Peer ' + i, species: 'cro', gender: 'female' }),
    );
    await new Promise((r, j) => {
      s.once('open', r);
      s.once('error', j);
    });
    peers.push(s);
  }
  await request('prepare', { mode: 'guard' });
  await sleep(1800);
  await look(a);
  await look(b, 12);
  await until(() => enemyLoaded(a), 'enemy asset', 60000);
  await sample(a, 'guard');
  await sample(b, 'guard');
  await shot(a, '01-guard');
  await shot(b, '01-guard-ape');
  assert.equal((await request('state')).count, 5);
  checks.push('Five connected players, two actual Chrome pages render the sabertooth on the snow plain south of the camp');
  await request('prepare', { mode: 'rear' });
  await sleep(1500);
  assert.equal((await request('state')).enemy.targetId, null);
  await sample(a, 'rear');
  checks.push('Rear approach beyond hearing range stays undetected');
  // Full hunt in real time from 14 m: roar, sprint, then a pounce or claw lands.
  await request('prepare', { mode: 'hunt' });
  await sleep(150);
  await sample(a, 'hunt');
  await look(a, 11);
  await sleep(150);
  // Sample before each screenshot: one can take ~0.5 s, as long as the roar.
  await sample(a, 'hunt');
  await shot(a, '02-alert');
  await watch(a, b, 'hunt', 22);
  assert.ok((await energyA()) < 100, 'hunt damage');
  checks.push('Roar telegraph, real-time sprint and a landed strike from 14 m');
  await request('prepare', { mode: 'pounce' });
  await sleep(200);
  await look(a, 10);
  await sleep(300);
  await sample(a, 'pounce');
  await shot(a, '03-crouch');
  await sleep(450);
  await sample(a, 'pounce');
  await shot(a, '03-leap');
  await watch(a, b, 'pounce', 8);
  assert.ok((await energyA()) < 100, 'pounce damage');
  checks.push('Pounce from 7 m: crouch, leap and a single hit in actual server time');
  await request('prepare', { mode: 'claw' });
  await sleep(250);
  await look(a, 7);
  await sleep(200);
  await shot(a, '04-claw');
  await watch(a, b, 'claw', 8);
  const e2 = await energyA();
  assert.ok(e2 <= 100 - 2 * 16, 'two claw swipes');
  checks.push('Claw combo: two separate swipes both connected');
  // Real attack key: the held-back cat must side-step and the thrust must miss.
  await request('prepare', { mode: 'step' });
  await sleep(400);
  await look(a, 7);
  await a.locator('#world').focus();
  const healthBefore = (await request('state')).enemy.health;
  await a.keyboard.press('f');
  await sleep(120);
  await sample(a, 'step');
  await sleep(80);
  await shot(a, '05-step');
  await watch(a, b, 'step', 5, 100);
  const afterStep = await request('state');
  assert.ok(
    afterStep.players.find((p) => p.name === 'Monster A').pendingStrike === null ||
      (await request('state')).players.find((p) => p.name === 'Monster A').pendingStrike === null,
  );
  assert.equal(afterStep.enemy.health, healthBefore);
  assert.ok(samples.some((s) => s.stage === 'step' && s.enemy?.clip === 'Step'), 'Step rendered');
  checks.push('Real F-key thrust: the cat side-steps and takes no damage');
  for (const clip of ['Alert', 'Run_Loop', 'Pounce', 'Attack', 'Step']) {
    assert.ok(
      samples.some((s) => s.enemy?.clip === clip && s.enemy.visible),
      clip + ' rendered',
    );
  }
  assert.ok(
    samples.some((s) => s.stage === 'pounce' && ['crouch', 'pounce', 'land'].includes(s.enemy?.state.behavior)),
    'pounce phases observed',
  );
  await request('escape');
  await sleep(200);
  assert.equal((await request('state')).enemy.targetId, null);
  checks.push('Leaving the territory cancels the hunt');
  await request('prepare', { mode: 'return' });
  await sleep(600);
  await sample(a, 'return');
  await until(
    async () => {
      const e = (await request('state')).enemy;
      return Math.hypot(e.x - e.home.x, e.z - e.home.z) < 0.01;
    },
    'home return',
    20000,
  );
  checks.push('Walks back to its exact post');
  await request('prepare', { mode: 'guard' });
  await sleep(800);
  await look(a);
  await a.locator('#world').focus();
  const before = await request('state');
  await a.keyboard.down('w');
  await sleep(500);
  await a.keyboard.up('w');
  await sleep(250);
  const after = await request('state');
  assert.ok(
    Math.hypot(before.players[0].x - after.players[0].x, before.players[0].z - after.players[0].z) > 0.1,
  );
  checks.push('Real keyboard movement with the enemy present');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.setViewportSize({ width, height });
    await sleep(600);
    await shot(a, `06-${width}x${height}`);
    await sample(a, 'responsive');
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.reload();
  await a.locator('#title-start').click();
  await a.locator('#world[data-world-asset="ready"]').waitFor({ timeout: 120000 });
  await sleep(800);
  await sample(a, 'reload');
  checks.push('Reload resumes and mobile viewport dimensions render');
  await until(() => enemyLoaded(a), 'enemy asset after reload', 60000);
  await request('prepare', { mode: 'death' });
  await sleep(600);
  await look(a, 8);
  await sleep(200);
  await sample(a, 'death');
  await shot(a, '07-death');
  assert.ok(samples.some((s) => s.stage === 'death' && s.enemy?.clip === 'Death'), 'Death rendered');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify(
      {
        checks,
        errors,
        samples,
        screenshots,
        fixtures:
          'Profiles, initial proximity, selected engagement states and death are explicit QA fixtures. Attack timing, movement, side-step, rendering and damage run in real time; the step and walk use real key presses. Three peers are socket-only. No physical-device claim.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, screenshots }));
} finally {
  for (const s of peers) s.close();
  for (const context of contexts) await context.close();
  if (child?.connected) await request('stop');
}
