import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createGameCore as createCore } from '../dist/application/game-core.mjs';
import {
  createGameServer as createServer,
  createPersistentGameServer as createPersistentServer,
} from '../dist/server.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { ALL_CONTENT } from '../dist/shared/content-visibility.mjs';

const hidden = { hiddenCharacters: ['maruimo', 'howkey'], hideMae: true };
// These tests exercise the independent local switches with the retained cast enabled.
const createGameCore = (options) => createCore({ mascotModels: ALL_MASCOT_MODELS, ...options });
const createGameServer = (options) => createServer({ mascotModels: ALL_MASCOT_MODELS, ...options });
const createPersistentGameServer = (options) =>
  createPersistentServer({ mascotModels: ALL_MASCOT_MODELS, ...options });
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
  ping() {}
  terminate() {
    this.close();
  }
}
function fixture(visibility = ALL_CONTENT) {
  let id = 0,
    now = Date.now();
  const core = createGameCore({
    visibility,
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `visible-${++id}`, token: () => `resume-${++id}` },
  });
  return {
    core,
    advance: () => {
      now += 200;
      core.tick();
    },
  };
}
function join(core, params = {}) {
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'VISIBILITY', resume: '1', ...params }));
  const welcome = socket.messages.find((m) => m.type === 'welcome');
  const room = core.rooms.get('VISIBILITY');
  return { socket, welcome, room, player: room.players.get(welcome.id) };
}
const act = (socket, action, targetId) =>
  socket.emit('message', JSON.stringify({ type: 'action', action, targetId }));
const progress = (p) => ({
  id: p.id,
  x: p.x,
  z: p.z,
  inventory: p.inventory,
  gathered: p.gathered,
  adventure: p.adventure,
  gulf: p.gulf,
});

test('hidden content is absent from joins and snapshots, including stale/forged choices', () => {
  const { core, advance } = fixture(hidden);
  const a = join(core, { species: 'maruimo', gender: 'male', startAtCamp: '1' });
  const b = join(core);
  assert.equal(a.player.species, 'cro');
  assert.equal(a.player.radius, 0.32);
  assert.equal(a.room.mae, undefined);
  act(a.socket, 'changeCharacter', 'maruimo-octopus');
  advance();
  act(a.socket, 'petMae');
  advance();
  act(a.socket, 'dismissMae');
  advance();
  assert.equal(a.player.species, 'cro');
  for (const socket of [a.socket, b.socket]) {
    const states = socket.messages.filter((m) => m.type === 'state');
    assert.ok(states.length);
    for (const state of states) {
      assert.equal(state.mae, undefined);
      assert.ok(state.companion524 && state.rimoNeko);
      assert.ok(state.players.every((p) => p.species !== 'maruimo' && !p.unavailableCharacter));
    }
  }
  core.close();
});

for (const species of ['maruimo'])
  test(`hiding ${species} preserves the private appearance, mae checkpoint, and player progress across saves`, () => {
    const source = fixture();
    const a = join(source.core, { species, gender: species === 'howkey' ? 'female' : 'male' });
    a.player.inventory.berry = 12;
    a.player.gathered = 27;
    const checkpoint = source.core.exportState();
    const originalProgress = structuredClone(progress(a.player));
    const concealed = fixture(hidden);
    concealed.core.importState(checkpoint);
    const b = join(concealed.core, { session: a.welcome.session });
    concealed.advance();
    assert.equal(b.welcome.resumed, true);
    assert.equal(b.player.species, 'cro');
    assert.deepEqual(progress(b.player), originalProgress);
    const saved = concealed.core.exportState();
    assert.deepEqual(saved.rooms[0].mae, checkpoint.rooms[0].mae);
    assert.equal(saved.rooms[0].sessions[0].player.unavailableCharacter.species, species);
    assert.equal(checkpoint.rooms[0].sessions[0].player.species, species);
    act(b.socket, 'changeCharacter', species === 'howkey' ? 'howkey-scientist' : 'maruimo-octopus');
    concealed.advance();
    assert.equal(b.player.species, 'cro');
    assert.ok(
      concealed.core
        .snapshot(b.room)
        .players.every((p) => p.species === 'cro' && !p.unavailableCharacter),
    );

    const shown = fixture();
    shown.core.importState(saved);
    const c = join(shown.core, { session: a.welcome.session });
    assert.equal(c.player.species, species);
    assert.equal(c.player.gender, a.player.gender);
    assert.equal(c.player.radius, a.player.radius);
    assert.equal(c.player.unavailableCharacter, undefined);
    assert.deepEqual(progress(c.player), originalProgress);
    assert.ok(shown.core.snapshot(c.room).mae);
    for (const { core } of [source, concealed, shown]) core.close();
  });

