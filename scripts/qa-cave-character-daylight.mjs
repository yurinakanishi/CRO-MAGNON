// Faces in the cave against the same face outdoors, in real Chrome (solo, in-memory server).
// The waiting gallery and the world's cave are photographed from in front of the face, the
// held torch lit and put out within one frame; the outdoor photograph has the same facing and
// camera, and is drawn a second time in the same frame by the scene's own lights alone. 524
// comes along and is photographed too. Placement is a fixture inside the patched worker;
// starting, the gallery and proceeding use the real UI.
// Usage: node scripts/qa-cave-character-daylight.mjs <output dir> [--assert] [--browser <build>]
// --browser draws with another build's browser modules (its dist/src and dist/shared), such as
// `git archive` of the commit before the daylight, built in a scratch folder.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { caveInteriorWeight } from '../dist/shared/cave-light.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const output = process.argv[2] || 'output/playwright/cave-character-daylight-20261023';
const checking = process.argv.includes('--assert');
const browserIndex = process.argv.indexOf('--browser');
const browserBuild = browserIndex > 0 ? path.resolve(process.argv[browserIndex + 1]) : null;
await mkdir(output, { recursive: true });

// A grown man, the chibi woman and two chibi children with big faces (--characters a,b: some).
const charactersIndex = process.argv.indexOf('--characters');
const CHARACTERS =
  charactersIndex > 0
    ? process.argv[charactersIndex + 1].split(',')
    : ['cro-male', 'cro-female', 'cro-magnon-girl-bear', 'cro-magnon-boy-lion'];
// Facing -Z turns the face toward the world's sun (it shines from -X, +Y, -Z); the gallery
// starts its traveler so.
const FACING = Math.PI;
const SPOTS = [
  { name: 'cave-hearth', local: -21 },
  { name: 'cave-mouth', local: 7 },
];

const WORKER_FIXTURE = `
const qaHandle = scope.onmessage;
scope.onmessage = (event) => {
  if (event.data?.type !== 'qa-fixture') return qaHandle(event);
  enqueue(async () => {
    const room = runtime.game.rooms.get('SOLO'), p = [...room.players.values()][0];
    const { place } = event.data;
    Object.assign(p, { x: place.x ?? p.x, z: place.z ?? p.z, facing: place.facing, target: null,
      path: [], dx: 0, dz: 0, caveTorchOff: false, warpSequence: (p.warpSequence ?? 0) + 1 });
  });
};`;

const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  browser: browser.version(),
  base,
  browserBuild,
  characters: {},
  errors: [],
  failedRequests: [],
  checks: [],
};
const pass = (label) => {
  report.checks.push(label);
  console.log('PASS', label);
};
let page, failure;

