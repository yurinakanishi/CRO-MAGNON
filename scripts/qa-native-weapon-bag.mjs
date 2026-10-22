// Disposable solo Chrome sessions: the giant ape on a PC and the fennec mage on a phone.
// Fixture preparation only, inside the patched worker: a standing place beside a real pile
// and one obsidian blade (the current world has no obsidian). Gathering, crafting, the bag
// and changing character all go through the real UI and the solo runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';
import { GATHER_RANGE, gatherRange, interactionVisible } from '../dist/shared/interactions.mjs';
import { characterModel } from '../dist/shared/characters.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const output = process.argv[2] || 'output/playwright/native-weapon-bag-20261022';
await mkdir(output, { recursive: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function saveHashes() {
  const hashes = {};
  for (const name of await readdir('.cro-magnon-save').catch(() => [])) {
    const file = `.cro-magnon-save/${name}`;
    if ((await stat(file)).isFile()) hashes[name] = sha(await readFile(file));
  }
  return hashes;
}
const savesBefore = await saveHashes();

// The closest place a body can stand beside a pile with a clear reach to it.
const collision = new CollisionWorld();
function standing(id, species) {
  const resource = INITIAL_RESOURCES.find((r) => r.id === id),
    radius = characterModel({ species }).radius;
  for (let d = 0.3; d <= gatherRange({ radius }) + 1e-9; d += 0.01)
    for (let a = 0; a < 360; a += 2) {
      const p = {
        x: resource.x + Math.sin((a * Math.PI) / 180) * d,
        z: resource.z + Math.cos((a * Math.PI) / 180) * d,
      };
      if (collision.free(p, radius) && interactionVisible(collision, p, resource))
        return { ...p, facing: Math.atan2(resource.x - p.x, resource.z - p.z), distance: d };
    }
  throw Error(`No standing place by ${id} for ${species}`);
}

const WORKER_FIXTURE = `
const qaHandle = scope.onmessage;
scope.onmessage = (event) => {
  if (event.data?.type !== 'qa-fixture') return qaHandle(event);
  enqueue(async () => {
    const room = runtime.game.rooms.get('SOLO'), p = [...room.players.values()][0];
    const { place, inventory } = event.data;
    if (place)
      Object.assign(p, { x: place.x, z: place.z, facing: place.facing, target: null, path: [],
        dx: 0, dz: 0, warpSequence: (p.warpSequence ?? 0) + 1 });
    if (inventory) Object.assign(p.inventory, inventory);
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
  gatherRange: GATHER_RANGE,
  checks: [],
  errors: [],
  forbidden: [],
  places: {},
};
const pass = (label) => {
  report.checks.push(label);
  console.log('PASS', label);
};
let page, failure;

async function start(character, phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: phone,
    hasTouch: phone,
  });
  await context.addInitScript(() => {
    window.soloQA = { state: null, id: '', sent: [], messages: [] };
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
          else if (message.type !== 'welcome') soloQA.messages.push(message);
        });
      }
      postMessage(data, ...rest) {
        if (this === soloQA.worker && data?.type === 'command')
          soloQA.sent.push({ ...JSON.parse(data.data), qaAt: Math.round(performance.now()) });
        return super.postMessage(data, ...rest);
      }
    };
  });
  const target = await context.newPage();
  target.on('pageerror', (error) => report.errors.push(String(error)));
  target.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  target.on('websocket', (socket) => report.forbidden.push(socket.url()));
  target.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) report.forbidden.push(request.url());
  });
  await target.route('**/src/solo-worker.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + WORKER_FIXTURE });
  });
  const tap = (selector) =>
    phone ? target.locator(selector).tap() : target.locator(selector).click();
  await target.goto(base);
  await tap('#title-start');
  await target.locator('#setup-form input[name="name"]').fill('持てないQA');
  await tap(`#setup-form input[value="${character}"]`);
  await tap('#setup-flow-yes');
  if (
    (await target.locator('[data-starting-mascot="524"]').getAttribute('aria-pressed')) !== 'true'
  )
    await tap('[data-starting-mascot="524"]');
  await tap('#mascot-start');
  await enterPreparedWorld(target, phone);
  await target.waitForFunction(() => soloQA.state?.players?.some((p) => p.id === soloQA.id));
  return { page: target, tap, phone };
}
const self = (who) => who.page.evaluate(() => soloQA.state.players.find((p) => p.id === soloQA.id));
const fixture = (who, data) =>
  who.page.evaluate((data) => soloQA.worker.postMessage({ type: 'qa-fixture', ...data }), data);
const sent = (who, action) =>
  who.page.evaluate((action) => soloQA.sent.filter((m) => m.action === action), action);

async function gather(who, name, id, kind, species) {
  const place = standing(id, species);
  report.places[`${name}:${id}`] = place;
  await fixture(who, { place });
  await who.page.waitForFunction(
    ({ x, z }) => {
      const p = soloQA.state.players.find((p) => p.id === soloQA.id);
      return Math.hypot(p.x - x, p.z - z) < 0.01;
    },
    place,
    { timeout: 30000 },
  );
  const label = kind === 'wood' ? '木材を採集する' : '石を採集する';
  if (who.phone)
    await who.page
      .locator('[data-touch-action="interact"]', { hasText: label })
      .waitFor({ timeout: 30000 });
  else
    await who.page.waitForFunction(
      (label) =>
        !document.querySelector('#interaction-hint').hidden &&
        document.querySelector('#interaction-hint span').textContent === label,
      label,
      { timeout: 30000 },
    );
  await who.page.screenshot({ path: `${output}/${name}-${kind}-hint.png` });
  // The game takes one action per 450 ms (application/game-core.mts); a player walks
  // between piles for longer than this fixture's instant move.
  await who.page.waitForFunction(() => {
    const last = soloQA.sent.findLast((m) => m.action === 'gather');
    return !last || performance.now() - last.qaAt > 500;
  });
  const before = (await self(who)).inventory[kind];
  if (who.phone) await who.page.locator('[data-touch-action="interact"]').tap();
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('e');
  }
  try {
    await who.page.waitForFunction(
      ({ kind, before }) =>
        soloQA.state.players.find((p) => p.id === soloQA.id).inventory[kind] === before + 1,
      { kind, before },
      { timeout: 15000 },
    );
  } catch (error) {
    report.diagnostics = await who.page.evaluate((id) => {
      const { x, z, radius, species, energy, inventory } = soloQA.state.players.find(
        (p) => p.id === soloQA.id,
      );
      return {
        sent: soloQA.sent.filter((m) => m.type !== 'ping').slice(-25),
        notices: soloQA.messages.filter((m) => m.type === 'notice'),
        animals: (soloQA.state.animals ?? [])
          .map((a) => ({ id: a.id, phase: a.phase, x: a.x, z: a.z }))
          .filter((a) => Math.hypot(a.x - x, a.z - z) < 12),
        self: { x, z, radius, species, energy, inventory },
        resource: soloQA.state.resources?.find((r) => r.id === id),
        focus: document.activeElement?.id || document.activeElement?.tagName,
      };
    }, id);
    throw error;
  }
  assert.equal((await sent(who, 'gather')).at(-1).targetId, id);
  pass(
    `${name}: ${kind} gathered with ${who.phone ? 'touch' : 'the E key'} from ${place.distance.toFixed(2)} m${place.distance > GATHER_RANGE ? ', beyond the old 1 m reach' : ''}`,
  );
}

