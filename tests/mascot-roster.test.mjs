import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { ALL_MASCOT_MODELS, MASCOT_ROSTER } from '../dist/shared/mascot-roster.mjs';
import { BOT_KINDS } from '../dist/shared/orb-bots.mjs';
import { setMascotSelection } from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { titleContributors, contributorsDialogMarkup } from '../dist/src/title-credits.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { friendDefinition } from '../dist/shared/friend-mascots.mjs';
import { characterChoicesMarkup } from '../dist/src/character-selection.js';
import { createHash } from 'node:crypto';
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

test('default rooms and selection contain only nine Dots, rimo-neko and 524, with five players', () => {
  const f = fixture();
  for (let i = 1; i < 5; i++) f.core.connect(new Socket(), new URLSearchParams({ room: 'ROSTER' }));
  assert.equal(f.room.players.size, 5);
  f.core.tick();
  assert.ok(f.room.rimoNeko && f.room.companion524);
  for (const key of ['mae', 'kohaku', 'maruimo']) assert.equal(f.room[key], undefined);
  assert.deepEqual(f.room.friends, []);
  setMascotSelection(f.room, f.player, 'all', true, 100000);
  assert.equal(f.room.orbBots.filter((bot) => bot.ownerId === f.player.id).length, 11);
  const keys = [
    ...mascotMenuMarkup(f.core.snapshot(f.room)).matchAll(/data-mascot="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(new Set(keys), new Set([...BOT_KINDS, 'rimo-neko', '524']));
  for (const key of ['mae', 'kohaku', 'maruimo-mascot', 'saber-mascot'])
    assert.equal(setMascotSelection(f.room, f.player, key, true, 100000), false);
  const state = f.core.snapshot(f.room);
  assert.equal(state.mae, undefined);
  assert.equal(state.kohaku, undefined);
  assert.equal(state.maruimo, undefined);
  assert.deepEqual(state.friends, []);
  f.core.close();
});

test('hidden companion checkpoints survive multiple saves and can be restored without remaking assets', () => {
  const source = fixture({ mascotModels: ALL_MASCOT_MODELS });
  setMascotSelection(source.room, source.player, 'all', true, 100000);
  const original = source.core.exportState();
  const hidden = createGameCore({ persistentSessions: true });
  hidden.importState(original);
  const room = hidden.rooms.get('ROSTER');
  assert.equal(room.mae, undefined);
  assert.equal(room.kohaku, undefined);
  assert.equal(room.maruimo, undefined);
  assert.deepEqual(room.friends, []);
  for (let i = 0; i < 3; i++) hidden.tick();
  const saved = hidden.exportState();
  for (const field of ['mae', 'kohaku', 'maruimo', 'friends'])
    assert.deepEqual(saved.rooms[0][field], original.rooms[0][field], field);
  const restored = createGameCore({ persistentSessions: true, mascotModels: ALL_MASCOT_MODELS });
  restored.importState(saved);
  const shown = restored.rooms.get('ROSTER');
  for (const field of ['mae', 'kohaku', 'maruimo'])
    assert.equal(shown[field].followPlayerId, source.player.id, field);
  assert.equal(shown.friends.length, 8);
  assert.ok(shown.friends.every((friend) => friend.followPlayerId === source.player.id));
  source.core.close();
  hidden.close();
  restored.close();
});

test('guest icons and links are limited to rimo and 524, with adviser credits retained', () => {
  const people = titleContributors();
  assert.deepEqual(
    people.filter((p) => p.role === '友情出演').map((p) => p.key),
    ['r524', 'rimo'],
  );
  const dialog = contributorsDialogMarkup();
  for (const key of ['maruimo', 'mae', 'risa', 'saber', 'fairy', 'sagasa', 'hawkie', 'asahina'])
    assert.ok(!dialog.includes(`/title/avatar-${key}.jpg`), key);
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
