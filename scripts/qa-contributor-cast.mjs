// Real Chrome, ephemeral solo server and isolated browser storage. Card checks use real
// clicks/taps; only the review camera/position is a fixture for inspecting the new painting.
// Usage: node scripts/qa-contributor-cast.mjs [output] [painted subject, default ryuichi]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CAVE_MURALS, caveMuralImages } from '../dist/src/cave-gallery-layout.js';
import { titleContributors, muralPeople } from '../dist/src/title-credits.js';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || `output/playwright/contributor-cast-${Date.now()}`;
const subject = process.argv[3] || 'ryuichi';
await mkdir(output, { recursive: true });
const server = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
});
const base = `http://127.0.0.1:${(await server.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const caveAsset = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
const placed = CAVE_MURALS.find((m) => m.kind === 'character' && m.subject === subject);
assert.ok(placed, `${subject}: not painted in the cave`);
const images = caveMuralImages(caveAsset);
const mural =
  images.extras[placed.motif] ??
  (placed.motif === 'creature524' ? images.characterPigment : images.rimoPigment);
const titleCards = titleContributors().length,
  muralCards = muralPeople().length;
const cases = [],
  errors = [],
  forbidden = [];
let failure, lastPage;
const cards = (people) => people.map(({ name, profile }) => ({ name, profile }));
async function readCards(page, root) {
  return page.locator(`${root} .contributor`).evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.querySelector('strong').textContent,
      profile: element.getAttribute('href') || '',
    })),
  );
}
async function inspectDialog(page, name, expected) {
  const root = '#modal[open]';
  await page.locator(root).waitFor();
  assert.deepEqual(await readCards(page, root), cards(expected));
  assert.equal(
    await page.locator(`${root} .contributor img, ${root} .contributor small`).count(),
    0,
  );
  for (const card of await page.locator(`${root} .contributor`).all()) {
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `${name} card width`);
    assert.ok(box.y >= -1 && box.y + box.height <= viewport.height + 1, `${name} card accessible`);
    const linked = !!(await card.getAttribute('href'));
    const mark = card.locator('svg.contributor-x');
    assert.equal(await mark.count(), linked ? 1 : 0, `${name} X mark matches profile link`);
    if (linked) {
      assert.equal(await mark.getAttribute('aria-hidden'), 'true');
      const icon = await mark.boundingBox();
      assert.equal(icon.width, 18);
      assert.equal(icon.height, 18);
      assert.ok(
        icon.x >= box.x && icon.x + icon.width <= box.x + box.width,
        `${name} X mark inside card`,
      );
    }
  }
  await page.screenshot({ path: `${output}/${name}-bottom.png` });
  await page.locator(`${root} .contributor`).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function painting(page, phase, name) {
  await page.evaluate(
    ({ pos, phase, sign }) => {
      const renderer = phase === 'waiting' ? window.qaCave : window.qaWorld;
      if (phase === 'waiting') {
        renderer.movement.position = pos;
        renderer.movement.facing = (sign * Math.PI) / 2;
      }
      const camera = renderer.camera.clone();
      camera.position.set(pos.x - sign * 0.9, 2.6, pos.z);
      camera.lookAt(pos.x + sign * 5.7, 2.25, pos.z);
      camera.fov = 75;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      window.qaReviewCamera = camera;
    },
    // The east wall lies toward world +x.
    { pos: caveWorldAt(placed.centre), phase, sign: placed.wall === 'east' ? 1 : -1 },
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/${name}.png` });
  await page.evaluate(() => {
    window.qaReviewCamera = null;
  });
}
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'phone' : 'pc';
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
      deviceScaleFactor: 1,
    });
    const page = (lastPage = await context.newPage());
    page.on('pageerror', (error) => errors.push({ name, error: String(error.stack || error) }));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ name, error: message.text() });
    });
    page.on('websocket', (socket) => forbidden.push(socket.url()));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
    });
    // Observe the real scene; the override is used only for explicitly labelled review shots.
    for (const [file, cls, key] of [
      ['loading-cave', 'LoadingCave', 'qaCave'],
      ['world3d', 'WorldRenderer', 'qaWorld'],
    ])
      await page.route(`**/src/${file}.js`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `\nconst castRender=${cls}.prototype.render;${cls}.prototype.render=function(...args){window.${key}=this;const result=castRender.apply(this,args);if(window.qaReviewCamera&&!this.disposed ${key === 'qaWorld' ? '&&!this.loadingCave' : ''})${key === 'qaCave' ? 'this.world.renderer' : 'this.renderer'}.render(this.scene,window.qaReviewCamera);return result;};`,
        });
      });
    const tap = (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    await page.goto(base);
    await tap('#title-contributors');
    await inspectDialog(page, `${name}-contributors`, titleContributors());
    assert.equal(await page.locator('#modal[open] .contributor:has-text("yuri")').count(), 1);
    await tap('#modal-close');
    await tap('#title-start');
    await page.locator('#setup-form input[name="name"]').fill('人物一覧 QA');
    await page.locator('#setup-form .character-choice:has(input[value="cro-male"])').click();
    await tap('#setup-flow-yes');
    const textureResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === mural.url,
    );
    await tap('#mascot-start');
    const response = await textureResponse;
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(createHash('sha256').update(bytes).digest('hex'), mural.sha256);
    await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 180000 });
    await tap('[data-cave-murals]');
    await inspectDialog(page, `${name}-mural-people`, muralPeople());
    assert.equal(await page.locator('#modal[open] .contributor:has-text("yuri")').count(), 0);
    await tap('#modal-close');
    await painting(page, 'waiting', `${name}-waiting-${subject}`);
    if (!mobile) {
      await enterPreparedWorld(page, mobile);
      await page.waitForFunction(() => !!window.qaWorld?.landmarks?.cavePigment, undefined, {
        timeout: 180000,
      });
      await painting(page, 'live', `${name}-live-${subject}`);
    }
    cases.push({
      name,
      viewport: page.viewportSize(),
      titleCards,
      muralCards,
      creatorOnlyInTitle: true,
      identicalNonCreatorCards: true,
      painted: { subject, wall: placed.wall, localZ: placed.centre },
      texture: { url: mural.url, sha256: mural.sha256, bytes: bytes.length },
      paintings: mobile ? ['waiting'] : ['waiting', 'live'],
    });
    console.log(
      'PASS',
      name,
      `${titleCards} title cards, ${muralCards} identical mural cards, verified ${subject} painting`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.equal(server.rooms.size, 0, 'solo uses no server room');
} catch (error) {
  failure = String(error.stack || error);
  await lastPage?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        cases,
        errors,
        forbidden,
        failure,
        scope:
          'Real PC and mobile-emulated Chrome clicks/taps and card scrolling; saved-data-free solo browser. Review cameras/positions are fixtures. Physical phones, Safari and gamepads untested.',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await server.close();
}
if (failure) throw Error(failure);