test('an explicit available character choice replaces the retained hidden appearance', () => {
  const { core, advance } = fixture(hidden);
  const a = join(core, { species: 'maruimo', gender: 'male' });
  act(a.socket, 'changeCharacter', 'cro-magnon-woman');
  advance();
  assert.equal(a.player.gender, 'female');
  assert.equal(a.player.unavailableCharacter, undefined);
  const shown = fixture();
  shown.core.importState(core.exportState());
  const b = join(shown.core, { session: a.welcome.session });
  assert.equal(b.player.species, 'cro');
  assert.equal(b.player.gender, 'female');
  core.close();
  shown.core.close();
});

test('a rejected arrival cannot discard the retained hidden appearance', () => {
  const { core } = fixture(hidden);
  const a = join(core, { species: 'maruimo', gender: 'male' });
  a.socket.close();
  const before = structuredClone(core.exportState());
  const nearestFree = a.room.collision.nearestFree;
  a.room.collision.nearestFree = () => null;
  const rejected = new Socket();
  core.connect(
    rejected,
    new URLSearchParams({
      room: 'VISIBILITY',
      resume: '1',
      session: a.welcome.session,
      startAtCamp: '1',
      species: 'cat',
      gender: 'female',
    }),
  );
  assert.ok(rejected.messages.some((m) => m.code === 'NO_SPAWN'));
  assert.deepEqual(core.exportState(), before);
  a.room.collision.nearestFree = nearestFree;
  const retry = join(core, { session: a.welcome.session });
  assert.equal(retry.player.species, 'cro');
  assert.equal(retry.player.unavailableCharacter.species, 'maruimo');
  core.close();
});

test('three local toggles independently control the served catalog and direct model URLs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cro-visibility-'));
  const filename = path.join(directory, 'local-visibility.json');
  for (const mae of [false, true])
    for (const maruimo of [false, true])
      for (const howkey of [false, true]) {
        await writeFile(filename, JSON.stringify({ mae, maruimo, howkey }));
        const visibility = await readLocalVisibility(filename);
        const game = createGameServer({ port: 0, host: '127.0.0.1', visibility });
        const { port } = await game.listen();
        const base = `http://127.0.0.1:${port}`;
        try {
          const module = await fetch(`${base}/shared/character-profiles.mjs`).then((r) => r.text());
          const { CHARACTER_MODELS } = await import(
            `data:text/javascript,${encodeURIComponent(module)}`
          );
          assert.equal(CHARACTER_MODELS.length, 7 + Number(maruimo));
          assert.equal(
            CHARACTER_MODELS.some((p) => p.species === 'maruimo'),
            maruimo,
          );
          assert.equal(
            CHARACTER_MODELS.some((p) => p.species === 'howkey'),
            false,
          );
          const catalog = await fetch(`${base}/models/world-assets.json`).then((r) => r.json());
          assert.equal(
            catalog.assets.some((a) => a.modelKey === 'mae'),
            mae,
          );
          assert.ok(catalog.assets.some((a) => a.modelKey === 'rimo-neko'));
          // Playable people are catalogued in character-profiles, not world-assets.
          assert.ok(catalog.assets.every((a) => !['howkey', 'maruimo'].includes(a.species)));
          for (const [model, visible] of [
            ['mae', mae],
            ['maruimo-octopus', maruimo],
            ['howkey-scientist', howkey],
          ]) {
            const asset = JSON.parse(await readFile(`public/models/${model}/asset.json`, 'utf8'));
            for (const url of [
              `/models/${model}/asset.json`,
              asset.url,
              ...(asset.lods ?? []).map((a) => a.url),
              ...(model === 'howkey-scientist'
                ? [`/models/${model}/portrait.png`, `/models/${model}/lod-performance.glb`]
                : []),
            ]) {
              assert.equal(
                (await fetch(base + url, { method: 'HEAD' })).status,
                visible ? 200 : 404,
              );
            }
            if (!visible)
              for (const url of [
                `/models/${model.toUpperCase()}/asset.json`,
                `/models/${model}%2Fasset.json`,
                `//models/${model}/asset.json`,
                `/models/unused/%2E%2E%2F${model}/asset.json`,
              ])
                assert.equal((await fetch(base + url)).status, 404);
          }
          assert.equal((await fetch(`${base}/local-visibility.json`)).status, 404);
          for (const [species, visible, gender] of [
            ['maruimo', maruimo, 'male'],
            ['howkey', false, 'female'],
          ]) {
            const socket = new WebSocket(
              `ws://127.0.0.1:${port}/ws?room=VISIBILITY&species=${species}&gender=${gender}`,
            );
            try {
              const state = await new Promise((resolve, reject) => {
                socket.on('error', reject);
                socket.on('message', (bytes) => {
                  const message = JSON.parse(String(bytes));
                  if (message.type === 'state') resolve(message);
                });
              });
              assert.equal(!!state.mae, mae);
              assert.ok(state.players.some((p) => p.species === (visible ? species : 'cro')));
              if (!visible) assert.ok(state.players.every((p) => p.species !== species));
            } finally {
              socket.terminate();
            }
          }
        } finally {
          await game.close();
        }
      }
});

