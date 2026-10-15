import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createGameCore } from '../dist/application/game-core.mjs';
import { activeMascot, mascotBodies, mascotKeyOf } from '../dist/shared/mascot-selection.mjs';
import { MascotSocket } from './mascot-fixture.mjs';
import { STARTING_MASCOTS, startingMascotMarkup } from '../dist/src/starting-mascot.js';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { MASCOT_PORTRAITS } from '../dist/src/mascot-portraits.js';

function fixture(t) {
  let serial = 0;
  const core = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: {
      now: () => 100000,
      id: () => `start-${++serial}`,
      token: () => `session-${++serial}`,
    },
  });
  t.after(() => core.close());
  const room = () => core.rooms.get('START');
  const join = (params = {}) => {
    const socket = new MascotSocket();
    core.connect(socket, new URLSearchParams({ room: 'START', resume: '1', ...params }));
    const welcome = socket.messages.find((message) => message.type === 'welcome');
    return { socket, welcome, player: room()?.players.get(welcome?.id) };
  };
  return { core, room, join };
}

test('five new visitors can each arrive with the same single companion in their first snapshot', (t) => {
  const { room, join } = fixture(t);
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const who = join({ startAtCamp: '1', mascot: '524' });
    assert.equal(who.welcome.profile.mascot, '524');
    const mine = activeMascot(room(), who.player.id);
    assert.equal(mascotKeyOf(mine), '524');
    ids.add(mine.id);
    assert.equal(
      mascotBodies(room()).filter((body) => body.ownerId === who.player.id && !body.leavingAt)
        .length,
      1,
    );
    const state = who.socket.messages.find((message) => message.type === 'state');
    assert.equal(state.players.find((player) => player.id === who.player.id).mascot, '524');
  }
  assert.equal(ids.size, 5);
});

test('a title choice changes the saved companion while preserving identity, inventory, energy and progress', (t) => {
  const { room, join } = fixture(t);
  const first = join({ mascot: 'rimo-neko' });
  Object.assign(first.player, { energy: 73, gathered: 12, tool: true });
  first.player.inventory.wood = 9;
  first.socket.close();
  assert.equal(mascotBodies(room()).length, 0);
  const next = join({ session: first.welcome.session, startAtCamp: '1', mascot: '524' });
  assert.equal(next.player.id, first.player.id);
  assert.equal(next.player.mascot, '524');
  assert.equal(next.player.inventory.wood, 9);
  assert.equal(next.player.energy, 73);
  assert.equal(next.player.gathered, 12);
  assert.equal(next.player.tool, true);
  assert.equal(mascotBodies(room()).length, 1);
  assert.equal(mascotKeyOf(activeMascot(room(), next.player.id)), '524');
});

test('stale automatic reconnect preferences never replace the saved companion', (t) => {
  const { room, join } = fixture(t);
  const first = join({ mascot: 'rimo-neko' });
  first.socket.close();
  const next = join({ session: first.welcome.session, mascot: '524' });
  assert.equal(next.player.mascot, 'rimo-neko');
  assert.equal(mascotKeyOf(activeMascot(room(), next.player.id)), 'rimo-neko');
});

test('hidden, malformed and old-client choices preserve a saved companion; explicit none dismisses it', (t) => {
  const { room, join } = fixture(t);
  let who = join({ mascot: '524' });
  for (const mascot of [undefined, 'keep', 'mae', 'all', '524,rimo-neko', '__proto__']) {
    who.socket.close();
    who = join({
      session: who.welcome.session,
      startAtCamp: '1',
      ...(mascot === undefined ? {} : { mascot }),
    });
    assert.equal(who.player.mascot, '524');
    assert.equal(mascotBodies(room()).length, 1);
  }
  who.socket.close();
  who = join({ session: who.welcome.session, startAtCamp: '1', mascot: 'none' });
  assert.equal(who.player.mascot, null);
  assert.equal(mascotBodies(room()).length, 0);
  const fresh = join({ mascot: 'mae' });
  assert.equal(fresh.player.mascot, null);
});