/** In the page: photograph a face or 524 from in front, each torch state in the same frame. */
function installCapture() {
  const luminance = (pixels, i) =>
    pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
  const quantile = (sorted, q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      mean: values.reduce((sum, v) => sum + v, 0) / values.length,
      p05: quantile(sorted, 0.05),
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      clipped: values.filter((v) => v >= 250).length / values.length,
    };
  };
  const target = (where) => {
    if (where === 'gallery') return { host: qaCave, actor: qaCave.actor, torch: qaCave.torch };
    const entity = qaWorld.players.get(qaWorld.selfId);
    return { host: qaWorld, actor: entity.actor, torch: entity.torch, model: entity.model };
  };
  const setTorch = (torch, lit) => {
    if (lit !== undefined && torch) torch.update(true, 2, 0, qaWorld.renderer.getPixelRatio(), lit);
  };
  const frontCamera = (focus, forward, distance) => {
    const canvas = qaWorld.canvas,
      camera = new qaThree.PerspectiveCamera(35, canvas.width / canvas.height, 0.05, 200);
    camera.position.copy(focus).addScaledVector(forward, distance);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    return camera;
  };
  /** Draw and read the canvas back, `hidden` out of sight meanwhile. */
  const shoot = (scene, camera, hidden) => {
    const renderer = qaWorld.renderer,
      canvas = qaWorld.canvas;
    if (hidden) hidden.visible = false;
    try {
      renderer.render(scene, camera);
    } finally {
      if (hidden) hidden.visible = true;
    }
    const gl = renderer.getContext(),
      pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  /** The square of `half` pixels around (cx, cy) from the bottom left, and each side's mean. */
  const square = (pixels, cx, cy, half) => {
    const width = qaWorld.canvas.width,
      all = [],
      left = [],
      right = [];
    for (let y = cy - half; y < cy + half; y++)
      for (let x = cx - half; x < cx + half; x++) {
        const value = luminance(pixels, (y * width + x) * 4);
        all.push(value);
        (x < cx ? left : right).push(value);
      }
    const [l, r] = [stats(left).mean, stats(right).mean];
    return {
      ...stats(all),
      sides: [l, r],
      asymmetry: Math.max(l, r) / Math.max(1, Math.min(l, r)),
    };
  };
  /** The canvas as just drawn, `scale` squares wide around it, the square outlined. */
  const review = (cx, cy, half, scale) => {
    const canvas = qaWorld.canvas,
      crop = Math.round(half * scale),
      image = document.createElement('canvas');
    image.width = image.height = crop * 2;
    const ctx = image.getContext('2d');
    ctx.drawImage(
      canvas,
      cx - crop,
      canvas.height - cy - crop,
      crop * 2,
      crop * 2,
      0,
      0,
      crop * 2,
      crop * 2,
    );
    ctx.strokeStyle = '#ff00ff';
    ctx.strokeRect(crop - half, crop - half, half * 2, half * 2);
    return image.toDataURL('image/png');
  };
  const pixel = (camera, point) => {
    const p = point.clone().project(camera),
      canvas = qaWorld.canvas;
    return [
      Math.round(((p.x + 1) * canvas.width) / 2),
      Math.round(((p.y + 1) * canvas.height) / 2),
    ];
  };
  /** The middle of the face (eyes to mouth, cheek to cheek): no hair, collar or background. */
  window.qaFaceCapture = async ({ where, lits = [undefined], sceneLights = false }) => {
    // Loaded first: the game may draw a frame while it loads, and every shot shares one frame.
    const daylight = sceneLights ? (await import('/src/actor-daylight.js')).ACTOR_DAYLIGHT : null;
    const T = qaThree,
      { host, actor, torch } = target(where);
    const height = actor.asset.heightMetres;
    actor.root.updateMatrixWorld(true);
    const head = actor.root.getObjectByName('Head');
    if (!head) throw Error('Missing delivered head bone');
    const forward = new T.Vector3(0, 0, 1)
      .applyQuaternion(actor.root.getWorldQuaternion(new T.Quaternion()))
      .setY(0)
      .normalize();
    const focus = head.getWorldPosition(new T.Vector3());
    focus.y += height * 0.06;
    focus.addScaledVector(forward, height * 0.03);
    const distance = height * 0.9,
      camera = frontCamera(focus, forward, distance);
    const perMetre =
      qaWorld.canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360) * distance);
    const half = Math.round(height * 0.035 * perMetre),
      [cx, cy] = pixel(camera, focus);
    const shots = lits.map((lit) => {
      setTorch(torch, lit);
      const result = square(shoot(host.scene, camera), cx, cy, half);
      return {
        ...result,
        torch: torch?.light.visible ? torch.light.intensity : 0,
        image: review(cx, cy, half, 7),
      };
    });
    if (daylight) {
      // The same frame by the scene's own lights alone, as before the daylight existed.
      const on = daylight.actorDaylightOn.value;
      daylight.actorDaylightOn.value = 0;
      try {
        const pixels = shoot(host.scene, camera);
        daylight.actorDaylightOn.value = on;
        const worn = shoot(host.scene, camera);
        let differing = 0,
          largest = 0;
        for (let y = cy - half * 3; y < cy + half * 3; y++)
          for (let x = cx - half * 3; x < cx + half * 3; x++)
            for (let c = 0; c < 3; c++) {
              const i = (y * qaWorld.canvas.width + x) * 4 + c,
                d = Math.abs(pixels[i] - worn[i]);
              if (d) differing++;
              largest = Math.max(largest, d);
            }
        shots[0].sceneLights = { ...square(pixels, cx, cy, half), differing, largest };
      } finally {
        daylight.actorDaylightOn.value = on;
      }
    }
    return shots;
  };
  /** The game's own camera, each torch state: how much the torch lights the scene. */
  window.qaFrameCapture = ({ lits }) => {
    const { torch } = target('world');
    return lits.map((lit) => {
      setTorch(torch, lit);
      const pixels = shoot(qaWorld.scene, qaWorld.camera);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += luminance(pixels, i);
      return {
        mean: sum / (pixels.length / 4),
        image: qaWorld.canvas.toDataURL('image/jpeg', 0.85),
      };
    });
  };
  /** The nearest companion (524) from in front, the traveler hidden: its middle, measured. */
  window.qaCompanionCapture = ({ lits }) => {
    const T = qaThree,
      { torch, model } = target('world');
    const root = [...qaWorld.companionRenderers.renderers.values()]
      .map((renderer) => renderer.root)
      .filter((root) => root.visible && root.position.distanceTo(model.position) < 6)
      .sort(
        (a, b) => a.position.distanceTo(model.position) - b.position.distanceTo(model.position),
      )[0];
    if (!root) return null;
    root.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(root),
      centre = box.getCenter(new T.Vector3()),
      size = box.getSize(new T.Vector3());
    const forward = new T.Vector3(0, 0, 1)
      .applyQuaternion(root.getWorldQuaternion(new T.Quaternion()))
      .setY(0)
      .normalize();
    const distance = Math.max(size.x, size.y, size.z) * 2.2,
      camera = frontCamera(centre, forward, distance);
    const perMetre =
      qaWorld.canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360) * distance);
    const half = Math.max(4, Math.round(size.y * 0.2 * perMetre)),
      [cx, cy] = pixel(camera, centre);
    return lits.map((lit) => {
      setTorch(torch, lit);
      const result = square(shoot(qaWorld.scene, camera, model), cx, cy, half);
      return {
        name: root.name,
        distance: root.position.distanceTo(model.position),
        ...result,
        image: review(cx, cy, half, 3),
      };
    });
  };
}

