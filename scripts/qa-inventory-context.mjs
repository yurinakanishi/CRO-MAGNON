// Real Chrome + isolated game host. Stock, health and positions are fixtures;
// controller/keyboard input, healing, cooking and cooldowns run in real time.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server.mjs';
import { PAD } from '../dist/src/gamepad-input.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || 'output/playwright/inventory-20260912/context';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen();
const checks = [],
  errors = [];
let browser, page;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
async function until(condition, label, ms = 10000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > ms) throw new Error(`Timed out: ${label}`);
    await sleep(50);
  }
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.stack || String(e)));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Inventory QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
    window.qaPad = {
      id: 'Inventory QA pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVENTORY-QA&autostart=1`);
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  const room = game.rooms.get('INVENTORY-QA');
  const me = [...room.players.values()][0];
  const input = async (buttons = [], axes = [0, 0, 0, 0]) => {
    await page.evaluate(
      async ({ buttons, axes }) => {
        window.qaPad.buttons.forEach((b, i) => {
          b.pressed = buttons.includes(i);
          b.value = b.pressed ? 1 : 0;
        });
        window.qaPad.axes = axes;
        for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      },
      { buttons, axes },
    );
  };
  const tap = async (button) => {
    await input([button]);
    await input();
  };
  const focus = async (selector) => {
    await page.locator(selector).focus();
    await input();
  };
  const closed = () => page.locator('#modal').evaluate((el) => !el.open);
  const scope = async (popup = false) => {
    const state = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.gamepad-focus')];
      const el = document.activeElement;
      return {
        count: all.length,
        same: all[0] === el,
        modal: !!el?.closest('dialog[open]'),
        popup: !!el?.closest('.item-actions'),
        hidden: !!el?.closest('[hidden],[inert]'),
      };
    });
    assert.equal(state.count, 1, JSON.stringify(state));
    assert.ok(state.same && state.modal && !state.hidden, JSON.stringify(state));
    if (popup) assert.ok(state.popup, JSON.stringify(state));
  };
  const prepare = async (x = 40, z = 40) => {
    Object.assign(me, {
      x,
      z,
      energy: 40,
      path: [],
      moving: false,
      attackAt: 0,
      attackSequence: 0,
      cookingEndsAt: 0,
    });
    await sleep(500);
  };
  for (const key of Object.keys(me.inventory)) me.inventory[key] = 0;
  Object.assign(me.inventory, { berry: 2, rawMeat: 3, cookedMeat: 2, stone: 4, wood: 6 });
  me.tool = true;
  me.gulf.fishingKit = true;
  await prepare();
  await input();
  assert.equal(await page.locator('#attack-button, #eat-meat-button').count(), 0);
  assert.equal(await page.locator('#magic-cooldown').isVisible(), false);
  assert.equal(await page.locator('#cook-button').isVisible(), false);
  assert.ok(!/攻撃|ジャンプ/.test(await page.locator('#prompt-bar').innerText()));
  await page.keyboard.press('f');
  await until(() => me.attackSequence > 0, 'melee still attacks');
  assert.equal(await page.locator('#magic-cooldown').isVisible(), false);
  await sleep(850);
  pass('Melee works without a permanent attack control or a cooldown label');

  const attackBefore = me.attackSequence;
  await input([PAD.options, PAD.square, PAD.triangle], [1, 0, 1, 0]);
  await input();
  assert.equal(await closed(), false);
  assert.equal(me.attackSequence, attackBefore, 'opening inventory consumes simultaneous attack');
  await scope();
  const inventory = page.locator('[data-pause-panel="inventory"]');
  assert.equal(await inventory.locator('h2').innerText(), '持ち物');
  const keys = await inventory
    .locator('[data-item]')
    .evaluateAll((els) => els.map((el) => el.dataset.item));
  assert.deepEqual(keys, [
    'berry',
    'rawMeat',
    'cookedMeat',
    'stone',
    'wood',
    'weapon',
    'axe',
    'fishingKit',
  ]);
  assert.ok(!/つくる|作る|共同|食事|焼き方|釣り方|相手を向いて/.test(await inventory.innerText()));
  await page.screenshot({ path: `${output}/01-carried-items.png` });
  pass(
    'Inventory lists carried food in order, materials and owned equipment; crafting has its own section',
  );

  await tap(PAD.right);
  assert.equal(await page.locator('.gamepad-focus').getAttribute('data-item'), 'rawMeat');
  await tap(PAD.circle);
  await scope(true);
  assert.equal(await page.locator('[data-item-action="cook"]').count(), 0);
  const origin = { x: me.x, z: me.z, attacks: me.attackSequence, jumps: me.jumpSequence ?? 0 };
  const yaw = await page.locator('#world').getAttribute('data-camera-yaw');
  for (const dir of [PAD.left, PAD.up, PAD.right, PAD.down]) {
    await tap(dir);
    await scope(true);
  }
  await input([PAD.r2], [1, 0, 1, 0]);
  await sleep(350);
  await input();
  await scope(true);
  assert.ok(Math.hypot(me.x - origin.x, me.z - origin.z) < 0.01);
  assert.equal(me.attackSequence, origin.attacks);
  assert.equal(me.jumpSequence ?? 0, origin.jumps);
  assert.equal(await page.locator('#world').getAttribute('data-camera-yaw'), yaw);
  // A programmatic focus request to the menu rail is also caught by the popup scope.
  await focus('[data-controller-menu="character"]');
  await scope(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.item-actions')));
  }
  await focus('[data-item-action="eatRawMeat"]');
  const hp = me.energy;
  await page.keyboard.press('Enter');
  await until(() => me.inventory.rawMeat === 2, 'keyboard raw meat use');
  assert.ok(me.energy >= hp + 14.9 && me.energy < hp + 16);
  assert.equal(
    await page.locator('.item-actions').count(),
    0,
    'Enter activates the button without reopening its card',
  );
  await input(); // New input context observes neutral before the next controller press.
  await tap(PAD.right);
  await scope();
  pass(
    'Popup traps D-pad, sticks, Tab and focus; no character movement, camera, attack or jump leaks; raw meat heals 15',
  );

  await tap(PAD.cross);
  assert.equal(await closed(), true);
  assert.equal(await page.locator('.gamepad-focus').count(), 0);
  assert.ok(await page.locator('#world').evaluate((el) => document.activeElement === el));
  await prepare(50, 52);
  await until(() => page.locator('#cook-button').isVisible(), 'near-fire cook hint');
  await tap(PAD.options);
  await focus('[data-item="rawMeat"]');
  await tap(PAD.circle);
  assert.equal(await page.locator('[data-item-action="cook"]').isVisible(), true);
  await focus('[data-item-action="cook"]');
  await tap(PAD.circle);
  await until(() => me.cookingEndsAt > 0, 'cooking starts');
  assert.equal(await closed(), true);
  await until(
    () => me.cookingEndsAt === 0 && me.inventory.cookedMeat === 3,
    'cooking completes',
    6000,
  );
  assert.equal(me.inventory.rawMeat, 1);
  pass(
    'Cooking is offered at the usable fire, consumes raw meat only after three seconds and produces cooked meat',
  );

  await tap(PAD.options);
  await focus('[data-item="rawMeat"]');
  await tap(PAD.circle);
  // A live position change while the dialog is open must invalidate an offered cook action.
  await prepare();
  await until(
    async () => (await page.locator('[data-item-action="cook"]').count()) === 0,
    'cook option removed outside range',
  );
  assert.equal(await page.locator('#cook-button').isVisible(), false);
  await focus('[data-item-action="eatRawMeat"]');
  await tap(PAD.circle);
  await until(
    async () => (await page.locator('[data-item="rawMeat"]').count()) === 0,
    'last raw item vanishes',
  );
  await scope();
  assert.equal(await page.locator('.gamepad-focus').getAttribute('data-item'), 'cookedMeat');
  await input();
  await tap(PAD.circle);
  assert.equal(
    await page.locator('.item-actions').count(),
    1,
    'cooked meat opens after last raw item disappears',
  );
  assert.equal(
    await page.locator('[data-item-action="eatMeat"]').isEnabled(),
    true,
    `cooked meat use is enabled at HP ${me.energy}: ${await page.locator('.item-actions').innerText()}`,
  );
  assert.equal(await page.locator('.gamepad-focus').getAttribute('data-item-action'), 'eatMeat');
  const beforeCooked = me.energy;
  await until(() => Date.now() - me.lastAction >= 450, 'existing server action interval');
  await tap(PAD.circle);
  await until(() => me.inventory.cookedMeat === 2, 'cooked meat eaten');
  assert.ok(me.energy >= Math.min(100, beforeCooked + 44.9));
  await scope();
  pass(
    'Leaving the fire removes both cooking displays live; consuming the last item selects the next item; cooked meat heals 45',
  );

  await tap(PAD.cross);
  await prepare(50, 52);
  assert.equal(
    await page.locator('#cook-button').isVisible(),
    false,
    'near the fire without raw meat',
  );
  await tap(PAD.options);
  await focus('[data-controller-menu="crafting"]');
  await tap(PAD.circle);
  assert.ok(await page.locator('[data-pause-panel="crafting"]').isVisible());
  for (const selector of [
    '#modal-craft',
    '#modal-boat-craft',
    '#modal-fishing',
    '#modal-crop-food',
    '#modal-crop-farms',
    '#modal-coastal',
  ])
    assert.ok(await page.locator(selector).isVisible(), selector);
  await page.screenshot({ path: `${output}/02-crafting-guide.png` });
  await tap(PAD.cross);

  // Only characters with an actual weapon model get a weapon inventory item.
  Object.assign(me, { species: 'bear', gender: 'male', tool: false });
  me.gulf.fishingKit = false;
  for (const key of Object.keys(me.inventory)) me.inventory[key] = 0;
  await prepare();
  await until(
    async () => (await page.locator('#world').getAttribute('data-weapon')) === 'magic',
    'mage ready',
  );
  await tap(PAD.options);
  assert.equal(await page.locator('.inventory-card').count(), 0);
  assert.ok(await page.locator('.inventory-none').isVisible());
  await scope();
  await tap(PAD.cross);
  await page.keyboard.press('f');
  await until(() => page.locator('#magic-cooldown').isVisible(), 'magic cooldown appears');
  const label = await page.locator('#magic-cooldown').innerText();
  assert.match(label, /^魔法 あと[1-5]秒$/);
  await page.screenshot({ path: `${output}/03-magic-cooldown.png` });
  await until(
    async () => !(await page.locator('#magic-cooldown').isVisible()),
    'magic cooldown disappears',
    6500,
  );
  assert.equal(await page.locator('#magic-cooldown').innerText(), '');
  pass(
    'Empty inventory stays navigable; abilities are not items; magic shows remaining seconds only during recharge',
  );

  Object.assign(me.inventory, { berry: 2, rawMeat: 1, cookedMeat: 1 });
  await sleep(400);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await tap(PAD.options);
    await scope();
    await focus('[data-item="rawMeat"]');
    await tap(PAD.circle);
    await scope(true);
    assert.ok(await page.locator('.item-actions-close').isVisible());
    await page.screenshot({ path: `${output}/04-popup-${viewport.width}.png` });
    await tap(PAD.cross);
    await tap(PAD.cross);
    assert.equal(await page.locator('.gamepad-focus').count(), 0);
  }
  pass('Portrait and landscape inventory popups keep a single focus and clean up on closing');
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.stack || String(error));
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/summary.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close();
  await game.close();
}