test('a failed arrival leaves the saved companion and possessions available for retry', (t) => {
  const { room, join } = fixture(t);
  const first = join({ mascot: '524' });
  first.player.inventory.wood = 7;
  first.socket.close();
  const nearest = room().collision.nearestFree;
  room().collision.nearestFree = () => null;
  const failed = join({ session: first.welcome.session, startAtCamp: '1', mascot: 'rimo-neko' });
  assert.equal(failed.welcome, undefined);
  const saved = room().sessions.get(first.welcome.session).player;
  assert.equal(saved.mascot, '524');
  assert.equal(saved.inventory.wood, 7);
  room().collision.nearestFree = nearest;
  const next = join({ session: first.welcome.session, startAtCamp: '1', mascot: 'rimo-neko' });
  assert.equal(next.player.mascot, 'rimo-neko');
});

test('setup offers the released roster, exactly one chosen card, and the same real photos as the menu', () => {
  assert.equal(STARTING_MASCOTS.length, 11);
  assert.deepEqual(new Set(MASCOT_PORTRAITS.map((photo) => photo.key)), new Set(STARTING_MASCOTS));
  assert.ok(!STARTING_MASCOTS.includes('mae'));
  const markup = startingMascotMarkup(STARTING_MASCOTS, '524', false);
  assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(markup, /data-starting-mascot="524" aria-pressed="true"/);
  assert.doesNotMatch(markup, /type="submit"/);
  for (const { url } of MASCOT_PORTRAITS) {
    assert.ok(markup.includes(`src="${url}"`));
    assert.ok(mascotMenuMarkup(STARTING_MASCOTS).includes(`src="${url}"`));
  }
  assert.match(
    startingMascotMarkup(STARTING_MASCOTS, 'keep', true),
    /data-starting-mascot="keep" aria-pressed="true"/,
  );
  assert.match(
    startingMascotMarkup(STARTING_MASCOTS, 'mae', true),
    /data-starting-mascot="keep" aria-pressed="true"/,
  );
  assert.doesNotMatch(
    startingMascotMarkup(STARTING_MASCOTS, 'keep', false),
    /data-starting-mascot="keep"/,
  );
});

for (const [revision, count] of [
  ['20261015-r01', 2],
  ['20261015-dots-r01', 9],
])
  test(`adopted photographs ${revision} retain verified model provenance and exact visible PNG pixels`, async () => {
    const folder = `assets/mascot-portraits/${revision}`;
    const capture = JSON.parse(await readFile(`${folder}/capture.json`, 'utf8'));
    const adoption = JSON.parse(await readFile(`${folder}/adoption.json`, 'utf8'));
    assert.equal(capture.ok, true);
    assert.equal(capture.records.length, count);
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
    for (const record of capture.records) {
      const source = JSON.parse(
        await readFile(`public/models/${record.modelKey}/asset.json`, 'utf8'),
      );
      assert.equal(source.sha256, record.source.sha256);
      const png = await readFile(`${folder}/${record.files.png.file}`);
      const webp = await readFile(`public${record.url}`);
      assert.equal(sha(webp), record.files.webp.sha256);
      assert.equal(sha(webp), adoption.files.find((file) => file.key === record.key).sha256);
      const a = await sharp(png).ensureAlpha().raw().toBuffer();
      const b = await sharp(webp).ensureAlpha().raw().toBuffer();
      for (let i = 0; i < a.length; i += 4) {
        assert.equal(a[i + 3], b[i + 3]);
        if (a[i + 3]) assert.ok(a.subarray(i, i + 3).equals(b.subarray(i, i + 3)));
      }
      assert.equal(record.clip, record.key === '524' ? 'Floating_Ripple' : 'Idle_Loop');
      assert.equal(record.camera.verticalSpan, 0.78);
      if (revision.includes('dots')) {
        assert.ok(record.modelKey.startsWith('orb-bot-'));
        assert.deepEqual(record.scale, [1, 1, 1]);
        if (!['triangle', 'heart'].includes(record.key)) assert.equal(record.blink.closure, 0);
      }
      assert.ok(record.pixelBounds.left >= 6 && record.pixelBounds.top >= 6);
    }
  });
