// Server setup is recorded separately; routes and ignition use real keyboard input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { WebSocket } from 'ws';
import {
  CAMP_CAVE,
  CAVE_MURAL_VIEW,
  CAVE_APPROACH,
  CAMP_MOUNTAIN_TRAIL,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE_GATE } from '../dist/shared/castle-layout.mjs';
import { createEnemies } from '../dist/shared/enemies.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = `output/playwright/camp-cave/game-${process.argv[2] || '01'}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  samples = [],
  checks = [],
  peers = [];
async function ready(page) {
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.caveWorld?.players.get(caveWorld.selfId)?.actor);
}
async function open(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const candidate = process.argv.find((a) => a.startsWith('--candidate='))?.split('=')[1];
  if (candidate) {
    const bytes = await readFile(`assets/camp-mountain/work/revision-${candidate}/model.glb`);
    await page.route('**/models/camp-mountain/model-*.glb', async (route) =>
      route.fulfill({ contentType: 'model/gltf-binary', body: bytes }),
    );
    await page.route('**/models/world-assets.json', async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      Object.assign(
        data.assets.find((a) => a.modelKey === 'camp-mountain'),
        { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      );
      await route.fulfill({ response, json: data });
    });
  }
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst draw=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.caveWorld=this;return draw.apply(this,args);};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=CAVE-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await ready(page);
  return page;
}
async function shot(page, label) {
  await page.waitForTimeout(350);
  const state = await page.evaluate(() => {
    const w = caveWorld,
      p = w.state.players.find((p) => p.id === w.selfId);
    return {
      position: [p.x, p.z],
      height: w.players.get(w.selfId).model.position.y,
      camera: w.camera.position.toArray(),
      camp: w.state.camp,
      landmarks: [...w.landmarks.instances.keys()],
      calls: w.renderer.info.render.calls,
      triangles: w.renderer.info.render.triangles,
      fps: Number(w.canvas.dataset.fps),
      geometries: w.renderer.info.memory.geometries,
      textures: w.renderer.info.memory.textures,
      loadMilliseconds: w.worldAssets.loadMilliseconds,
    };
  });
  samples.push({ label, ...state });
  if (label === 'murals-fire-off' || label === 'murals-fire-on')
    assert.ok(
      state.camera[1] < CAMP_CAVE.elevation + 5,
      `camera escaped the chamber: ${state.camera}`,
    );
  await page.screenshot({ path: `${folder}/${label}.png` });
  console.log(label, JSON.stringify(state.position));
  return state;
}
async function walk(page, goal, label) {
  await page.locator('#world').focus();
  await page.keyboard.down('KeyW');
  let previous = Infinity,
    stuck = 0;
  try {
    for (let i = 0; i < 450; i++) {
      const distance = await page.evaluate((goal) => {
        const w = caveWorld,
          p = w.state.players.find((p) => p.id === w.selfId),
          dx = goal.x - p.x,
          dz = goal.z - p.z,
          d = Math.hypot(dx, dz);
        if (d > 0.35) w.yaw = Math.atan2(-dx, -dz);
        w.pitch = 0.25;
        return d;
      }, goal);
      if (distance < 0.3) {
        checks.push(`keyboard walk: ${label}`);
        return;
      }
      if (Math.abs(distance - previous) < 0.025) stuck++;
      else stuck = 0;
      assert.ok(stuck < 18, `stuck walking ${label}, distance ${distance}`);
      previous = distance;
      await page.waitForTimeout(160);
    }
    throw new Error(`walk timeout ${label}`);
  } finally {
    await page.keyboard.up('KeyW');
  }
}
try {
  const page = await open('Cave A'),
    room = game.rooms.get('CAVE-QA');
  room.enemies = []; // Scene preparation: peaceful route review, no position teleport.
  await page.waitForFunction(
    () =>
      caveWorld.landmarks.instances.has('camp-cave') &&
      caveWorld.landmarks.instances.has('camp-mountain'),
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(2500);
  if (process.argv.includes('--gallery')) {
    const player = [...room.players.values()].find((p) => p.name === 'Cave A');
    Object.assign(player, { x: CAVE_MURAL_VIEW.x, z: CAVE_MURAL_VIEW.z - 1 });
    await page.waitForTimeout(1200);
    await walk(page, CAVE_MURAL_VIEW, 'reach the cave hearth');
    await page.waitForFunction(
      () =>
        caveWorld.landmarks.cavePigment?.image?.complete &&
        caveWorld.landmarks.caveLimestone?.image?.complete,
    );
    const frame = async (wall, distance = 4) => {
      await page.evaluate(
        ({ wall, distance }) => {
          caveWorld.yaw = wall === 'east' ? -Math.PI / 2 : wall === 'west' ? Math.PI / 2 : Math.PI;
          caveWorld.pitch = 0.13;
          caveWorld.targetDistance = distance;
        },
        { wall, distance },
      );
    };
    await walk(page, { x: 34.5, z: 125.2 }, 'view opposing motifs before ignition');
    await frame('east');
    await shot(page, 'gallery-cat-unlit');
    await frame('west');
    await shot(page, 'gallery-524-unlit');
    await walk(page, CAVE_MURAL_VIEW, 'return to light the cave hearth');
    await page.locator('#world').focus();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === true);
    await walk(page, { x: 34.5, z: 125.2 }, 'view opposing motifs in firelight');
    await frame('east');
    await shot(page, 'gallery-cat-lit');
    await frame('west');
    await shot(page, 'gallery-524-lit');
    checks.push('cat and 524 are on opposite walls, actual E reveals both');
    if (!process.argv.includes('--gallery-preview')) {
      const other = await open('Cave B');
      Object.assign(
        [...room.players.values()].find((p) => p.name === 'Cave B'),
        { x: 36, z: 126 },
      );
      for (let i = 0; i < 3; i++) {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/ws?` +
            new URLSearchParams({
              room: 'CAVE-QA',
              name: `Gallery Peer ${i}`,
              species: 'cro',
              gender: 'male',
            }),
        );
        await new Promise((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
        socket.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.camp) socket.lastCamp = msg.camp;
        });
        peers.push(socket);
      }
      await page.waitForFunction(() => caveWorld.players.size === 5);
      await other.waitForFunction(
        () =>
          caveWorld.landmarks.caveLimestone?.image?.complete && caveWorld.state.camp.caveFireLit,
      );
      await other.evaluate(() => {
        caveWorld.yaw = Math.PI / 2;
        caveWorld.pitch = 0.13;
        caveWorld.targetDistance = 3;
      });
      await shot(other, 'gallery-peer-west');
      assert.ok(peers.every((p) => p.lastCamp?.caveFireLit));
      checks.push('two renderers and three network peers share the cave fire');
      for (const z of [120, 115, 120, 125.2, 130]) {
        await walk(page, { x: 34.5, z }, `gallery route ${z}`);
        for (const wall of ['east', 'west']) {
          await frame(wall);
          await shot(page, `gallery-${wall}-${z}`);
        }
      }
      await frame('back');
      await shot(page, 'gallery-blind-end');
      await walk(page, { x: 34.5, z: 125.2 }, 'return to central gallery');
      await walk(page, { x: 37.7, z: 125.2 }, 'approach the limestone and cat');
      await frame('east', 1.8);
      await shot(page, 'gallery-rock-close');
      await walk(page, { x: 34.5, z: 125.2 }, 'return from the rock face');
      await frame('east');
      for (const [width, height] of [
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await shot(page, `gallery-viewport-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.reload();
      await page.locator('#title-start').click();
      await ready(page);
      await page.waitForFunction(() => caveWorld.landmarks.caveLimestone?.image?.complete);
      await frame('west');
      await shot(page, 'gallery-reload');
      assert.equal(room.camp.caveFireLit, true);
      await walk(page, CAVE_MURAL_VIEW, 'return for extinguishing');
      await page.locator('#world').focus();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
      await other.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
      assert.ok(peers.every((p) => p.lastCamp?.caveFireLit === false));
      checks.push('gallery reload and real E extinguishing pass');
    }
  } else if (process.argv.includes('--mural')) {
    const sideMural = process.argv.includes('--side-mural');
    const sideView = { x: 34.5, z: 125.2 };
    const player = [...room.players.values()].find((p) => p.name === 'Cave A');
    // Scene preparation only: start near the far wall, then walk and ignite normally.
    Object.assign(player, { x: CAVE_MURAL_VIEW.x, z: CAVE_MURAL_VIEW.z - 2 });
    await page.waitForTimeout(1200);
    await walk(page, CAVE_MURAL_VIEW, 'approach the large rear-wall painting');
    const frame = () =>
      page.evaluate((side) => {
        caveWorld.yaw = side ? -Math.PI / 2 : Math.PI;
        caveWorld.pitch = 0.12;
        caveWorld.targetDistance = 4;
      }, sideMural);
    if (sideMural) await walk(page, sideView, 'view the side-wall frieze unlit');
    await frame();
    await page.waitForFunction(() => caveWorld.landmarks.cavePigment?.image?.complete);
    const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
    const loaded = await page.evaluate(() => caveWorld.landmarks.cavePigment.image.src);
    assert.ok(loaded.endsWith(asset.pigment.url), loaded);
    checks.push('active manifest mural loaded in real renderer');
    await shot(page, 'murals-fire-off');
    if (sideMural) await walk(page, CAVE_MURAL_VIEW, 'return to hearth for ignition');
    await page.locator('#world').focus();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === true);
    if (sideMural) {
      await walk(page, sideView, 'view the side-wall frieze lit');
      await frame();
    }
    await shot(page, 'murals-fire-on');
    checks.push('actual E input illuminates the mural');
    if (sideMural) {
      for (const z of [123.2, 127.2]) {
        await walk(page, { x: 34.5, z }, 'walk along the single painted side wall');
        await page.evaluate((z) => {
          caveWorld.yaw = Math.atan2(-5, z - 125.2);
          caveWorld.pitch = 0.12;
        }, z);
        await shot(page, `mural-oblique-${z}`);
      }
      await walk(page, sideView, 'return to the mural centre');
      await frame();
    }
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await shot(page, `mural-lit-viewport-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.locator('#title-start').click();
    await ready(page);
    await page.waitForFunction(() => caveWorld.landmarks.cavePigment?.image?.complete);
    await frame();
    assert.equal(room.camp.caveFireLit, true);
    await shot(page, 'mural-reload-lit');
    checks.push('reload retains the current mural and fire state');
    if (sideMural) await walk(page, CAVE_MURAL_VIEW, 'return to hearth for extinguishing');
    await page.locator('#world').focus();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
    if (sideMural) {
      await walk(page, sideView, 'return to the dark side-wall painting');
      await frame();
    }
    await shot(page, 'mural-extinguished');
    checks.push('actual E input extinguishes the light');
  } else if (process.argv.includes('--seams')) {
    const player = [...room.players.values()].find((p) => p.name === 'Cave A');
    // Deliberate scene preparation, followed by actual keyboard traversal.
    Object.assign(player, { x: 35, z: 104 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      caveWorld.yaw = Math.PI;
      caveWorld.pitch = 0.25;
      caveWorld.targetDistance = 7;
    });
    await walk(page, { x: 35, z: 105 }, 'entry approach');
    await page.evaluate(() => {
      caveWorld.yaw = 2.48;
      caveWorld.pitch = 0.25;
    });
    await shot(page, 'entrance-seam');
    if (process.argv.includes('--entry-only')) {
      await walk(page, { x: 35, z: 113 }, 'open apron');
      await shot(page, 'entrance-floor');
    } else {
      Object.assign(player, { x: 50, z: 112 });
      await page.waitForTimeout(1200);
      for (const [x, z] of [
        [50, 116],
        [50, 121],
        [50, 128],
        [50, 133],
        [55, 133],
        [59, 128],
        [59, 116],
        [65, 116],
        [70, 116],
        [59, 116],
      ]) {
        await walk(page, { x, z }, `river-side seam ${x},${z}`);
        const measured = await page.evaluate(async () => {
          const T = await import('/vendor/three.module.js'),
            w = caveWorld,
            model = w.players.get(w.selfId).model;
          const ray = new T.Raycaster(
            new T.Vector3(model.position.x, 80, model.position.z),
            new T.Vector3(0, -1, 0),
          );
          const hits = ray.intersectObjects(
            [w.landmarks.instances.get('camp-mountain'), w.terrain],
            true,
          );
          return { position: model.position.toArray(), drawn: hits[0]?.point.y };
        });
        assert.ok(Math.abs(measured.position[1] - measured.drawn) < 0.16, JSON.stringify(measured));
        checks.push(`rendered ground matches feet ${x},${z}`);
        await shot(page, `seam-${x}-${z}`);
      }
    }
  } else if (process.argv.includes('--overview')) {
    const views = [
      ['massif-overview', [160, 145, -20], [-45, 15, 160]],
      ['cave-ledge-overview', [90, 55, 70], [25, 12, 118]],
    ];
    for (const [name, position, target] of views) {
      const data = await page.evaluate(
        ({ position, target }) => {
          const w = caveWorld,
            c = w.camera.clone(),
            fog = w.scene.fog;
          c.position.set(...position);
          c.lookAt(...target);
          c.updateMatrixWorld();
          w.scene.fog = null;
          w.renderer.render(w.scene, c);
          const image = w.canvas.toDataURL('image/png');
          w.scene.fog = fog;
          return image;
        },
        { position, target },
      );
      await writeFile(`${folder}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
    }
    checks.push('diagnostic camera overview; no player teleport');
  } else {
    await page.evaluate(() => {
      caveWorld.yaw = Math.PI;
      caveWorld.pitch = 0.48;
      caveWorld.targetDistance = 18;
    });
    await shot(page, 'camp-unchanged-entrance');
    await page.evaluate(() => {
      caveWorld.targetDistance = 7;
    });
    for (let i = 0; i < CAVE_APPROACH.length; i++) {
      await walk(page, CAVE_APPROACH[i], `camp to cave ledge ${i}`);
      await shot(page, `approach-${i}`);
    }
    await walk(page, { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 5 }, 'through cave entrance');
    await walk(page, CAVE_MURAL_VIEW, 'inside by hearth');
    await page.evaluate(() => {
      caveWorld.yaw = Math.PI;
      caveWorld.pitch = 0.12;
      caveWorld.targetDistance = 4;
    });
    await shot(page, 'murals-fire-off');
    if (process.argv.includes('--preview')) {
      checks.push('preview only');
    } else {
      const other = await open('Cave B');
      Object.assign(
        [...room.players.values()].find((p) => p.name === 'Cave B'),
        { x: CAMP_CAVE.x + 1, z: CAVE_MURAL_VIEW.z - 1.5 },
      ); // Peer observation setup only.
      for (let i = 0; i < 3; i++) {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/ws?` +
            new URLSearchParams({
              room: 'CAVE-QA',
              name: `Cave Peer ${i}`,
              species: 'cro',
              gender: 'male',
            }),
        );
        await new Promise((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
        socket.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.camp) socket.lastCamp = msg.camp;
        });
        peers.push(socket);
      }
      await page.waitForFunction(() => caveWorld.players.size === 5);
      await page.locator('#world').focus();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === true);
      await other.waitForFunction(() => caveWorld.state.camp.caveFireLit === true);
      await shot(page, 'murals-fire-on');
      await shot(other, 'peer-fire-on');
      assert.ok(peers.every((p) => p.lastCamp?.caveFireLit === true));
      checks.push('E ignites, two renderers plus three websocket peers agree');
      await page.reload();
      await page.locator('#title-start').click();
      await ready(page);
      assert.equal(room.camp.caveFireLit, true);
      await shot(page, 'reload-lit');
      checks.push('reload retains shared fire');
      await page.locator('#world').focus();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
      checks.push('E extinguishes');
      for (const [width, height] of [
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await shot(page, `viewport-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await walk(page, { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 5 }, 'return through chamber');
      await walk(page, CAVE_APPROACH.at(-1), 'exit cave');
      for (let i = 5; i < CAMP_MOUNTAIN_TRAIL.length; i++) {
        await walk(page, CAMP_MOUNTAIN_TRAIL[i], `mountain trail ${i}`);
        await shot(page, `trail-${i}`);
      }
      await walk(page, CASTLE_GATE, 'castle gate');
      room.enemies = createEnemies(room.collision, room.animals, Date.now());
      await page.evaluate(() => {
        caveWorld.yaw = Math.PI;
        caveWorld.pitch = 0.4;
        caveWorld.targetDistance = 13;
      });
      await shot(page, 'castle-from-mountain');
      checks.push('28 castle crows restored at relocated posts for final visual');
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify(
      {
        checks,
        samples,
        errors,
        setup: process.argv.includes('--gallery')
          ? 'Scene preparation places the player near the hearth and suppresses enemies. All following gallery walking, lighting and extinguishing use real keyboard input.'
          : process.argv.includes('--mural')
            ? 'Enemies suppressed and player placed 2m before the rear mural for preparation. Final approach, ignition and extinguishing use actual keyboard input.'
            : 'Enemies suppressed; second viewer position prepared. Main route and fire interaction are actual keyboard input.',
      },
      null,
      2,
    ),
  );
  for (const p of peers) p.close();
  await browser.close();
  await game.close();
}
