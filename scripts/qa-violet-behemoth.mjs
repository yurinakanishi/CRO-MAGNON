import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/violet-behemoth');
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
  const data = await page.evaluate(() => {
    const r = window.monsterReview,
      e = [...r.enemies.values()].find((e) => e.state.modelKey === 'violet-behemoth');
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
  });
  samples.push({ stage, ...data });
  return data;
}
async function look(page) {
  await page.evaluate(() => {
    const r = window.monsterReview;
    const p = r.players.get(r.selfId)?.state;
    const e = [...r.enemies.values()].find((e) => e.state.modelKey === 'violet-behemoth')?.state;
    r.yaw = p && e ? Math.atan2(p.x - e.x, p.z - e.z) : 0;
    r.pitch = 0.23;
    r.distance = 9;
    r.targetDistance = 9;
  });
}
async function play(name, species) {
  const context = await chromium.launchPersistentContext(
    path.join(out, name.replaceAll(' ', '-')),
    {
      channel: 'chrome',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [
        '--use-angle=d3d11',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  );
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
  await page.goto(base + '/?room=BEHEMOTH-QA');
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
  const a = await play('Monster A', 'ape'),
    b = await play('Monster B', 'cro');
  for (let i = 0; i < 3; i++) {
    const s = new WebSocket(
      base.replace('http:', 'ws:') +
        '/ws?' +
        new URLSearchParams({
          room: 'BEHEMOTH-QA',
          name: 'Peer ' + i,
          species: 'cro',
          gender: 'female',
        }),
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
  await look(b);
  await until(
    () =>
      a.evaluate(() =>
        [...window.monsterReview.enemies.values()].some(
          (e) => e.state.modelKey === 'violet-behemoth' && e.actor,
        ),
      ),
    'enemy asset',
  );
  await sample(a, 'guard');
  await sample(b, 'guard');
  await shot(a, '01-scale-ape');
  await shot(b, '01-side-tail');
  assert.equal((await request('state')).count, 5);
  checks.push('Five connected players, two actual Chrome pages render the enemy');
  await request('prepare', { mode: 'rear' });
  await sleep(1500);
  assert.equal((await request('state')).enemy.targetId, null);
  checks.push('Rear approach remains undetected');
  await sample(a, 'rear');
  for (const mode of ['charge', 'bite', 'tail']) {
    await request('prepare', { mode });
    // The 0.7 s telegraph is sampled before framing the shot, which takes longer than that.
    await sleep(120);
    await sample(a, mode);
    await sleep(130);
    await look(a);
    await look(b);
    await sleep(mode === 'charge' ? 400 : 150);
    await shot(a, '02-' + mode);
    await sample(a, mode);
    await sample(b, mode);
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      await sample(a, mode);
      await sample(b, mode);
    }
    const state = await request('state');
    assert.ok(state.players.find((p) => p.name === 'Monster A').energy < 100, mode + ' damage');
    checks.push(mode + ' damage observed in actual server time');
  }
  for (const clip of ['Alert', 'Charge', 'Attack', 'TailSpin']) {
    assert.ok(
      samples.some((s) => s.enemy?.clip === clip && s.enemy.visible),
      clip + ' rendered',
    );
  }
  // The HUD discovery card was retired; the telegraph and charge cues are
  // checked on the authoritative state the pages rendered from.
  assert.ok(
    samples.some(
      (s) => s.stage === 'charge' && ['alert', 'charge'].includes(s.enemy?.state.behavior),
    ),
    'charge telegraph observed',
  );
  await request('escape');
  await sleep(200);
  assert.equal((await request('state')).enemy.targetId, null);
  checks.push('Leaving the territory cancels pursuit');
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
  checks.push('Returns to exact home by movement');
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
    Math.hypot(before.players[0].x - after.players[0].x, before.players[0].z - after.players[0].z) >
      0.1,
  );
  checks.push('Real keyboard movement with enemy present');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await a.setViewportSize({ width, height });
    await sleep(600);
    await shot(a, `03-${width}x${height}`);
    await sample(a, 'responsive');
  }
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.reload();
  await a.locator('#title-start').click();
  await a.locator('#world[data-world-asset="ready"]').waitFor({ timeout: 120000 });
  await sleep(800);
  await sample(a, 'reload');
  checks.push('Reload resumes and mobile viewport dimensions render');
  // The reloaded page must have the enemy model back before the death fixture starts.
  await until(
    () =>
      a.evaluate(() =>
        [...window.monsterReview.enemies.values()].some(
          (e) => e.state.modelKey === 'violet-behemoth' && e.actor && e.model.visible,
        ),
      ),
    'enemy asset after reload',
  );
  await request('prepare', { mode: 'death' });
  await sleep(500);
  await sample(a, 'death');
  await shot(a, '04-death');
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
          'Profiles, initial proximity, selected attack state and death are explicit QA fixtures. Attack timing, movement, rendering and damage run in real time. Three peers are socket-only. No physical-device claim.',
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
