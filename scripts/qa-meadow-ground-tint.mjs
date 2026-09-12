// Real-browser look at the grassland ground beside the meadow-grass / meadow-sprig
// cover, with colour buckets (not object segmentation) and stable instance tints.
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
// Historical bucket names: "blade" = strong green, "ground" = olive/earth.
// Both ground and blades now contain both buckets; these do not identify objects.
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
async function grassPalette(page) {
  return page.evaluate(() => {
    const r = window.monsterReview, colours = {}, sources = [];
    for (const landscape of r.landscapes) {
      if (landscape.surface || !['meadow-grass', 'meadow-sprig'].includes(landscape.key)) continue;
      const source = r.worldAssets.get(landscape.key).gltf.scene;
      const original = [];
      source.traverse((node) => { if (node.isMesh) original.push(node); });
      sources.push({
        key: landscape.key,
        sharedGeometry: landscape.levels[0].every(({mesh}, i) => mesh.geometry === original[i].geometry),
        sharedTexture: landscape.levels[0].every(({mesh}, i) => mesh.material.map === original[i].material.map),
        sourceUntinted: original.every((node) => !node.material.customProgramCacheKey().includes('meadow-grass-palette')),
        allLodsTinted: landscape.levels.flat().every(({mesh}) => mesh.instanceColor && mesh.material.customProgramCacheKey().includes('meadow-grass-palette')),
      });
      const mesh = landscape.levels[2][0].mesh;
      for (let i = 0; i < mesh.count; i++) {
        const matrix = mesh.instanceMatrix.array, colour = mesh.instanceColor.array;
        const id = `${landscape.key}:${matrix[i*16+12].toFixed(3)},${matrix[i*16+14].toFixed(3)}`;
        colours[id] = [...colour.slice(i*3, i*3+3)];
      }
    }
    return { colours, sources };
  });
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
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => page.evaluate(() => !!window.monsterReview?.selfId), 'renderer');
  // Densest valley cover east of the river (34 tufts + 16 sprigs in the 8 m cell at 72..80, 64..72).
  await request('place', { x: 76, z: 68 });
  await sleep(2500);
  await view(page, Math.PI * 0.5, 0.22, 6);
  await shot(page, '01-east-eye-level');
  const paletteBefore = await grassPalette(page);
  for (const source of paletteBefore.sources) {
    assert.ok(source.sharedGeometry && source.sharedTexture && source.sourceUntinted && source.allLodsTinted, source.key);
  }
  assert.ok(paletteBefore.sources.length >= 2);
  assert.ok(new Set(Object.values(paletteBefore.colours).map((c) => c.map((v) => v.toFixed(2)).join(','))).size > 30);
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
  // Return after streaming cells and changing LOD/culling order: the same plants keep their colours.
  await request('place', { x: 76, z: 68 });
  await sleep(2500);
  await view(page, Math.PI * 0.5, 0.22, 6);
  const paletteAfter = await grassPalette(page);
  let compared = 0;
  for (const [id, colour] of Object.entries(paletteBefore.colours)) {
    if (!paletteAfter.colours[id]) continue;
    assert.deepEqual(paletteAfter.colours[id], colour, id);
    compared++;
  }
  assert.ok(compared > 100, `${compared} returned plants`);
  facts.grassPalette = { sources: paletteBefore.sources, stableAfterTravel: compared };
  await shot(page, '08-east-return');
  // Exercise the actual near GLBs as well as the normal distant impostors.
  // The fixture temporarily extends their threshold, then restores production distances.
  const distances = await page.evaluate(() => window.monsterReview.landscapes.map((landscape) => {
    const saved = [...landscape.distances];
    if (!landscape.surface && ['meadow-grass', 'meadow-sprig'].includes(landscape.key)) landscape.distances[0] = 5;
    return saved;
  }));
  await view(page, Math.PI * 0.5 + 0.01, 0.3, 2.2);
  facts.grassPalette.nearModels = await page.evaluate(() => window.monsterReview.landscapes
    .filter((l) => !l.surface && ['meadow-grass', 'meadow-sprig'].includes(l.key))
    .map((l) => ({ key: l.key, count: l.levels[0][0].mesh.count })));
  assert.ok(facts.grassPalette.nearModels.every((l) => l.count > 0));
  await shot(page, '09-near-grass-models');
  await page.evaluate((saved) => window.monsterReview.landscapes.forEach((l, i) => l.distances = saved[i]), distances);
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
