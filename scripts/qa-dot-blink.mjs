// Real Chrome in an isolated, unsaved room: each Dot is chosen from the companions menu and
// looked at closely; its lids are held open, half shut and shut (a read-only renderer observer
// freezes the blink clock) and the face is photographed and compared. Then the lids run on
// their own: every Dot with lids blinks within the longest gap.
// node scripts/qa-dot-blink.mjs [output]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createGameServer } from '../dist/server.mjs';
import { DOT_FACES, BLINK_GAP } from '../dist/src/dot-blink.js';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/dot-blink-${Date.now()}`;
await mkdir(out, { recursive: true });
const KINDS = ['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog', 'triangle', 'heart'];
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  faces = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(100);
  }
}
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst qaSetState = WorldRenderer.prototype.setState; WorldRenderer.prototype.setState = function(...args) { globalThis.qaRenderer = this; return qaSetState.apply(this, args); };',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=DOT-BLINK&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(() => performance.getEntriesByName('cro:controls').length > 0, null, {
    timeout: 120000,
  });
  for (const kind of KINDS) {
    await page.locator('#world').focus();
    await page.keyboard.press('i');
    await page.locator('[data-pause-tab="mascots"]').click();
    await page.locator(`[data-mascot="${kind}"]`).click();
    await page.locator(`[data-mascot="${kind}"][aria-pressed="true"]`).waitFor();
    await page.keyboard.press('Escape');
    await until(
      () =>
        page.evaluate((kind) => {
          const r = globalThis.qaRenderer;
          return [...(r?.orbBotRenderer?.bots.values() ?? [])].some(
            (e) =>
              e.state.kind === kind &&
              e.state.ownerId === r.selfId &&
              ['idle', 'follow', 'following', 'waiting', 'ground'].includes(e.state.mode) &&
              e.actor.root.visible,
          );
        }, kind),
      `${kind} stands beside the player`,
      60000,
    );
    await sleep(1500);
    const id = await page.evaluate((kind) => {
      const r = globalThis.qaRenderer;
      const [id, entry] = [...r.orbBotRenderer.bots].find(
        ([, e]) => e.state.kind === kind && e.state.ownerId === r.selfId,
      );
      // Freeze this Dot's blink clock so the lids stay where the check puts them.
      if (entry.blink) entry.blink.update = () => {};
      return r.viewCompanion(id) ? id : null;
    }, kind);
    assert.ok(id, `${kind}: close view`);
    await sleep(1600);
    // Hold the pose too (the idle bob would move every edge), then frame the face.
    const clip = await page.evaluate((kind) => {
      const r = globalThis.qaRenderer;
      const entry = [...r.orbBotRenderer.bots.values()].find(
        (e) => e.state.kind === kind && e.state.ownerId === r.selfId,
      );
      entry.actor.update = () => {};
      const box = new entry.actor.root.position.constructor();
      const top = entry.actor.root.position.clone();
      const ground = entry.actor.root.position.clone();
      top.y += 0.28 * entry.actor.root.scale.y;
      const project = (v) => {
        const p = v.clone().project(r.camera);
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
      };
      const a = project(top),
        b = project(ground);
      box.set((a.x + b.x) / 2, a.y + (b.y - a.y) * 0.45, 0);
      const side = Math.min(760, Math.max(160, Math.abs(b.y - a.y) * 1.15));
      return {
        x: Math.max(0, Math.round(box.x - side / 2)),
        y: Math.max(0, Math.round(box.y - side / 2)),
        width: Math.round(Math.min(side, innerWidth - Math.max(0, box.x - side / 2))),
        height: Math.round(Math.min(side, innerHeight - Math.max(0, box.y - side / 2))),
      };
    }, kind);
    await sleep(400);
    const shots = [];
    for (const [name, closure] of [
      ['open', 0],
      ['still', 0],
      ['half', 0.5],
      ['shut', 1],
    ]) {
      await page.evaluate(
        ({ kind, closure }) => {
          const r = globalThis.qaRenderer;
          const entry = [...r.orbBotRenderer.bots.values()].find(
            (e) => e.state.kind === kind && e.state.ownerId === r.selfId,
          );
          if (entry.blink) entry.blink.closure.value = closure;
        },
        { kind, closure },
      );
      await sleep(300);
      const file = `${out}/${kind}-${name}.png`;
      await page.screenshot({ path: file, clip });
      shots.push(file);
    }
    const [open, still, half, shut] = await Promise.all(
      shots.map((file) => sharp(file).removeAlpha().raw().toBuffer()),
    );
    const differs = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 3)
        if (
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
          30
        )
          n++;
      return n;
    };
    faces[kind] = {
      lids: !!DOT_FACES[kind],
      clip,
      noise: differs(open, still),
      halfChanged: differs(open, half),
      shutChanged: differs(open, shut),
    };
    // Lids change the face beyond the frame-to-frame noise; without lids nothing changes.
    if (DOT_FACES[kind])
      assert.ok(
        faces[kind].shutChanged > faces[kind].noise * 3 + 100,
        `${kind}: shut lids change the face ${JSON.stringify(faces[kind])}`,
      );
    else
      assert.ok(
        faces[kind].shutChanged <= faces[kind].noise * 3 + 20,
        `${kind}: no lids ${JSON.stringify(faces[kind])}`,
      );
    await page.evaluate(() => globalThis.qaRenderer.endCompanionView());
    console.log(kind, JSON.stringify(faces[kind]));
  }
  pass(
    'Every Dot with visible eyes shuts them when its lids close; the triangle and heart bots keep theirs',
  );
  // Unfrozen, the last Dot with lids blinks on its own within the longest gap.
  await page.locator('#world').focus();
  await page.keyboard.press('i');
  await page.locator('[data-pause-tab="mascots"]').click();
  await page.locator('[data-mascot="purple"]').click();
  await page.keyboard.press('Escape');
  await until(
    () =>
      page.evaluate(() => {
        const r = globalThis.qaRenderer;
        return [...r.orbBotRenderer.bots.values()].some(
          (e) =>
            e.state.kind === 'purple' &&
            e.state.ownerId === r.selfId &&
            e.blink &&
            e.actor.root.visible,
        );
      }),
    'purple returns',
    60000,
  );
  const blinked = await page.evaluate(
    async (ms) => {
      const r = globalThis.qaRenderer;
      const entry = [...r.orbBotRenderer.bots.values()].find(
        (e) => e.state.kind === 'purple' && e.state.ownerId === r.selfId && e.blink,
      );
      let most = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        most = Math.max(most, entry.blink.closure.value);
        await new Promise(requestAnimationFrame);
      }
      return most;
    },
    (BLINK_GAP.max + 0.5) * 1000,
  );
  assert.ok(blinked > 0.9, `the purple Dot blinked on its own (${blinked})`);
  pass('Left alone, a Dot blinks fully within the longest gap between blinks');
  assert.deepEqual(errors, []);
  pass('No browser errors');
} catch (error) {
  errors.push(String(error.stack ?? error));
  if (page && !page.isClosed())
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, faces, errors }, null, 2));
  await browser.close();
  await game.close();
}
