// Observe the real title through shell -> game handoff. No user saves or running servers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || `output/playwright/title-continuity-${Date.now()}`;
await mkdir(output, { recursive: true });
const server = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
});
const base = `http://127.0.0.1:${(await server.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const cases = [],
  actions = [],
  errors = [],
  forbidden = [];
let failure;

async function observe(mobile, held) {
  const name = `${mobile ? 'phone' : 'pc'}-${held ? 'held' : 'natural'}`;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push({ name, error: String(error.stack || error) }));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ name, error: message.text() });
  });
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  let mainRelease;
  const mainGate = new Promise((resolve) => {
    mainRelease = resolve;
  });
  if (held)
    await page.route('**/src/main.js', async (route) => {
      await mainGate;
      await route.continue();
    });
  const images = [];
  page.on('request', (request) => {
    if (request.url().includes('/title/cro-magnon-mmo-transparent.webp'))
      images.push(request.url());
  });
  await page.addInitScript(() => {
    const ids = new WeakMap();
    let serial = 0;
    const id = (element) => {
      if (!element) return null;
      if (!ids.has(element)) ids.set(element, ++serial);
      return ids.get(element);
    };
    const trace = (window.titleContinuity = { frames: [], events: [], recording: true });
    for (const kind of ['animationstart', 'animationcancel', 'animationend'])
      document.addEventListener(
        kind,
        (event) => {
          if (event.target.closest?.('#screen-title'))
            trace.events.push({
              at: performance.now(),
              kind,
              animation: event.animationName,
              target: event.target.className,
            });
        },
        true,
      );
    const sample = (at) => {
      if (!trace.recording) return;
      const title = document.querySelector('#screen-title');
      const content = title?.querySelector('.title-content');
      const logo = title?.querySelector('.title-logo');
      const image = title?.querySelector('.title-art');
      if (title && content && logo && image) {
        const nodes = [title, content, logo, image];
        const styles = nodes.map((node) => getComputedStyle(node));
        const box = image.getBoundingClientRect();
        const shown =
          !title.hidden &&
          styles.every((style) => style.display !== 'none' && style.visibility !== 'hidden');
        trace.frames.push({
          at,
          title: id(title),
          image: id(image),
          parent: id(title.parentElement),
          shown,
          ready: image.complete && image.naturalWidth > 0,
          opacity: shown ? styles.reduce((value, style) => value * Number(style.opacity), 1) : 0,
          styles: styles.map((style) => ({ opacity: style.opacity, transform: style.transform })),
          animations: title.getAnimations({ subtree: true }).map((animation) => ({
            name: animation.animationName,
            time: animation.currentTime,
            start: animation.startTime,
            state: animation.playState,
          })),
          rect: { x: box.x, y: box.y, width: box.width, height: box.height },
          game: !!document.querySelector('#world'),
          moduleReady: performance
            .getEntriesByType('mark')
            .some((mark) => mark.name.endsWith('game-module-ready')),
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.enable');
  const film = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    film.push({ data, timestamp: metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: 960,
    maxHeight: 900,
    everyNthFrame: 1,
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#screen-title').waitFor({ state: 'visible' });
  await page.locator('.title-art').evaluate((image) => image.decode());
  if (held) {
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${output}/${name}-before.png` });
    mainRelease();
  }
  await page.waitForFunction(
    () => window.titleContinuity.frames.some((frame) => frame.moduleReady),
    undefined,
    { timeout: 90000 },
  );
  await page.waitForTimeout(1300);
  await cdp.send('Page.stopScreencast');
  const trace = await page.evaluate(() => {
    window.titleContinuity.recording = false;
    return { ...window.titleContinuity, timeOrigin: performance.timeOrigin };
  });
  await page.screenshot({ path: `${output}/${name}-after.png` });
  const drops = trace.frames.flatMap((frame, index, frames) => {
    const previous = frames[index - 1];
    return previous &&
      previous.ready &&
      frame.ready &&
      previous.opacity > 0.3 &&
      previous.opacity - frame.opacity > 0.15
      ? [{ before: previous, after: frame }]
      : [];
  });
  const handoff = trace.frames.find((frame) => frame.game);
  const around = film
    .map((frame) => ({ ...frame, at: frame.timestamp * 1000 - trace.timeOrigin }))
    .filter((frame) => handoff && frame.at > handoff.at - 250 && frame.at < handoff.at + 700);
  await mkdir(`${output}/${name}-frames`, { recursive: true });
  for (let index = 0; index < around.length; index++)
    await writeFile(
      `${output}/${name}-frames/${String(index).padStart(3, '0')}.png`,
      Buffer.from(around[index].data, 'base64'),
    );
  const result = {
    name,
    held,
    mobile,
    imageRequests: images.length,
    drops,
    handoffAt: handoff?.at,
    frames: trace.frames.length,
    screenshots: around.map(({ at }, index) => ({
      file: `${name}-frames/${String(index).padStart(3, '0')}.png`,
      at,
    })),
    titleIds: [...new Set(trace.frames.map((frame) => frame.title))],
    imageIds: [...new Set(trace.frames.map((frame) => frame.image))],
    parentIds: [...new Set(trace.frames.map((frame) => frame.parent))],
    events: trace.events,
    trace: `${name}-trace.json`,
  };
  await writeFile(`${output}/${name}-trace.json`, JSON.stringify(trace, null, 2) + '\n');
  await page.unrouteAll({ behavior: 'wait' });
  await context.close();
  cases.push(result);
  console.log(
    JSON.stringify({
      name,
      frames: result.frames,
      drops: drops.length,
      handoffAt: handoff?.at,
      animationStarts: trace.events.filter((event) => event.kind === 'animationstart'),
      images: images.length,
    }),
  );
}