async function openBag(who) {
  if (who.phone) await who.page.locator('[data-touch-action="menu"]').tap();
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('i');
  }
  await who.page.locator('#inventory-crafting').waitFor();
}

async function craftStoredSpear(who, name) {
  await openBag(who);
  assert.equal(await who.page.locator('#recipe-reason-spear').innerText(), '');
  const button = who.page.locator('[data-craft="spear"]');
  await button.scrollIntoViewIfNeeded();
  await who.tap('[data-craft="spear"]');
  await who.page.waitForFunction(
    () =>
      document.querySelector('#inventory-craft-result')?.textContent ===
      '黒曜石の槍を持ち物に追加しました。この人物は武器を持てません。',
    undefined,
    { timeout: 15000 },
  );
  assert.equal((await self(who)).spearHead, 'obsidian');
  assert.equal((await self(who)).inventory.obsidianBlade, 0);
  assert.equal(await who.page.locator('#equipment-confirm').count(), 0, 'no offer to hold it');
  const card = who.page.locator('.inventory-grid [data-item="obsidianSpear"]');
  await card.waitFor();
  assert.match(await card.innerText(), /黒曜石の槍[\s\S]*持てません/);
  await card.scrollIntoViewIfNeeded();
  await who.page.screenshot({ path: `${output}/${name}-bag-stored-spear.png` });
  await who.tap('.inventory-grid [data-item="obsidianSpear"]');
  await who.page.waitForFunction(
    () =>
      document.querySelector('#inventory-craft-result')?.textContent ===
      'この人物は武器を持てません。',
  );
  assert.equal(await who.page.locator('#equipment-confirm').count(), 0);
  assert.deepEqual(await sent(who, 'equipItem'), []);
  const world = await who.page.locator('#world').evaluate((el) => ({ ...el.dataset }));
  assert.equal(world.weaponModel, '', 'nothing drawn in its hand');
  assert.equal(world.weaponVisible, 'false');
  pass(
    `${name}: spear crafted from gathered wood goes into the bag as 持てません; choosing it explains, never equips or draws it`,
  );
}

