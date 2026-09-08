// Actual Chrome game clients. Position/material fixtures are explicit; equipment is changed through UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameServer } = await import(build + 'server.mjs');
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { CHARACTER_MODELS } = await import(build + 'shared/characters.mjs');
const { attackProfile } = await import(build + 'shared/combat-profiles.mjs');
const core = createGameCore(),
  game = createGameServer({ core, port: 0, host: '127.0.0.1' });
const address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`;
const folder = 'assets/coastal-craft/appearance-qa/r02';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const results = [],
  errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(80);
  }
  throw Error('Timeout: ' + label);
}
try {
  for (const [index, profile] of CHARACTER_MODELS.entries()) {
    const roomName = 'GEAR' + index;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((p) => {
      localStorage.setItem('cro-name', p.key);
      localStorage.setItem('cro-species', p.species);
      localStorage.setItem('cro-gender', p.gender);
    }, profile);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`${base}/?room=${roomName}&autostart=1`, { waitUntil: 'domcontentloaded' });
    const ready = () =>
      page
        .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
        .waitFor({ timeout: 90000 });
    await ready();
    const room = core.rooms.get(roomName),
      actor = [...room.players.values()][0];
    assert.equal(actor.spearHead, 'wood');
    assert.equal(attackProfile(actor).key, profile.weapon || 'spear');
    Object.assign(actor, { x: -2258, z: 460, facing: 0 });
    Object.assign(actor.inventory, { wood: 1, obsidianBlade: 1 });
    const fixture = { x: actor.x, z: actor.z, wood: 1, obsidianBlade: 1 };
    assert.ok(room.collision.free(actor, actor.radius));
    // Let the join Wave clip and region banner finish before judging idle equipment.
    await sleep(6000);
    await page.screenshot({ path: `${folder}/${profile.key}-initial.png` });
    await page.keyboard.press('i');
    await page.locator('#modal-coastal').click();
    if (profile.weapon) {
      assert.ok(await page.locator('#stone-haft').isDisabled());
      await page.keyboard.press('Escape');
    } else {
      await page.locator('#stone-haft').click();
      await until(() => actor.spearHead === 'obsidian', 'haft ' + profile.key);
      assert.equal(actor.inventory.wood, 0);
      assert.equal(actor.inventory.obsidianBlade, 0);
      await page.keyboard.press('Escape');
      await until(
        () =>
          page
            .locator('#attack-button')
            .textContent()
            .then((s) => s.includes('黒曜石')),
        'upgraded HUD',
      );
      // Hafting plays a two-second Craft clip which intentionally hides tools.
      await sleep(2300);
      await page.screenshot({ path: `${folder}/${profile.key}-obsidian.png` });
    }
    const seq = actor.attackSequence || 0;
    await page.keyboard.press('f');
    await until(() => actor.attackSequence > seq, 'attack ' + profile.key);
    await sleep(280);
    await page.screenshot({ path: `${folder}/${profile.key}-attack.png` });
    const id = actor.id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await until(() => room.players.has(id), 'same session resumed');
    const restored = room.players.get(id);
    assert.equal(restored.spearHead, profile.weapon ? 'wood' : 'obsidian');
    assert.equal(attackProfile(restored).key, profile.weapon || 'spear');
    await sleep(2200);
    await page.screenshot({ path: `${folder}/${profile.key}-restored.png` });
    results.push({
      profile,
      fixture,
      idRetained: true,
      spearHead: restored.spearHead,
      weapon: attackProfile(restored),
      fps: await page.locator('#world').getAttribute('data-fps'),
    });
    console.log(JSON.stringify({ checked: profile.key, spearHead: restored.spearHead }));
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        status: 'passed',
        results,
        errors,
        notes: [
          'One real Chrome renderer at a time; five-player integration is recorded separately.',
          'Workshop position and one blade/wood are setup fixtures. Hafting and attack use normal controls.',
          'All four human appearances start bare, show an obsidian head after hafting, and retain equipment on reload. Cat and mage retain their own attacks.',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await game.close();
}
