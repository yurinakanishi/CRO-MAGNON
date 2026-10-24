// Disposable solo browser; fixed camera fixtures make before/after views comparable.
// Geometry/material diagnostics only observe the delivered scene. Isolation shots
// explicitly hide one surface for diagnosis and are never treated as normal play.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { publicAssets } from './qa-static-server.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const output = process.argv[2];
const artifact = process.argv[3];
assert.ok(output && artifact, 'output and verified artifact directory are required');
const phone = process.argv.includes('--phone');
const diagnose = process.argv.includes('--diagnose');
const before = process.argv.includes('--before');
const probeOnly = process.argv.includes('--probe-only');
const url = process.argv.find((s) => s.startsWith('--url='))?.slice(6);
const build = JSON.parse(await readFile(`${artifact}/cloudflare-build.json`, 'utf8'));
const runtime = build.browserBundle.outputs.find((f) => f.inputs.includes('src/world3d.js')).name;
const server = url ? null : publicAssets(`${artifact}/dist-cloudflare`);
const base = url || `http://127.0.0.1:${(await server.listen()).port}/`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  hasTouch: phone,
  isMobile: phone,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const result = {
  buildId: build.buildId,
  base,
  browser: browser.version(),
  phone,
  diagnose,
  before,
  fixture:
    'Real UI entry, fixed camera views with a matching terrain cull; optional explicitly hidden diagnostic surfaces.',
  errors: [],
  forbidden: [],
  views: {},
};
page.on('pageerror', (e) => result.errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') result.errors.push(m.text());
});
page.on('websocket', (ws) => result.forbidden.push(ws.url()));
await page.route('**/api/**', (r) => {
  result.forbidden.push(r.request().url());
  return r.abort();
});
await page.route(`**/${runtime}`, async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    createHash('sha256')
      .update(await readFile(`${artifact}/dist-cloudflare/${runtime}`))
      .digest('hex'),
  );
  await route.fulfill({
    response,
    body:
      source +
      `
const terrainQaRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function(...args) {
  window.terrainQa = this;
  if (!this.renderer.terrainQa) {
    this.renderer.terrainQa = true;
    const draw = this.renderer.render.bind(this.renderer);
    this.renderer.render = (scene, camera) => {
      if (scene !== this.scene || this.loadingCave) return draw(scene,camera);
      const pose = window.terrainQaPose;
      if (pose) {
        camera.position.fromArray(pose.eye);
        camera.lookAt(...pose.aim);
        camera.updateMatrixWorld();
        // The ordinary camera already culled this frame. This instantaneous
        // survey pose must bypass that view throttle, or it photographs stale
        // visibility from the player's camera (especially in portrait view).
        if (this.openWorld) this.openWorld.cullDirty = true;
        this.openWorld?.update(camera, performance.now()/1000);
      }
      const hidden = window.terrainQaHide === 'mountain'
        ? this.landmarks?.instances.get('camp-mountain')
        : window.terrainQaHide === 'ground' ? this.openWorld?.root : null;
      const visible = hidden?.visible;
      if (hidden) hidden.visible = false;
      const only = window.terrainQaOnly;
      const kept = only === 'mountain' ? this.landmarks?.instances.get('camp-mountain') : this.openWorld?.root;
      const others = only ? scene.children.filter(n => n !== kept && !n.isLight && n.visible) : [];
      for (const n of others) n.visible = false;
      draw(scene,camera);
      for (const n of others) n.visible = true;
      if (hidden) hidden.visible = visible;
    };
  }
  return terrainQaRender.apply(this,args);
};`,
  });
});
const tap = (s) => (phone ? page.locator(s).tap() : page.locator(s).click());
async function shot(name, pose = null, hide = null) {
  await page.evaluate(
    ({ pose, hide }) => {
      window.terrainQaPose = pose;
      window.terrainQaHide = hide;
    },
    { pose, hide },
  );
  await page.waitForTimeout(1500);
  result.views[name] = await page.evaluate(() => {
    const w = window.terrainQa;
    return {
      eye: w.camera.position.toArray(),
      focus: w.focus.toArray(),
      yaw: w.yaw,
      pitch: w.pitch,
      pose: window.terrainQaPose,
      hide: window.terrainQaHide,
    };
  });
  await page.screenshot({ path: `${output}/${name}.png` });
}
try {
  await page.goto(base);
  await tap('#title-start');
  await page.locator('#setup-form input[name="name"]').fill('地形QA');
  await tap('#setup-form input[value="cro-male"]');
  await tap('#setup-flow-yes');
  await tap('[data-starting-mascot-none]');
  await tap('#mascot-start');
  await enterPreparedWorld(page, phone);
  await page.waitForFunction(() => !!window.terrainQa?.selfId);
  await page.waitForTimeout(6000);
  if (!probeOnly) {
    await shot('normal');
    const poses = {
      camp: {
        eye: [46.507396704913035, 2.439883922370753, 62.19068280832014],
        aim: [48, 1.40116, 57],
      },
      east: { eye: [40, 3.7, 51], aim: [60, 0, 51] },
      approach: { eye: [56, 4.5, 58], aim: [49, 1, 77] },
      survey: { eye: [52, 49, 61], aim: [52, 0, 60] },
    };
    for (const [name, pose] of Object.entries(poses)) await shot(name, pose);
    if (diagnose)
      for (const hide of ['mountain', 'ground']) {
        await shot(`camp-no-${hide}`, poses.camp, hide);
        await shot(`survey-no-${hide}`, poses.survey, hide);
      }
    result.surface = await page.evaluate(async () => {
      const T = await import('/vendor/three.module.js'),
        w = window.terrainQa;
      w.scene.updateMatrixWorld(true);
      const hill = w.landmarks.instances.get('camp-mountain'),
        ground = w.openWorld.root;
      const visible = (n) => {
        for (let p = n; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      const meshes = (root) => {
        const a = [];
        root.traverse((n) => {
          if (n.isMesh && visible(n)) a.push(n);
        });
        return a;
      };
      const layers = { mountain: meshes(hill), ground: meshes(ground) };
      const ray = new T.Raycaster(),
        samples = [];
      for (let z = 44; z <= 72; z += 2)
        for (let x = 38; x <= 64; x += 2) {
          ray.set(new T.Vector3(x, 100, z), new T.Vector3(0, -1, 0));
          const sample = { x, z };
          for (const [name, list] of Object.entries(layers))
            sample[name] = ray
              .intersectObjects(list, false)
              .slice(0, 2)
              .map((h) => ({
                y: h.point.y,
                mesh: h.object.name,
                normal: h.face.normal.toArray(),
                instance: h.instanceId,
              }));
          samples.push(sample);
        }
      return {
        samples,
        counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.length])),
      };
    });
  }
  // The actual delivered surfaces under identical light/camera. Only the two
  // surfaces are isolated; no geometry or material is substituted. A central
  // patch at x=51,z=63 spans their nearly coplanar overlap and shared path.
  const probe = { eye: [51, 10, 63], aim: [51, 0, 62.999] };
  const pixels = [];
  for (const layer of ['ground', 'mountain']) {
    await page.evaluate((layer) => {
      window.terrainQaOnly = layer;
    }, layer);
    await shot(`probe-${layer}`, probe);
    pixels.push(
      await sharp(`${output}/probe-${layer}.png`)
        .extract({
          left: Math.round((phone ? 390 : 1440) / 2) - 60,
          top: Math.round((phone ? 844 : 900) / 2) - 60,
          width: 120,
          height: 120,
        })
        .removeAlpha()
        .raw()
        .toBuffer(),
    );
  }
  const differences = Array.from(pixels[0], (a, i) => Math.abs(a - pixels[1][i])).sort(
    (a, b) => a - b,
  );
  result.overlapPixels = {
    samples: differences.length,
    mean: differences.reduce((a, b) => a + b, 0) / differences.length,
    p95: differences[Math.floor(differences.length * 0.95)],
    max: differences.at(-1),
  };
  await page.evaluate(() => {
    window.terrainQaOnly = 'ground';
  });
  await shot('probe-tile-edge', { eye: [32, 14, 50], aim: [32, 0, 49.999] });
  const tile = await sharp(`${output}/probe-tile-edge.png`)
    .extract({
      left: Math.round((phone ? 390 : 1440) / 2) - 1,
      top: Math.round((phone ? 844 : 900) / 2) - 60,
      width: 2,
      height: 120,
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  let tileDelta = 0;
  for (let i = 0; i < tile.length; i += 6)
    for (let c = 0; c < 3; c++) tileDelta += Math.abs(tile[i + c] - tile[i + c + 3]);
  result.tileEdgePixels = { samples: 360, mean: tileDelta / 360 };
  if (!before) {
    assert.ok(
      result.overlapPixels.mean < 4,
      `overlap changes colour: ${JSON.stringify(result.overlapPixels)}`,
    );
    assert.ok(
      result.overlapPixels.p95 < 10,
      'no pronounced path/grass edge between the actual layers',
    );
    assert.ok(
      result.tileEdgePixels.mean < 1.5,
      `tile edge: ${JSON.stringify(result.tileEdgePixels)}`,
    );
  }
  if (!probeOnly) {
    await page.evaluate(() => {
      window.terrainQaOnly = null;
      window.terrainQaPose = null;
      window.terrainQaHide = null;
    });
    await page.waitForTimeout(500);
    const position = () =>
      page.evaluate(() => {
        const w = window.terrainQa,
          p = w.state.players.find((p) => p.id === w.selfId);
        return { x: p.x, z: p.z };
      });
    result.walk = { before: await position(), input: phone ? 'touch pad drag' : 'S key' };
    if (phone) {
      const zone = await page.locator('.touch-move').boundingBox();
      const cdp = await context.newCDPSession(page);
      const x = zone.x + zone.width / 2,
        y = zone.y + zone.height * 0.35;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + 65 }],
      });
      await page.waitForTimeout(3500);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.keyboard.down('s');
      await page.waitForTimeout(3500);
      await page.keyboard.up('s');
    }
    await page.waitForTimeout(500);
    result.walk.after = await position();
    result.walk.distance = Math.hypot(
      result.walk.after.x - result.walk.before.x,
      result.walk.after.z - result.walk.before.z,
    );
    assert.ok(result.walk.distance > 5, 'real movement crosses the camp/foothill join');
    await shot('walked');
  }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.forbidden, []);
  result.status = 'passed';
  console.log(
    JSON.stringify({
      status: result.status,
      output,
      surfaces: result.surface?.counts,
      overlap: result.overlapPixels,
      tile: result.tileEdgePixels,
    }),
  );
} catch (e) {
  result.status = 'failed';
  result.failure = String(e);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw e;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await server?.close();
}
