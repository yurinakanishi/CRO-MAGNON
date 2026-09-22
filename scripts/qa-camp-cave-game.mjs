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
  caveWorldAt,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE_GATE } from '../dist/shared/castle-layout.mjs';
import { createEnemies } from '../dist/shared/enemies.mjs';
import { CAVE_MOTIFS, CAVE_MURALS, caveMuralHeight } from '../dist/src/cave-gallery-layout.js';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = `output/playwright/camp-cave/game-${process.argv[2] || '01'}`;
const caveCandidate = process.argv.find((a) => a.startsWith('--cave-candidate='))?.split('=')[1],
  caveAsset = JSON.parse(await readFile('public/models/camp-cave/asset.json')),
  caveFile = caveCandidate
    ? `assets/camp-cave/work/revision-${caveCandidate}/model.glb`
    : `public${caveAsset.url}`;
const cave = {
  file: caveFile,
  sha256: createHash('sha256')
    .update(await readFile(caveFile))
    .digest('hex'),
  previewOverride: !!caveCandidate,
};
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  samples = [],
  checks = [],
  peers = [],
  gallery = { revision: caveAsset.galleryRevision, layout: CAVE_MURALS };
async function peersSeeFire(lit) {
  const deadline = Date.now() + 5000;
  while (!peers.every((p) => p.lastCamp?.caveFireLit === lit) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(peers.every((p) => p.lastCamp?.caveFireLit === lit));
}
async function ready(page) {
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.caveWorld?.players.get(caveWorld.selfId)?.actor);
}
async function start(page) {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await ready(page);
}
async function open(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const mountainCandidate = process.argv.find((a) => a.startsWith('--candidate='))?.split('=')[1],
    overrides = [];
  if (mountainCandidate) {
    const bytes = await readFile(
      `assets/camp-mountain/work/revision-${mountainCandidate}/model.glb`,
    );
    await page.route('**/models/camp-mountain/model-*.glb', async (route) =>
      route.fulfill({ contentType: 'model/gltf-binary', body: bytes }),
    );
    overrides.push({ key: 'camp-mountain', bytes });
  }
  if (caveCandidate) {
    const bytes = await readFile(`assets/camp-cave/work/revision-${caveCandidate}/model.glb`);
    await page.route('**/models/camp-cave/model-*.glb', async (route) =>
      route.fulfill({ contentType: 'model/gltf-binary', body: bytes }),
    );
    overrides.push({ key: 'camp-cave', bytes });
    const surface = process.argv.find((a) => a.startsWith('--cave-surface='))?.split('=')[1];
    if (surface) {
      const body = await readFile(surface, 'utf8');
      await page.route('**/shared/camp-cave-surface-data.mjs', (route) =>
        route.fulfill({ contentType: 'text/javascript', body }),
      );
    }
  }
  if (overrides.length) {
    await page.route('**/models/world-assets.json', async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      for (const { key, bytes } of overrides)
        Object.assign(
          data.assets.find((a) => a.modelKey === key),
          { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
        );
      await route.fulfill({ response, json: data });
    });
  }
  page.on('pageerror', (e) => errors.push(e.stack || String(e)));
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
  await start(page);
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
      if (distance < 0.4) {
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
    if (process.argv.includes('--from-camp')) {
      await page.evaluate(() => {
        caveWorld.yaw = 2.85;
        caveWorld.pitch = 0.2;
        caveWorld.targetDistance = 7;
      });
      await shot(page, 'entrance-from-camp');
      for (let i = 0; i < CAVE_APPROACH.length; i++) {
        await walk(page, CAVE_APPROACH[i], `walk from outdoor camp to ledge ${i}`);
        if (i >= 3) {
          await page.evaluate(() => {
            caveWorld.yaw = Math.PI;
            caveWorld.pitch = 0.15;
          });
          await shot(page, `entrance-approach-${i}`);
        }
      }
      for (const z of [17, 12, 6, 0, -6, -12, -18]) {
        await walk(page, caveWorldAt(z), `walk through the visible rock mouth ${z}`);
        if ([12, 6, -6].includes(z)) {
          await page.evaluate(() => {
            caveWorld.pitch = 0.15;
          });
          await shot(page, `entrance-traverse-${z}`);
        }
      }
      checks.push(
        'continuous keyboard walk from the original outdoor camp through the visible mouth',
      );
    } else {
      Object.assign(player, caveWorldAt(-18));
      await page.waitForTimeout(1200);
    }
    await walk(page, CAVE_MURAL_VIEW, 'reach the deep gallery');
    await page.waitForFunction(
      () =>
        caveWorld.landmarks.cavePigment?.image?.complete &&
        caveWorld.landmarks.caveCharacter524?.image?.complete &&
        caveWorld.landmarks.caveLimestone?.image?.complete,
    );
    const activeCharacter = JSON.parse(
      await readFile('public/models/camp-cave/asset.json'),
    ).characterPigment;
    assert.ok(
      (await page.evaluate(() => caveWorld.landmarks.caveCharacter524.image.src)).endsWith(
        activeCharacter.url,
      ),
    );
    checks.push('faithful transparent 524 pigment loaded from the active manifest');
    const pigmentBounds = await page.evaluate((motifs) => {
      const bounds = {};
      for (const motif of ['mammoth', 'creature524']) {
        const texture =
          motif === 'mammoth'
            ? caveWorld.landmarks.cavePigment
            : caveWorld.landmarks.caveCharacter524;
        const [x0, y0, x1, y1] = motifs[motif],
          canvas = document.createElement('canvas');
        canvas.width = x1 - x0;
        canvas.height = y1 - y0;
        const context = canvas.getContext('2d');
        context.drawImage(
          texture.image,
          x0,
          y0,
          canvas.width,
          canvas.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let minY = canvas.height,
          maxY = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++)
            if (data[(y * canvas.width + x) * 4 + 3] > 32) {
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
        bounds[motif] = { heightPixels: maxY - minY + 1, imageHeight: canvas.height };
      }
      return bounds;
    }, CAVE_MOTIFS);
    const mammothMural = CAVE_MURALS.find((m) => m.wall === 'west' && m.motif === 'mammoth'),
      smallMural = CAVE_MURALS.find((m) => m.motif === 'creature524');
    const paintedHeight = (mural) =>
      (caveMuralHeight(mural) * pigmentBounds[mural.motif].heightPixels) /
      pigmentBounds[mural.motif].imageHeight;
    const targetHeightRatio = 0.5,
      paintedHeightRatio = paintedHeight(smallMural) / paintedHeight(mammothMural);
    gallery.scale = {
      pigmentBounds,
      companionPaintedHeight: paintedHeight(smallMural),
      mammothPaintedHeight: paintedHeight(mammothMural),
      targetHeightRatio,
      paintedHeightRatio,
      relativeError: Math.abs(paintedHeightRatio / targetHeightRatio - 1),
    };
    assert.ok(
      gallery.scale.relativeError < 0.02,
      '524 must be half the mammoth painted height, excluding transparent margins',
    );
    assert.ok(
      smallMural.bottom > mammothMural.bottom,
      '524 should float above the animal baseline',
    );
    checks.push('painted 524 is half the mammoth height within two percent');
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
    assert.equal(CAVE_MURALS.length, 15);
    assert.equal('cat' in CAVE_MOTIFS, false);
    assert.equal(
      CAVE_MURALS.some((m) => m.motif === 'cat'),
      false,
    );
    checks.push('cat motif and projection are completely removed from the active gallery');
    const eastAnimals = CAVE_MURALS.filter(
      (m) =>
        m.wall === 'east' &&
        ['redHorse', 'mammoth', 'bison', 'deer', 'ochreHorse'].includes(m.motif),
    ).sort((a, b) => b.centre - a.centre);
    gallery.eastAnimalGaps = eastAnimals.slice(1).map((m, i) => {
      const previous = eastAnimals[i];
      const gap = previous.centre - previous.width / 2 - (m.centre + m.width / 2);
      assert.ok(
        gap >= 0 && gap < Math.min(previous.width, m.width),
        'animal row has an empty slot or overlap',
      );
      return gap;
    });
    checks.push(
      'the east animal row closes the former cat slot without overlap or a large blank gap',
    );
    // Inspect the old cat footprint, now occupied by the deer in a continuous animal row.
    const reflowedWallView = caveWorldAt(-26.1),
      creatureView = caveWorldAt(CAVE_MURALS.find((m) => m.motif === 'creature524').centre),
      hearthApproach = caveWorldAt(-20, 1.5);
    await walk(page, reflowedWallView, 'view the reflowed animal row before ignition');
    await frame('east');
    await shot(page, 'gallery-reflowed-wall-unlit');
    await walk(page, creatureView, 'view 524 on the opposite wall before ignition');
    await frame('west');
    await shot(page, 'gallery-524-unlit');
    await walk(page, hearthApproach, 'return to light the cave hearth');
    await page.locator('#world').focus();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === true);
    await walk(page, reflowedWallView, 'view the reflowed animal row in firelight');
    await frame('east');
    await shot(page, 'gallery-reflowed-wall-lit');
    await walk(page, creatureView, 'view 524 in firelight');
    await frame('west');
    await shot(page, 'gallery-524-lit');
    checks.push('actual E lighting reveals continuous limestone and the small floating 524');
    await walk(page, caveWorldAt(-22.2, 3.0), 'approach the small 524 and neighbouring mammoth');
    await frame('west', 1.5);
    await shot(page, 'gallery-524-close');
    await walk(page, creatureView, 'return from the small 524');
    if (process.argv.includes('--gallery-preview')) {
      await walk(page, caveWorldAt(-30.5), 'preview the spacious back chamber');
      await page.evaluate(() => {
        caveWorld.yaw = 2.75;
        caveWorld.pitch = 0.13;
        caveWorld.targetDistance = 6;
      });
      await shot(page, 'gallery-spacious-back');
    }
    if (!process.argv.includes('--gallery-preview')) {
      const other = await open('Cave B');
      Object.assign(
        [...room.players.values()].find((p) => p.name === 'Cave B'),
        caveWorldAt(-22, -1),
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
        socket.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.camp) socket.lastCamp = msg.camp;
        });
        await new Promise((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
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
      await peersSeeFire(true);
      checks.push('two renderers and three network peers share the cave fire');
      for (const localZ of [-13, -18, -23, -28, -31.5]) {
        await walk(page, caveWorldAt(localZ), `gallery route ${localZ}`);
        for (const wall of ['east', 'west']) {
          await frame(wall);
          await shot(page, `gallery-${wall}-${Math.abs(localZ)}`);
        }
      }
      await walk(page, caveWorldAt(-31.5), 'approach the natural blind end');
      await page.evaluate(() => {
        caveWorld.yaw = 2.82;
        caveWorld.pitch = 0.13;
        caveWorld.targetDistance = 3;
      });
      await shot(page, 'gallery-blind-end');
      await walk(page, caveWorldAt(-30.5), 'stand in the full-width back chamber');
      await page.evaluate(() => {
        caveWorld.yaw = 2.75;
        caveWorld.pitch = 0.13;
        caveWorld.targetDistance = 6;
      });
      await shot(page, 'gallery-spacious-back');
      for (const across of [-3.5, 3.5, 0])
        await walk(page, caveWorldAt(-30.5, across), `cross the back chamber at ${across}`);
      checks.push('the rear chamber can be crossed in both directions at full standing height');
      await walk(page, reflowedWallView, 'return to the reflowed wall');
      await walk(page, caveWorldAt(-26.1, -3.6), 'approach the former cat footprint');
      await frame('east', 1.8);
      await shot(page, 'gallery-rock-close');
      await walk(page, reflowedWallView, 'return from the rock face');
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
      await start(page);
      await page.waitForFunction(() => caveWorld.landmarks.caveLimestone?.image?.complete);
      await page.evaluate(() => {
        caveWorld.yaw = Math.PI;
        caveWorld.pitch = 0.35;
        caveWorld.targetDistance = 8;
      });
      const camp = await shot(page, 'gallery-reload-camp');
      assert.ok(Math.hypot(camp.position[0] - 50, camp.position[1] - 50) < 12);
      for (const [i, point] of CAVE_APPROACH.entries())
        await walk(page, point, `camp to cave approach after reload ${i}`);
      await walk(page, caveWorldAt(12), 'enter the unpainted front chamber');
      await page.evaluate(() => {
        caveWorld.yaw = Math.PI;
        caveWorld.pitch = 0.13;
        caveWorld.targetDistance = 4;
      });
      await shot(page, 'gallery-entrance');
      for (const z of [4, -4, -12, -20])
        await walk(page, caveWorldAt(z), `follow the extended chamber after reload ${z}`);
      await walk(page, creatureView, 'return to the gallery after reload');
      await frame('west');
      await shot(page, 'gallery-reload');
      assert.equal(room.camp.caveFireLit, true);
      await walk(page, hearthApproach, 'return for extinguishing');
      await page.locator('#world').focus();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
      await other.waitForFunction(() => caveWorld.state.camp.caveFireLit === false);
      await peersSeeFire(false);
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
    await start(page);
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
        socket.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.camp) socket.lastCamp = msg.camp;
        });
        await new Promise((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
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
      await peersSeeFire(true);
      checks.push('E ignites, two renderers plus three websocket peers agree');
      await page.reload();
      await start(page);
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
        cave,
        gallery,
        checks,
        samples,
        errors,
        setup: process.argv.includes('--from-camp')
          ? 'Only enemies are suppressed initially. The main player walks from the original camp through the entrance and galleries using keyboard input; only the second observer is placed for multiplayer observation.'
          : process.argv.includes('--gallery')
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
