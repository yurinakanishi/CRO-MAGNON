// Real-Chrome QA (2026-10-12): how often Three looks a material's program up again while the
// camera turns. WebGLRenderer.setProgram (three r185) decides on every draw whether the material
// needs another program (`needsProgramChange`) and then looks it up (getProgram →
// WebGLPrograms.getParameters). The served three.module.js is extended in transit so that each of
// those 26 decisions reports its reason, material and object, and getProgram is timed. A steady
// frame should need none (src/material-variants.ts).
// --pixels also compares, within one frame and without a game update between the draws, the
// water drawn side by side with the single double-sided materials it replaces (Three's own two
// passes), and the instanced copies with their source materials (readPixels).
// A memory-only world (LOCAL_VERIFY in a throwaway save folder under <outDir>); the user's
// servers are never touched.
// Usage: node scripts/qa-program-lookups.mjs <outDir> [--frames 90] [--pixels]
//   [--browser <build>]: --browser serves another build's dist/src, dist/shared and
//   public/index.html (an earlier revision) with this checkout's assets.
import { copyFile, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { riverX } from '../dist/shared/terrain.mjs';
import { BEHEMOTH_MARSH } from '../dist/shared/behemoth-rules.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const out = path.resolve(process.argv[2] || `output/playwright/program-lookups/${Date.now()}`);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const frameCount = Number(option('--frames', 90));
const pixels = process.argv.includes('--pixels');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(100);
  }
}

// The renderer of the page and a per-frame hook, as qa-camera-clearance.mjs exposes them.
const PATCH = `import { WorldRenderer as ReviewedRenderer } from './world3d.js';
{
  const render = ReviewedRenderer.prototype.render;
  ReviewedRenderer.prototype.render = function (...args) {
    window.cameraReview = this;
    const value = render.apply(this, args);
    try { window.cameraFrameHook?.(this); } catch (error) { window.cameraFrameHook = null; console.error(error); }
    return value;
  };
}
`;
// The branches of WebGLRenderer.setProgram (three r185), in source order.
const REASONS = [
  null,
  'lights state',
  'output colour space',
  'batching on',
  'batching off',
  'batching colour on',
  'batching colour off',
  'instancing on',
  'instancing off',
  'skinning on',
  'skinning off',
  'instance colour off',
  'instance colour on',
  'instance morph off',
  'instance morph on',
  'environment map',
  'fog',
  'clipping planes',
  'vertex alphas',
  'vertex tangents',
  'morph targets',
  'morph normals',
  'morph colours',
  'tone mapping',
  'morph target count',
  'light probe grid',
  'material version',
];
/** three.module.js with each program-change decision reported and getProgram timed. */
function instrument(source) {
  let branch = 0;
  const text = source.replace(
    /needsProgramChange = true;/g,
    () =>
      `needsProgramChange = true; globalThis.__programChange && globalThis.__programChange(${++branch}, material, object);`,
  );
  if (branch !== REASONS.length - 1)
    throw new Error(`three.module.js: expected ${REASONS.length - 1} decisions, found ${branch}`);
  const call = 'program = getProgram( material, scene, object );';
  if (text.split(call).length !== 2) throw new Error('three.module.js: getProgram call changed');
  return text.replace(
    call,
    `{ const started = performance.now(); ${call} globalThis.__programTime && globalThis.__programTime(performance.now() - started); }`,
  );
}

