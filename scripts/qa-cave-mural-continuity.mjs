// Isolated solo Chrome. Native entry/walking use actual input; comparison cameras
// and review positions are explicit fixtures. Never touches the normal servers.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { CAMP_CAVE, CAVE_BEND, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CAVE_MURALS, caveMuralImages } from '../dist/src/cave-gallery-layout.js';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const output = process.argv[2] ?? `output/playwright/cave-mural-continuity-${Date.now()}`;
await mkdir(output, { recursive: true });
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
const { extras, ...main } = caveMuralImages(asset),
  expected = [...Object.values(main), ...Object.values(extras)];
const server = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
});
const base = `http://127.0.0.1:${(await server.listen()).port}/`,
  browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  forbidden = [],
  cases = [],
  shots = [];
let failure, lastPage;
const hook = (cls, key, renderer) => `
const reviewRender=${cls}.prototype.render;
${cls}.prototype.render=function(...args){window.${key}=this;const result=reviewRender.apply(this,args);if(window.qaMuralCamera&&!this.disposed${key === 'qaMuralWorld' ? '&&!this.loadingCave' : ''}){${renderer}.render(this.scene,window.qaMuralCamera);}return result;};
`;
async function framing(page, phase, wall, z, ortho = true) {
  const sign = wall === 'east' ? 1 : -1,
    t = -z / CAVE_BEND.depth,
    slope = (CAVE_BEND.offset * 6 * t * (1 - t)) / CAVE_BEND.depth;
  return page.evaluate(
    ({ phase, pos, viewpoint, sign, slope, ortho, offset }) => {
      const c = phase === 'waiting' ? window.qaMuralCave : window.qaMuralWorld;
      if (phase === 'waiting') {
        c.movement.position = pos;
        if (c.actor?.root) c.actor.root.visible = false;
      }
      c.scene.updateMatrixWorld(true);
      const camera = c.camera.clone();
      if (ortho) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(pos.x, offset + 2.6, pos.z),
          new THREE.Vector3(sign, 0, 0),
          0,
          100,
        );
        const hits = ray
          .intersectObjects(c.scene.children, true)
          .filter(
            (h) =>
              h.object.isMesh &&
              [h.object.material]
                .flat()
                .some((m) => m.customProgramCacheKey().startsWith('camp-cave-')),
          );
        if (!hits.length) throw Error('No cave wall at ' + JSON.stringify(pos));
        const target = hits[0].point.clone(),
          normal = new THREE.Vector3(sign, 0, sign * slope).normalize();
        const span = 11.5,
          aspect = 1440 / 900;
        const fixed = new THREE.OrthographicCamera(
          -span / 2,
          span / 2,
          span / (2 * aspect),
          -span / (2 * aspect),
          0.05,
          100,
        );
        fixed.position.copy(target).addScaledVector(normal, -3);
        fixed.lookAt(target);
        fixed.updateProjectionMatrix();
        fixed.updateMatrixWorld(true);
        window.qaMuralCamera = fixed;
        return { target: target.toArray(), span, normal: normal.toArray() };
      }
      camera.position.set(viewpoint.x, 1.7, viewpoint.z);
      camera.lookAt(pos.x + sign * 5.7, 1.7, pos.z);
      camera.fov = 80;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      window.qaMuralCamera = camera;
      return { camera: camera.position.toArray() };
    },
    {
      phase,
      pos: caveWorldAt(z),
      viewpoint: caveWorldAt(z + 7),
      sign,
      slope,
      ortho,
      offset: CAMP_CAVE.groundOffset + CAMP_CAVE.elevation,
    },
  );
}
async function shot(page, name, fixture, detail = {}) {
  await page.screenshot({ path: `${output}/${name}.png` });
  shots.push({ name, fixture, ...detail });
  console.log('CAPTURE', name);
}
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'phone' : 'pc',
      context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        hasTouch: mobile,
        isMobile: mobile,
        deviceScaleFactor: 1,
      });
    const page = (lastPage = await context.newPage()),
      verified = new Set();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.stack ?? e}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
    });
    page.on('websocket', (s) => forbidden.push(s.url()));
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) forbidden.push(r.url());
    });
    const responses = [];
    page.on('response', (r) => {
      const record = expected.find((x) => new URL(r.url()).pathname === x.url);
      if (record)
        responses.push(
          (async () => {
            assert.equal(r.status(), 200);
            const data = await r.body();
            assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256);
            verified.add(record.url);
          })(),
        );
    });
    for (const [file, cls, key, renderer] of [
      ['loading-cave', 'LoadingCave', 'qaMuralCave', 'this.world.renderer'],
      ['world3d', 'WorldRenderer', 'qaMuralWorld', 'this.renderer'],
    ])
      await page.route(`**/src/${file}.js`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + hook(cls, key, renderer) });
      });
    // Make Three available only to the measurement fixture, never shipped code.
    await page.route('**/src/loading-cave.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.THREE=THREE;\n' +
          hook('LoadingCave', 'qaMuralCave', 'this.world.renderer'),
      });
    });
    const click = (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    await page.goto(base);
    await click('#title-start');
    await page.locator('#setup-form input[name="name"]').fill('壁画縮尺 QA');
    await page.locator('#setup-form input[name="character"]').first().check();
    await click('#setup-flow-yes');
    await click('#mascot-start');
    await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
    await shot(page, `${name}-native-entry`, false);
    if (!mobile) {
      await page.keyboard.down('w');
      await page.waitForTimeout(1800);
      await page.keyboard.up('w');
      await shot(page, 'pc-native-walk', false, { walkingMs: 1800 });
    }
    if (!mobile)
      for (const wall of ['east', 'west'])
        for (const z of [-5, -13, -21, -29, -37]) {
          const camera = await framing(page, 'waiting', wall, z);
          await page.waitForTimeout(350);
          await shot(page, `ortho-${wall}-${-z}`, true, {
            phase: 'waiting',
            wall,
            localZ: z,
            camera,
          });
        }
    for (const wall of ['east', 'west']) {
      await framing(page, 'waiting', wall, -20, false);
      await page.waitForTimeout(350);
      await shot(page, `${name}-oblique-${wall}`, true, { phase: 'waiting', wall });
    }
    await page.evaluate(() => {
      window.qaMuralCamera = null;
    });
    await enterPreparedWorld(page, mobile);
    await page.waitForFunction(() => !!window.qaMuralWorld?.landmarks?.cavePigment, undefined, {
      timeout: 180000,
    });
    for (const wall of ['east', 'west']) {
      await framing(page, 'live', wall, -20, false);
      await page.waitForTimeout(350);
      await shot(page, `${name}-live-${wall}`, true, { phase: 'live', wall });
    }
    await Promise.all(responses);
    assert.equal(verified.size, expected.length);
    cases.push({
      name,
      viewport: page.viewportSize(),
      verifiedTextures: verified.size,
      waitingAndLive: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.equal(server.rooms.size, 0);
} catch (e) {
  failure = String(e.stack ?? e);
  await lastPage?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: failure ? 'failed' : 'passed',
        browser: browser.version(),
        cases,
        shots,
        errors,
        forbidden,
        failure,
        murals: CAVE_MURALS,
        textures: expected,
        geometry: { url: asset.url, sha256: asset.sha256, bytes: asset.bytes },
        scope:
          'Isolated Chrome and ephemeral solo server. Actual entry controls and PC walking, 11.5 m orthographic review fixtures on both walls, oblique waiting/live views on PC and mobile emulation. Test avatar hidden only in review views. Physical phones/Safari/gamepads and multiplayer untested. No normal server restart or user save changes.',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await server.close();
}
if (failure) throw Error(failure);
