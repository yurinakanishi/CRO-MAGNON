// Real-Chrome check of the spruce collision trunk (2026-10-12): the player walks into spruce
// trunks with a held W key until the authoritative collision stops the body, then every vertex
// of the player's skinned body is tested against the delivered spruce's surface below its crown.
// A memory-only world (LOCAL_VERIFY in a throwaway save folder under <outDir>); the user's
// servers are never touched. Placing the player 2.4 m from a trunk and turning the camera toward
// it are preparation; the approach itself is real keyboard input.
// Usage: node scripts/qa-spruce-trunk.mjs <outDir> [--bounds <model-bounds.mts>]
//   [--character cro-female]: --bounds uses another MODEL_BOUNDS (an earlier
//   shared/model-bounds.mts) in this server and in the page, to compare footprints on one build.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { MODEL_BOUNDS } from '../dist/shared/model-bounds.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { terrainHeight } from '../dist/shared/terrain.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { geometryScene } from './measure-collision-bounds.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const out = path.resolve(process.argv[2] || `output/playwright/spruce-trunk/${Date.now()}`);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const character = option('--character', 'cro-female');
const boundsFile = option('--bounds', null);
const boundsModule = boundsFile ? await readFile(boundsFile, 'utf8') : null;
if (boundsModule) {
  const other = new Function(boundsModule.replace('export const MODEL_BOUNDS =', 'return'))();
  for (const key of Object.keys(MODEL_BOUNDS)) MODEL_BOUNDS[key] = other[key];
}
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(100);
  }
}

// The delivered spruce (the near LOD the renderer draws within 14 m), sliced every centimetre
// below the crown (2.02 m). The trunk surface has inner walls, so each slice is reduced to its
// outer envelope: the farthest surface from the slice's centre in each 5-degree direction. A body
// vertex inside that envelope is hidden inside the trunk or its root flare.
const CROWN = 2,
  STEP = 0.01,
  BINS = 72;
const asset = JSON.parse(await readFile('public/models/valley-pine/asset.json', 'utf8'));
const spruce = (await geometryScene(`public${asset.url}`)).scene;
spruce.updateMatrixWorld(true);
const triangles = [];
spruce.traverse((node) => {
  if (!node.isMesh) return;
  const index = node.geometry.index,
    position = node.geometry.attributes.position,
    count = index ? index.count : position.count;
  const corner = (i) =>
    node
      .getVertexPosition(index ? index.getX(i) : i, new THREE.Vector3())
      .applyMatrix4(node.matrixWorld)
      .toArray();
  for (let i = 0; i < count; i += 3) triangles.push([corner(i), corner(i + 1), corner(i + 2)]);
});
const slices = [];
for (let k = 0; k * STEP <= CROWN + 1e-9; k++) {
  const y = k * STEP,
    segments = [];
  for (const triangle of triangles) {
    const cut = [];
    for (let e = 0; e < 3; e++) {
      const p = triangle[e],
        q = triangle[(e + 1) % 3];
      if ((p[1] - y) * (q[1] - y) < 0) {
        const t = (y - p[1]) / (q[1] - p[1]);
        cut.push([p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t]);
      }
    }
    if (cut.length === 2) segments.push(cut);
  }
  const points = segments.flatMap(([[x1, z1], [x2, z2]]) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.005));
    return Array.from({ length: n + 1 }, (_, i) => [
      x1 + ((x2 - x1) * i) / n,
      z1 + ((z2 - z1) * i) / n,
    ]);
  });
  // Below the lowest vertex (2.6 mm) there is no surface to be inside.
  if (!points.length) {
    slices.push(null);
    continue;
  }
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]);
  const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const reach = new Float64Array(BINS).fill(-1);
  for (const [px, pz] of points) {
    const bin =
      Math.floor(((Math.atan2(pz - centre[1], px - centre[0]) + Math.PI) / (2 * Math.PI)) * BINS) %
      BINS;
    reach[bin] = Math.max(reach[bin], Math.hypot(px - centre[0], pz - centre[1]));
  }
  // A direction without surface takes the nearer of its neighbours that have one.
  for (let bin = 0; bin < BINS; bin++)
    if (reach[bin] < 0)
      for (let k = 1; k < BINS / 2; k++) {
        const near = Math.max(reach[(bin + k) % BINS], reach[(bin - k + BINS) % BINS]);
        if (near >= 0) {
          reach[bin] = near;
          break;
        }
      }
  slices.push({ centre, reach });
}
/** How far (model metres) a model-space point lies inside the spruce's outer envelope; 0 outside. */
function depthInside(x, y, z) {
  const slice = y >= 0 && y <= CROWN ? slices[Math.round(y / STEP)] : null;
  if (!slice) return 0;
  const { centre, reach } = slice,
    angle = Math.atan2(z - centre[1], x - centre[0]),
    at = ((angle + Math.PI) / (2 * Math.PI)) * BINS - 0.5,
    low = Math.floor(at),
    t = at - low,
    envelope = reach[(low + BINS) % BINS] * (1 - t) + reach[(low + 1) % BINS] * t;
  return Math.max(0, envelope - Math.hypot(x - centre[0], z - centre[1]));
}

