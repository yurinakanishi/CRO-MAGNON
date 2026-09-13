// Real-Chrome QA of the stepped temple-fortress (2026-09-13) and of the staged
// assault on the White-Feather cult: one rendering page against an isolated
// in-memory server (the behemoth fixture host, whose `place` command moves the
// reviewer and whose `crowFall` command fells a whole rank). Screenshots at
// the gate, the forecourt with the first rank, each terrace with its praying
// rank inside its veil, then each rank rising in turn: the hex monks' red
// spells on the middle terrace, the high priests taking flight on the third,
// and the pontiff on the summit altar.
// Usage: node scripts/qa-castle-ruin.mjs [out-dir]
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {
  CASTLE,
  CASTLE_GATE,
  CASTLE_HALL,
  CASTLE_SORCERER_POST,
  CASTLE_SUMMIT,
  CASTLE_TIERS,
  castleWorld,
} = await import('../dist/shared/castle-layout.mjs');
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
      e = r.enemies.get('crow-shaman-1');
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
      castleCrows: [...r.enemies.values()]
        .filter((e) => /^crow-(?:shaman|pontiff|prelate|brute|soldier)-\d+$/.test(e.state.id))
        .map((e) => ({
          id: e.state.id,
          x: e.state.x,
          z: e.state.z,
          y: e.model.position.y,
          visible: e.model.visible,
          clip: e.actor?.name,
          role: e.state.crowRole,
          tier: e.state.crowTier,
          sealed: e.state.sealed,
          sealRing: !!e.seal?.visible,
          behavior: e.state.behavior,
          phase: e.state.phase,
          health: e.state.health,
          distance: me ? Math.hypot(e.state.x - me.state.x, e.state.z - me.state.z) : null,
          airborneHeight: e.state.airborneHeight,
          decorated: !!e.actor?.root.getObjectByName(
            {
              pontiff: 'CrowPontiffCrown',
              prelate: 'CrowPrelateMantle',
              shaman: 'CrowShamanFocus',
              brute: 'CrowBruteAxe',
              soldier: 'CrowSoldierShield',
            }[e.state.crowRole],
          ),
        })),
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
    args: [
      '--use-angle=d3d11',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
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
  await place(page, castleWorld(-2, 72));
  await lookAt(page, castleWorld(0, 30), 14, 0.3);
  await until(
    () => page.evaluate(() => Number(document.querySelector('#world').dataset.landmarks || 0) > 0),
    'castle landmark',
    90000,
  );
  await sleep(2500);
  await sample(page, 'gate');
  await shot(page, '01-gate');
  checks.push('The fortress loads as an on-demand landmark and is drawn from outside the gate');
  // Forecourt, looking up the grand stair to the first terrace.
  await place(page, castleWorld(0, 46));
  await lookAt(page, castleWorld(0, 20), 12, 0.25);
  await sleep(800);
  await until(
    () =>
      page.evaluate(
        () =>
          [...window.monsterReview.enemies.values()].filter(
            (e) => e.state.crowRole === 'soldier' && e.actor,
          ).length === 12,
      ),
    'first rank models',
    120000,
  );
  await sleep(1000);
  const forecourt = await sample(page, 'forecourt');
  await shot(page, '02-forecourt-stair');
  const rankOf = (crows, role) => crows.filter((crow) => crow.role === role);
  assert.equal(forecourt.castleCrows.length, 28, 'all 28 faction members are synchronized');
  for (const crow of forecourt.castleCrows) {
    assert.equal(crow.tier, { soldier: 1, brute: 2, shaman: 3, prelate: 4, pontiff: 5 }[crow.role]);
    assert.equal(crow.sealed, crow.role !== 'soldier', `${crow.id} sealed=${crow.sealed}`);
  }
  for (const crow of rankOf(forecourt.castleCrows, 'soldier')) {
    assert.ok(crow.visible && crow.clip && crow.decorated, `${crow.id} is drawn in the forecourt`);
    assert.ok(Math.abs(crow.y - forecourt.me.y) < 1.5, `${crow.id} stands on the forecourt`);
    assert.ok(!crow.sealRing, `${crow.id} has no seal`);
  }
  checks.push('Rank 1 (12 followers) stands awake in the forecourt; every higher rank is sealed');
  // Halfway up the first grand stair.
  await place(page, castleWorld(0, 32));
  await lookAt(page, castleWorld(0, 10), 9, 0.3);
  await sleep(800);
  const stair = await sample(page, 'stair');
  await shot(page, '03-central-stair');
  assert.ok(stair.me.y > forecourt.me.y + 1.5, 'the stair carries the body upward');
  checks.push('Forecourt at valley level, the grand stair climbs toward the first terrace');
  // The first terrace: the warrior monks pray on it; the second terrace ahead.
  await place(page, castleWorld(0, 23));
  await lookAt(page, castleWorld(0, 5), 20, 0.35);
  await until(
    () =>
      page.evaluate(
        () =>
          [...window.monsterReview.enemies.values()]
            .filter((e) => /^crow-(?:shaman|pontiff|prelate|brute|soldier)-\d+$/.test(e.state.id))
            .filter((e) => e.actor).length === 28,
      ),
    'all crow faction models',
    120000,
  );
  await sleep(1000);
  const hall = await sample(page, 'hall');
  await shot(page, '04-first-terrace');
  assert.ok(
    hall.me.y > forecourt.me.y + 8,
    `first terrace is a level up (${hall.me.y - forecourt.me.y})`,
  );
  assert.ok(hall.enemy, 'the first hex monk is synchronized');
  assert.equal(hall.castleCrows.length, 28, 'all 28 faction members are synchronized');
  assert.deepEqual(
    Object.fromEntries(
      ['pontiff', 'prelate', 'shaman', 'brute', 'soldier'].map((role) => [
        role,
        hall.castleCrows.filter((crow) => crow.role === role).length,
      ]),
    ),
    { pontiff: 1, prelate: 3, shaman: 6, brute: 6, soldier: 12 },
  );
  for (const crow of hall.castleCrows) {
    if (crow.role === 'soldier') continue;
    // Every upper rank still prays: sealed, grounded, inside its veil.
    assert.equal(crow.sealed, true, `${crow.id} prays behind the seal`);
    assert.equal(crow.behavior, 'pray');
    assert.ok(crow.airborneHeight < 0.01, `${crow.id} is grounded while praying`);
    if (crow.role === 'brute') {
      assert.ok(
        crow.visible && crow.clip && crow.decorated,
        `${crow.id} is drawn on the first terrace`,
      );
      assert.ok(crow.sealRing, `${crow.id} shows its veil`);
      assert.ok(Math.abs(crow.y - hall.me.y) < 1.5, `${crow.id} stands on the first terrace`);
    }
  }
  await lookAt(page, castleWorld(-10, 24), 6, 0.35);
  await sleep(600);
  await shot(page, '04b-sealed-warrior-monks');
  checks.push('The first terrace shows rank 2 praying inside red veils, grounded and still');
  // Rank 2 opens once every follower has fallen; the reviewer beside a monk is then noticed.
  await request('crowFall', { roles: ['soldier'] });
  await until(
    () =>
      page.evaluate(() =>
        [...window.monsterReview.enemies.values()]
          .filter((e) => e.state.crowRole === 'brute')
          .every((e) => e.state.sealed === false),
      ),
    'rank 2 opens',
  );
  await sleep(700);
  const rank2 = await sample(page, 'rank2');
  await shot(page, '04c-rank2-awake');
  assert.ok(rankOf(rank2.castleCrows, 'brute').every((c) => !c.sealed && !c.sealRing));
  assert.ok(rankOf(rank2.castleCrows, 'shaman').every((c) => c.sealed && c.sealRing));
  checks.push('Felling rank 1 lifts the seal from rank 2 only; rank 3 keeps praying');
  // Rank 3: the hex monks on the middle terrace. Fell rank 2 and fight crow-shaman-1.
  await request('crowFall', { roles: ['brute'] });
  await until(
    () =>
      page.evaluate(
        () => window.monsterReview.enemies.get('crow-shaman-1')?.state.sealed === false,
      ),
    'rank 3 opens',
  );
  // Approach to bolt range on the middle terrace and watch the red spells in server time.
  await place(page, castleWorld(-21, 7));
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
      await place(page, castleWorld(-25.8, 7));
      await lookAt(page, CASTLE_SORCERER_POST, 7, 0.25);
    }
  }
  assert.ok(stages.bolt, 'the sorcerer cast a red bolt');
  assert.ok(stages.bolts > 0, 'a hex bolt flew in the snapshot');
  assert.ok(stages.burst, 'the sorcerer cast the area burst');
  assert.ok(stages.bursts > 0, 'the burst ring telegraph was in the snapshot');
  checks.push('Rank 3: both red spells (bolt and area burst) were cast, telegraphed and rendered');
  // Rank 4: the high priests on the third terrace take flight once the hex monks have fallen.
  await request('crowFall', { roles: ['shaman'] });
  await place(page, castleWorld(-2, -4));
  await lookAt(page, castleWorld(-22, -6), 14, 0.2);
  await until(
    () =>
      page.evaluate(() =>
        [...window.monsterReview.enemies.values()]
          .filter((e) => e.state.crowRole === 'prelate')
          .every((e) => e.state.sealed === false && e.state.airborneHeight > 2),
      ),
    'rank 4 flies',
  );
  await sleep(800);
  const rank4 = await sample(page, 'rank4');
  await shot(page, '07-rank4-high-priests-fly');
  for (const crow of rankOf(rank4.castleCrows, 'prelate'))
    assert.ok(crow.y > rank4.me.y + 1.8, `${crow.id} is visibly above the hall floor`);
  assert.ok(rankOf(rank4.castleCrows, 'pontiff').every((c) => c.sealed && c.sealRing));
  checks.push('Rank 4: the three high priests rise into the air; the pontiff still prays');
  // Rank 5: the pontiff on the summit altar.
  await request('crowFall', { roles: ['prelate'] });
  const pontiffPost = CASTLE_SUMMIT;
  await place(page, castleWorld(-10, -12));
  await lookAt(page, pontiffPost, 9, 0.2);
  const pontiffStages = { engaged: false, behaviors: new Set() };
  let shotPontiff = false;
  for (let i = 0; i < 80 && !shotPontiff; i++) {
    await sleep(120);
    const s = await sample(page, 'pontiff');
    const pontiff = rankOf(s.castleCrows, 'pontiff')[0];
    pontiffStages.behaviors.add(pontiff.behavior);
    if (!pontiff.sealed && ['bolt', 'burst', 'attack', 'chase'].includes(pontiff.behavior)) {
      pontiffStages.engaged = true;
      await sleep(500);
      await shot(page, '08-rank5-pontiff');
      shotPontiff = true;
    }
  }
  assert.ok(pontiffStages.engaged, `pontiff behaviors ${[...pontiffStages.behaviors]}`);
  const summit = await sample(page, 'summit');
  assert.ok(
    summit.me.y > forecourt.me.y + 27,
    `the summit is the top of the keep (${summit.me.y - forecourt.me.y})`,
  );
  checks.push('Rank 5: the pontiff, unsealed, engages the reviewer on the summit altar');
  // The pontiff falls: the rite ends and the whole cult is gone until it re-forms.
  await request('crowFall', { roles: ['pontiff'] });
  await sleep(400);
  const silence = await request('state');
  assert.ok(
    silence.enemies
      .filter((e) => /^crow-(?:shaman|pontiff|prelate|brute|soldier)-\d+$/.test(e.id))
      .every((e) => e.phase === 'respawning'),
    'every rank is down after the pontiff falls',
  );
  checks.push('After the pontiff falls every rank stays down (the congregation re-forms later)');
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
