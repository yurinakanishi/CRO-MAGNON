import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { MOUNTAIN_LAKE as LAKE } from '../dist/shared/mountain-lake.mjs';

const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = `output/playwright/mountain-river/${process.argv[2] || 'current'}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const peers = [];
const checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst draw = WorldRenderer.prototype.render; WorldRenderer.prototype.render = function(...args) { window.riverWorld = this; return draw.apply(this,args); };',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=RIVER-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.riverWorld?.landmarks?.instances.has('camp-mountain'), {
    timeout: 120000,
  });
  // Camera-only preparation in a new, non-persistent QA room. No normal saves.
  await page.evaluate(() => {
    const w = riverWorld;
    w.qaRender = w.render;
    w.render = () => {};
  });
  const views = [
    ['summit-overview', [LAKE.x + 150, 150, LAKE.z + 150], [LAKE.x, 15, LAKE.z - 40]],
    ['lake', [LAKE.x + 55, 62, LAKE.z + 48], [LAKE.x, 33, LAKE.z]],
    ['lake-shore', [LAKE.x + 40, 40, LAKE.z + 8], [LAKE.x, 34, LAKE.z]],
    ['lake-outlet', [-5, 78, 324], [-45, 32, 290]],
    ['lake-above', [LAKE.x, 170, LAKE.z + 12], [LAKE.x, 34, LAKE.z]],
    ['overview', [112, 150, 310], [-50, 18, 235]],
    ['east-face', [100, 42, 214], [5, 17, 193]],
    ['source', [18, 53, 251], [-3, 31, 215]],
    ['waterfall', [43, 29, 203], [7, 22, 197]],
    ['confluence', [93, 23, 130], [51, 3, 164]],
  ];
  for (const [name, from, to] of views) {
    await page.evaluate(
      async ({ from, to }) => {
        const w = riverWorld;
        w.camera.position.fromArray(from);
        w.camera.lookAt(...to);
        w.camera.updateMatrixWorld(true);
        w.scene.fog.near = 350;
        w.scene.fog.far = 700;
        w.sun.position.set(to[0] - 32, to[1] + 48, to[2] - 25);
        w.sun.target.position.fromArray(to);
        for (let i = 0; i < 50; i++) {
          const time = performance.now() / 1000;
          w.openWorld.update(w.camera, time);
          w.landmarks.update(w.camera, time);
          w.regionalScenery?.update(w.camera, time);
          for (const landscape of w.landscapes ?? []) landscape.update(w.camera, time);
          w.waterMaterial.userData.time.value = time;
          w.renderer.render(w.scene, w.camera);
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      },
      { from, to },
    );
    await page.screenshot({ path: `${folder}/${name}.png` });
    if (name === 'waterfall' || name === 'lake') {
      const before = await page.screenshot();
      await page.evaluate(() => {
        riverWorld.waterMaterial.userData.time.value += 0.75;
        riverWorld.renderer.render(riverWorld.scene, riverWorld.camera);
      });
      const after = await page.screenshot({ path: `${folder}/${name}-flow.png` });
      assert.notEqual(
        createHash('sha256').update(before).digest('hex'),
        createHash('sha256').update(after).digest('hex'),
      );
      checks.push(`${name}: static camera and scene change visibly when only water time advances`);
    }
    console.log(name);
  }
  const state = await page.evaluate(() => ({
    river: riverWorld.mountainRiver?.userData,
    calls: riverWorld.renderer.info.render.calls,
    triangles: riverWorld.renderer.info.render.triangles,
    geometries: riverWorld.renderer.info.memory.geometries,
    textures: riverWorld.renderer.info.memory.textures,
  }));
  const surface = await page.evaluate(async () => {
    const w = riverWorld,
      T = await import('/vendor/three.module.js');
    const { MeshRayGrid } = await import('/src/mesh-ray-grid.js');
    const { mountainRiverSample, mountainRiverContains, MOUNTAIN_RIVER_LENGTH } =
      await import('/shared/mountain-river.mjs');
    const { MOUNTAIN_LAKE, mountainLakeAt, mountainLakePoint } =
      await import('/shared/mountain-lake.mjs');
    await Promise.all(w.openWorld.bankJobs.values());
    const root = w.landmarks.instances.get('camp-mountain');
    const grids = root.levels.map((level) => new MeshRayGrid(level.object));
    // Lake fragments outside the shared shore are discarded by its shader.
    // Keep its grid separate so those invisible triangles do not count as water.
    const riverMeshes = new T.Group();
    for (const node of w.mountainRiver.children)
      if (node.name !== 'Mountain lake') riverMeshes.add(node.clone());
    const water = new MeshRayGrid(riverMeshes);
    const lakeWater = new MeshRayGrid(w.mountainRiver.getObjectByName('Mountain lake'));
    const height = (grid, x, z) => {
      let y = -Infinity;
      grid.ray.set(new T.Vector3(x, 100, z), new T.Vector3(0, -1, 0));
      for (const id of grid.cells.get(
        `${Math.floor(x / grid.cellSize)},${Math.floor(z / grid.cellSize)}`,
      ) ?? []) {
        grid.a.fromArray(grid.vertices, id * 9);
        grid.b.fromArray(grid.vertices, id * 9 + 3);
        grid.c.fromArray(grid.vertices, id * 9 + 6);
        if (grid.ray.intersectTriangle(grid.a, grid.b, grid.c, false, grid.hit))
          y = Math.max(y, grid.hit.y);
      }
      return y;
    };
    const result = grids.map(() => ({
      samples: 0,
      missing: 0,
      buried: 0,
      minClearance: Infinity,
      examples: [],
      lakeSamples: 0,
      lakeMissing: 0,
      lakeBuried: 0,
      lakeMinClearance: Infinity,
      summitSamples: 0,
      summitMissing: 0,
      summitLow: 0,
      summitMinHeight: Infinity,
    }));
    for (let s = 1; s < MOUNTAIN_RIVER_LENGTH - 2; s += 0.2) {
      const p = mountainRiverSample(s);
      for (const across of [-0.8, 0, 0.8]) {
        const x = p.x + p.nx * p.width * across,
          z = p.z + p.nz * p.width * across;
        const lake = mountainLakeAt(x, z);
        const waterY = Math.max(
          height(water, x, z),
          lake && lake.shore < 0 ? height(lakeWater, x, z) : -Infinity,
        );
        grids.forEach((grid, i) => {
          const r = result[i],
            ground = height(grid, x, z);
          r.samples++;
          if (!Number.isFinite(waterY)) {
            r.missing++;
            if (r.examples.length < 10) r.examples.push({ s, across, x, z, missing: true });
          } else if (Number.isFinite(ground)) {
            const clearance = waterY - ground;
            r.minClearance = Math.min(r.minClearance, clearance);
            if (clearance < -0.025) {
              r.buried++;
              if (r.examples.length < 10)
                r.examples.push({ s, across, x, z, waterY, ground, clearance });
            }
          }
        });
      }
    }
    for (
      let x = MOUNTAIN_LAKE.x - MOUNTAIN_LAKE.radiusX * 1.2;
      x <= MOUNTAIN_LAKE.x + MOUNTAIN_LAKE.radiusX * 1.2;
      x += 0.5
    )
      for (
        let z = MOUNTAIN_LAKE.z - MOUNTAIN_LAKE.radiusZ * 1.2;
        z <= MOUNTAIN_LAKE.z + MOUNTAIN_LAKE.radiusZ * 1.2;
        z += 0.5
      ) {
        const p = mountainLakeAt(x, z);
        if (!p || p.shore > -0.45) continue;
        const waterY = height(lakeWater, x, z);
        grids.forEach((grid, i) => {
          const r = result[i],
            ground = height(grid, x, z);
          r.lakeSamples++;
          if (!Number.isFinite(waterY)) {
            r.lakeMissing++;
            r.examples.push({ lakeMissing: true, x, z, shore: p.shore });
          } else {
            r.lakeMinClearance = Math.min(r.lakeMinClearance, waterY - ground);
            if (waterY < ground - 0.025) r.lakeBuried++;
          }
        });
      }
    for (let degrees = 0; degrees < 360; degrees += 3) {
      const p = mountainLakePoint((degrees * Math.PI) / 180);
      const dx = p.x - MOUNTAIN_LAKE.x,
        dz = p.z - MOUNTAIN_LAKE.z,
        length = Math.hypot(dx, dz);
      for (const distance of [5, 15, 30]) {
        const x = p.x + (dx / length) * distance,
          z = p.z + (dz / length) * distance;
        if (mountainRiverContains(x, z, 3)) continue;
        grids.forEach((grid, i) => {
          const r = result[i],
            y = height(grid, x, z);
          r.summitSamples++;
          if (!Number.isFinite(y)) r.summitMissing++;
          else {
            r.summitMinHeight = Math.min(r.summitMinHeight, y);
            if (y < MOUNTAIN_LAKE.y + 0.1) r.summitLow++;
          }
        });
      }
    }
    return result;
  });
  await writeFile(
    `${folder}/result.json`,
    JSON.stringify({ errors, state, surface, views, checks }, null, 2),
  );
  console.log(JSON.stringify(surface));
  assert.deepEqual(errors, []);
  assert.ok(
    surface.every(
      (s) =>
        s.missing === 0 &&
        s.buried === 0 &&
        s.lakeMissing === 0 &&
        s.lakeBuried === 0 &&
        s.summitMissing === 0 &&
        s.summitLow === 0,
    ),
    'lake and river water must be continuous and above both fitted mountain LODs',
  );
  // A second real Chrome page plus three protocol clients share the new world.
  const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  other.on('pageerror', (e) => errors.push(String(e)));
  await other.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst draw=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.riverWorld=this;return draw.apply(this,args);};',
    });
  });
  async function start(p) {
    await p.locator('#title-start').click();
    await p.locator('#setup-form .character-choice:has(input:checked)').click();
    await p.locator('#setup-flow [data-choose-difficulty="normal"]').click();
    await p.locator('#setup-flow-yes').click();
    await p
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 120000 });
  }
  await other.goto(`http://127.0.0.1:${port}/?room=RIVER-QA`);
  await start(other);
  for (let i = 0; i < 3; i++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?room=RIVER-QA&name=RiverPeer${i}`);
    const record = { socket, last: null };
    peers.push(record);
    socket.on('message', (bytes) => {
      const m = JSON.parse(bytes);
      if (m.type === 'state') record.last = m;
    });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }
  const room = game.rooms.get('RIVER-QA');
  room.enemies = [];
  const id = await page.evaluate(() => riverWorld.selfId),
    player = room.players.get(id);
  await page.waitForFunction(() => riverWorld.state.players.length === 5);
  assert.equal(room.players.size, 5);
  Object.assign(player, { x: 57, z: 148, dx: 0, dz: 0, target: null });
  await page.evaluate(() => {
    riverWorld.render = riverWorld.qaRender;
    riverWorld.yaw = 0;
    riverWorld.pitch = 0.3;
  });
  await page.waitForFunction(
    () => Math.abs(riverWorld.state.players.find((p) => p.id === riverWorld.selfId).x - 57) < 0.2,
  );
  await page.locator('#world').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyD');
  try {
    await page.waitForFunction(
      () => riverWorld.state.players.find((p) => p.id === riverWorld.selfId).x > 67,
      null,
      { timeout: 10000 },
    );
  } finally {
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Shift');
  }
  assert.ok(player.x > 67 && Math.abs(player.z - 148) < 0.3);
  await other.waitForFunction(
    (id) => riverWorld.state.players.find((p) => p.id === id)?.x > 67,
    id,
  );
  assert.ok(peers.every((p) => p.last.players.some((p) => p.id === id && p.x > 66.5)));
  checks.push(
    'five participants; keyboard running crosses the confluence and position agrees on the second page and three peers',
  );
  const shoreStart = { x: LAKE.x + 8, z: LAKE.z - LAKE.radiusZ - 4 };
  Object.assign(player, { ...shoreStart, dx: 0, dz: 0, target: null });
  await page.waitForFunction(
    (z) => Math.abs(riverWorld.state.players.find((p) => p.id === riverWorld.selfId).z - z) < 0.1,
    shoreStart.z,
  );
  await page.keyboard.down('KeyS');
  await page.keyboard.down('Shift');
  try {
    await page.waitForFunction(
      (z) => riverWorld.state.players.find((p) => p.id === riverWorld.selfId).z > z,
      shoreStart.z + 8,
      { timeout: 10000 },
    );
  } finally {
    await page.keyboard.up('KeyS');
    await page.keyboard.up('Shift');
  }
  assert.ok(player.z > shoreStart.z + 8 && Math.abs(player.x - shoreStart.x) < 0.3);
  await other.waitForFunction(
    ({ id, z }) => riverWorld.state.players.find((p) => p.id === id)?.z > z,
    { id, z: shoreStart.z + 8 },
  );
  assert.ok(
    peers.every((peer) => peer.last.players.some((p) => p.id === id && p.z > shoreStart.z + 7.5)),
  );
  assert.ok(await page.evaluate(() => riverWorld.camera.position.y >= 34.4));
  checks.push(
    'keyboard walking from the dry shore into the lake; five participants agree and camera stays above water',
  );
  for (const [i, p] of [...room.players.values()].entries())
    Object.assign(p, {
      x: LAKE.x + LAKE.radiusX + 6 + i * 0.5,
      z: LAKE.z - 2 + i * 1.1,
      dx: 0,
      dz: 0,
      target: null,
    });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    riverWorld.yaw = 1.8;
    riverWorld.pitch = 0.2;
    riverWorld.targetDistance = 13;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${folder}/gameplay.png` });
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${folder}/gameplay-${width}.png` });
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [width, height]);
  }
  checks.push(
    'normal game camera and five characters beside the lake; portrait and landscape viewport rendering',
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.reload();
  await start(page);
  await page.waitForFunction(
    () =>
      riverWorld.mountainRiver?.userData.connectedTo === 'valley-river' &&
      riverWorld.mountainRiver.getObjectByName('Mountain lake'),
  );
  checks.push('reload reconstructs the lake, connected river and waterfall');
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/result.json`,
    JSON.stringify({ errors, state, surface, views, checks }, null, 2),
  );
  console.log(JSON.stringify(checks));
} finally {
  for (const peer of peers) peer.socket.close();
  await browser.close();
  await game.close();
}