const settings = localVerificationSettings(out);
const game = createGameServer({ ...settings, port: 0 });
const { port } = await game.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
});
const errors = [],
  facts = {
    date: new Date().toISOString(),
    character,
    bounds: boundsFile ?? 'shared/model-bounds.mts',
    trunk: MODEL_BOUNDS['valley-pine'].trunk,
    spruce: { url: asset.url, sha256: asset.sha256 },
    approaches: [],
  };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const seen = { id: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (m.type === 'welcome') seen.id = m.id;
      } catch {}
    }),
  );
  // Expose the renderer as the other QA hosts do (the entry module, extended in transit).
  await page.route(
    (url) => url.pathname === '/src/boot.js',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        status: 200,
        body:
          `import { WorldRenderer as Reviewed } from './world3d.js';
{ const render = Reviewed.prototype.render;
  Reviewed.prototype.render = function (...args) { window.cameraReview = this; return render.apply(this, args); }; }
` + (await response.text()),
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  );
  if (boundsModule)
    await page.route(
      (url) => url.pathname === '/shared/model-bounds.mjs',
      (route) =>
        route.fulfill({
          status: 200,
          body: boundsModule,
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          },
        }),
    );
  await page.addInitScript(() => localStorage.setItem('cro-name', 'TrunkQA'));
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
    'joined',
  );
  const room = game.rooms.get(settings.runtimeConfig.room);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  const me = () => room.players.get(seen.id);
  await until(() => page.evaluate(() => !!window.cameraReview?.selfId), 'renderer');
  const radius = me().radius;
  facts.radius = radius;
  const free = (p) => room.collision.free(p, radius);
  const trunkBox = (tree) =>
    room.collision.obstacles.find(
      (o) => o.cameraPassable && Math.hypot(o.groundX - tree.x, o.groundZ - tree.z) < 1e-9,
    );
  // The three free-standing spruces nearest the camp (nothing else solid within 3.5 m), from
  // four sides: two faces and two corners of each collision box.
  const alone = (tree) =>
    [...room.collision.nearby(tree, 3.5)].every(
      (o) =>
        o === trunkBox(tree) ||
        Math.hypot(o.x - tree.x, o.z - tree.z) > 3.5 + (o.radius ?? Math.hypot(o.hx, o.hz)),
    );
  const trees = SCENERY.trees
    .filter((t) => !t.surface)
    .map((t) => ({ ...t, d: Math.hypot(t.x - 50, t.z - 50) }))
    .sort((p, q) => p.d - q.d)
    .filter(alone)
    .slice(0, 3);
  async function view(yaw, pitch, distance, wait = 500) {
    await page.evaluate(
      ({ yaw, pitch, distance }) => {
        const r = window.cameraReview;
        Object.assign(r, { yaw, pitch, targetDistance: distance, distance });
      },
      { yaw, pitch, distance },
    );
    await sleep(wait);
  }
  for (const [n, tree] of trees.entries()) {
    const box = trunkBox(tree);
    assert.ok(box, `collision trunk of tree ${n}`);
    for (const [side, angle] of [
      ['face +x', 0],
      ['face +z', Math.PI / 2],
      ['corner -x-z', (Math.PI * 5) / 4],
      ['corner +x-z', (Math.PI * 7) / 4],
    ]) {
      // Local box axes in world space: x along (c, -s), z along (s, c).
      const lx = Math.cos(angle),
        lz = Math.sin(angle),
        dir = { x: box.c * lx + box.s * lz, z: -box.s * lx + box.c * lz };
      const start = { x: box.x + dir.x * 2.4, z: box.z + dir.z * 2.4 };
      if (!free(start)) {
        facts.approaches.push({ tree: n, side, skipped: 'start blocked' });
        continue;
      }
      const p = me();
      stopActor(p);
      Object.assign(p, { ...start, warpSequence: (p.warpSequence ?? 0) + 1 });
      await until(
        () =>
          page.evaluate(({ x, z }) => {
            const r = window.cameraReview,
              self = r.players.get(r.selfId);
            return (
              !!self && Math.hypot(self.model.position.x - x, self.model.position.z - z) < 0.05
            );
          }, start),
        `placed at tree ${n} ${side}`,
      );
      // W walks away from the camera: look from the start toward the trunk.
      await view(Math.atan2(start.x - box.x, start.z - box.z), 0.25, 5.5, 700);
      await page.bringToFront();
      await page.keyboard.down('KeyW');
      await sleep(1800);
      await page.keyboard.up('KeyW');
      await sleep(700);
      const end = { x: me().x, z: me().z };
      // The skinned body as drawn in the frame after it came to rest.
      const body = await page.evaluate(() => {
        const r = window.cameraReview,
          model = r.players.get(r.selfId).model,
          v = model.position.clone(),
          list = [];
        model.updateMatrixWorld(true);
        model.traverse((node) => {
          if (!node.isSkinnedMesh) return;
          for (let q = node; q; q = q.parent) if (!q.visible) return;
          const count = node.geometry.attributes.position.count;
          for (let i = 0; i < count; i++) {
            node.getVertexPosition(i, v).applyMatrix4(node.matrixWorld);
            list.push(v.x, v.y, v.z);
          }
        });
        return { list, at: model.position.toArray() };
      });
      const ground = terrainHeight(tree.x, tree.z),
        [sx, sy, sz] = tree.scale,
        c = Math.cos(tree.yaw),
        s = Math.sin(tree.yaw);
      let inside = 0,
        deepest = 0,
        deepestAt = null,
        highest = null;
      for (let i = 0; i < body.list.length; i += 3) {
        const dx = body.list[i] - tree.x,
          dz = body.list[i + 2] - tree.z,
          y = (body.list[i + 1] - ground) / sy;
        const depth = depthInside((c * dx - s * dz) / sx, y, (s * dx + c * dz) / sz) * sx;
        if (!(depth > 0)) continue;
        inside++;
        highest = Math.max(highest ?? 0, Number((y * sy).toFixed(3)));
        if (depth > deepest) [deepest, deepestAt] = [depth, Number((y * sy).toFixed(3))];
      }
      // The trunk box's local frame: how far the body's circle is from its faces.
      const ox = box.c * (end.x - box.x) - box.s * (end.z - box.z),
        oz = box.s * (end.x - box.x) + box.c * (end.z - box.z),
        gap =
          Math.hypot(Math.max(Math.abs(ox) - box.hx, 0), Math.max(Math.abs(oz) - box.hz, 0)) -
          radius;
      // A side view for the record. The renderer hides a tree the sight passes near
      // (LandscapeInstances.viewHidden); this view keeps it drawn, for the picture only.
      const file = `tree${n}-${side.replaceAll('+', 'p').replaceAll('-', 'm').replace(/\W+/g, '')}.png`;
      await page.evaluate(() => {
        for (const landscape of window.cameraReview.landscapes)
          landscape.viewHidden = () => new Set();
      });
      await view(Math.atan2(start.x - box.x, start.z - box.z) + Math.PI / 2, 0.08, 3.2, 900);
      await page.screenshot({ path: path.join(out, file) });
      await page.evaluate(() => {
        for (const landscape of window.cameraReview.landscapes) delete landscape.viewHidden;
      });
      facts.approaches.push({
        tree: n,
        treeAt: [tree.x, tree.z],
        scale: tree.scale,
        side,
        start,
        end,
        travelled: Number(Math.hypot(end.x - start.x, end.z - start.z).toFixed(3)),
        fromTrunkCentre: Number(Math.hypot(end.x - box.x, end.z - box.z).toFixed(3)),
        // How far the body ended beside its line of approach (a slide along the trunk).
        offLine: Number(Math.abs(dir.x * (end.z - box.z) - dir.z * (end.x - box.x)).toFixed(3)),
        boxGap: Number(gap.toFixed(4)),
        bodyVertices: body.list.length / 3,
        insideSpruce: inside,
        deepestMetres: Number(deepest.toFixed(4)),
        deepestAtHeight: deepestAt,
        highestInsideHeight: highest,
        file,
      });
    }
  }
  facts.dataset = await page.locator('#world').evaluate((el) => ({
    fps: el.dataset.fps,
    playerModel: el.dataset.playerModel,
  }));
  facts.errors = errors;
  facts.status = 'measured';
} catch (error) {
  facts.status = 'failed';
  facts.error = String(error?.stack ?? error);
  facts.errors = errors;
  process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 1) + '\n');
  await browser.close();
  await game.close?.();
}
for (const a of facts.approaches)
  console.log(
    a.skipped
      ? `tree${a.tree} ${a.side}: ${a.skipped}`
      : `tree${a.tree} ${a.side.padEnd(11)} travelled ${a.travelled} m, ${a.fromTrunkCentre} m from the trunk box centre (${a.offLine} m off the line), box gap ${a.boxGap} m, body vertices inside the spruce ${a.insideSpruce}/${a.bodyVertices} (highest ${a.highestInsideHeight} m above the ground), deepest ${a.deepestMetres} m at ${a.deepestAtHeight} m`,
  );
console.log(JSON.stringify({ status: facts.status, error: facts.error, errors }));
process.exit();