async function checkAction(mobile, intent) {
  const name = `${mobile ? 'phone' : 'pc'}-${intent}`;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push({ name, error: String(error) }));
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/src/main.js', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const tap = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await page.locator('.title-art').evaluate((image) => image.decode());
  const roots = [];
  for (const selector of ['.game-viewport', '#screens', '#screen-title', '.title-art', '#modal'])
    roots.push({ selector, node: await page.locator(selector).elementHandle() });
  await tap(intent === 'start' ? '#title-start' : '#title-contributors');
  if (intent === 'start')
    await page.locator('[data-title-status="busy"]').waitFor({ state: 'visible' });
  else assert.equal(await page.locator('#modal').evaluate((dialog) => dialog.open), true);
  release();
  await page.waitForFunction(
    () =>
      performance.getEntriesByType('mark').some((mark) => mark.name.endsWith('game-module-ready')),
    undefined,
    { timeout: 90000 },
  );
  for (const { selector, node } of roots) {
    assert.equal(
      await page.locator(selector).evaluate((current, original) => current === original, node),
      true,
      name + ': ' + selector + ' stays mounted',
    );
    assert.equal(await page.locator(selector).count(), 1);
  }
  if (intent === 'start') {
    assert.equal(await page.locator('#screen-setup').isVisible(), true);
    assert.equal(await page.locator('[data-title-status]').count(), 0);
    await tap('#setup-back');
  } else {
    assert.equal(await page.locator('#modal').evaluate((dialog) => dialog.open), true);
    await tap('#modal-close');
  }
  await tap('#title-language');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await tap('#title-start');
  assert.equal(await page.locator('#screen-setup').isVisible(), true);
  assert.equal(await page.locator('#setup-form').count(), 1);
  assert.equal(server.rooms.size, 0);
  await page.screenshot({ path: `${output}/${name}-setup.png`, animations: 'disabled' });
  actions.push({
    name,
    intent,
    mountedRoots: roots.length,
    setup: true,
    language: 'en',
    serverRooms: server.rooms.size,
  });
  await page.unrouteAll({ behavior: 'wait' });
  await context.close();
  console.log('PASS', name, 'retains DOM, pending action/dialog, language toggle and setup');
}

try {
  for (const [mobile, held] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])
    await observe(mobile, held);
  for (const mobile of [false, true])
    for (const intent of ['start', 'contributors']) await checkAction(mobile, intent);
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  for (const result of cases) {
    assert.deepEqual(result.drops, [], `${result.name}: title fades out during handoff`);
    assert.equal(result.imageIds.length, 1, `${result.name}: same decoded image`);
    assert.equal(result.imageRequests, 1, `${result.name}: no duplicate artwork fetch`);
    assert.equal(result.parentIds.length, 1, `${result.name}: keep the title mounted`);
    for (const animation of [
      'screen-in',
      'title-rise',
      ...(result.mobile ? ['title-logo-settle'] : []),
    ]) {
      assert.equal(
        result.events.filter(
          (event) => event.kind === 'animationstart' && event.animation === animation,
        ).length,
        1,
        `${result.name}: ${animation} only starts once`,
      );
    }
  }
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        ok: !failure,
        browser: browser.version(),
        cases,
        actions,
        errors,
        forbidden,
        failure: failure ? String(failure.stack || failure) : null,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await server.close();
}
if (failure) process.exitCode = 1;
