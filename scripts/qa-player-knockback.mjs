// Real-Chrome player knockback QA (2026-10-12): in a memory-only LOCAL_VERIFY world (the
// user's servers are never touched) two players in separate browser contexts stand face to
// face. The attacker presses F (real keyboard input); both pages record, frame by frame, how
// the struck player's body is drawn (position, tilt) and the server's own state is sampled
// every few milliseconds. Three more WebSocket players join, so the room holds five and every
// client must receive the slide. Placement and camera angles are preparation values.
// Usage: node scripts/qa-player-knockback.mjs <outDir> [--attacker cro-male] [--victim cro-female]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { damageableTargets, stopActor } from '../dist/shared/combat.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { caveInteriorWeight } from '../dist/shared/cave-light.mjs';
import { KNOCKBACK, knockbackScale } from '../dist/shared/knockback.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const out = path.resolve(process.argv[2] || `output/playwright/player-knockback/${Date.now()}`);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const attackerCharacter = option('--attacker', 'cro-male');
const victimCharacter = option('--victim', 'cro-female');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(20);
  }
}

// The renderer of each page, exposed as the other QA hosts do, plus a per-frame hook. The
// entry module is extended in transit; the document itself is served unchanged.
const PATCH = `import { WorldRenderer as ReviewedRenderer } from './world3d.js';
{
  const render = ReviewedRenderer.prototype.render;
  ReviewedRenderer.prototype.render = function (...args) {
    window.kbReview = this;
    const value = render.apply(this, args);
    try { window.kbFrameHook?.(this); } catch (error) { window.kbFrameHook = null; console.error(error); }
    return value;
  };
}
`;

const settings = localVerificationSettings(out);
const game = createGameServer({ ...settings, port: 0 });
const { port } = await game.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
});
const errors = [];
const facts = {
  date: new Date().toISOString(),
  attackerCharacter,
  victimCharacter,
  viewport: [1280, 800],
  rounds: [],
};
const bots = [];

async function enter(name, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = { id: null };
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (m.type === 'welcome') seen.id = m.id;
      } catch {}
    }),
  );
  await page.route(
    (url) => url.pathname === '/src/boot.js',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        status: 200,
        body: PATCH + (await response.text()),
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  );
  await page.addInitScript((n) => localStorage.setItem('cro-name', n), name);
  await page.goto(`${base}/`);
  await page.locator('#title-start').click();
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 180000 });
  await page.locator('[data-cave-proceed]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(
    () => seen.id && game.rooms.get(settings.runtimeConfig.room)?.players.has(seen.id),
    `${name} joined`,
  );
  await until(() => page.evaluate(() => !!window.kbReview?.selfId), `${name} renderer`);
  return { name, context, page, id: seen.id };
}

function bot(name) {
  return new Promise((resolve, reject) => {
    const url = new URL(`ws://127.0.0.1:${port}/ws`);
    for (const [key, value] of Object.entries({
      room: settings.runtimeConfig.room,
      name,
      species: 'cro',
      gender: 'male',
      resume: '1',
    }))
      url.searchParams.set(key, value);
    const ws = new WebSocket(url);
    const record = { name, ws, id: null, states: 0, knockbacks: new Map() };
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'welcome') {
        record.id = m.id;
        resolve(record);
      }
      if (m.type === 'state') {
        record.states++;
        for (const p of m.players)
          if (p.knockbackSequence)
            record.knockbacks.set(p.id, { sequence: p.knockbackSequence, energy: p.energy });
      }
    });
    ws.on('error', reject);
  });
}