async function save(name, data) {
  await writeFile(`${output}/${name}`, Buffer.from(data.image.split(',')[1], 'base64'));
  delete data.image;
  return data;
}

async function settle(target) {
  await target.evaluate(() => (window.qaSettle = null));
  await target.waitForFunction(
    () => {
      const v = qaWorld.hemisphere.intensity + qaWorld.sun.intensity;
      const s = (window.qaSettle ??= { v, n: 0 });
      if (Math.abs(v - s.v) < 1e-4) s.n++;
      else Object.assign(s, { v, n: 0 });
      return s.n > 20;
    },
    undefined,
    { polling: 100, timeout: 60000 },
  );
}

async function place(target, spot) {
  await target.evaluate((place) => soloQA.worker.postMessage({ type: 'qa-fixture', place }), spot);
  await target.waitForFunction(
    ({ x, z }) => {
      const p = soloQA.state?.players?.find((p) => p.id === soloQA.id);
      return p && Math.hypot(p.x - x, p.z - z) < 0.05;
    },
    spot,
    { timeout: 30000 },
  );
}

async function run(character) {
  const record = (report.characters[character] = {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    window.soloQA = { state: null, id: '' };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes('solo-worker')) return;
        soloQA.worker = this;
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'message') return;
          const message = JSON.parse(data.data);
          if (message.type === 'welcome') soloQA.id = message.id;
          if (message.type === 'state') soloQA.state = { ...soloQA.state, ...message };
        });
      }
    };
  });
  await context.addInitScript(installCapture);
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(String(error)));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.failedRequests.push(`${character} ${response.status()} ${response.url()}`);
  });
  // The browser module this page asked for: this build's, or the --browser build's.
  const browserModule = async (route) =>
    browserBuild
      ? readFile(path.join(browserBuild, 'dist', new URL(route.request().url()).pathname), 'utf8')
      : (await route.fetch()).text();
  const serve = async (route, extra = '') =>
    route.fulfill({ contentType: 'text/javascript', body: (await browserModule(route)) + extra });
  // Routes registered later take precedence.
  if (browserBuild) await page.route(/\/(src|shared)\/[^?]*\.m?js$/, (route) => serve(route));
  await page.route('**/src/solo-worker.js', (route) => serve(route, WORKER_FIXTURE));
  for (const [file, cls, key] of [
    ['loading-cave', 'LoadingCave', 'qaCave'],
    ['world3d', 'WorldRenderer', 'qaWorld'],
  ])
    await page.route(`**/src/${file}.js`, (route) =>
      serve(
        route,
        `\nconst qaRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;window.qaThree=THREE;return qaRender.apply(this,args);};`,
      ),
    );
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('顔の明かりQA');
  await page.locator(`#setup-form input[value="${character}"]`).click();
  await page.locator('#setup-flow-yes').click();
  const mascot = page.locator('[data-starting-mascot="524"]');
  if ((await mascot.getAttribute('aria-pressed')) !== 'true') await mascot.click();
  await page.locator('#mascot-start').click();
  await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
  await page.waitForFunction(() => window.qaCave?.actor && window.qaWorld);
  assert.equal(await page.evaluate(() => qaCave.movement.facing), FACING);
  await page.screenshot({ path: `${output}/${character}-gallery-view.png` });
  const shots = (name, results, ...labels) =>
    Promise.all(results.map((result, i) => save(`${character}-${name}-${labels[i]}.png`, result)));
  [record['gallery-lit'], record['gallery-unlit']] = await shots(
    'gallery',
    await page.evaluate(() => qaFaceCapture({ where: 'gallery', lits: [true, false] })),
    'lit',
    'unlit',
  );
  await enterPreparedWorld(page, false);
  await page.waitForFunction(() => soloQA.state?.players?.some((p) => p.id === soloQA.id));
  const spawn = await page.evaluate(() => soloQA.state.players.find((p) => p.id === soloQA.id));
  await place(page, { x: spawn.x, z: spawn.z, facing: FACING });
  await settle(page);
  [record.outdoor] = await shots(
    'outdoor',
    await page.evaluate(
      (sceneLights) => qaFaceCapture({ where: 'world', sceneLights }),
      !browserBuild,
    ),
    'face',
  );
  record.outdoor.position = { x: spawn.x, z: spawn.z };
  for (const spot of SPOTS) {
    const at = caveWorldAt(spot.local);
    await place(page, { ...at, facing: FACING });
    await page.locator('#world[data-cave-torch-lit="true"]').waitFor({ timeout: 30000 });
    await settle(page);
    await page.screenshot({ path: `${output}/${character}-${spot.name}-view.png` });
    const self = await page.evaluate(() => soloQA.state.players.find((p) => p.id === soloQA.id));
    const result = (record[spot.name] = { cave: caveInteriorWeight(self), position: at });
    [result.lit, result.unlit] = await shots(
      spot.name,
      await page.evaluate(() => qaFaceCapture({ where: 'world', lits: [true, false] })),
      'lit',
      'unlit',
    );
    const frames = await page.evaluate(() => qaFrameCapture({ lits: [true, false] }));
    for (const [i, suffix] of ['lit', 'unlit'].entries())
      result[`frame-${suffix}`] = await save(
        `${character}-${spot.name}-frame-${suffix}.jpg`,
        frames[i],
      );
    const companion = await page.evaluate(() => qaCompanionCapture({ lits: [true, false] }));
    if (companion)
      [result['companion-lit'], result['companion-unlit']] = await shots(
        `${spot.name}-companion`,
        companion,
        'lit',
        'unlit',
      );
    console.log(character, spot.name, JSON.stringify(result));
  }
  console.log(character, 'gallery', JSON.stringify(record['gallery-lit']));
  console.log(character, 'outdoor', JSON.stringify(record.outdoor));
  await context.close();
}