async function changeCharacter(who, value, species) {
  await who.tap('[data-pause-tab="character"]');
  await who.tap(`#character-switch-form input[value="${value}"]`);
  await who.tap('#character-switch-apply');
  await who.page.waitForFunction(() => !document.querySelector('#modal').open);
  await who.page.waitForFunction(
    (species) => soloQA.state.players.find((p) => p.id === soloQA.id).species === species,
    species,
  );
  await who.page.locator('#world[data-character-asset="ready"]').waitFor({ timeout: 120000 });
}

try {
  // PC: the giant ape.
  const ape = await start('ape-male', false);
  page = ape.page;
  assert.equal((await self(ape)).species, 'ape');
  await gather(ape, 'ape', 'wood-7', 'wood', 'ape');
  await gather(ape, 'ape', 'stone-17', 'stone', 'ape');
  await fixture(ape, { inventory: { obsidianBlade: 1 } });
  await ape.page.waitForFunction(
    () => soloQA.state.players.find((p) => p.id === soloQA.id).inventory.obsidianBlade === 1,
  );
  await craftStoredSpear(ape, 'ape');
  assert.equal(
    await ape.page.locator('#world').evaluate((el) => el.dataset.attackStyle),
    'unarmed',
  );

  await changeCharacter(ape, 'cro-male', 'cro');
  const drawn = (model) =>
    ape.page.waitForFunction(
      (model) => {
        const data = document.querySelector('#world').dataset;
        return data.weaponModel === model && data.weaponVisible === 'true';
      },
      model,
      { timeout: 30000 },
    );
  // The ape's hands are no human's item: the human takes up its best spear, the stored one.
  await drawn('obsidian-spear');
  await ape.page.screenshot({ path: `${output}/human-holds-stored-spear.png` });
  await openBag(ape);
  assert.match(
    await ape.page.locator('.inventory-grid [data-item="obsidianSpear"]').innerText(),
    /装備中/,
  );
  for (const [item, model] of [
    ['weapon', 'wooden-spear'],
    ['obsidianSpear', 'obsidian-spear'],
  ]) {
    assert.match(
      await ape.page.locator(`.inventory-grid [data-item="${item}"]`).innerText(),
      /装備する/,
    );
    await ape.tap(`.inventory-grid [data-item="${item}"]`);
    await ape.page.locator('#equipment-confirm').waitFor();
    await ape.tap('#equipment-confirm-yes');
    await ape.page.locator(`.inventory-grid .inventory-equipped[data-item="${item}"]`).waitFor();
    await drawn(model);
  }
  assert.deepEqual(
    (await sent(ape, 'equipItem')).map((m) => m.targetId),
    ['spear', 'obsidianSpear'],
  );
  await ape.page.keyboard.press('Escape');
  await ape.page.waitForFunction(() => !document.querySelector('#modal').open);
  pass(
    'A human takes up the stored obsidian spear; switching to the wooden spear and back each takes one confirmation',
  );

  await ape.page.locator('#world').focus();
  await ape.page.keyboard.press('Escape');
  await changeCharacter(ape, 'ape-male', 'ape');
  await ape.page.waitForFunction(
    () => {
      const data = document.querySelector('#world').dataset;
      return (
        data.attackStyle === 'unarmed' && data.weaponModel === '' && data.weaponVisible === 'false'
      );
    },
    undefined,
    { timeout: 30000 },
  );
  await openBag(ape);
  assert.match(
    await ape.page.locator('.inventory-grid [data-item="obsidianSpear"]').innerText(),
    /持てません/,
  );
  await ape.page.screenshot({ path: `${output}/ape-again-bag.png` });
  pass('Changing back into the ape lets go of the spear; it stays in the bag as 持てません');
  await ape.page.context().close();

  // Phone: the fennec mage.
  const mage = await start('bear-female', true);
  page = mage.page;
  assert.equal((await self(mage)).species, 'bear');
  await gather(mage, 'mage', 'stone-17', 'stone', 'bear');
  await gather(mage, 'mage', 'wood-7', 'wood', 'bear');
  await fixture(mage, { inventory: { obsidianBlade: 1 } });
  await mage.page.waitForFunction(
    () => soloQA.state.players.find((p) => p.id === soloQA.id).inventory.obsidianBlade === 1,
  );
  await craftStoredSpear(mage, 'mage-phone');
  assert.equal(
    await mage.page.locator('#modal').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
    'no horizontal overflow on the phone',
  );
  await mage.page.context().close();

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.forbidden, []);
  assert.deepEqual(await saveHashes(), savesBefore, 'the local save is untouched');
  pass('No browser errors, no socket or API traffic, and the local save is untouched');
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