try {
  const attacker = await enter('QA Attacker', attackerCharacter);
  const victim = await enter('QA Victim', victimCharacter);
  for (const name of ['QA Bot 3', 'QA Bot 4', 'QA Bot 5']) bots.push(await bot(name));
  const room = game.rooms.get(settings.runtimeConfig.room);
  assert.equal(room.players.size, 5);
  facts.players = room.players.size;
  // Nothing hostile may interfere with the measured exchange.
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  const A = () => room.players.get(attacker.id),
    V = () => room.players.get(victim.id);
  facts.environment = await attacker.page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio,
    renderer: (() => {
      const gl = window.kbReview.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })(),
  }));

  // An open, level stretch near the camp: the whole slide is free for the victim's body, the
  // side camera (CAMERA, on the -X side) sees both bodies over open ground, and no companion,
  // animal or resident is near enough to take the blow or block the slide.
  const profile = attackProfile(A());
  const slide = profile.knockback * knockbackScale(V().radius);
  const gap = A().radius + V().radius + 0.75;
  const creatures = damageableTargets(room).map(({ target }) => target);
  const CAMERA = { yaw: -Math.PI / 2, pitch: 0.22, distance: 6.5 };
  const cameraSide = (p) => ({
    x: p.x + Math.sin(CAMERA.yaw) * 7,
    z: p.z + Math.cos(CAMERA.yaw) * 7,
  });
  let spot = null;
  for (let r = 8; r <= 40 && !spot; r += 1)
    for (let i = 0; i < 24 && !spot; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const a = { x: room.camp.x + Math.cos(angle) * r, z: room.camp.z + Math.sin(angle) * r };
      const v = { x: a.x, z: a.z + gap },
        end = { x: a.x, z: v.z + slide + 0.6 };
      const level = [a, v, end, cameraSide(a), cameraSide(end)].map((p) =>
        room.collision.surfaceHeight(p),
      );
      if (
        room.collision.segmentFree({ x: a.x, z: a.z - 1 }, end, 1.2) &&
        [a, v, end].every((p) => room.collision.segmentFree(p, cameraSide(p), 0.6)) &&
        Math.max(...level) - Math.min(...level) < 0.05 &&
        [a, v, end].every((p) => caveInteriorWeight(p) === 0) &&
        creatures.every((c) => Math.hypot(c.x - v.x, c.z - v.z) > 6 + (c.radius ?? 0)) &&
        (room.residents ?? []).every((c) => Math.hypot(c.x - v.x, c.z - v.z) > 6) &&
        bots.every(({ id }) => {
          const b = room.players.get(id);
          return Math.hypot(b.x - v.x, b.z - v.z) > 6;
        })
      )
        spot = { a, v };
    }
  assert.ok(spot, 'an open stretch near the camp');
  facts.spot = spot;

  async function place() {
    for (const [p, at, facing] of [
      [A(), spot.a, 0],
      [V(), spot.v, Math.PI],
    ]) {
      stopActor(p);
      Object.assign(p, {
        x: at.x,
        z: at.z,
        facing,
        warpSequence: (p.warpSequence ?? 0) + 1,
        knockbackDone: 1,
      });
    }
    for (const viewer of [attacker, victim])
      await until(
        () =>
          viewer.page.evaluate(
            ({ ids, points }) => {
              const r = window.kbReview;
              return ids.every((id, i) => {
                const e = r.players.get(id);
                return (
                  e?.actor &&
                  e.model.visible &&
                  Math.hypot(e.model.position.x - points[i].x, e.model.position.z - points[i].z) <
                    0.03
                );
              });
            },
            { ids: [attacker.id, victim.id], points: [spot.a, spot.v] },
          ),
        `${viewer.name} sees both placed`,
      );
  }
  /** A side view across the line of the blow: the slide runs across the picture. */
  async function camera(viewer) {
    await viewer.page.evaluate((view) => {
      const r = window.kbReview;
      r.yaw = view.yaw;
      r.pitch = view.pitch;
      r.targetDistance = r.distance = view.distance;
    }, CAMERA);
  }
  /** Frame records, and the drawn canvas itself the first frame past each moment of the slide
   * (read right after that frame was rendered, so the moment is exact, unlike a screenshot). */
  async function record(viewer, sequence) {
    await viewer.page.evaluate(
      ({ attackerId, victimId, sequence, moments }) => {
        window.kbFrames = [];
        window.kbCaptures = [];
        window.kbFrameHook = (r) => {
          const v = r.players.get(victimId),
            a = r.players.get(attackerId);
          const since =
            (v.state.knockbackSequence ?? 0) > sequence
              ? r.serverNow() - v.state.knockbackAt
              : null;
          for (const moment of moments)
            if (
              since !== null &&
              since >= moment &&
              !window.kbCaptures.some((c) => c.moment === moment)
            )
              window.kbCaptures.push({
                moment,
                since: Math.round(since),
                tilt: Math.hypot(v.model.rotation.x, v.model.rotation.z),
                image: r.renderer.domElement.toDataURL('image/jpeg', 0.88),
              });
          window.kbFrames.push({
            t: performance.now(),
            server: r.serverNow(),
            vx: v.model.position.x,
            vz: v.model.position.z,
            tiltX: v.model.rotation.x,
            tiltZ: v.model.rotation.z,
            ax: a.model.position.x,
            az: a.model.position.z,
            sequence: v.state.knockbackSequence ?? 0,
            damageFlash: document.querySelector('#damage-flash')?.hidden === false,
          });
        };
      },
      { attackerId: attacker.id, victimId: victim.id, sequence, moments: MOMENTS },
    );
  }
  const MOMENTS = [0, 80, 220, 700];
  async function frames(viewer, round) {
    const { list, captures } = await viewer.page.evaluate(() => {
      window.kbFrameHook = null;
      return { list: window.kbFrames, captures: window.kbCaptures };
    });
    const saved = [];
    for (const { moment, since, tilt, image } of captures) {
      const file = `${round}-${viewer === attacker ? 'attacker' : 'victim'}-page-${moment}ms.jpg`;
      await writeFile(path.join(out, file), Buffer.from(image.split(',')[1], 'base64'));
      saved.push({ file, since, tiltDegrees: +((tilt * 180) / Math.PI).toFixed(1) });
    }
    return { list, saved };
  }
  function summarize(list, start, at) {
    const after = list.filter((f) => f.server >= at - 100);
    const steps = after.slice(1).map((f, i) => Math.hypot(f.vx - after[i].vx, f.vz - after[i].vz));
    const tilt = after.map((f) => Math.hypot(f.tiltX, f.tiltZ));
    const window_ = after.filter((f) => f.server >= at && f.server <= at + KNOCKBACK.staggerMs);
    const span = window_.length > 1 ? window_.at(-1).t - window_[0].t : 0;
    const last = after.at(-1);
    return {
      frames: after.length,
      fpsDuringSlide: span > 0 ? +(((window_.length - 1) * 1000) / span).toFixed(1) : null,
      shownSlide: +Math.hypot(last.vx - start.x, last.vz - start.z).toFixed(3),
      shownDirectionZ: +(last.vz - start.z).toFixed(3),
      maxStepPerFrame: +Math.max(0, ...steps).toFixed(3),
      maxTiltDegrees: +((Math.max(0, ...tilt) * 180) / Math.PI).toFixed(1),
      tiltPeakAfterMs: (() => {
        const i = tilt.indexOf(Math.max(...tilt));
        return i >= 0 ? Math.round(after[i].server - at) : null;
      })(),
      uprightAtEnd: Math.max(Math.abs(last.tiltX), Math.abs(last.tiltZ)) < 1e-6,
      attackerMoved: +Math.hypot(last.ax - spot.a.x, last.az - spot.a.z).toFixed(3),
      damageFlash: after.some((f) => f.damageFlash),
      sequenceSeen: last.sequence,
    };
  }

  for (const round of ['blow-1', 'blow-2']) {
    await place();
    await camera(attacker);
    await camera(victim);
    // The arrival's place-name banner fades before the measured blow.
    await sleep(3500);
    const before = {
      energy: V().energy,
      hurtSequence: V().hurtSequence ?? 0,
      knockbackSequence: V().knockbackSequence ?? 0,
      attackerEnergy: A().energy,
    };
    await record(attacker, before.knockbackSequence);
    await record(victim, before.knockbackSequence);
    // Server samples every 5 ms, independent of the pages.
    const samples = [];
    const sampler = setInterval(() => {
      const v = V();
      samples.push({
        t: Date.now(),
        x: v.x,
        z: v.z,
        sequence: v.knockbackSequence ?? 0,
        done: v.knockbackDone ?? 1,
        energy: v.energy,
        moving: v.moving,
      });
    }, 5);
    // Real input: the attacker's own page receives the key.
    await attacker.page.bringToFront();
    await attacker.page.keyboard.press('KeyF');
    await until(
      () => (V().knockbackSequence ?? 0) > before.knockbackSequence,
      `${round}: blow lands`,
      5000,
    );
    const at = V().knockbackAt;
    await sleep(Math.max(0, at + 1000 - Date.now()));
    clearInterval(sampler);
    // The whole page (HUD included) once the slide has settled.
    const shots = [];
    for (const viewer of [attacker, victim]) {
      const file = `${round}-${viewer === attacker ? 'attacker' : 'victim'}-page-settled.png`;
      await viewer.page.screenshot({ path: path.join(out, file) });
      shots.push(file);
    }
    const attackerFrames = await frames(attacker, round),
      victimFrames = await frames(victim, round);
    const pageFrames = { attacker: attackerFrames.list, victim: victimFrames.list };
    const settled = samples.filter((s) => s.t >= at + KNOCKBACK.staggerMs + 50);
    const final = settled.at(-1) ?? samples.at(-1);
    const result = {
      round,
      shots,
      captures: { attacker: attackerFrames.saved, victim: victimFrames.saved },
      server: {
        knockbackAt: at,
        sequence: V().knockbackSequence,
        distance: +V().knockbackDistance.toFixed(3),
        expected: +slide.toFixed(3),
        slid: +Math.hypot(final.x - spot.v.x, final.z - spot.v.z).toFixed(3),
        towardZ: +(final.z - spot.v.z).toFixed(3),
        settledWithinMs: (() => {
          const first = samples.find((s) => s.sequence > before.knockbackSequence && s.done >= 1);
          return first ? first.t - at : null;
        })(),
        movingDuringSlide: samples.some(
          (s) => s.t > at && s.t < at + KNOCKBACK.staggerMs && s.moving,
        ),
        energyBefore: before.energy,
        energyAfter: V().energy,
        hurtSequenceBefore: before.hurtSequence,
        hurtSequenceAfter: V().hurtSequence ?? 0,
        attackerEnergySpent: before.attackerEnergy - A().energy,
      },
      attackerPage: summarize(pageFrames.attacker, spot.v, at),
      victimPage: summarize(pageFrames.victim, spot.v, at),
    };
    facts.rounds.push(result);
    console.log(JSON.stringify(result));
    await writeFile(
      path.join(out, `${round}-frames.json`),
      JSON.stringify({ at, samples, pageFrames }, null, 1),
    );
  }
  facts.victimHud = await victim.page.evaluate(() => ({
    knockbackSequence: document.querySelector('#world')?.dataset.knockbackSequence,
    hurtSequence: document.querySelector('#world')?.dataset.hurtSequence,
  }));
  facts.bots = bots.map((b) => ({
    name: b.name,
    states: b.states,
    sawVictim: b.knockbacks.get(victim.id) ?? null,
  }));
  facts.errors = errors;
  // Expectations of the change: no energy cost, the full slide, every client informed.
  for (const r of facts.rounds) {
    assert.equal(r.server.energyAfter, r.server.energyBefore, `${r.round} energy`);
    assert.equal(r.server.hurtSequenceAfter, r.server.hurtSequenceBefore, `${r.round} hurt`);
    assert.ok(Math.abs(r.server.slid - slide) < 0.02, `${r.round} slide ${r.server.slid}`);
    assert.ok(r.server.towardZ > 0, `${r.round} away from the attacker`);
    assert.equal(r.server.movingDuringSlide, false);
    for (const view of [r.attackerPage, r.victimPage]) {
      assert.ok(Math.abs(view.shownSlide - slide) < 0.05, `${r.round} shown ${view.shownSlide}`);
      assert.ok(view.maxTiltDegrees > 5, `${r.round} tilt`);
      assert.equal(view.uprightAtEnd, true);
      assert.equal(view.damageFlash, false);
    }
    for (const captures of [r.captures.attacker, r.captures.victim]) {
      assert.deepEqual(
        captures.map((c) => c.file.match(/-(\d+)ms/)[1]),
        MOMENTS.map(String),
      );
      assert.ok(captures.find((c) => c.file.includes('-80ms')).tiltDegrees > 5);
      assert.equal(captures.find((c) => c.file.includes('-700ms')).tiltDegrees, 0);
    }
  }
  for (const b of facts.bots) assert.ok(b.sawVictim?.sequence >= 2, `${b.name} saw both blows`);
  assert.equal(facts.victimHud.knockbackSequence, '2');
  assert.deepEqual(errors, []);
  facts.pass = true;
} catch (error) {
  facts.pass = false;
  facts.failure = String(error?.stack ?? error);
  facts.errors = errors;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 2));
  for (const b of bots) b.ws.close();
  await browser.close();
  await game.close();
}
