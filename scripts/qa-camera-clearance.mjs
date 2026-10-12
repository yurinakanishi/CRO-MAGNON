// Real-Chrome camera clearance QA (2026-10-12): does the third-person camera end up inside
// a tree, a rock, a cave or castle wall, the mountain, or the player's own body?
// A memory-only world (LOCAL_VERIFY in a throwaway save folder under <outDir>); the user's
// servers are never touched. Spots are found from the authoritative collision: the player
// stands against a tree trunk, inside a spruce's skirt, against boulders, against the cave's
// walls and beside its mouth. At each spot the camera is set to fixed yaw/pitch directions
// (preparation values, not input) and, after the game's own frames, the in-page probe reads
// the camera the frame was drawn with:
//   clearance  the distance from the camera to the nearest drawn world triangle; below the
//              near plane's corner distance (nearCorner) the near plane may slice it open
//   blocked    the sight segment from the look target to the camera crosses a drawn triangle
//   self       the nearest drawn vertex of the player's own (skinned) body and its opacity
// A continuous turn (frame by frame, time based) catches what a settled view hides.
// Usage: node scripts/qa-camera-clearance.mjs <outDir> [--character cro-female] [--phone]
//   [--only spotA,spotB] [--browser <build>]: --browser serves another build's dist/src,
//   dist/shared and public/index.html (an earlier revision) with this checkout's assets.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const out = path.resolve(process.argv[2] || `output/playwright/camera-clearance/${Date.now()}`);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const character = option('--character', 'cro-female');
const phone = process.argv.includes('--phone');
// --only spotA,spotB measures just those spots (and their turns).
const only = option('--only', null)?.split(',') ?? null;
// --profile adds a CPU profile of each cost turn: the functions with the most time per frame.
const profiling = process.argv.includes('--profile');
// --cost-only measures just the frame cost (no clearance views or probed turns).
const costOnly = process.argv.includes('--cost-only');
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(`Timeout: ${label}`);
    await sleep(100);
  }
}

// The renderer of the page, exposed as the existing QA hosts do, plus a per-frame hook. The
// page entry module is extended in transit; the document itself is served unchanged (a
// fulfilled document would lose its local address space and its socket to this server).
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