const browserBuild = option('--browser', null);
let assetRoot = null;
if (browserBuild) {
  assetRoot = path.join(out, 'browser-root');
  for (const directory of ['public', 'dist'])
    await mkdir(path.join(assetRoot, directory), { recursive: true });
  for (const directory of ['src', 'shared'])
    await symlink(
      path.resolve(browserBuild, 'dist', directory),
      path.join(assetRoot, 'dist', directory),
      'junction',
    );
  for (const entry of await readdir('public', { withFileTypes: true }))
    if (entry.name === 'index.html') continue;
    else if (entry.isDirectory())
      await symlink(
        path.resolve('public', entry.name),
        path.join(assetRoot, 'public', entry.name),
        'junction',
      );
    else
      await copyFile(
        path.resolve('public', entry.name),
        path.join(assetRoot, 'public', entry.name),
      );
  await copyFile(
    path.resolve(browserBuild, 'public/index.html'),
    path.join(assetRoot, 'public/index.html'),
  );
}
const settings = localVerificationSettings(out);
const game = createGameServer({ ...settings, port: 0, ...(assetRoot ? { assetRoot } : {}) });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
});
const errors = [],
  facts = { date: new Date().toISOString(), browserBuild, spots: [], pixels: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const seen = { id: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (m.type === 'welcome') seen.id = m.id;
      } catch {}
    }),
  );
  const fulfil = async (route, body) =>
    route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
    });
  await page.route(
    (url) => url.pathname === '/src/boot.js',
    async (route) => fulfil(route, PATCH + (await (await route.fetch()).text())),
  );
  await page.route(
    (url) => url.pathname === '/vendor/three.module.js',
    async (route) => fulfil(route, instrument(await (await route.fetch()).text())),
  );
  await page.addInitScript(() => localStorage.setItem('cro-name', 'ProgramQA'));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 180000 });
  await page.locator('[data-cave-proceed]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(
    () => seen.id && game.rooms.get(settings.runtimeConfig.room)?.players.has(seen.id),
    'joined',
  );
  const room = game.rooms.get(settings.runtimeConfig.room);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  const me = () => room.players.get(seen.id);
  await until(() => page.evaluate(() => !!window.cameraReview?.selfId), 'renderer');
  facts.prepared = await page.evaluate(() => ({
    // Programs the world's offscreen preparation draw needed beyond those compiled.
    worldPreparedPrograms: window.cameraReview.canvas.dataset.worldPreparedPrograms,
    programs: window.cameraReview.renderer.info.programs.length,
  }));

  // The camera-clearance QA's spots: inside the nearest spruce's skirt, and at two cave walls.
  const radius = me().radius,
    free = (p) => room.collision.free(p, radius);
  const against = (from, angle, start = 0, limit = 6) => {
    for (let d = start; d <= limit; d += 0.02) {
      const p = { x: from.x + Math.cos(angle) * d, z: from.z + Math.sin(angle) * d };
      if (free(p)) return { ...p, d };
    }
    return null;
  };
  const tree = SCENERY.trees
    .filter((t) => !t.surface)
    .map((t) => ({ ...t, d: Math.hypot(t.x - 50, t.z - 50) }))
    .sort((p, q) => p.d - q.d)[0];
  const angle = Math.atan2(50 - tree.z, 50 - tree.x),
    trunk = against(tree, angle),
    skirt = against(tree, angle, Math.max(trunk.d, 1.3 + radius * 0.3));
  const spots = [{ name: 'tree0-skirt', x: skirt.x, z: skirt.z }];
  for (const [depth, side] of [
    [6, -1],
    [-21, 1],
  ]) {
    let last = null;
    for (let across = 0; across <= 12; across += 0.02) {
      const p = caveWorldAt(depth, side * across);
      if (free(p)) last = p;
      else if (last) break;
    }
    spots.push({ name: `cave${depth}${side > 0 ? 'L' : 'R'}`, cave: true, ...last });
  }
  async function place({ x, z, cave = false }) {
    const p = me();
    stopActor(p);
    Object.assign(p, { x, z, warpSequence: (p.warpSequence ?? 0) + 1 });
    await until(
      () =>
        page.evaluate(
          ({ x, z }) => {
            const r = window.cameraReview,
              self = r.players.get(r.selfId);
            return (
              !!self &&
              Math.hypot(self.model.position.x - x, self.model.position.z - z) < 0.05 &&
              Math.hypot(r.focus.x - x, r.focus.z - z) < 0.05
            );
          },
          { x, z },
        ),
      `placed at ${x.toFixed(1)},${z.toFixed(1)}`,
    );
    if (cave)
      await until(() => page.evaluate(() => !!window.cameraReview.landmarks?.caveCamera), 'cave');
    await sleep(1500);
  }

  // A turn at 90 degrees per second; each frame's program lookups by reason and material.
  for (const spot of spots) {
    await place(spot);
    await page.evaluate(() => {
      const r = window.cameraReview;
      r.yaw = 0;
      r.pitch = 0.19;
      r.targetDistance = r.distance = 5.5;
    });
    await sleep(600);
    const result = await page.evaluate(
      ({ frames, reasons }) =>
        new Promise((resolve) => {
          const r = window.cameraReview,
            renderer = r.renderer,
            start = performance.now(),
            perFrame = [];
          let changes = [],
            time = 0;
          const describe = (object) => {
            const chain = [];
            for (let n = object; n && chain.length < 4; n = n.parent) {
              const key = n.userData?.assetKey;
              chain.push(
                `${n.isInstancedMesh ? 'InstancedMesh' : n.type}${n.name ? `:${n.name}` : ''}${key ? `[${key}]` : ''}`,
              );
            }
            return chain.join(' < ');
          };
          window.__programChange = (branch, material, object) =>
            changes.push({ branch, material, object });
          window.__programTime = (ms) => (time += ms);
          window.cameraFrameHook = () => {
            let lights = 0;
            r.scene.traverseVisible((node) => {
              if (node.isLight && !node.isAmbientLight) lights++;
            });
            perFrame.push({ changes, time, lights, programs: renderer.info.programs.length });
            changes = [];
            time = 0;
            const t = (performance.now() - start) / 1000;
            if (perFrame.length < frames + 2) {
              r.yaw = (Math.PI / 2) * t;
              return;
            }
            window.cameraFrameHook = window.__programChange = window.__programTime = null;
            // The first two frames began before the hook.
            const steady = perFrame.slice(2),
              n = steady.length,
              materials = new Map(),
              byReason = {};
            for (const frame of steady)
              for (const { branch, material, object } of frame.changes) {
                const reason = reasons[branch];
                byReason[reason] = (byReason[reason] ?? 0) + 1;
                const entry = materials.get(material) ?? { count: 0, reasons: {}, objects: {} };
                entry.count++;
                entry.reasons[reason] = (entry.reasons[reason] ?? 0) + 1;
                const drawn = describe(object);
                entry.objects[drawn] = (entry.objects[drawn] ?? 0) + 1;
                materials.set(material, entry);
              }
            const perFrameOf = (count) => +(count / n).toFixed(2);
            resolve({
              frames: n,
              lookupsPerFrame: perFrameOf(steady.reduce((s, f) => s + f.changes.length, 0)),
              framesWithout: steady.filter((f) => !f.changes.length).length,
              maxPerFrame: Math.max(...steady.map((f) => f.changes.length)),
              getProgramMsPerFrame: +(steady.reduce((s, f) => s + f.time, 0) / n).toFixed(3),
              byReason: Object.fromEntries(
                Object.entries(byReason).map(([reason, count]) => [reason, perFrameOf(count)]),
              ),
              lights: [
                Math.min(...steady.map((f) => f.lights)),
                Math.max(...steady.map((f) => f.lights)),
              ],
              programs: [steady[0].programs, steady.at(-1).programs],
              perFrame: steady.map((f) => [f.changes.length, f.lights, f.programs]),
              materials: [...materials]
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 12)
                .map(([material, entry]) => ({
                  material: `${material.type} "${material.name}" #${material.id}`,
                  perFrame: perFrameOf(entry.count),
                  reasons: entry.reasons,
                  drawnBy: Object.fromEntries(
                    Object.entries(entry.objects)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4),
                  ),
                })),
            });
          };
        }),
      { frames: frameCount, reasons: REASONS },
    );
    facts.spots.push({ name: spot.name, at: [+spot.x.toFixed(2), +spot.z.toFixed(2)], ...result });
    console.log(
      JSON.stringify({
        spot: spot.name,
        lookupsPerFrame: result.lookupsPerFrame,
        framesWithout: `${result.framesWithout}/${result.frames}`,
        maxPerFrame: result.maxPerFrame,
        byReason: result.byReason,
        top: result.materials.slice(0, 4).map((m) => [m.material, m.perFrame]),
      }),
    );
  }

  if (pixels) {
    await page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const { materialCopy } = await import('/src/material-variants.js');
      const r = window.cameraReview,
        renderer = r.renderer,
        gl = renderer.getContext();
      const read = () => {
        renderer.render(r.scene, r.camera);
        const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          px,
        );
        return px;
      };
      const differ = (a, b) => {
        let count = 0,
          max = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.max(
            Math.abs(a[i] - b[i]),
            Math.abs(a[i + 1] - b[i + 1]),
            Math.abs(a[i + 2] - b[i + 2]),
          );
          if (d) count++;
          max = Math.max(max, d);
        }
        return { pixels: count, max };
      };
      /** The frame as drawn, then with each swap worn (twice, so its programs are current),
       * then as drawn again. */
      const compare = (swaps) => {
        const a = read(),
          worn = swaps.map(([node]) => node.material);
        for (const [node, material] of swaps) node.material = material;
        read();
        const b = read();
        swaps.forEach(([node], i) => (node.material = worn[i]));
        read();
        return { swapped: swaps.length, changed: differ(a, b), repeat: differ(a, read()) };
      };
      window.comparePixels = () => {
        // Split water, worn as one double-sided material per pair (Three's own two passes).
        const split = [],
          single = new Map();
        r.scene.traverse((node) => {
          const pair = node.material;
          if (!node.isMesh || !Array.isArray(pair) || pair.length !== 2) return;
          if (pair[0].side !== THREE.BackSide || pair[1].side !== THREE.FrontSide) return;
          if (!single.has(pair[1])) {
            const source = materialCopy(pair[1]);
            source.side = THREE.DoubleSide;
            single.set(pair[1], source);
          }
          split.push([node, single.get(pair[1])]);
        });
        const water = compare(split);
        for (const [node] of split) node.visible = false;
        const hidden = read();
        for (const [node] of split) node.visible = true;
        water.waterPixels = differ(read(), hidden).pixels;
        for (const material of single.values()) material.dispose();
        // Instanced ground tiles, trees and boulders, worn with their source materials.
        const sources = [];
        for (const levels of r.openWorld?.prepared?.values() ?? [])
          for (const parts of levels)
            for (const part of parts)
              if (part.mesh.material !== part.material) sources.push([part.mesh, part.material]);
        for (const landscape of r.landscapes) {
          if (landscape.grassTints) continue;
          const template = r.worldAssets.get(landscape.key, landscape.surface);
          [template.gltf, template.lods[0]].forEach((model, level) => {
            const materials = [];
            model?.scene.traverse((node) => node.isMesh && materials.push(node.material));
            landscape.levels[level].forEach(({ mesh }, i) => {
              if (materials[i] && mesh.material !== materials[i])
                sources.push([mesh, materials[i]]);
            });
          });
        }
        const instanced = compare(sources);
        instanced.drawn = sources.filter(([mesh]) => mesh.count > 0).length;
        return { water, instanced };
      };
    });
    const places = [
      { name: 'river-camp', x: riverX(46) - 7, z: 46 },
      { name: 'river-bridge', x: riverX(30) + 7, z: 30 },
      { name: 'cave-spring', ...caveWorldAt(-27), cave: true },
      { name: 'marsh', x: BEHEMOTH_MARSH.x - 18, z: BEHEMOTH_MARSH.z },
    ];
    for (const where of places) {
      await place(where);
      const views = [];
      for (let i = 0; i < 8; i++)
        for (const pitch of [0.25, 0.6]) {
          await page.evaluate(
            ({ yaw, pitch }) => {
              const r = window.cameraReview;
              r.yaw = yaw;
              r.pitch = pitch;
              r.targetDistance = r.distance = 6;
            },
            { yaw: (i * Math.PI) / 4, pitch },
          );
          await sleep(400);
          views.push(await page.evaluate(() => window.comparePixels()));
        }
      await page.screenshot({ path: path.join(out, `${where.name}.png`) });
      const sum = (pick) => views.reduce((n, v) => n + pick(v), 0);
      const summary = {
        place: where.name,
        views: views.length,
        withWater: views.filter((v) => v.water.waterPixels > 0).length,
        maxWaterPixels: Math.max(...views.map((v) => v.water.waterPixels)),
        splitMeshes: views[0].water.swapped,
        waterChangedPixels: sum((v) => v.water.changed.pixels),
        instancedMeshes: views[0].instanced.swapped,
        instancedDrawn: Math.max(...views.map((v) => v.instanced.drawn)),
        instancedChangedPixels: sum((v) => v.instanced.changed.pixels),
        repeatChangedPixels: sum((v) => v.water.repeat.pixels + v.instanced.repeat.pixels),
      };
      facts.pixels.push({ ...summary, details: views });
      console.log(JSON.stringify(summary));
    }
  }
  facts.status = 'measured';
} catch (error) {
  facts.status = 'failed';
  facts.error = String(error?.stack ?? error);
  process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  facts.errors = errors;
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 1) + '\n');
  await browser.close();
  await game.close?.();
}
console.log(
  JSON.stringify({ status: facts.status, prepared: facts.prepared, error: facts.error, errors }),
);
process.exit();
