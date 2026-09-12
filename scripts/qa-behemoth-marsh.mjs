// Real-browser look at the behemoth marsh: floor, pools, mist and the map patch.
// Reuses the behemoth QA host fixture (guard mode places the player 12 m south
// of the guard post, beside the pool at 92,124). Screenshots and scene facts are
// written for the adoption record; nothing here touches the normal server.
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BEHEMOTH_MARSH, marshDrop } from '../dist/shared/behemoth-rules.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/behemoth-marsh');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  facts = {},
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
async function view(page, yawOffset, pitch, distance) {
  await page.evaluate(
    ({ yawOffset, pitch, distance }) => {
      const r = window.monsterReview;
      const p = r.players.get(r.selfId)?.state;
      const e = [...r.enemies.values()].find((e) => e.state.modelKey === 'violet-behemoth')?.state;
      r.yaw = (p && e ? Math.atan2(p.x - e.x, p.z - e.z) : 0) + yawOffset;
      r.pitch = pitch;
      r.distance = distance;
      r.targetDistance = distance;
    },
    { yawOffset, pitch, distance },
  );
  await sleep(700);
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
  await request('prepare', { mode: 'guard' });
  await sleep(2500);
  await until(
    () =>
      page.evaluate(() =>
        [...window.monsterReview.enemies.values()].some(
          (e) => e.state.modelKey === 'violet-behemoth' && e.actor && e.model.visible,
        ),
      ),
    'enemy asset',
  );
  await view(page, 0, 0.3, 11);
  await shot(page, '01-marsh-toward-post');
  await view(page, Math.PI, 0.45, 9);
  await shot(page, '02-marsh-pool-behind');
  await view(page, 0.6, 1.05, 26);
  await shot(page, '03-marsh-overview');
  await view(page, 0, 1.5, 34);
  await shot(page, '03b-marsh-top-down');
  await view(page, -2.2, 0.5, 14);
  await shot(page, '04-marsh-west-pools');
  await page.evaluate(() => {
    const r = window.monsterReview;
    // Orbit yaw looks from the player toward a target when yaw = atan2(dx, dz) player minus target.
    r.yaw = Math.atan2(95 - 88, 122 - 120);
    r.pitch = 0.95;
    r.distance = 9;
    r.targetDistance = 9;
  });
  await sleep(700);
  // Mark where the pool centre and its rim project, so the shot proves the sheet is there.
  facts.projection = await page.evaluate(() => {
    const r = window.monsterReview,
      camera = r.camera,
      canvas = r.renderer.domElement,
      marks = [];
    const project = (x, y, z, color) => {
      const v = { x, y, z };
      // Manual projection: world -> clip via the camera matrices (no THREE global).
      const m = camera.matrixWorldInverse.elements,
        p = camera.projectionMatrix.elements;
      const cx = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
        cy = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
        cz = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
      const px = p[0] * cx + p[4] * cy + p[8] * cz + p[12],
        py = p[1] * cx + p[5] * cy + p[9] * cz + p[13],
        pw = p[3] * cx + p[7] * cy + p[11] * cz + p[15];
      const sx = ((px / pw + 1) / 2) * canvas.clientWidth,
        sy = ((1 - py / pw) / 2) * canvas.clientHeight;
      const dot = document.createElement('div');
      dot.className = 'qa-mark';
      dot.style.cssText = `position:fixed;left:${sx - 5}px;top:${sy - 5}px;width:10px;height:10px;border-radius:50%;background:${color};z-index:99999;pointer-events:none;border:1px solid #000`;
      document.body.append(dot);
      marks.push({ x, y, z, sx: Math.round(sx), sy: Math.round(sy) });
    };
    project(88, -0.3, 120, '#ff2020');
    project(88 + 4.5, -0.22, 120, '#ffe020');
    project(88 - 4.5, -0.22, 120, '#ffe020');
    project(88, -0.22, 120 + 4.5, '#ffe020');
    project(88, -0.22, 120 - 4.5, '#ffe020');
    return marks;
  });
  await shot(page, '06-marsh-pool-close');
  await page.evaluate(() => document.querySelectorAll('.qa-mark').forEach((n) => n.remove()));
  // Wade into the pool: feet on the shared basin floor with the sheet at the ankles.
  await request('place', { x: 88, z: 120 });
  await sleep(1200);
  await page.evaluate(() => {
    const r = window.monsterReview;
    r.yaw = Math.atan2(88 - 95, 120 - 110);
    r.pitch = 0.18;
    r.distance = 4.5;
    r.targetDistance = 4.5;
  });
  await sleep(800);
  await shot(page, '07-marsh-wading');
  facts.wading = await page.evaluate(() => {
    const r = window.monsterReview,
      me = r.players.get(r.selfId);
    return { x: me.state.x, z: me.state.z, modelY: Number(me.model.position.y.toFixed(3)) };
  });
  facts.shaders = await page.evaluate(() => {
    const r = window.monsterReview,
      gl = r.renderer.getContext();
    return r.renderer.info.programs
      .filter((p) => /paleo-terrain-grassland|behemoth-marsh-pool/.test(String(p.cacheKey)))
      .map((p) => ({
        key: String(p.cacheKey).match(/paleo-terrain-grassland[^,]*|behemoth-marsh-pool[^,]*/)?.[0],
        instancing: /USE_INSTANCING/.test(String(p.cacheKey)),
        vertexHasMarshDrop: gl.getShaderSource(p.vertexShader).includes('marshDrop(earthPoint.xz)'),
        fragmentHasMarshPool: gl.getShaderSource(p.fragmentShader).includes('marshPool'),
        usedTimes: p.usedTimes,
      }));
  });
  Object.assign(
    facts,
    await page.evaluate(() => {
      const r = window.monsterReview,
        pools = r.scene.getObjectByName('behemoth marsh pools'),
        mist = r.scene.getObjectByName('behemoth marsh mist'),
        me = r.players.get(r.selfId)?.state;
      return {
        pools: pools?.children.length ?? 0,
        poolHeights: pools?.children.map((c) => Number(c.position.y.toFixed(3))) ?? [],
        mistPoints: mist?.geometry.attributes.position.count ?? 0,
        player: me && { x: me.x, z: me.z },
        fps: document.querySelector('#world').dataset.fps,
      };
    }),
  );
  // Drawn floor under each pool: source tile vertices near the centre (the GPU
  // lowers them by the same marshDrop), so the water sheet must sit above them.
  facts.poolFloors = await page.evaluate((pools) => {
    const r = window.monsterReview,
      meshes = [];
    r.terrain.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    const result = [];
    for (const pool of pools) {
      const ys = [];
      for (const mesh of meshes) {
        const p = mesh.geometry.attributes.position,
          instances = mesh.isInstancedMesh ? mesh.count : 1;
        for (let i = 0; i < instances; i++) {
          let e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          if (mesh.isInstancedMesh)
            e = Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16));
          else e = Array.from(mesh.matrixWorld.elements);
          if (Math.abs(e[12] - pool.x) > 24 || Math.abs(e[14] - pool.z) > 24) continue;
          for (let v = 0; v < p.count; v++) {
            const x = p.getX(v),
              y = p.getY(v),
              z = p.getZ(v);
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12],
              wy = e[1] * x + e[5] * y + e[9] * z + e[13],
              wz = e[2] * x + e[6] * y + e[10] * z + e[14];
            if (Math.hypot(wx - pool.x, wz - pool.z) <= 1.2) ys.push(wy);
          }
        }
      }
      result.push({
        pool,
        vertices: ys.length,
        sourceMin: Math.min(...ys),
        sourceMax: Math.max(...ys),
      });
    }
    return result;
  }, BEHEMOTH_MARSH.pools);
  facts.diagnostics = await page.evaluate(async () => {
    const r = window.monsterReview,
      pools = r.scene.getObjectByName('behemoth marsh pools');
    const served = await fetch('/src/world-scenery.js').then((x) => x.text());
    const corners = (mesh) => {
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox,
        e = mesh.matrixWorld.elements,
        out = { minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity };
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12],
              wy = e[1] * x + e[5] * y + e[9] * z + e[13];
            out.minY = Math.min(out.minY, wy);
            out.maxY = Math.max(out.maxY, wy);
            out.minX = Math.min(out.minX, wx);
            out.maxX = Math.max(out.maxX, wx);
          }
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Number(v.toFixed(3))]));
    };
    const poolMeshes = [];
    pools?.traverse((o) => {
      if (o.isMesh)
        poolMeshes.push({
          visible: o.visible,
          frustumCulled: o.frustumCulled,
          material: o.material.name || o.material.type,
          opacity: o.material.opacity,
          bounds: corners(o),
        });
    });
    return {
      servedHasPoolV2: served.includes('behemoth-marsh-pool-2'),
      programs: r.renderer.info.programs.map((p) => String(p.cacheKey).slice(0, 60)),
      terrainMaterials: [
        ...new Set(
          (() => {
            const names = [];
            r.terrain.traverse((o) => {
              if (o.isMesh) names.push(o.material.customProgramCacheKey?.() ?? o.material.type);
            });
            return names;
          })(),
        ),
      ],
      poolMeshes: poolMeshes.slice(0, 3),
      poolMeshCount: poolMeshes.length,
    };
  });
  for (const [i, f] of facts.poolFloors.entries()) {
    f.drawnMax = Number((f.sourceMax - marshDrop(f.pool.x, f.pool.z)).toFixed(3));
    f.water = facts.poolHeights[i];
  }
  await writeFile(path.join(out, 'diagnostics.json'), JSON.stringify(facts, null, 2));
  for (const [i, mesh] of facts.diagnostics.poolMeshes.entries()) {
    assert.ok(mesh.visible, `pool ${i} visible`);
    assert.ok(mesh.bounds.maxY > -BEHEMOTH_MARSH.basinDepth, `pool ${i} floats on the floor`);
  }
  assert.equal(facts.pools, 6, 'six pools in the scene');
  assert.ok(facts.mistPoints > 100, 'mist points');
  const state = await request('state');
  facts.enemy = { x: state.enemy.x, z: state.enemy.z, behavior: state.enemy.behavior };
  await page.locator('#world').focus();
  await page.keyboard.press('m');
  await sleep(1200);
  await shot(page, '05-map-marsh');
  facts.mapOpen = await page.evaluate(
    () => !!document.querySelector('#map-screen, [data-screen="map"], .map-screen'),
  );
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify({ facts, screenshots, errors, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(JSON.stringify({ facts, screenshots: screenshots.length }));
} finally {
  await context?.close().catch(() => {});
  try {
    await request('stop');
  } catch {}
  child?.kill();
}
