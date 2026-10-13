// Two real Chrome players share an in-memory room: one companion per person, the same
// mascot for both, petting someone else's companion, goodbyes, throw-and-leave and leaving.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/mascot-companions-${Date.now()}`;
await mkdir(output, { recursive: true });
const ROOM = 'MASCOT-ONE-QA';
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`timed out: ${label}`);
    await sleep(40);
  }
  checks.push(label);
}
const room = () => game.rooms.get(ROOM);
const bodies = () => [...(room()?.orbBots ?? []), ...(room()?.companions ?? [])];
const active = (id) => bodies().find((b) => b.ownerId === id && !b.leavingAt && !b.companionId);
const keyOf = (body) => body?.kind ?? body?.key;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dataset = (page, key) =>
  page.evaluate((name) => JSON.parse(document.querySelector('#world').dataset[name] ?? '[]'), key);

async function join(name, viewport, gender) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  await page.addInitScript(
    ({ name, gender }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', gender);
    },
    { name, gender },
  );
  const before = new Set(room()?.players.keys() ?? []);
  await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}&autostart=1`);
  await enterPreparedWorld(page, false);
  await until(
    () => [...(room()?.players.keys() ?? [])].some((id) => !before.has(id)),
    `${name} joined`,
  );
  const id = [...room().players.keys()].find((key) => !before.has(key));
  return { name, context, page, id, player: () => room().players.get(id) };
}
async function openMascots(who) {
  await who.page.locator('#world').focus();
  await who.page.keyboard.press('Escape');
  await who.page.locator('[data-pause-tab="mascots"]').click();
  await who.page.locator('.mascot-cards').waitFor();
}
async function closeMenu(who) {
  await who.page.keyboard.press('Escape');
  await who.page.waitForFunction(() => !document.querySelector('#modal')?.open);
  await who.page.locator('#world').focus();
}
/** Face the open ground with the longest clear throw from where the player stands. */
function faceOpenGround(who) {
  const p = who.player();
  let best = { facing: p.facing, reach: -1 };
  for (let i = 0; i < 16; i++) {
    const facing = -Math.PI + (i / 16) * Math.PI * 2;
    const plan = botThrowPlan({ ...p, facing }, room().collision, room().orbBots, 'white');
    const reach = plan ? distance(plan.landing, p) : -1;
    if (reach > best.reach) best = { facing, reach };
  }
  assert.ok(best.reach > 3, 'open ground to throw into');
  p.facing = best.facing;
}
async function choose(who, key) {
  await openMascots(who);
  await who.page.locator(`[data-mascot="${key}"]`).click();
  await until(() => keyOf(active(who.id)) === key, `${who.name} travels with ${key}`);
  await until(
    () =>
      who.page
        .locator(`[data-mascot="${key}"]`)
        .getAttribute('aria-pressed')
        .then((pressed) => pressed === 'true'),
    `${who.name}'s ${key} card reflects the server`,
  );
}
/** Stand beside a body, facing it, with the player's own companion settled behind. */
async function standBeside(who, body, gap = 1.05) {
  Object.assign(who.player(), { x: body.x + gap, z: body.z, facing: -Math.PI / 2 });
  await sleep(1500);
  Object.assign(who.player(), { x: body.x + gap, z: body.z, facing: -Math.PI / 2 });
  await sleep(200);
}

