import test from 'node:test';
import assert from 'node:assert/strict';
import { SoloRuntime } from '../dist/infrastructure/browser/solo-runtime.mjs';
import {
  encodeSoloSave,
  decodeSoloSave,
  UnsupportedSoloSave,
} from '../dist/infrastructure/browser/solo-save.mjs';
import {
  loadMultiplayerConfig,
  multiplayerSessionKey,
  multiplayerUrl,
} from '../dist/src/multiplayer-config.js';
import edge from '../dist/cloudflare/request-handler.mjs';

const profile = {
  name: 'Solo test',
  species: 'cro',
  gender: 'male',
  character: 'cro-magnon-hunter',
  dye: 'blue',
  mascot: '524',
};
function memorySave(initial = null) {
  return {
    data: structuredClone(initial),
    writes: 0,
    fail: false,
    async load(validate) {
      if (this.data) validate(this.data);
      return { data: this.data, recovered: false };
    },
    async write(data) {
      this.writes++;
      if (this.fail) throw new Error('injected quota failure');
      this.data = structuredClone(data);
    },
    close() {},
  };
}
const messages = (outputs) =>
  outputs.filter((m) => m.type === 'message').map((m) => JSON.parse(m.data));

test('solo commits its first world before entry, and refuses entry if saving fails', async () => {
  for (const fail of [false, true]) {
    const save = memorySave(),
      output = [];
    save.fail = fail;
    const runtime = new SoloRuntime(save, (event) => {
      if (event.type === 'open') assert.ok(save.data, 'a committed checkpoint precedes entry');
      output.push(event);
    });
    if (fail) {
      await assert.rejects(runtime.start(profile), /quota failure/);
      assert.equal(
        output.some((m) => m.type === 'open'),
        false,
      );
      assert.equal(
        messages(output).some((m) => m.type === 'welcome'),
        false,
      );
      assert.equal(save.data, null);
    } else {
      await runtime.start(profile);
      assert.equal(messages(output).find((m) => m.type === 'welcome').room, 'SOLO');
      assert.equal(save.data.game.rooms.length, 1);
      assert.equal(save.data.game.rooms[0].sessions.length, 1);
    }
    save.fail = false;
    await runtime.close();
  }
});

test('a fresh solo runtime restores inventory, progress, location and companion, applying confirmed clothes', async () => {
  const save = memorySave();
  const first = new SoloRuntime(save, () => {});
  await first.start(profile);
  await first.close();
  // Arrange a genuine exported checkpoint with earned progress, without a live mutation hook.
  const room = save.data.game.rooms[0],
    player = room.sessions[0].player;
  player.inventory.wood = 9;
  player.gathered = 11;
  room.camp.wood = 18;
  room.resources[0].amount = 0;
  const previous = structuredClone(save.data),
    outputs = [];
  const next = new SoloRuntime(save, (event) => outputs.push(event));
  await next.start({
    ...profile,
    dye: 'teal',
    character: 'cro-magnon-girl-bear',
    gender: 'female',
    mascot: 'keep',
  });
  const restored = save.data.game.rooms[0],
    me = restored.sessions[0].player;
  assert.equal(me.id, player.id);
  assert.deepEqual(me.inventory, player.inventory);
  assert.equal(me.gathered, 11);
  assert.equal(restored.camp.wood, 18);
  assert.equal(restored.resources[0].amount, 0);
  assert.ok(Math.hypot(me.x - player.x, me.z - player.z) < 0.1);
  assert.equal(me.character, 'cro-magnon-girl-bear');
  assert.equal(me.dye, 'teal');
  assert.equal(me.mascot, '524');
  assert.equal(messages(outputs).find((m) => m.type === 'welcome').resumed, true);
  assert.deepEqual(
    previous.game.rooms[0].sessions[0].player,
    player,
    'restore never mutates its input',
  );
  await next.close();
});

for (const resumed of [false, true])
  test(`solo ${resumed ? 'resumed' : 'new'} play stays active and saves after long inactivity`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const save = memorySave();
    if (resumed) {
      const previous = new SoloRuntime(save, () => {});
      await previous.start(profile);
      await previous.close();
    }
    const outputs = [];
    const runtime = new SoloRuntime(save, (event) => outputs.push(event));
    await runtime.start(profile);
    const welcome = messages(outputs).find((message) => message.type === 'welcome');
    const startedAt = now;
    try {
      for (const elapsed of [30000, 60000, 3600000, 86400000]) {
        now = startedAt + elapsed;
        const writes = save.writes;
        await runtime.tick();
        assert.equal(
          outputs.some((event) => event.type === 'closed'),
          false,
        );
        assert.equal(
          messages(outputs).some((message) => message.code === 'IDLE_TIMEOUT'),
          false,
        );
        const state = messages(outputs)
          .filter((message) => message.type === 'state')
          .at(-1);
        assert.ok(state.players.some((player) => player.id === welcome.id));
        assert.ok(save.writes > writes, 'autosave continues without input');
        assert.equal(save.data.game.rooms[0].sessions[0].player.id, welcome.id);
      }
      await runtime.command(
        JSON.stringify({ type: 'action', action: 'dyeClothes', targetId: 'teal' }),
      );
      const player = save.data.game.rooms[0].sessions[0].player;
      assert.equal(player.dye, 'teal', 'input still works after the idle period');
      assert.equal(player.mascot, profile.mascot);
    } finally {
      await runtime.close();
    }
    assert.equal(
      outputs.find((event) => event.type === 'closed')?.code,
      1000,
      'manual exit still saves and closes',
    );
  });

