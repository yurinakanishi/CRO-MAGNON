// Real-browser look at the grassland ground beside the meadow-grass / meadow-sprig
// cover, with a pixel comparison of the drawn ground against the drawn blades.
// Reuses the behemoth QA host fixture (room BEHEMOTH-QA, `place` command);
// nothing here touches the normal server. Usage: node scripts/qa-meadow-ground-tint.mjs <outDir>
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/meadow-ground-tint');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  facts = { shots: {} };
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
// Mean display colour of blade-like pixels (green-dominant) and ground-like
// pixels inside the band below the horizon and above the bottom HUD.
async function analyse(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.round(info.width * 0.05),
    x1 = Math.round(info.width * 0.9),
    y0 = Math.round(info.height * 0.48),
    y1 = Math.round(info.height * 0.87);
  const sum = { blade: [0, 0, 0, 0], ground: [0, 0, 0, 0] };
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (r + g + b < 60) continue;
      const ratio = g / Math.max(r, 1);
      const bucket = ratio > 1.45 && g > b * 1.3 ? 'blade' : ratio > 0.75 && ratio <= 1.45 ? 'ground' : null;
      if (!bucket) continue;
      sum[bucket][0] += r;
      sum[bucket][1] += g;
      sum[bucket][2] += b;
      sum[bucket][3]++;
    }
  const mean = (s) =>
    s[3]
      ? {
          rgb: s.slice(0, 3).map((v) => Math.round(v / s[3])),
          hex: '#' + s.slice(0, 3).map((v) => Math.round(v / s[3]).toString(16).padStart(2, '0')).join(''),
          gOverR: Number((s[1] / Math.max(1, s[0])).toFixed(3)),
          pixels: s[3],
        }
      : null;
  return { blade: mean(sum.blade), ground: mean(sum.ground) };
}
async function shot(page, name) {
  const file = path.join(out, name + '.png');
  await page.screenshot({ path: file });
  facts.shots[name] = await analyse(file);
}
async function view(page, yaw, pitch, distance) {
  await page.evaluate(
    ({ yaw, pitch, distance }) => {
      const r = window.monsterReview;
      r.yaw = yaw;
      r.pitch = pitch;
      r.distance = distance;
      r.targetDistance = distance;
    },
    { yaw, pitch, distance },
  );
  await sleep(900);
}
let context;
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
  context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Monster A');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + '/?room=BEHEMOTH-QA');
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('Monster A');
  await page.locator('#setup-submit').click();
  await page.locator('#guide-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => page.evaluate(() => !!window.monsterReview?.selfId), 'renderer');
  // Densest valley cover east of the river (34 tufts + 16 sprigs in the 8 m cell at 72..80, 64..72).
  await request('place', { x: 76, z: 68 });
  await sleep(2500);
  await view(page, Math.PI * 0.5, 0.22, 6);
  await shot(page, '01-east-eye-level');
  await view(page, Math.PI * 0.5, 0.62, 14);
  await shot(page, '02-east-overview');
  await view(page, Math.PI * 0.5, 0.3, 2.2);
  await shot(page, '03-east-close');
  await view(page, -Math.PI * 0.5, 1.45, 10);
  await shot(page, '04-east-top-down');
  // South valley cover (31 tufts + 17 sprigs in the cell at 32..40, 96..104).
  await request('place', { x: 36, z: 100 });
  await sleep(2500);
  await view(page, 0, 0.25, 7);
  await shot(page, '05-south-eye-level');
  // The behemoth marsh keeps its mud and algae on top of the re-hued ground.
  await request('prepare', { mode: 'guard' });
  await sleep(2500);
  await page.evaluate(() => {
    const r = window.monsterReview,
      p = r.players.get(r.selfId)?.state,
      e = [...r.enemies.values()].find((e) => e.state.modelKey === 'violet-behemoth')?.state;
    r.yaw = p && e ? Math.atan2(p.x - e.x, p.z - e.z) + 0.6 : 0;
    r.pitch = 1.05;
    r.distance = 26;
    r.targetDistance = 26;
  });
  await sleep(900);
  await shot(page, '06-marsh-overview');
  await page.locator('#world').focus();
  await page.keyboard.press('m');
  await sleep(1200);
  await shot(page, '07-map');
  await page.keyboard.press('Escape');
  await sleep(300);
  facts.terrainShader = await page.evaluate(() => {
    const r = window.monsterReview,
      gl = r.renderer.getContext();
    return r.renderer.info.programs
      .filter((p) => /paleo-terrain-grassland/.test(String(p.cacheKey)))
      .map((p) => ({
        key: String(p.cacheKey).match(/paleo-terrain-grassland[^,]*/)?.[0],
        meadowMatch: gl.getShaderSource(p.fragmentShader).includes('meadowBlade'),
        usedTimes: p.usedTimes,
      }));
  });
  facts.player = await page.evaluate(() => {
    const r = window.monsterReview,
      me = r.players.get(r.selfId)?.state;
    return { x: me?.x, z: me?.z, fps: document.querySelector('#world').dataset.fps };
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify({ facts, errors, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(JSON.stringify(facts, null, 1));
} finally {
  await context?.close().catch(() => {});
  try {
    await request('stop');
  } catch {}
  child?.kill();
}