let result;
const a = await join('Companion A', { width: 1440, height: 900 }, 'female');
try {
  // Nothing waits at camp: no companion body exists until someone chooses one.
  await sleep(1500);
  assert.deepEqual(bodies(), []);
  assert.deepEqual(await dataset(a.page, 'companions'), []);
  assert.deepEqual(await dataset(a.page, 'orbBots'), []);
  checks.push('no companion waits at camp');

  await openMascots(a);
  assert.equal(await a.page.locator('[data-mascot]').count(), 11);
  assert.equal(await a.page.locator('[data-mascot-all]').count(), 0, 'no select-all');
  assert.equal(await a.page.locator('[data-mascot-none]').isDisabled(), true);
  assert.equal(await a.page.locator('#mascot-selection-count').count(), 0);
  await a.page.screenshot({ path: `${output}/menu-alone.png`, animations: 'disabled' });
  await closeMenu(a);

  await choose(a, '524');
  assert.equal(await a.page.locator('#mascot-selection-count').count(), 0);
  assert.match(await a.page.locator('[data-mascot="524"]').innerText(), /一緒に行く/);
  assert.equal(await a.page.locator('[data-mascot-none]').isDisabled(), false);
  await a.page.screenshot({ path: `${output}/menu-524.png`, animations: 'disabled' });
  await closeMenu(a);
  const a524 = active(a.id);
  await until(
    async () =>
      (await dataset(a.page, 'companions')).some(
        (c) => c.id === a524.id && c.ownerId === a.id && c.visible,
      ),
    "A's own 524 is drawn",
    60000,
  );

  // A second traveler brings the same mascot: two separate bodies.
  const b = await join('Companion B', { width: 1280, height: 800 }, 'male');
  Object.assign(b.player(), { x: a.player().x + 3, z: a.player().z, facing: 0 });
  await choose(b, '524');
  const b524 = active(b.id);
  assert.notEqual(a524.id, b524.id);
  assert.equal(room().companions.filter((c) => c.key === '524' && !c.leavingAt).length, 2);
  await closeMenu(b);
  for (const who of [a, b])
    await until(
      async () =>
        (await dataset(who.page, 'companions')).filter((c) => c.key === '524' && c.visible)
          .length === 2,
      `${who.name} sees both 524s`,
      60000,
    );
  await a.page.screenshot({ path: `${output}/two-524.png` });

  // B pets A's 524: it is happy, and it stays A's.
  await standBeside(b, a524);
  assert.ok(distance(b.player(), a524) < distance(b.player(), b524), "A's 524 is the nearest");
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('v');
  await until(() => a524.petPlayerId === b.id, "B strokes A's 524");
  let contact = false;
  const strokeEnd = Date.now() + 4500;
  while (Date.now() < strokeEnd) {
    assert.equal(a524.ownerId, a.id, 'petting never changes the owner');
    if (!contact && a524.petContactAt > 0) {
      contact = true;
      await sleep(900);
      await b.page.screenshot({ path: `${output}/b-pets-a-524.png` });
    }
    if (!a524.petPlayerId && contact) break;
    await sleep(50);
  }
  assert.ok(contact, "A's 524 reached B's hand");
  await until(() => !a524.petPlayerId, 'the stroke ends');
  assert.equal(a524.ownerId, a.id);
  assert.equal(active(b.id), b524, 'B still has only its own 524');
  checks.push("petting someone else's companion never changes its owner");

  // Choosing another companion waves the previous one goodbye.
  Object.assign(a.player(), { x: a.player().x - 4 });
  await sleep(1500);
  await choose(a, 'white');
  assert.ok(a524.leavingAt > 0, 'the 524 says goodbye');
  await closeMenu(a);
  await a.page.screenshot({ path: `${output}/goodbye-524.png` });
  await until(() => !room().companions.includes(a524), "A's 524 left the world", 3000);
  await until(
    async () => !(await dataset(a.page, 'companions')).some((c) => c.id === a524.id),
    "A's 524 is no longer drawn",
    4000,
  );
  const white = active(a.id);
  await until(
    async () =>
      (await dataset(a.page, 'orbBots')).some((bot) => bot.id === white.id && bot.visible),
    'the white dot is drawn',
    60000,
  );
  // Throw and leave: it waits where it landed while its person walks away.
  faceOpenGround(a);
  await sleep(300);
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('c');
  await until(() => white.mode === 'waiting', 'the thrown dot waits at its landing');
  const landing = { x: white.x, z: white.z };
  await a.page.screenshot({ path: `${output}/thrown-dot-waits.png` });
  Object.assign(a.player(), { x: a.player().x - 9 });
  await sleep(2000);
  assert.equal(white.mode, 'waiting');
  assert.ok(distance(white, landing) < 0.01);
  await standBeside(b, white);
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('v');
  await until(() => white.petPlayerId === b.id, 'B strokes the waiting dot');
  await until(() => !white.petPlayerId, 'that stroke ends', 6000);
  assert.equal(white.mode, 'waiting', 'it keeps waiting after being petted');
  assert.equal(white.ownerId, a.id);
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('q');
  await until(
    () => ['following', 'catching'].includes(white.mode) && distance(white, a.player()) < 3,
    'only its owner calls it back',
    12000,
  );

  // T sends one's own companion off; no card remains selected.
  await a.page.keyboard.press('t');
  await until(() => white.mode === 'leaving', 'T waves the dot goodbye');
  await until(() => !room().orbBots.includes(white), 'the dot left after its goodbye', 3000);
  assert.equal(a.player().mascot, null);
  await openMascots(a);
  assert.equal(await a.page.locator('[data-mascot][aria-pressed="true"]').count(), 0);
  await closeMenu(a);

  // B's companion leaves with B.
  Object.assign(b.player(), { x: a.player().x + 2.5, z: a.player().z });
  await sleep(1500);
  await until(
    async () => (await dataset(a.page, 'companions')).some((c) => c.id === b524.id && c.visible),
    "A sees B's 524 beside B",
    10000,
  );
  await b.context.close();
  await until(() => !room().companions.some((c) => c.id === b524.id), "B's 524 left with B");
  await until(
    async () => !(await dataset(a.page, 'companions')).some((c) => c.id === b524.id),
    "B's 524 is no longer drawn for A",
    4000,
  );

  // Phone and landscape sizes: one choice, no horizontal scroll.
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(viewport);
    await openMascots(a);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await a.page.screenshot({
      path: `${output}/menu-${viewport.width}x${viewport.height}.png`,
      animations: 'disabled',
    });
    await closeMenu(a);
  }
  assert.deepEqual(errors, []);
  result = { passed: true, checks, errors };
  console.log(`PASS ${checks.length} checks, no browser errors`);
} catch (error) {
  result = { passed: false, checks, errors, error: String(error), stack: error.stack };
  await a.page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await game.close();
}