test('autosave failures preserve the committed state, report the error and avoid retrying every tick', async () => {
  const save = memorySave(),
    outputs = [];
  const runtime = new SoloRuntime(save, (event) => outputs.push(event));
  await runtime.start(profile);
  const committed = structuredClone(save.data);
  save.fail = true;
  await runtime.command(JSON.stringify({ type: 'action', action: 'dyeClothes', targetId: 'teal' }));
  assert.equal(
    messages(outputs)
      .filter((m) => m.type === 'saveStatus')
      .at(-1).state,
    'error',
  );
  const attempts = save.writes;
  for (let i = 0; i < 8; i++) await runtime.tick();
  assert.equal(save.writes, attempts, 'bounded retry after quota failure');
  assert.deepEqual(save.data, committed);
  save.fail = false;
  await runtime.save();
  assert.equal(save.data.game.rooms[0].sessions[0].player.dye, 'teal');
  assert.equal(
    messages(outputs)
      .filter((m) => m.type === 'saveStatus')
      .at(-1).state,
    'saved',
  );
  await runtime.close();
});

test('unknown newer worlds and missing resume identities cannot reset and overwrite progress', async () => {
  const original = memorySave();
  const first = new SoloRuntime(original, () => {});
  await first.start(profile);
  await first.close();
  for (const corruption of ['world', 'token']) {
    const save = memorySave(original.data);
    if (corruption === 'world') save.data.game.worldVersion = 999;
    else save.data.session = 'missing';
    const before = structuredClone(save.data);
    await assert.rejects(
      new SoloRuntime(save, () => {}).start(profile),
      corruption === 'world' ? UnsupportedSoloSave : /Missing solo session/,
    );
    assert.equal(save.writes, 0);
    assert.deepEqual(save.data, before);
  }
});

test('solo envelopes detect tampering and reject newer payload versions', async () => {
  const data = { session: 'a', game: { version: 1, worldVersion: 4, rooms: [], savedAt: 123 } };
  const record = await encodeSoloSave(data, 1);
  assert.deepEqual(await decodeSoloSave(record), data);
  await assert.rejects(
    decodeSoloSave({ ...record, payload: record.payload.replace('123', '124') }),
    /Invalid solo checkpoint/,
  );
  await assert.rejects(decodeSoloSave({ ...record, version: 2 }), UnsupportedSoloSave);
  await assert.rejects(
    decodeSoloSave(await encodeSoloSave({ ...data, game: { ...data.game, version: 2 } }, 2)),
    UnsupportedSoloSave,
  );
});

test('normal startup forces old online configurations to solo and keeps online saves separate', async (t) => {
  for (const config of [
    null,
    { mode: 'online', serverUrl: 'wss://example.com/ws', room: 'EMBER' },
    { mode: 'solo', serverUrl: '', room: 'SOLO' },
  ]) {
    t.mock.method(globalThis, 'fetch', async () =>
      config ? Response.json(config) : new Response(null, { status: 404 }),
    );
    const loaded = await loadMultiplayerConfig();
    assert.equal(loaded.mode, 'solo');
    assert.equal(loaded.serverUrl, '');
    assert.equal(loaded.room, 'SOLO');
    assert.notEqual(
      multiplayerSessionKey(loaded, 'EMBER'),
      multiplayerSessionKey({ mode: 'online' }, 'EMBER'),
    );
    assert.throws(() => multiplayerUrl(loaded, 'https://example.com', {}), /no network/);
    t.mock.restoreAll();
  }
  const lan = { mode: 'lan', serverUrl: 'ws://10.10.10.1:8080', room: 'LAN' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(lan));
  assert.equal(
    (await loadMultiplayerConfig()).mode,
    'lan',
    'archived LAN behavior remains available',
  );
});

test('the public solo edge serves static files and refuses stale online requests without touching GAME', async () => {
  let gameAccess = 0,
    assets = 0;
  for (const flag of ['false', undefined]) {
    const env = {
      SERVICE_ENABLED: flag,
      get GAME() {
        gameAccess++;
        throw new Error('Durable Object must never be resolved');
      },
      ASSETS: {
        async fetch() {
          assets++;
          return new Response('static');
        },
      },
    };
    for (const url of ['/', '/src/solo-worker.js', '/models/test.glb'])
      assert.equal(
        await (await edge.fetch(new Request(`https://example.com${url}`), env)).text(),
        'static',
      );
    const health = await (
      await edge.fetch(new Request('https://example.com/api/health'), env)
    ).json();
    assert.equal(health.mode, 'solo');
    assert.equal(health.maxPlayers, 1);
    for (const url of ['/api/status', '/ws?room=EMBER']) {
      const response = await edge.fetch(
        new Request(`https://example.com${url}`, { headers: { Upgrade: 'websocket' } }),
        env,
      );
      assert.equal(response.status, 503);
    }
    assert.equal(
      (await edge.fetch(new Request('https://example.com/api/save', { method: 'POST' }), env))
        .status,
      404,
    );
  }
  assert.equal(gameAccess, 0);
  assert.equal(assets, 6);
});