test('invalid local settings fail closed rather than silently restoring hidden content', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cro-visibility-invalid-'));
  const filename = path.join(directory, 'local-visibility.json');
  assert.deepEqual(await readLocalVisibility(filename), ALL_CONTENT);
  for (const config of [
    '{',
    '{}',
    'null',
    '[]',
    '{"mae":"false","maruimo":false}',
    '{"mae":false,"maruimo":false,"typo":true}',
    '{"mae":false,"maruimo":false,"howkey":"false"}',
    '{"mae":false,"maruimo":false,"howkey":null}',
  ]) {
    await writeFile(filename, config);
    await assert.rejects(readLocalVisibility(filename));
  }
  await writeFile(filename, '\uFEFF{"mae":false,"maruimo":false}');
  assert.deepEqual(await readLocalVisibility(filename), {
    hiddenCharacters: ['maruimo'],
    hideMae: true,
  });
  await writeFile(filename, '\uFEFF{"mae":false,"maruimo":false,"howkey":false}');
  assert.deepEqual(await readLocalVisibility(filename), hidden);
});

for (const species of ['maruimo'])
  test(`persistent Node hosts apply ${species} visibility during disk restore and retain the reversible save`, async () => {
    const saveDirectory = await mkdtemp(path.join(tmpdir(), 'cro-visibility-save-'));
    let game = await createPersistentGameServer({ saveDirectory, port: 0 });
    const a = join(game.core, { species, gender: species === 'howkey' ? 'female' : 'male' });
    a.player.inventory.wood = 7;
    const mae = structuredClone(a.room.mae);
    await game.close();
    game = await createPersistentGameServer({ saveDirectory, port: 0, visibility: hidden });
    assert.equal(game.core.visibility.hideMae, true);
    const concealed = game.rooms.get('VISIBILITY');
    assert.equal(concealed.mae, undefined);
    const player = concealed.sessions.get(a.welcome.session).player;
    assert.equal(player.species, 'cro');
    assert.equal(player.inventory.wood, 7);
    await game.saveNow();
    await game.close();
    const bytes = JSON.parse(await readFile(path.join(saveDirectory, 'world.json'), 'utf8'));
    assert.deepEqual(bytes.state.rooms[0].mae, mae);
    game = await createPersistentGameServer({ saveDirectory, port: 0 });
    assert.ok(game.rooms.get('VISIBILITY').mae);
    assert.equal(
      game.rooms.get('VISIBILITY').sessions.get(a.welcome.session).player.species,
      species,
    );
    await game.close();
  });