function checkDaylight() {
  for (const [character, record] of Object.entries(report.characters)) {
    const outdoor = record.outdoor;
    // Outdoors the daylight is the scene's own light: the same pixels, but for the last bit of a
    // direction the shader turns into view space itself.
    assert.ok(outdoor.sceneLights.largest <= 1, `${character}: outdoors drawn as before`);
    assert.ok(Math.abs(outdoor.sceneLights.mean - outdoor.mean) < 0.05);
    const faces = [
      ['gallery', record['gallery-lit'], record['gallery-unlit']],
      ...SPOTS.map((spot) => [spot.name, record[spot.name].lit, record[spot.name].unlit]),
    ];
    for (const [name, lit, unlit] of faces) {
      assert.equal(lit.clipped, 0, `${character} ${name}: no white clipping on the face`);
      // A program with and without the torch's light may round the last bit differently.
      assert.ok(
        Math.abs(lit.mean - unlit.mean) < 0.05,
        `${character} ${name}: the torch does not light the face (${lit.mean} / ${unlit.mean})`,
      );
      assert.ok(
        Math.abs(lit.mean - outdoor.mean) / outdoor.mean < 0.1,
        `${character} ${name}: as bright as outdoors (${lit.mean} / ${outdoor.mean})`,
      );
      assert.ok(
        lit.asymmetry < outdoor.asymmetry * 1.15 + 0.05,
        `${character} ${name}: no harsher shadow than outdoors (${lit.asymmetry} / ${outdoor.asymmetry})`,
      );
    }
    for (const spot of SPOTS) {
      const result = record[spot.name];
      assert.ok(
        result['frame-lit'].mean > result['frame-unlit'].mean + 0.5,
        `${character} ${spot.name}: the torch still lights the cave`,
      );
      const near = result['companion-lit'],
        dark = result['companion-unlit'];
      assert.ok(near && dark, `${character} ${spot.name}: 524 is with the traveler`);
      assert.equal(near.clipped, 0, `${character} ${spot.name}: no clipping on 524`);
      assert.ok(
        Math.abs(near.mean - dark.mean) < 0.05,
        `${character} ${spot.name}: the torch does not light 524 (${near.mean} / ${dark.mean})`,
      );
    }
    pass(
      `${character}: cave faces and 524 as outdoors and unlit by the torch, which still lights the cave; outdoors unchanged`,
    );
  }
}

try {
  for (const character of CHARACTERS) await run(character);
  assert.deepEqual(report.errors, []);
  if (checking) checkDaylight();
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ ok: !failure, ...report, failure }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log('EVIDENCE', output);
}
if (failure) process.exitCode = 1;
