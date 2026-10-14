import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { ALL_MASCOT_MODELS, MASCOT_ROSTER } from '../dist/shared/mascot-roster.mjs';
import { BOT_KINDS } from '../dist/shared/orb-bots.mjs';
import { chooseMascot } from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { titleContributors } from '../dist/src/title-credits.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { friendDefinition } from '../dist/shared/friend-mascots.mjs';
import { characterChoicesMarkup } from '../dist/src/character-selection.js';
import { createHash } from 'node:crypto';
import { mascotCore } from './mascot-fixture.mjs';
import { runtimeTextureRecords } from '../scripts/environment-assets.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

function fixture(options = {}) {
  let id = 0;
  const core = createGameCore({
    keepEmptyRooms: true,
    persistentSessions: true,
    runtime: { now: () => 100000, id: () => `roster-${++id}`, token: () => `token-${++id}` },
    ...options,
  });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'ROSTER', resume: '1' }));
  const room = core.rooms.get('ROSTER');
  return { core, room, socket, player: [...room.players.values()][0] };
}

test('default five-player rooms offer nine Dots, rimo-neko and 524 without camp bodies', (t) => {
  const w = mascotCore(t),
    players = Array.from({ length: 5 }, (_, i) => w.join('Player ' + i));
  assert.deepEqual(w.room().companions, []);
  assert.deepEqual(w.room().orbBots, []);
  const keys = [...mascotMenuMarkup(w.room().mascotKeys).matchAll(/data-mascot="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(new Set(keys), new Set([...BOT_KINDS, 'rimo-neko', '524']));
  for (const player of players) w.act(player, 'selectMascot', '524');
  assert.equal(w.room().companions.length, 5);
  assert.equal(new Set(w.room().companions.map((c) => c.id)).size, 5);
  for (const player of players) assert.equal(w.active(player).ownerId, player.id);
  for (const key of ['mae', 'kohaku', 'maruimo-mascot', 'saber-mascot', 'all'])
    assert.equal(chooseMascot(w.room(), players[0].player(), key, w.now()), false);
  assert.equal(players[0].player().mascot, '524');
  const state = w.core().snapshot(w.room());
  for (const field of ['mae', 'kohaku', 'maruimo', 'friends', 'companion524', 'rimoNeko'])
    assert.equal(field in state, false, field);
});

test('each dormant selection survives hidden saves and appears only when enabled and reconnected', (t) => {
  for (const key of MASCOT_ROSTER.filter((entry) => !entry.enabled).map(
    (entry) => entry.modelKey,
  )) {
    const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS }),
      a = w.join();
    w.act(a, 'selectMascot', key);
    assert.equal(a.player().mascot, key);
    assert.equal(w.active(a).key, key);
    let saved = w.core().exportState();
    for (let round = 0; round < 3; round++) {
      w.load(saved, { mascotModels: undefined });
      const b = w.join('Hidden', a.session, null);
      w.step();
      assert.equal(b.player().mascot, key);
      assert.equal(w.active(b), undefined);
      assert.deepEqual(w.room().companions, []);
      assert.deepEqual(w.room().orbBots, []);
      saved = w.core().exportState();
      assert.equal(saved.rooms[0].sessions[0].player.mascot, key);
      for (const field of ['mae', 'kohaku', 'maruimo', 'friends', 'companions', 'orbBots'])
        assert.equal(field in saved.rooms[0], false, field);
    }
    w.load(saved, { mascotModels: ALL_MASCOT_MODELS });
    assert.deepEqual(w.room().companions, [], 'offline selections have no bodies');
    const c = w.join('Visible', a.session, null);
    assert.equal(w.active(c).key, key);
    assert.equal(w.active(c).ownerId, c.id);
    assert.equal(w.room().companions.length, 1);
    w.core().close();
  }
});

test('guest profiles are limited to rimo, 524 and the always-present dots, with adviser credits retained', () => {
  const people = titleContributors();
  assert.deepEqual(
    people.filter((p) => p.role === '友情出演').map((p) => p.key),
    ['r524', 'rimo', 'dots'],
  );
  for (const key of ['maruimo', 'mae', 'risa', 'saber', 'fairy', 'sagasa', 'hawkie', 'asahina'])
    assert.ok(!people.some((person) => person.key === key), key);
  for (const key of ['otani', 'urata', 'nukonuko']) {
    const adviser = people.find((p) => p.key === key);
    assert.equal(adviser.role, '監修');
    assert.equal(adviser.appears, undefined);
    assert.ok(adviser.mural);
  }
});

test('Howkey is a dormant mascot using its unchanged rig, and old player saves keep their items', async () => {
  const definition = friendDefinition('howkey-scientist');
  assert.equal(definition.credit, 'hawkie');
  assert.equal(definition.contactBone, 'Head');
  assert.equal(definition.bodyHeight, 1.55);
  assert.doesNotMatch(characterChoicesMarkup(), /howkey-female/);
  const asset = JSON.parse(await readFile('public/models/howkey-scientist/asset.json', 'utf8'));
  const bytes = await readFile(`public${asset.url}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(doc.nodes.some((node) => node.name === definition.contactBone));
  for (const clip of Object.values(definition.reactions))
    assert.ok(
      doc.animations.some((a) => a.name === clip),
      clip,
    );
  const source = fixture();
  const saved = source.core.exportState();
  const player = saved.rooms[0].sessions[0].player;
  Object.assign(player, { species: 'howkey', gender: 'female' });
  player.inventory.wood = 13;
  const restored = createGameCore({ persistentSessions: true });
  restored.importState(saved);
  const legacy = restored.rooms.get('ROSTER').sessions.values().next().value.player;
  assert.equal(legacy.species, 'cro');
  assert.equal(legacy.inventory.wood, 13);
  assert.equal(legacy.unavailableCharacter.species, 'howkey');
  const snapshot = restored.snapshot(restored.rooms.get('ROSTER'));
  assert.ok(snapshot.players.every((p) => p.species !== 'howkey'));
  source.core.close();
  restored.close();
});

test('browser catalog removes dormant models but preserves all cave pigment textures', async (t) => {
  const catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  const cave = catalog.assets.find((asset) => asset.modelKey === 'camp-cave');
  const murals = runtimeTextureRecords(cave);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => structuredClone(catalog),
  }));
  const world = new WorldAssets();
  const visible = await world.loadCatalog();
  for (const entry of MASCOT_ROSTER)
    assert.equal(
      visible.assets.some((asset) => asset.modelKey === entry.modelKey),
      entry.enabled,
      entry.modelKey,
    );
  assert.deepEqual(
    runtimeTextureRecords(visible.assets.find((asset) => asset.modelKey === 'camp-cave')),
    murals,
  );
  assert.ok(murals.some((record) => record.url.includes('mae-kohaku')));
  assert.ok(murals.some((record) => record.url.includes('friends-meadow')));
  assert.ok(murals.some((record) => record.url.includes('friends-river')));
  world.dispose();
});