/** In-page probe: geometry around the camera of the last drawn frame (see the header). */
async function installProbe() {
  const THREE = await import('/vendor/three.module.js');
  // The hillside the mountain shader discards inside the cave's rock envelope is not drawn
  // (the discard of src/mountain-materials.ts, restated so that earlier builds are measured
  // with it as well).
  const { CAMP_CAVE, CAMP_MOUNTAIN, CAVE_BEND } = await import('/shared/camp-cave-layout.mjs');
  const { CAMP_CAVE_SURFACE_DATA: cave } = await import('/shared/camp-cave-surface-data.mjs');
  const roofAt = (u, v) => {
    const x = Math.min(Math.max(u * cave.nx - 0.5, 0), cave.nx - 1),
      z = Math.min(Math.max(v * cave.nz - 0.5, 0), cave.nz - 1);
    const x0 = Math.floor(x),
      z0 = Math.floor(z),
      x1 = Math.min(x0 + 1, cave.nx - 1),
      z1 = Math.min(z0 + 1, cave.nz - 1),
      at = (i, k) => cave.roofs[k * cave.nx + i];
    const near = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * (x - x0),
      far = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * (x - x0);
    return near + (far - near) * (z - z0);
  };
  const mountainCaveClipped = (x, y, z) => {
    const lx = CAMP_CAVE.x - (CAMP_MOUNTAIN.x - x),
      lz = CAMP_CAVE.z - (CAMP_MOUNTAIN.z - z);
    const u = (lx - cave.minX) / (cave.nx * cave.step),
      v = (lz - cave.minZ) / (cave.nz * cave.step);
    if (u < 0 || v < 0 || u > 1 || v > 1) return false;
    const roof = roofAt(u, v),
      bend = Math.min(Math.max(-lz / CAVE_BEND.depth, 0), 1),
      centre = CAVE_BEND.offset * bend * bend * (3 - 2 * bend),
      t = Math.min(Math.max((lz - 3) / 4, 0), 1),
      width = 6.6 + (6.0 - 6.6) * t * t * (3 - 2 * t);
    return (
      Math.abs(lx - centre) < width &&
      roof > 1.3 &&
      y < CAMP_CAVE.elevation + CAMP_CAVE.groundOffset + roof - 0.15
    );
  };
  const cache = new WeakMap();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    closest = new THREE.Vector3(),
    hit = new THREE.Vector3(),
    v = new THREE.Vector3();
  const triangle = new THREE.Triangle(),
    ray = new THREE.Ray(),
    matrix = new THREE.Matrix4(),
    world = new THREE.Matrix4(),
    sphere = new THREE.Sphere(),
    box = new THREE.Box3(),
    meshBox = new THREE.Box3();
  const shown = (node, camera) => {
    for (let n = node; n; n = n.parent) if (!n.visible) return false;
    return node.layers.test(camera.layers);
  };
  const opacityOf = (node) =>
    Math.max(
      ...(Array.isArray(node.material) ? node.material : [node.material]).map((m) =>
        !m.visible ? 0 : m.alphaHash || m.transparent ? m.opacity : 1,
      ),
    );
  // World-space corners of a static mesh's drawn triangles, computed once (landmarks and
  // props never move); a mountain triangle the shader discards at every corner is left out.
  const corners = (mesh, mountain) => {
    const cached = cache.get(mesh);
    if (cached?.geometry === mesh.geometry) return cached.data;
    const position = mesh.geometry.attributes.position,
      index = mesh.geometry.index,
      count = index ? index.count : position.count,
      data = [];
    for (let i = 0; i < count; i += 3) {
      const local = [0, 1, 2].map((k) =>
        new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + k) : i + k),
      );
      if (mountain && local.every((p) => mountainCaveClipped(p.x, p.y, p.z))) continue;
      for (const p of local) data.push(...p.applyMatrix4(mesh.matrixWorld).toArray());
    }
    const packed = Float32Array.from(data);
    cache.set(mesh, { geometry: mesh.geometry, data: packed });
    return packed;
  };
  window.cameraProbe = ({ self: measureSelf = true } = {}) => {
    const r = window.cameraReview,
      camera = r.camera,
      cam = camera.position.clone(),
      aim = r.focus.clone();
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const nearCorner =
      camera.near * Math.sqrt(1 + half * half * (1 + camera.aspect * camera.aspect));
    const direction = cam.clone().sub(aim),
      length = direction.length();
    direction.normalize();
    ray.set(aim, direction);
    const reach = 0.6;
    box.min.set(Math.min(cam.x, aim.x), Math.min(cam.y, aim.y), Math.min(cam.z, aim.z));
    box.max.set(Math.max(cam.x, aim.x), Math.max(cam.y, aim.y), Math.max(cam.z, aim.z));
    box.expandByScalar(reach);
    const result = {
      camera: cam.toArray().map((n) => +n.toFixed(3)),
      focus: aim.toArray().map((n) => +n.toFixed(3)),
      yaw: +r.yaw.toFixed(3),
      pitch: +r.pitch.toFixed(3),
      distance: +length.toFixed(3),
      nearCorner: +nearCorner.toFixed(4),
      clearance: Infinity,
      clearanceSource: null,
      blocked: null,
      triangles: 0,
    };
    const consider = (source) => {
      if (
        Math.max(a.x, b.x, c.x) < box.min.x ||
        Math.min(a.x, b.x, c.x) > box.max.x ||
        Math.max(a.y, b.y, c.y) < box.min.y ||
        Math.min(a.y, b.y, c.y) > box.max.y ||
        Math.max(a.z, b.z, c.z) < box.min.z ||
        Math.min(a.z, b.z, c.z) > box.max.z
      )
        return;
      result.triangles++;
      triangle.set(a, b, c);
      triangle.closestPointToPoint(cam, closest);
      const d = closest.distanceTo(cam);
      if (d < result.clearance) {
        result.clearance = d;
        result.clearanceSource = source;
      }
      if (ray.intersectTriangle(a, b, c, false, hit)) {
        const t = hit.distanceTo(aim);
        if (t > 0.02 && t < length - 1e-4 && (!result.blocked || t < result.blocked.at))
          result.blocked = { source, at: +t.toFixed(3) };
      }
    };
    // The cave and the castle, from their exact camera triangle grids.
    for (const [source, grid] of [
      ['camp-cave', r.landmarks?.caveCamera],
      ['valley-castle', r.landmarks?.castleCamera],
    ]) {
      if (!grid) continue;
      const seen = new Set(),
        size = grid.cellSize;
      for (let x = Math.floor(box.min.x / size); x <= Math.floor(box.max.x / size); x++)
        for (let z = Math.floor(box.min.z / size); z <= Math.floor(box.max.z / size); z++)
          for (const id of grid.cell((x + 0.5) * size, (z + 0.5) * size)) {
            if (seen.has(id)) continue;
            seen.add(id);
            a.fromArray(grid.vertices, id * 9);
            b.fromArray(grid.vertices, id * 9 + 3);
            c.fromArray(grid.vertices, id * 9 + 6);
            consider(source);
          }
    }
    // Drawn trees and boulders: the instanced landscapes' detailed levels.
    for (const landscape of r.landscapes) {
      if (landscape.key !== 'valley-pine' && landscape.key !== 'valley-boulder') continue;
      for (const level of landscape.levels.slice(0, 2))
        for (const { mesh } of level) {
          const geometry = mesh.geometry;
          if (!geometry.boundingSphere) geometry.computeBoundingSphere();
          const position = geometry.attributes.position,
            index = geometry.index,
            count = index ? index.count : position.count;
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            world.multiplyMatrices(mesh.matrixWorld, matrix);
            sphere.copy(geometry.boundingSphere).applyMatrix4(world);
            if (!box.intersectsSphere(sphere)) continue;
            for (let j = 0; j < count; j += 3) {
              a.fromBufferAttribute(position, index ? index.getX(j) : j).applyMatrix4(world);
              b.fromBufferAttribute(position, index ? index.getX(j + 1) : j + 1).applyMatrix4(
                world,
              );
              c.fromBufferAttribute(position, index ? index.getX(j + 2) : j + 2).applyMatrix4(
                world,
              );
              consider(landscape.key);
            }
          }
        }
    }
    // Every other static model: landmarks (the mountain, ruins), props and resources.
    const roots = [];
    for (const [id, root] of r.landmarks?.instances ?? [])
      if (id !== 'camp-cave' && id !== 'valley-castle') roots.push([id, root]);
    for (const { root } of r.staticScenery) roots.push(['scenery', root]);
    for (const item of r.resources.values()) roots.push(['resource', item.model]);
    for (const [source, root] of roots) {
      if (!root || !shown(root, camera)) continue;
      root.traverse((node) => {
        if (!node.isMesh || node.isInstancedMesh || node.isSkinnedMesh || !shown(node, camera))
          return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        meshBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
        if (!meshBox.intersectsBox(box)) return;
        const data = corners(node, source === 'camp-mountain');
        for (let j = 0; j < data.length; j += 9) {
          a.fromArray(data, j);
          b.fromArray(data, j + 3);
          c.fromArray(data, j + 6);
          consider(source);
        }
      });
    }
    result.clearance = +result.clearance.toFixed(4);
    // The player's own body, skinned as drawn; a mesh faded below half counts as not drawn.
    if (measureSelf) {
      const self = r.players.get(r.selfId);
      let nearest = Infinity,
        nearestDrawn = Infinity,
        opacity = 0;
      self?.model.updateMatrixWorld(true);
      self?.model.traverse((node) => {
        if (!node.isMesh || !shown(node, camera)) return;
        const seen = opacityOf(node);
        opacity = Math.max(opacity, seen);
        const position = node.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          node.getVertexPosition(i, v).applyMatrix4(node.matrixWorld);
          const d = v.distanceToSquared(cam);
          if (d < nearest) nearest = d;
          if (seen >= 0.5 && d < nearestDrawn) nearestDrawn = d;
        }
      });
      result.self = {
        nearest: +Math.sqrt(nearest).toFixed(4),
        nearestDrawn: +Math.sqrt(nearestDrawn).toFixed(4),
        opacity: +opacity.toFixed(3),
      };
    }
    // Other actors whose bounds hold the camera.
    const inside = [];
    const test = (label, model) => {
      if (!model || !shown(model, camera)) return;
      meshBox.setFromObject(model).expandByScalar(nearCorner);
      if (meshBox.containsPoint(cam)) inside.push(label);
    };
    for (const [id, entity] of r.players) if (id !== r.selfId) test(`player:${id}`, entity.model);
    for (const animal of r.mammoths ?? []) test(`animal:${animal.id}`, animal.model);
    for (const enemy of r.enemies.values()) test(`enemy:${enemy.state.id}`, enemy.model);
    result.insideActors = inside;
    // What each solid allows along the orbit (where the renderer has these sources).
    const orbit = new THREE.Vector3(
        Math.sin(r.yaw) * Math.cos(r.pitch),
        Math.sin(r.pitch),
        Math.cos(r.yaw) * Math.cos(r.pitch),
      ),
      reachOf = (camera) => {
        const h = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        return camera.near * Math.sqrt(1 + h * h * (1 + camera.aspect * camera.aspect)) + 0.05;
      },
      round = (n) => (n === undefined ? undefined : +n.toFixed(3));
    if (r.landmarks?.caveCamera?.sweep) {
      const radius = reachOf(camera);
      result.sources = {
        boxes: round(r.collision.cameraDistance(aim, orbit, r.distance, radius)),
        cave: round(r.landmarks.caveCamera?.sweep(aim, orbit, r.distance, radius)),
        castle: round(r.landmarks.castleCamera?.sweep(aim, orbit, r.distance, radius)),
        mountain: round(r.landmarks.mountainCamera?.sweep(aim, orbit, r.distance, radius)),
        lift: round(r.cameraLift),
      };
    }
    return result;
  };
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
    phone,
    viewport: phone ? [390, 844] : [1280, 800],
    spots: [],
    turns: [],
    cost: [],
  };
