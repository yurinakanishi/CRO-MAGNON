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
  poisonFrames = [],
  screenshots = [];
let child,
  base,
  tuning,
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
      poisonShots: r.state.poisonShots?.length ?? 0,
      poisonSplashes: r.state.poisonSplashes?.length ?? 0,
      poisonParticles: r.spells.poison.count,
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
  await page.waitForSelector('body.in-game', { timeout: 60000 });
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
      tuning = m.tuning;
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
  const palette = await a.evaluate(() => {
    const e = [...window.monsterReview.enemies.values()].find(
      (e) => e.state.modelKey === 'violet-behemoth',
    );
    const keys = [];
    e.actor.root.traverse((n) => {
      if (n.isMesh) for (const m of [n.material].flat()) keys.push(m.customProgramCacheKey());
    });
    return keys;
  });
  assert.ok(palette.length && palette.every((key) => key === 'violet-behemoth-palette-1'));
  checks.push('Verified quadruped uses the skin-only purple palette in actual Chrome');
  await request('prepare', { mode: 'patrol' });
  await sleep(300);
  await look(a);
  await look(b);
  const patrol = [];
  for (let i = 0; i < 72; i++) {
    await sleep(500);
    const state = await request('state');
    patrol.push(state.enemy);
    assert.equal(state.enemy.targetId, null);
    assert.ok(
      Math.hypot(state.enemy.x - state.enemy.home.x, state.enemy.z - state.enemy.home.z) +
        state.enemy.radius <
        tuning.territoryRadius,
    );
    assert.ok(
      state.players.every(
        (p) =>
          Math.hypot(p.x - state.enemy.home.x, p.z - state.enemy.home.z) > tuning.territoryRadius,
      ),
    );
    await sample(a, 'patrol');
    if (i % 12 === 0) {
      await sample(b, 'patrol');
      await look(a);
      await look(b);
      await shot(a, `01-patrol-${i}`);
    }
  }
  const patrolDistance = patrol
    .slice(1)
    .reduce((sum, e, i) => sum + Math.hypot(e.x - patrol[i].x, e.z - patrol[i].z), 0);
  assert.ok(patrolDistance > 17, `patrolled ${patrolDistance}m in the real game`);
  assert.ok(patrol.some((e) => e.clip === 'Walk_Loop' && e.speed > 0.5));
  assert.ok(patrol.some((e) => e.clip === 'Idle_Loop'));
  assert.ok(patrol.at(-1).patrolStep >= 2);
  checks.push(
    `No characters in territory: ${patrolDistance.toFixed(1)}m of slow patrol, with short rests and multiple destinations`,
  );
  await request('prepare', { mode: 'rear' });
  await sleep(1500);
  assert.equal((await request('state')).enemy.targetId, null);
  checks.push('A stationary player behind the monster beyond contact range stays undetected');
  await sample(a, 'rear');
  for (const mode of ['charge', 'bite', 'tail', 'poison']) {
    await request('prepare', { mode });
    // Sample short telegraphs before spending time framing a screenshot.
    await sleep(120);
    await sample(a, mode);
    await sleep(130);
    await look(a);
    await look(b);
    await sleep(mode === 'charge' ? 400 : 150);
    await shot(a, '02-' + mode);
    await sample(a, mode);
    await sample(b, mode);
    for (let i = 0; i < 32; i++) {
      await sleep(110);
      await sample(a, mode);
      await sample(b, mode);
      if (
        mode === 'poison' &&
        samples.at(-1).poisonShots > 0 &&
        !screenshots.some((s) => s.endsWith('02-poison-flight.png'))
      )
        await shot(b, '02-poison-flight');
    }
    const state = await request('state');
    assert.ok(state.players.find((p) => p.name === 'Monster A').energy < 100, mode + ' damage');
    checks.push(mode + ' damage observed in actual server time');
  }
  // 2026-09-12: every strike opens with its telegraph clip.
  for (const clip of [
    'Roar',
    'Charge',
    'Gape',
    'Attack',
    'Tremble',
    'TailSpin',
    'SpitWindup',
    'Spit',
  ]) {
    assert.ok(
      samples.some((s) => s.enemy?.clip === clip && s.enemy.visible),
      clip + ' rendered',
    );
  }
  // The flight screenshot can take longer than the entire splash lifetime.
  // Observe actual effect updates in each browser, independently of screenshots.
  for (const page of [a, b])
    poisonFrames.push(...(await page.evaluate(() => window.poisonReviewFrames)));
  assert.ok(
    poisonFrames.some((s) => s.shots > 0 && s.particles > 10),
    'Liquid flight rendered',
  );
  assert.ok(
    poisonFrames.some((s) => s.splashes > 0 && s.particles > 0),
    'Liquid impact rendered',
  );
  for (const retreat of [false, true]) {
    const staged = await request('prepare', { mode: 'charge' });
    const start = { x: staged.enemy.x, z: staged.enemy.z };
    await until(
      async () => {
        const s = await request('state');
        return s.enemy.behavior === 'charge' && s.enemy.z > start.z + 0.1;
      },
      'rush actually moving before target dodges or retreats',
      4000,
    );
    await request('place', {
      x: start.x + (retreat ? 0 : 12),
      z: start.z + (retreat ? 25 : 12),
    });
    const trace = [];
    await until(
      async () => {
        const s = await request('state');
        trace.push({
          x: s.enemy.x,
          z: s.enemy.z,
          speed: s.enemy.speed,
          behavior: s.enemy.behavior,
        });
        return s.enemy.behavior === 'recover';
      },
      retreat ? 'rush reaches retreating player' : 'rush brakes after passing player',
      2500,
    );
    const stopped = await request('state');
    const distance = stopped.enemy.z - start.z;
    assert.ok(retreat ? distance > 18 && distance < 20 : distance > 13.5 && distance < 15.5);
    assert.equal(
      stopped.players.find((p) => p.name === 'Monster A').energy,
      retreat ? 100 - tuning.chargeDamage : 100,
    );
    const stage = retreat ? 'charge-retreat' : 'charge-pass-stop';
    await sample(a, stage);
    samples.push({ stage: stage + '-server-trace', trace });
    checks.push(
      retreat
        ? 'Rush reaches the player retreating beyond their original position'
        : 'Rush brakes shortly after passing a sidestepping player',
    );
  }
  await request('prepare', { mode: 'poison' });
  await sleep(1150);
  const dodgeState = await request('state'),
    dodgePlayer = dodgeState.players.find((p) => p.name === 'Monster A');
  await request('place', { x: dodgePlayer.x + 4, z: dodgePlayer.z });
  await sleep(1800);
  assert.equal((await request('state')).players.find((p) => p.name === 'Monster A').energy, 100);
  checks.push('Poison aim locks before release; side step avoids damage');
  // The HUD discovery card was retired; the telegraph and charge cues are
  // checked on the authoritative state the pages rendered from.
  assert.ok(
    samples.some(
      (s) => s.stage === 'charge' && ['roar', 'charge'].includes(s.enemy?.state.behavior),
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
  const homeState = await request('state'),
    home = homeState.enemy;
  await request('place', { x: home.x, z: home.z + 12 });
  await sleep(120);
  await look(a);
  await a.locator('#world').focus();
  await a.keyboard.down('w');
  try {
    await until(
      async () => {
        const s = await request('state');
        return s.enemy.targetId === s.players.find((p) => p.name === 'Monster A').id;
      },
      'rear footsteps after return',
      2500,
    );
  } finally {
    await a.keyboard.up('w');
  }
  await sample(a, 'rear-footsteps-after-return');
  checks.push('Real W footsteps from behind reacquire after a complete leash return');
  await request('escape');
  await until(
    async () => {
      const e = (await request('state')).enemy;
      return !e.returning && e.behavior === 'guard';
    },
    'second return',
    15000,
  );
  const rearHome = (await request('state')).enemy;
  await request('place', {
    player: 'Monster B',
    x: rearHome.x,
    z: rearHome.z + 7,
    facing: Math.PI,
    vulnerable: true,
  });
  await sleep(120);
  await look(b);
  await b.locator('#world').focus();
  assert.equal(
    (await request('state')).enemy.targetId,
    null,
    'stationary spearman outside contact remains unseen behind',
  );
  await b.keyboard.press('f');
  await until(
    async () => {
      const s = await request('state');
      return (
        s.enemy.health < rearHome.health &&
        s.enemy.targetId === s.players.find((p) => p.name === 'Monster B').id
      );
    },
    'real rear spear hit retaliation',
    2500,
  );
  await sample(b, 'rear-hit-after-return');
  await shot(b, '02-rear-hit-retaliation');
  checks.push('Real F spear hit from behind immediately reacquires after the second return');
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
        tuning,
        checks,
        errors,
        samples,
        poisonFrames,
        screenshots,
        fixtures:
          'Profiles, initial proximity, selected attack state and death are explicit QA fixtures. Attack timing, movement, rendering and damage run in real time. Three peers are socket-only. No physical-device claim.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, screenshots }));
} catch (error) {
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: String(error), checks, errors, samples }, null, 2),
  );
  throw error;
} finally {
  for (const s of peers) s.close();
  for (const context of contexts) await context.close();
  if (child?.connected) await request('stop');
}
