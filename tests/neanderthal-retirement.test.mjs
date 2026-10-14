import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_ROSTER } from '../dist/shared/character-roster.mjs';
import { PLAYABLE_CHARACTER_MODELS, characterModel } from '../dist/shared/characters.mjs';
import { NPC, RETAINED_TRADER } from '../dist/shared/world.mjs';
import { staticObstacles } from '../dist/shared/collision.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { characterChoicesMarkup } from '../dist/src/character-selection.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { ActorResidency } from '../dist/src/actor-residency.js';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
function fixture() {
  let id = 0;
  return createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => 100000, id: () => `retained-${++id}`, token: () => `token-${++id}` },
  });
}
function join(core, params = {}) {
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'RETAINED', resume: '1', ...params }));
  const welcome = socket.messages.find((message) => message.type === 'welcome');
  const room = core.rooms.get('RETAINED');
  return { socket, welcome, room, player: room.players.get(welcome.id) };
}

test('both choices and the trader disappear without deleting their definitions or models', async () => {
  assert.equal(NPC, undefined);
  assert.equal(RETAINED_TRADER.name, 'オル');
  assert.ok(PLAYABLE_CHARACTER_MODELS.every((model) => model.species !== 'nea'));
  assert.doesNotMatch(characterChoicesMarkup(), /nea-|neanderthal/);
  assert.ok(staticObstacles().every((obstacle) => obstacle.id !== 'orl'));
  assert.equal(WARP_POINTS.find((point) => point.id === 'fire-75-40').name, '谷の集落');
  for (const gender of ['female', 'male']) {
    const profile = characterModel({ species: 'nea', gender });
    const asset = JSON.parse(await readFile(`public/models/${profile.key}/asset.json`, 'utf8'));
    for (const record of [asset, ...(asset.lods ?? [])]) {
      const bytes = await readFile(`public${record.url}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    }
    assert.ok((await readFile(`public/models/${profile.key}/portrait.png`)).length);
  }
});

test('old appearances survive repeated saves, restore when enabled, and reject forged switches and trading', () => {
  for (const gender of ['female', 'male']) {
    const original = fixture();
    const a = join(original, { species: 'nea', gender });
    Object.assign(a.player.inventory, { wood: 14, berry: 6 });
    a.player.gathered = 42;
    // A checkpoint from before the exclusion, entirely in memory.
    const checkpoint = original.exportState();
    const oldPlayer = checkpoint.rooms[0].sessions[0].player;
    Object.assign(oldPlayer, { species: 'nea', gender });
    delete oldPlayer.unavailableCharacter;
    original.close();
    const concealed = fixture();
    concealed.importState(checkpoint);
    const b = join(concealed, { session: a.welcome.session });
    assert.equal(b.welcome.resumed, true);
    assert.equal(b.player.species, 'cro');
    assert.equal(b.player.gender, gender);
    assert.deepEqual(b.player.unavailableCharacter, {
      species: 'nea',
      gender,
      character: gender === 'male' ? 'neanderthal-hunter' : 'neanderthal-woman',
    });
    const before = structuredClone(b.player.inventory);
    for (const targetId of ['neanderthal-woman', 'neanderthal-hunter']) {
      b.player.lastAction = 0;
      b.socket.emit(
        'message',
        JSON.stringify({ type: 'action', action: 'changeCharacter', targetId }),
      );
      assert.equal(b.player.species, 'cro');
    }
    Object.assign(b.player, { x: RETAINED_TRADER.x, z: RETAINED_TRADER.z, lastAction: 0 });
    b.socket.emit('message', JSON.stringify({ type: 'action', action: 'trade' }));
    assert.deepEqual(b.player.inventory, before);
    const state = concealed.snapshot(b.room, true);
    assert.equal(state.npc, undefined);
    assert.ok(
      state.players.every((player) => player.species !== 'nea' && !player.unavailableCharacter),
    );
    const saved = concealed.exportState();
    const again = fixture();
    again.importState(saved);
    assert.deepEqual(again.exportState().rooms[0].sessions[0].player.unavailableCharacter, {
      species: 'nea',
      gender,
      character: gender === 'male' ? 'neanderthal-hunter' : 'neanderthal-woman',
    });
    // Simulate the one roster edit in this test process only; never edit production files/saves.
    const roster = CHARACTER_ROSTER.find((entry) => entry.species === 'nea');
    roster.enabled = true;
    let restored;
    try {
      restored = fixture();
      restored.importState(again.exportState());
      const c = join(restored, { session: a.welcome.session });
      assert.equal(c.player.species, 'nea');
      assert.equal(c.player.gender, gender);
      assert.equal(c.player.unavailableCharacter, undefined);
      assert.deepEqual(c.player.inventory, before);
      assert.equal(c.player.gathered, 42);
      assert.equal(c.player.id, a.player.id);
    } finally {
      roster.enabled = false;
      restored?.close();
      concealed.close();
      again.close();
    }
  }
});

test('a local host omits dormant catalogs and refuses every direct or encoded model URL', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  const { port } = await game.listen();
  t.after(() => game.close());
  const base = `http://127.0.0.1:${port}`;
  const profiles = await fetch(`${base}/shared/character-profiles.mjs`).then((r) => r.text());
  assert.doesNotMatch(profiles, /neanderthal|ネアンデル/);
  const catalog = await fetch(`${base}/models/world-assets.json`).then((r) => r.json());
  assert.ok(catalog.assets.every((asset) => !asset.modelKey.startsWith('neanderthal-')));
  for (const key of CHARACTER_ROSTER[0].modelKeys) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    for (const url of [
      `/models/${key}/asset.json`,
      `/models/${key}/portrait.png`,
      asset.url,
      ...asset.lods.map((record) => record.url),
      `/models/${key.toUpperCase()}/asset.json`,
      `/models/${key}%2Fasset.json`,
      `//models/${key}/asset.json`,
      `/models/unused/%2E%2E%2F${key}/asset.json`,
    ])
      assert.equal((await fetch(base + url, { method: 'HEAD' })).status, 404, url);
  }
  assert.equal((await fetch(`${base}/models/cro-magnon-woman/asset.json`)).status, 200);
});

test('the browser drops dormant catalog entries and never queues an absent camp trader', async (t) => {
  const catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  for (const key of CHARACTER_ROSTER[0].modelKeys)
    catalog.assets.push(JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8')));
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => structuredClone(catalog),
  }));
  const assets = new WorldAssets();
  assert.ok(
    (await assets.loadCatalog()).assets.every(
      (asset) => !asset.modelKey.startsWith('neanderthal-'),
    ),
  );
  assets.dispose();
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    state: { npc: undefined },
    npcResidency: new ActorResidency(),
    npcAssets: {
      create() {
        assert.fail('dormant trader must not request a model');
      },
    },
  });
  world.updateNpc(0);
  assert.equal(world.npcResidency.state, 'absent');
});
