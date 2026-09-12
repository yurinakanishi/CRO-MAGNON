// Real-Chrome QA of the rebuilt castle ruin (2026-09-12): one rendering page
// against an isolated in-memory server (the behemoth fixture host, whose
// `place` command moves the reviewer). Screenshots at the gate, the central
// stair and the great hall, then the sorcerer's red spells sampled in server time.
// Usage: node scripts/qa-castle-ruin.mjs [out-dir]
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { CASTLE, CASTLE_GATE, CASTLE_HALL, CASTLE_SORCERER_POST, castleWorld } = await import(
  '../dist/shared/castle-layout.mjs'
);
const { ENEMY_RULES } = await import('../dist/shared/enemies.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/castle-ruin');
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
  contexts = [];
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
async function sample(page, stage) {
  const data = await page.evaluate(() => {
    const r = window.monsterReview,
      me = r.players.get(r.selfId),
      e = [...r.enemies.values()].find((e) => e.state.modelKey === 'crow-shaman');
    return {
      at: r.serverNow(),
      me: me
        ? { x: me.state.x, z: me.state.z, y: me.model.position.y, energy: me.state.energy }
        : null,
      enemy: e
        ? {
            x: e.state.x,
            z: e.state.z,
            y: e.model.position.y,
            behavior: e.state.behavior,
            clip: e.actor?.name,
            visible: e.model.visible,
            targetId: e.state.targetId,
            hash: e.actor?.asset.sha256,
          }
        : null,
      hexBursts: (r.state.hexBursts || []).length,
      hexBolts: (r.state.projectiles || []).filter((p) => p.kind === 'hex').length,
      landmarks: document.querySelector('#world').dataset.landmarks,
    };
  });
  samples.push({ stage, ...data });
  return data;
}
async function lookAt(page, target, distance = 9, pitch = 0.22) {
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
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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
  // Outside the gate: the ruin loads on demand once the camera is near it.
  await place(page, castleWorld(-9, 52));
  await lookAt(page, CASTLE_HALL, 14, 0.3);
  await until(
    () => page.evaluate(() => Number(document.querySelector('#world').dataset.landmarks || 0) > 0),
    'castle landmark',
    90000,
  );
  await sleep(2500);
  await sample(page, 'gate');
  await shot(page, '01-gate');
  checks.push('The ruin loads as an on-demand landmark and is drawn from outside the gate');
  // Forecourt, looking up the central stair to the hall.
  await place(page, castleWorld(0, 22));
  await lookAt(page, castleWorld(0, 0), 12, 0.25);
  await sleep(800);
  const forecourt = await sample(page, 'forecourt');
  await shot(page, '02-forecourt-stair');
  // Halfway up the central stair.
  await place(page, castleWorld(0, 8));
  await lookAt(page, castleWorld(0, -10), 9, 0.3);
  await sleep(800);
  const stair = await sample(page, 'stair');
  await shot(page, '03-central-stair');
  assert.ok(stair.me.y > forecourt.me.y + 1.5, 'the stair carries the body upward');
  checks.push('Forecourt at valley level, the central stair climbs toward the hall');
  // The great hall: wide open floor, the sorcerer ahead.
  await place(page, castleWorld(0, -4));
  await lookAt(page, CASTLE_SORCERER_POST, 11, 0.35);
  await sleep(1000);
  const hall = await sample(page, 'hall');
  await shot(page, '04-great-hall');
  assert.ok(hall.me.y > forecourt.me.y + 5, `hall floor is a storey up (${hall.me.y - forecourt.me.y})`);
  assert.ok(hall.enemy?.visible, 'the sorcerer is drawn in the hall');
  assert.ok(Math.abs(hall.enemy.y - hall.me.y) < 1.5, 'the sorcerer stands on the same floor');
  checks.push('The roofless great hall is one storey up and the sorcerer waits on it');
  // Approach to bolt range and watch the red spells in server time.
  await place(page, {
    x: CASTLE_SORCERER_POST.x + 8,
    z: CASTLE_SORCERER_POST.z,
  });
  await lookAt(page, CASTLE_SORCERER_POST, 8, 0.2);
  const stages = { bolt: false, burst: false, bolts: 0, bursts: 0 };
  let shotBolt = false,
    shotBurst = false;
  for (let i = 0; i < 90 && !(stages.bolt && stages.burst); i++) {
    await sleep(120);
    const s = await sample(page, 'fight');
    if (s.enemy?.behavior === 'bolt') stages.bolt = true;
    if (s.enemy?.behavior === 'burst') stages.burst = true;
    stages.bolts = Math.max(stages.bolts, s.hexBolts);
    stages.bursts = Math.max(stages.bursts, s.hexBursts);
    if (s.enemy?.behavior === 'bolt' && !shotBolt) {
      shotBolt = true;
      await sleep(600);
      await shot(page, '05-red-bolt');
    }
    if (s.enemy?.behavior === 'burst' && !shotBurst) {
      shotBurst = true;
      await sleep(900);
      await shot(page, '06-red-burst-ring');
    }
    if (i === 30 && !stages.burst) {
      // Step inside burst range so the ring spell is used too.
      await place(page, { x: CASTLE_SORCERER_POST.x + 3.2, z: CASTLE_SORCERER_POST.z });
      await lookAt(page, CASTLE_SORCERER_POST, 7, 0.25);
    }
  }
  assert.ok(stages.bolt, 'the sorcerer cast a red bolt');
  assert.ok(stages.bolts > 0, 'a hex bolt flew in the snapshot');
  assert.ok(stages.burst, 'the sorcerer cast the area burst');
  assert.ok(stages.bursts > 0, 'the burst ring telegraph was in the snapshot');
  checks.push('Both red spells (bolt and area burst) were cast, telegraphed and rendered');
  const finalState = await request('state');
  const me = finalState.players.find((p) => p.name === 'Monster A');
  checks.push(`Reviewer energy after the exchange: ${me.energy}`);
  await sleep(300);
} catch (e) {
  errors.push('FAIL ' + (e.stack || e));
} finally {
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify(
      {
        castle: { url: CASTLE.key, groundOffset: CASTLE.groundOffset, clearance: CASTLE.clearance },
        rules: { boltRange: ENEMY_RULES.boltRange, burstRadius: ENEMY_RULES.burstRadius },
        checks,
        errors,
        samples,
        screenshots,
      },
      null,
      2,
    ),
  );
  for (const context of contexts) await context.close();
  if (child?.connected) await request('stop').catch(() => {});
}
console.log(JSON.stringify({ checks, errors: errors.slice(0, 5), screenshots }, null, 2));
process.exit(errors.length ? 1 : 0);
