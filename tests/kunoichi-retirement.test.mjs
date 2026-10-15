import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CHARACTER_ROSTER, characterModelReleased } from '../dist/shared/character-roster.mjs';
import { PLAYABLE_CHARACTER_MODELS, characterModel } from '../dist/shared/characters.mjs';
import { characterChoicesMarkup } from '../dist/src/character-selection.js';
import { characterPortraitUrls } from '../dist/src/character-portraits.js';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { WorldAssets } from '../dist/src/world-assets.js';

const retained = CHARACTER_ROSTER.find((entry) => entry.species === 'cat');
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
function core() {
  let id = 0;
  return createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => 100000, id: () => `cat-${++id}`, token: () => `resume-${++id}` },
  });
}
function join(game, params = {}) {
  const socket = new Socket();
  game.connect(socket, new URLSearchParams({ room: 'CAT-RETIRED', resume: '1', ...params }));
  const welcome = socket.messages.find((message) => message.type === 'welcome');
  return { socket, welcome, player: game.rooms.get('CAT-RETIRED').players.get(welcome.id) };
}

test('the kunoichi and its weapon are omitted while their exact models and photos are retained', async () => {
  assert.equal(retained.enabled, false);
  assert.deepEqual(retained.modelKeys, ['cat-kunoichi', 'kunoichi-katana']);
  assert.equal(characterModel({ species: 'cat' }).key, 'cat-kunoichi');
  assert.ok(PLAYABLE_CHARACTER_MODELS.every((model) => model.species !== 'cat'));
  assert.doesNotMatch(characterChoicesMarkup(), /cat-female|cat-kunoichi|クノイチ/);
  for (const key of retained.modelKeys) {
    assert.equal(characterModelReleased(key), false);
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    for (const model of [asset, ...(asset.lods ?? [])]) {
      const bytes = await readFile(`public${model.url}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), model.sha256);
    }
  }
  assert.ok((await readFile('public/models/cat-kunoichi/portrait.png')).length);
  assert.ok((await readFile('public/models/cat-kunoichi/portraits/choice-r02-red.webp')).length);
  for (const url of characterPortraitUrls('cat-kunoichi'))
    assert.ok((await readFile(`public${url}`)).length, `Immediately restorable: ${url}`);
});

test('joining and forged switches cannot select the kunoichi; saved identity and possessions restore with one flag', (t) => {
  const original = core();
  t.after(() => original.close());
  const first = join(original, { species: 'cat', gender: 'female', character: 'cat-kunoichi' });
  assert.equal(first.player.species, 'cro');
  assert.equal(first.player.unavailableCharacter.character, 'cat-kunoichi');
  Object.assign(first.player.inventory, { wood: 13, berry: 7 });
  first.player.gathered = 27;
  const inventory = structuredClone(first.player.inventory);
  const saved = original.exportState();
  const resumed = core();
  t.after(() => resumed.close());
  resumed.importState(saved);
  const second = join(resumed, { session: first.welcome.session });
  assert.equal(second.welcome.resumed, true);
  assert.equal(second.player.id, first.player.id);
  assert.deepEqual(second.player.inventory, inventory);
  second.socket.emit(
    'message',
    JSON.stringify({ type: 'action', action: 'changeCharacter', targetId: 'cat-kunoichi' }),
  );
  assert.equal(second.player.species, 'cro');
  const again = core();
  t.after(() => again.close());
  again.importState(resumed.exportState());
  assert.equal(
    again.exportState().rooms[0].sessions[0].player.unavailableCharacter.character,
    'cat-kunoichi',
  );
  assert.ok(
    original
      .snapshot(original.rooms.get('CAT-RETIRED'), true)
      .players.every((p) => !p.unavailableCharacter),
  );
  retained.enabled = true;
  try {
    const restored = core();
    t.after(() => restored.close());
    restored.importState(again.exportState());
    const third = join(restored, { session: first.welcome.session });
    assert.equal(third.player.character, 'cat-kunoichi');
    assert.equal(third.player.unavailableCharacter, undefined);
    assert.deepEqual(third.player.inventory, inventory);
    assert.equal(third.player.gathered, 27);
  } finally {
    retained.enabled = false;
  }
});

test('local delivery refuses the character, all colour photographs and its katana, including encoded URLs', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  const { port } = await game.listen();
  t.after(() => game.close());
  const base = `http://127.0.0.1:${port}`;
  const profiles = await fetch(`${base}/shared/character-profiles.mjs`).then((response) =>
    response.text(),
  );
  assert.doesNotMatch(profiles, /cat-kunoichi|クノイチ/);
  const catalog = await fetch(`${base}/models/world-assets.json`).then((response) =>
    response.json(),
  );
  assert.ok(catalog.assets.every((asset) => !retained.modelKeys.includes(asset.modelKey)));
  for (const key of retained.modelKeys) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    for (const url of [
      `/models/${key}/asset.json`,
      `/models/${key}/portrait.png`,
      asset.url,
      ...(asset.lods ?? []).map((lod) => lod.url),
      `/models/${key.toUpperCase()}/asset.json`,
      `/models/${key}%2Fasset.json`,
      `/models/unused/%2E%2E%2F${key}/asset.json`,
      ...['original', 'red', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'white'].map(
        (colour) => `/models/${key}/portraits/choice-r02-${colour}.webp`,
      ),
    ])
      assert.equal((await fetch(base + url, { method: 'HEAD' })).status, 404, url);
  }
  assert.equal((await fetch(`${base}/models/giant-ape/asset.json`)).status, 200);
});

test('an old catalog cannot queue the retained kunoichi or its katana in the browser', async (t) => {
  const catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  for (const key of retained.modelKeys)
    catalog.assets.push(JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8')));
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => structuredClone(catalog),
  }));
  const assets = new WorldAssets();
  assert.ok(
    (await assets.loadCatalog()).assets.every(
      (asset) => !retained.modelKeys.includes(asset.modelKey),
    ),
  );
  assets.dispose();
});
