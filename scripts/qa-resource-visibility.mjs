// Real Chrome, isolated solo checkpoints. Initial positions and camera orientation are
// preparation; approaching and harvesting use keyboard/touch input and the real solo worker.
// The renderer probe only observes frames. No user storage or running server is changed.
// node scripts/qa-resource-visibility.mjs [output] [--baseline]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { SoloRuntime } from '../dist/infrastructure/browser/solo-runtime.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || `output/playwright/resource-visibility-${Date.now()}`;
const baseline = process.argv.includes('--baseline');
await mkdir(output, { recursive: true });
const storage = {
  async load() {
    return { data: null, recovered: false };
  },
  async write(data) {
    this.data = structuredClone(data);
  },
  close() {},
};
const runtime = new SoloRuntime(storage, () => {});
await runtime.start({
  name: 'Resource QA',
  species: 'cro',
  gender: 'male',
  character: 'cro-magnon-hunter',
});
await runtime.close();
const game = createGameServer({
  core: createGameCore(),
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [],
  errors = [],
  forbidden = [];
let failure;
const probe = `
const qaRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) {
  globalThis.qaWorld = this;
  const result = qaRender.apply(this, args);
  const item = this.resources.get(globalThis.qaTarget);
  if (item && globalThis.qaSamples) {
    const me = this.state.players.find(p => p.id === this.selfId);
    globalThis.qaSamples.push({
      visible: item.model.visible, amount: item.resource.amount,
      distance: me ? Math.hypot(me.x-item.resource.x, me.z-item.resource.z) : null,
      level: item.model.getCurrentLevel?.(),
    });
  }
  return result;
};`;
async function observe(page, id) {
  return page.evaluate((id) => {
    const world = globalThis.qaWorld,
      item = world.resources.get(id);
    const player = world.state.players.find((p) => p.id === world.selfId);
    const meshes = [];
    item?.model.traverseVisible((node) => {
      if (node.isMesh) meshes.push({ name: node.name, count: node.count ?? 1 });
    });
    return {
      player: { x: player.x, z: player.z, inventory: player.inventory },
      resource: item?.resource,
      visible: item?.model.visible,
      meshes,
      distance: item ? Math.hypot(player.x - item.resource.x, player.z - item.resource.z) : null,
      level: item?.model.getCurrentLevel?.(),
      camera: world.camera.position.toArray(),
      hint: document.querySelector('#interaction-hint')?.textContent,
      touch: [...document.querySelectorAll('.touch-prompts button')].map((n) => n.textContent),
    };
  }, id);
}
async function approach(page, mobile, id) {
  let cdp, point;
  if (mobile) {
    const box = await page.locator('.touch-move').boundingBox();
    point = { x: box.x + box.width / 2, y: box.y + box.height * 0.65, id: 0 };
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...point, y: point.y - 48 }],
    });
  } else await page.keyboard.down('w');
  try {
    await page.waitForFunction(
      (id) => {
        const world = globalThis.qaWorld,
          item = world.resources.get(id);
        const player = world.state.players.find((p) => p.id === world.selfId);
        return (
          player &&
          item &&
          Math.hypot(player.x - item.resource.x, player.z - item.resource.z) < 0.82
        );
      },
      id,
      { timeout: 10000 },
    );
  } finally {
    if (mobile) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else await page.keyboard.up('w');
  }
  await page.waitForTimeout(500);
}
try {
  for (const mobile of [false, true])
    for (const type of ['berry', 'stone']) {
      const name = `${mobile ? 'phone' : 'desktop'}-${type}`;
      const data = structuredClone(storage.data),
        room = data.game.rooms[0];
      const resource = room.resources.find(
        (r) => r.id === (type === 'berry' ? 'berry-25' : 'stone-16'),
      );
      Object.assign(room.sessions[0].player, { x: resource.x, z: resource.z + 3, facing: Math.PI });
      const context = await browser.newContext(
        mobile
          ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
          : { viewport: { width: 1440, height: 900 } },
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push({ name, error: String(error) }));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push({ name, error: message.text() });
      });
      page.on('websocket', (socket) => forbidden.push(socket.url()));
      await page.route('**/api/**', (route) => {
        forbidden.push(route.request().url());
        return route.abort();
      });
      await page.route('**/qa-save.mjs', (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          path: 'dist/infrastructure/browser/solo-save.mjs',
        }),
      );
      await page.route('**/src/world3d.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + probe });
      });
      await page.goto(base);
      await page.evaluate(async (data) => {
        const { openSoloSave } = await import('/qa-save.mjs');
        const save = await openSoloSave();
        await save.load(() => {});
        await save.write(data);
        save.close();
      }, data);
      await page.locator('#title-start').click();
      await page.locator('#setup-form input[name="name"]').fill('Resource QA');
      await page.locator('#setup-form input[value="cro-male"]').click();
      await page.locator('#setup-flow-yes').click();
      await page.locator('#mascot-start').click();
      await enterPreparedWorld(page, mobile);
      await page.waitForFunction((id) => globalThis.qaWorld?.resources.has(id), resource.id);
      await page.evaluate((id) => {
        globalThis.qaWorld.yaw = 0;
        globalThis.qaWorld.pitch = 0.19;
        globalThis.qaTarget = id;
        globalThis.qaSamples = [];
      }, resource.id);
      await page.waitForTimeout(1800);
      const before = await observe(page, resource.id);
      await page.screenshot({ path: `${output}/${name}-before.png` });
      await approach(page, mobile, resource.id);
      const near = await observe(page, resource.id);
      await page.screenshot({ path: `${output}/${name}-near.png` });
      const samples = await page.evaluate(() => globalThis.qaSamples.splice(0));
      const result = { name, before, near, samples };
      results.push(result);
      console.log(
        'APPROACH',
        name,
        JSON.stringify({
          before: before.visible,
          near: near.visible,
          distance: near.distance,
          meshes: near.meshes,
        }),
      );
      if (!baseline) {
        assert.equal(before.visible, true, `${name}: visible before approach`);
        assert.equal(near.visible, true, `${name}: visible within gathering reach`);
        assert.ok(near.meshes.length > 0, `${name}: drawn mesh remains`);
        assert.ok(
          samples.every((sample) => sample.visible),
          `${name}: no frame hides the resource on approach`,
        );
      }
      if (mobile) {
        await page
          .locator('.touch-prompts button')
          .filter({ hasText: type === 'berry' ? 'ベリー' : '石' })
          .tap();
      } else await page.keyboard.press('e');
      await page.waitForFunction(
        ({ id, type, amount }) => {
          const world = globalThis.qaWorld,
            item = world.resources.get(id);
          const player = world.state.players.find((p) => p.id === world.selfId);
          return item?.resource.amount === amount - 1 && player?.inventory[type] === 1;
        },
        { id: resource.id, type, amount: resource.amount },
      );
      result.gathered = await observe(page, resource.id);
      await page.screenshot({ path: `${output}/${name}-gathered.png` });
      console.log('GATHERED', name, result.gathered.player.inventory[type]);
      // Prepared camera angles exercise sight-line culling; they are not an input test.
      result.views = [];
      for (const yaw of [Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
        await page.evaluate((yaw) => {
          globalThis.qaWorld.yaw = yaw;
        }, yaw);
        await page.waitForTimeout(250);
        const view = await observe(page, resource.id);
        result.views.push({ yaw, visible: view.visible, meshes: view.meshes });
        if (!baseline) assert.equal(view.visible, true, `${name}: stays drawn at yaw ${yaw}`);
      }
      for (let remaining = resource.amount - 1; remaining > 0; remaining--) {
        await page.waitForTimeout(850);
        if (mobile)
          await page
            .locator('.touch-prompts button')
            .filter({ hasText: type === 'berry' ? 'ベリー' : '石' })
            .tap();
        else await page.keyboard.press('e');
        await page.waitForFunction(
          ({ id, remaining }) =>
            globalThis.qaWorld.resources.get(id)?.resource.amount === remaining - 1,
          { id: resource.id, remaining },
        );
      }
      result.depleted = await observe(page, resource.id);
      assert.equal(result.depleted.visible, false, `${name}: disappears only when exhausted`);
      assert.equal(
        result.depleted.player.inventory[type],
        resource.amount,
        `${name}: every unit reaches inventory`,
      );
      await page.screenshot({ path: `${output}/${name}-depleted.png` });
      console.log('DEPLETED', name, result.depleted.player.inventory[type]);
      await context.close();
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      { baseline, browser: browser.version(), results, errors, forbidden, failure },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
