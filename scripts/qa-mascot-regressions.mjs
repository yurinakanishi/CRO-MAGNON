import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BOT_KINDS, botThrowPlan } from '../dist/shared/orb-bots.mjs';
import { GROUND_MASCOTS } from '../dist/shared/friend-mascots.mjs';
import { PLAYABLE_CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { mascotQA, until, sleep, distance } from './qa-mascot-harness.mjs';
import { verifyRimoHappyLifecycle } from './qa-rimo-happy-lifecycle.mjs';
import { verify524Surface } from './qa-524-surface.mjs';

const activeKeys = ['rimo-neko', '524', ...BOT_KINDS];
const retainedKeys = GROUND_MASCOTS.map((def) => def.key);

/** Current replacements for the former camp/group/recruitment QA entry points. */
export async function runMascotRegressions({ profile = 'active', keys, out } = {}) {
  keys ??=
    profile === 'retained'
      ? retainedKeys
      : ['persistence', 'poses'].includes(profile)
        ? ['524', 'rimo-neko', 'white']
        : activeKeys;
  const q = await mascotQA({
    out,
    retained: keys.some((key) => retainedKeys.includes(key)),
    persistent: profile === 'persistence',
  });
  let error;
  try {
    const a = await q.open('owner'),
      b = await q.open('visitor');
    assert.deepEqual(q.bodies(), []);
    q.pass('no shared or unchosen bodies at camp');
    q.room().enemies = [];
    let site;
    for (let x = 40; x < 65 && !site; x++)
      for (let z = 54; z < 66; z++)
        if (q.room().collision.free({ x, z }, 3)) {
          site = { x, z };
          break;
        }
    assert.ok(site, 'open collision-free stage');
    await q.stage(a, { ...site, facing: 0 });
    await q.stage(b, { x: site.x + 3, z: site.z, facing: 0 });
    for (let i = 0; i < 3; i++) {
      const peer = await q.peer(`peer-${i}`);
      Object.assign(peer.player(), { x: site.x + 10, z: site.z + 8 });
      peer.socket.send(
        JSON.stringify({ type: 'action', action: 'selectMascot', targetId: 'white' }),
      );
    }
    await until(
      () => q.room().players.size === 5 && q.peers.every((p) => p.seen.state.players?.length === 5),
      'five clients',
    );
    q.pass('two real Chrome views and three protocol peers share one five-player world');
    const cases =
      profile === 'poses'
        ? keys.flatMap((key) => PLAYABLE_CHARACTER_MODELS.map((character) => ({ key, character })))
        : keys.map((key) => ({ key }));
    for (const { key, character } of cases) {
      if (character) await changeCharacter(q, b, character);
      const caseName = character ? `${key}-${character.key}` : key;
      await q.stage(a, { ...site, facing: 0 });
      await q.stage(b, { x: site.x + 3, z: site.z, facing: 0 });
      const c = await q.choose(a, key),
        other = await q.choose(b, key);
      assert.notEqual(c.id, other.id);
      assert.equal(c.ownerId, a.id);
      assert.equal(other.ownerId, b.id);
      await q.drawn(b, c.id);
      await q.drawn(a, other.id);
      await until(() => q.bodies().length === 5, 'exactly five selected bodies');
      for (const viewer of [a, b, ...q.peers]) {
        const visible = [
          ...(viewer.seen.state.companions ?? []),
          ...(viewer.seen.state.orbBots ?? []).filter((b) => !b.companionId),
        ];
        assert.equal(visible.filter((b) => b.ownerId === a.id && !b.leavingAt).length, 1);
        assert.equal(visible.find((b) => b.id === c.id).ownerId, a.id);
      }
      q.pass(`${key}: independent same-kind bodies and five-client owner agreement`);
      await q.beside(b, c);
      await q.record(c, b);
      await b.page.locator('#world').focus();
      await b.page.keyboard.press('v');
      await until(() => c.petPlayerId === b.id, `${key}: real V pet`);
      await until(() => c.petContactAt > 0, `${key}: authoritative hand contact`);
      await sleep(450);
      await q.snapshot(`${caseName}-contact`);
      await until(() => !c.petPlayerId, `${key}: stroke and happy reaction end`, 10000);
      assert.equal(c.ownerId, a.id);
      assert.equal(a.player().mascot, key);
      assert.equal(b.player().mascot, key);
      assert.equal(q.body(b).id, other.id);
      for (const viewer of [a, b]) {
        const samples = await q.frames(viewer);
        const contact = samples.filter(
          (f) => f.petContactAt && f.weight > 0.99 && f.at - f.petContactAt > 150,
        );
        assert.ok(contact.length >= 5, `${key}: contact frames in ${viewer.name}`);
        const maxGap = Math.max(...contact.map((f) => f.gap));
        assert.ok(maxGap < 0.045, `${key}: ${viewer.name} hand gap ${maxGap}`);
        assert.ok(
          samples.some((f) => f.hearts >= 3),
          `${key}: ${viewer.name} completed happy hearts`,
        );
        if (key === '524')
          assert.ok(
            samples.some((f) => f.spin > 6.27),
            '524 finishes one happy revolution',
          );
        q.records.push({
          key,
          character: character?.key,
          viewer: viewer.name,
          contactFrames: contact.length,
          maxGap,
          maxHearts: Math.max(...samples.map((f) => f.hearts)),
        });
        await writeFile(`${q.out}/${caseName}-pet-${viewer.name}.json`, JSON.stringify(samples));
      }
      q.pass(
        `${caseName}: real V, animated hand contact, happy hearts and unchanged ownership in both views`,
      );
      if (key === 'rimo-neko' && !character) {
        const lifecycle = await verifyRimoHappyLifecycle(a.page);
        q.records.push({ key, lifecycle });
        q.pass('cat happy lifecycle: late arrival, culling, interruption and disposal');
      }
      if (key === '524' && (!character || character.key === 'cro-magnon-woman')) {
        q.records.push({ key, surface: await verify524Surface(a.page) });
        q.pass('524: all vertices in 51 poses stay airborne, 30cm body, closed four-second loop');
      }
      if (profile === 'flight') await checkFlight(q, a, b, c, key);
      const old = c.id;
      await q.choose(a, null);
      assert.equal(q.body(a), undefined);
      assert.equal(q.body(b).id, other.id);
      await until(() => !q.bodies().some((b) => b.id === old), 'goodbye removes only owner body');
      for (const viewer of [a, b])
        await until(
          () =>
            viewer.page.evaluate(
              (id) => !qa.companionRenderers.renderers.has(id) && !qa.orbBotRenderer.bots.has(id),
              old,
            ),
          'no orphan renderer',
        );
      q.pass(`${key}: goodbye removes its renderer and preserves the other owner's body`);
    }
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await a.page.setViewportSize(viewport);
      await q.menu(a);
      assert.equal(await a.page.locator('[data-mascot-all]').count(), 0);
      assert.equal(await a.page.locator('[data-mascot-none]').count(), 1);
      assert.equal(
        await a.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const touchKey = viewport.width === 844 ? 'white' : '524';
      const card = a.page.locator(`[data-mascot="${touchKey}"]`);
      await card.scrollIntoViewIfNeeded();
      await card.tap();
      await until(() => a.player().mascot === touchKey, 'real touch chooses one mascot');
      await q.snapshot(`menu-${viewport.width}`);
      await q.closeMenu(a);
    }
    q.pass('desktop, portrait and landscape fit; actual touch selects one, no group controls');
    if (profile === 'persistence') await checkPersistence(q, a, b, keys);
    assert.deepEqual(q.errors, []);
    q.pass('no browser exceptions or console errors');
  } catch (caught) {
    error = caught;
    await q.snapshot('failure').catch(() => {});
  } finally {
    await q.finish(error);
  }
  if (error) throw error;
}

async function changeCharacter(q, who, character) {
  if (who.player().species === character.species && who.player().gender === character.gender)
    return;
  await q.menu(who);
  await who.page.locator('[data-pause-tab="settings"]').click();
  await who.page.locator('[data-controller-menu="character"]').click();
  await who.page
    .locator(
      `#character-switch-form .character-choice:has(input[value="${character.species}-${character.gender}"])`,
    )
    .click();
  await who.page.locator('#character-confirm-yes').click();
  await until(
    () => who.player().species === character.species && who.player().gender === character.gender,
    'character change',
  );
  await until(
    () =>
      who.page.evaluate(
        (key) => qa.players.get(qa.selfId)?.actor?.asset.modelKey === key,
        character.key,
      ),
    'changed character GLB',
    60000,
  );
  await q.closeMenu(who);
}

async function checkFlight(q, a, b, c, key) {
  const bot = q.room().orbBots.find((bot) => bot.id === c.id || bot.companionId === c.id);
  assert.ok(bot, `${key} is throwable`);
  let best;
  for (let i = 0; i < 24; i++) {
    const facing = (i / 24) * Math.PI * 2,
      plan = botThrowPlan({ ...a.player(), facing }, q.room().collision, q.room().orbBots, key);
    if (plan && (!best || distance(plan.landing, a.player()) > best.reach))
      best = { facing, reach: distance(plan.landing, a.player()) };
  }
  assert.ok(best?.reach > 3);
  a.player().facing = best.facing;
  await sleep(500);
  await q.record(c, a);
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('c');
  await until(() => bot.mode === 'waiting', `${key}: actual C throw lands`);
  await sleep(250);
  for (const viewer of [a, b]) {
    const samples = await q.frames(viewer),
      flight = samples.filter((f) => f.mode === 'airborne');
    await writeFile(`${q.out}/${key}-flight-${viewer.name}.json`, JSON.stringify(samples));
    assert.ok(flight.length >= 5, `${key}: visible flight frames in ${viewer.name}`);
    const angles = flight.map((f) => f.pitch);
    assert.ok(
      Math.min(...angles) < 0.7 && Math.max(...angles) > 5.7,
      `${key}: complete forward turn`,
    );
    assert.ok(
      angles.some((a) => a > 2.5 && a < 3.8),
      `${key}: upside-down apex`,
    );
    assert.ok(
      angles.every((a, i) => a >= 0 && a <= 2 * Math.PI && (!i || a >= angles[i - 1] - 1e-9)),
      `${key}: exactly one monotonic turn`,
    );
    assert.ok(
      samples.some((f) => f.mode === 'waiting' && f.pitch === 0),
      `${key}: lands upright`,
    );
    // Early windup is the authored pickup blend, before the body reaches the hand.
    const held = samples.filter(
      (f) => f.mode === 'windup' && f.heldWeight > 0.999 && f.handError !== null,
    );
    assert.ok(
      held.length > 0 && held.every((f) => f.handError < 0.001),
      `${key}: held at the animated hand`,
    );
  }
  const at = { x: bot.x, z: bot.z };
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('q');
  await sleep(500);
  assert.equal(bot.mode, 'waiting');
  assert.ok(distance(bot, at) < 0.001, 'visitor recall cannot move it');
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('q');
  await until(
    () => bot.mode === 'following' && distance(bot, a.player()) < 3,
    `${key}: owner's Q recall`,
    20000,
  );
  q.pass(
    `${key}: hand hold, one full flight turn, upright landing, owner-only recall in both views`,
  );
}

async function checkPersistence(q, a, b, keys) {
  const sessions = [];
  for (let i = 0; i < keys.length; i++) {
    const who = i === 0 ? a : i === 1 ? b : q.peers[0];
    if (who.page) await q.choose(who, keys[i]);
    else {
      who.socket.send(
        JSON.stringify({ type: 'action', action: 'selectMascot', targetId: keys[i] }),
      );
      await until(() => who.player().mascot === keys[i], 'peer selection');
    }
    who.player().inventory.wood = 17 + i;
    sessions.push({
      id: who.id,
      session: who.seen.session,
      key: keys[i],
      wood: 17 + i,
      bodyId: q.body(who).id,
    });
  }
  await q.game().saveNow();
  const saved = q.game().core.exportState();
  for (const name of ['companions', 'orbBots', 'companion524', 'rimoNeko', 'friends', 'mae'])
    assert.equal(name in saved.rooms[0], false);
  await q.restart();
  assert.deepEqual(q.bodies(), [], 'no bodies while saved owners are offline');
  for (const before of sessions) {
    const who = await q.peer('Resumed', before.session);
    assert.equal(who.id, before.id);
    assert.equal(who.player().mascot, before.key);
    assert.equal(who.player().inventory.wood, before.wood);
    await until(() => !!q.body(who), 'fresh body on resume');
    assert.ok(distance(q.body(who), who.player()) < 3);
    assert.equal(q.body(who).petPlayerId, null);
  }
  assert.equal(q.bodies().length, sessions.length);
  q.pass(
    'actual isolated disk restart preserves only selections and inventory; bodies appear on reconnect',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runMascotRegressions({ profile: process.argv[2] ?? 'active', out: process.argv[3] });