let page, room, seen;
try {
  page = await browser.newPage({
    viewport: { width: facts.viewport[0], height: facts.viewport[1] },
    hasTouch: phone,
    isMobile: phone,
  });
  seen = { id: null };
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
  await page.addInitScript(() => localStorage.setItem('cro-name', 'CameraQA'));
  await page.goto(`${base}/`);
  const use = (selector) => (phone ? page.locator(selector).tap() : page.locator(selector).click());
  await use('#title-start');
  await use(`#setup-form .character-choice:has(input[value="${character}"])`);
  await use('#setup-flow-yes');
  // The world is entered from the loading cave (start flow of 2026-10-10).
  await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 180000 });
  await use('[data-cave-proceed]');
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await until(
    () => seen.id && game.rooms.get(settings.runtimeConfig.room)?.players.has(seen.id),
    'joined',
  );
  room = game.rooms.get(settings.runtimeConfig.room);
  room.enemies = [];
  room.behemoth = room.sabertooth = null;
  const me = () => room.players.get(seen.id);
  await until(() => page.evaluate(() => !!window.cameraReview?.selfId), 'renderer');
  await page.evaluate(installProbe);
  const radius = me().radius;
  facts.radius = radius;
  facts.environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio,
    renderer: (() => {
      const gl = window.cameraReview.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })(),
  }));

  // Spots from the authoritative collision.
  const free = (p) => room.collision.free(p, radius);
  /** The first free point from `from` outward along the angle: standing against what blocks. */
  const against = (from, angle, start = 0, limit = 6) => {
    for (let d = start; d <= limit; d += 0.02) {
      const p = { x: from.x + Math.cos(angle) * d, z: from.z + Math.sin(angle) * d };
      if (free(p)) return { ...p, d };
    }
    return null;
  };
  const spots = [];
  const trees = SCENERY.trees
    .filter((t) => !t.surface)
    .map((t) => ({ ...t, d: Math.hypot(t.x - 50, t.z - 50) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 2);
  for (const [n, tree] of trees.entries()) {
    // Against the trunk on the side facing the camp, then 1.3 m out inside the skirt.
    const angle = Math.atan2(50 - tree.z, 50 - tree.x);
    const trunk = against(tree, angle);
    assert.ok(trunk, `room beside tree ${n}`);
    spots.push({ name: `tree${n}-trunk`, kind: 'tree', x: trunk.x, z: trunk.z, tree });
    const skirt = against(tree, angle, Math.max(trunk.d, 1.3 + radius * 0.3));
    spots.push({ name: `tree${n}-skirt`, kind: 'tree', x: skirt.x, z: skirt.z, tree });
  }
  for (const [n, rock] of SCENERY.rocks
    .filter((r) => !r.surface && r.key === 'valley-boulder' && r.scale > 1.2)
    .map((r) => ({ ...r, d: Math.hypot(r.x - 50, r.z - 60) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 2)
    .entries()) {
    const angle = Math.atan2(60 - rock.z, 50 - rock.x);
    const spot = against(rock, angle);
    assert.ok(spot, `room beside rock ${n}`);
    spots.push({ name: `rock${n}`, kind: 'rock', x: spot.x, z: spot.z, rock });
  }
  for (const depth of [-21, -8, 6, 12])
    for (const side of [1, -1]) {
      const centre = caveWorldAt(depth);
      // March across from the middle to the last free point before the wall (or the
      // cliff beside the mouth, outside).
      let last = null;
      for (let across = 0; across <= 12; across += 0.02) {
        const p = caveWorldAt(depth, side * across);
        if (free(p)) last = p;
        else if (last) break;
      }
      assert.ok(last, `cave room at ${depth}/${side}`);
      spots.push({
        name: `cave${depth}${side > 0 ? 'L' : 'R'}`,
        kind: depth < 10 ? 'cave' : 'mouth',
        x: last.x,
        z: last.z,
        centre,
      });
    }

  async function place(spot) {
    const p = me();
    stopActor(p);
    Object.assign(p, { x: spot.x, z: spot.z, warpSequence: (p.warpSequence ?? 0) + 1 });
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
          { x: spot.x, z: spot.z },
        ),
      `placed at ${spot.name}`,
    );
    if (spot.kind === 'cave' || spot.kind === 'mouth')
      await until(() => page.evaluate(() => !!window.cameraReview.landmarks?.caveCamera), 'cave');
    await sleep(600);
  }
  async function pose(yaw, pitch, distance = 5.5, wait = 450) {
    await page.evaluate(
      ({ yaw, pitch, distance }) => {
        const r = window.cameraReview;
        r.yaw = yaw;
        r.pitch = pitch;
        r.targetDistance = distance;
        r.distance = distance;
      },
      { yaw, pitch, distance },
    );
    await sleep(wait);
  }
  const YAWS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  const PITCHES = [-0.3, 0.19, 0.7];
  // A view through geometry first, then the least clearance.
  const score = (s) => (s.blocked ? 10 : 0) + s.nearCorner - s.clearance;
  const worst = (samples) => samples.reduce((w, s) => (score(s) > score(w) ? s : w));
  for (const spot of spots.filter((s) => !costOnly && (!only || only.includes(s.name)))) {
    await place(spot);
    const samples = [];
    for (const pitch of PITCHES)
      for (const yaw of YAWS) {
        await pose(yaw, pitch);
        samples.push(await page.evaluate(() => window.cameraProbe()));
      }
    const clipped = samples.filter((s) => s.clearance < s.nearCorner);
    const blocked = samples.filter((s) => s.blocked);
    const selfClipped = samples.filter((s) => s.self.nearestDrawn < s.nearCorner);
    const summary = {
      name: spot.name,
      kind: spot.kind,
      at: [+spot.x.toFixed(2), +spot.z.toFixed(2)],
      samples: samples.length,
      clipped: clipped.length,
      blocked: blocked.length,
      blockedBy: Object.fromEntries(
        [...new Set(blocked.map((s) => s.blocked.source))].map((source) => [
          source,
          blocked.filter((s) => s.blocked.source === source).length,
        ]),
      ),
      selfClipped: selfClipped.length,
      minClearance: Math.min(...samples.map((s) => s.clearance)),
      minDistance: Math.min(...samples.map((s) => s.distance)),
      minSelf: Math.min(...samples.map((s) => s.self.nearest)),
      insideActors: samples.filter((s) => s.insideActors.length).length,
    };
    // The worst view of the spot, and its closest view of the player's own body.
    const bad = worst(samples);
    await pose(bad.yaw, bad.pitch);
    await page.screenshot({ path: path.join(out, `${spot.name}-worst.png`) });
    summary.worst = await page.evaluate(() => window.cameraProbe());
    const close = samples.reduce((w, s) => (s.self.nearest < w.self.nearest ? s : w));
    await pose(close.yaw, close.pitch);
    await page.screenshot({ path: path.join(out, `${spot.name}-closest-self.png`) });
    summary.closestSelf = await page.evaluate(() => window.cameraProbe());
    // The most faded view in which the player is still drawn (dithered), if any.
    const faded = samples
      .filter((s) => s.self.opacity > 0 && s.self.opacity < 1)
      .sort((p, q) => p.self.opacity - q.self.opacity)[0];
    if (faded) {
      await pose(faded.yaw, faded.pitch);
      await page.screenshot({ path: path.join(out, `${spot.name}-faded.png`) });
      summary.faded = await page.evaluate(() => window.cameraProbe());
    }
    facts.spots.push({ ...summary, details: samples });
    console.log(
      JSON.stringify({
        spot: spot.name,
        clipped: summary.clipped,
        blocked: summary.blocked,
        blockedBy: summary.blockedBy,
        selfClipped: summary.selfClipped,
        minClearance: summary.minClearance,
        minSelf: summary.minSelf,
      }),
    );
  }
  // A continuous turn at 90 degrees per second, one probe per drawn frame.
  for (const name of ['tree0-skirt', 'tree1-trunk', 'cave-21L', 'cave6R', 'rock0']) {
    const spot = spots.find((s) => s.name === name);
    if (!spot || costOnly || (only && !only.includes(name))) continue;
    await place(spot);
    for (const pitch of [0.19, 0.7]) {
      await pose(0, pitch);
      const frames = await page.evaluate(
        ({ seconds, speed }) =>
          new Promise((resolve) => {
            const r = window.cameraReview,
              frames = [],
              start = performance.now();
            window.cameraFrameHook = () => {
              const t = (performance.now() - start) / 1000;
              const probe = window.cameraProbe({ self: false });
              frames.push({
                t: +t.toFixed(3),
                yaw: probe.yaw,
                clearance: probe.clearance,
                source: probe.clearanceSource,
                blocked: probe.blocked?.source ?? null,
                nearCorner: probe.nearCorner,
                distance: probe.distance,
              });
              if (t >= seconds) {
                window.cameraFrameHook = null;
                resolve(frames);
              } else r.yaw = speed * t;
            };
          }),
        { seconds: 4.2, speed: Math.PI / 2 },
      );
      const turn = {
        name,
        pitch,
        frames: frames.length,
        clipped: frames.filter((f) => f.clearance < f.nearCorner).length,
        blocked: frames.filter((f) => f.blocked).length,
        blockedBy: [...new Set(frames.filter((f) => f.blocked).map((f) => f.blocked))],
      };
      facts.turns.push({ ...turn, details: frames });
      console.log(JSON.stringify(turn));
    }
  }
  // The frame's CPU cost while the camera turns at 90 degrees per second, without the probe:
  // the renderer's simulation time (its 0.8/0.2 running mean, unrolled to each frame).
  for (const name of ['cave-21L', 'cave6R', 'tree0-skirt', 'rock0']) {
    const spot = spots.find((s) => s.name === name);
    if (!spot || (only && !only.includes(name))) continue;
    await place(spot);
    await pose(0, 0.19);
    const cdp = profiling ? await page.context().newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.send('Profiler.start');
    }
    const frames = await page.evaluate(
      ({ seconds, speed }) =>
        new Promise((resolve) => {
          const r = window.cameraReview,
            costs = [],
            start = performance.now();
          let mean = r.simulationMs,
            prepared = !!r.selfFade?.prepared;
          window.cameraFrameHook = () => {
            const t = (performance.now() - start) / 1000;
            costs.push((r.simulationMs - 0.8 * mean) / 0.2);
            mean = r.simulationMs;
            // The frame on which the player's fade compiled its programs (camera-fade.ts).
            if (!prepared && r.selfFade?.prepared) {
              prepared = true;
              window.cameraFadePrepared = { frame: costs.length - 1, cost: costs.at(-1) };
            }
            if (t >= seconds) {
              window.cameraFrameHook = null;
              resolve(costs);
            } else r.yaw = speed * t;
          };
        }),
      { seconds: 8, speed: Math.PI / 2 },
    );
    const prepared = await page.evaluate(() => {
      const value = window.cameraFadePrepared ?? null;
      window.cameraFadePrepared = null;
      return value;
    });
    const sorted = frames.slice(2).sort((a, b) => a - b),
      at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3);
    const cost = {
      name,
      frames: sorted.length,
      median: at(0.5),
      p95: at(0.95),
      max: at(1),
      worstFrames: frames
        .map((ms, frame) => ({ frame, ms: +ms.toFixed(1) }))
        .sort((p, q) => q.ms - p.ms)
        .slice(0, 3),
      ...(prepared ? { fadePrepared: prepared } : {}),
    };
    if (cdp) {
      // Self and inclusive time per function (each counted once per sampled stack), per frame.
      const { profile } = await cdp.send('Profiler.stop');
      await cdp.detach();
      const nodes = new Map(profile.nodes.map((node) => [node.id, node])),
        parents = new Map();
      for (const node of profile.nodes)
        for (const child of node.children ?? []) parents.set(child, node.id);
      const label = (node) =>
          `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}`,
        own = new Map(),
        within = new Map();
      profile.samples.forEach((id, k) => {
        const ms = profile.timeDeltas[k] / 1000,
          leaf = nodes.get(id),
          seen = new Set();
        own.set(label(leaf), (own.get(label(leaf)) ?? 0) + ms);
        for (let node = leaf; node; node = nodes.get(parents.get(node.id))) {
          const key = label(node);
          if (seen.has(key)) continue;
          seen.add(key);
          within.set(key, (within.get(key) ?? 0) + ms);
        }
      });
      const top = (map, n) =>
        [...map]
          .filter(([key]) => /\.(m?js):/.test(key) && !/^\(/.test(key))
          .sort((p, q) => q[1] - p[1])
          .slice(0, n)
          .map(([key, ms]) => [key, +(ms / frames.length).toFixed(3)]);
      cost.profile = { self: top(own, 25), inclusive: top(within, 40) };
    }
    facts.cost.push(cost);
    console.log(JSON.stringify({ cost }));
  }
  facts.totals = {
    samples: facts.spots.reduce((n, s) => n + s.samples, 0),
    clipped: facts.spots.reduce((n, s) => n + s.clipped, 0),
    blocked: facts.spots.reduce((n, s) => n + s.blocked, 0),
    selfClipped: facts.spots.reduce((n, s) => n + s.selfClipped, 0),
    insideActors: facts.spots.reduce((n, s) => n + s.insideActors, 0),
    turnFrames: facts.turns.reduce((n, t) => n + t.frames, 0),
    turnClipped: facts.turns.reduce((n, t) => n + t.clipped, 0),
    turnBlocked: facts.turns.reduce((n, t) => n + t.blocked, 0),
  };
  facts.dataset = await page.locator('#world').evaluate((el) => ({
    fps: el.dataset.fps,
    frameSimulationMs: el.dataset.frameSimulationMs,
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
  facts.failureState = await page
    ?.evaluate(() => ({
      body: document.body.className,
      world: { ...(document.getElementById('world')?.dataset ?? {}) },
      text: document.body.innerText.slice(0, 600),
    }))
    .catch((e) => String(e));
} finally {
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 1) + '\n');
  await browser.close();
  await game.close?.();
}
console.log(
  JSON.stringify({ status: facts.status, totals: facts.totals, error: facts.error, errors }),
);
process.exit();
