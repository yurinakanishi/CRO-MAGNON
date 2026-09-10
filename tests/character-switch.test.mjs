import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CHARACTER_MODELS, characterModel } from '../dist/shared/characters.mjs';
import { handleCharacterSwitch } from '../dist/shared/character-switching.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { WorldRenderer } from '../dist/src/world3d.js';

const player = (model = CHARACTER_MODELS[0]) => ({
  id: 'self',
  name: '旅人',
  species: model.species,
  gender: model.gender,
  x: 48,
  z: 57,
  facing: 1.2,
  radius: model.radius ?? WORLD.playerRadius,
  energy: 63,
  inventory: { wood: 7, stone: 8, berry: 9, rawMeat: 2, cookedMeat: 3 },
  tool: true,
  spearHead: 'obsidian',
  gathered: 37,
  ready: true,
  adventure: { regions: { forest: { claimed: true, gathered: 50 } } },
  gulf: { countryId: 'reed', crops: ['one'] },
  village: { helped: 2 },
  hurtAt: 10,
  hurtSequence: 2,
  invulnerableUntil: 20,
  sessionToken: 'private-test',
});
const room = (p, collision = new CollisionWorld([], { river: false })) => ({
  players: new Map([[p.id, p]]),
  animals: [],
  enemies: [],
  residents: [],
  projectiles: [],
  collision,
});
const change = (r, p, key = 'giant-ape', now = 10000) =>
  handleCharacterSwitch(r, p, { targetId: key }, now);
const retained = (p) =>
  Object.fromEntries(
    [
      'id',
      'name',
      'x',
      'z',
      'facing',
      'energy',
      'inventory',
      'tool',
      'spearHead',
      'gathered',
      'ready',
      'adventure',
      'gulf',
      'village',
      'hurtAt',
      'hurtSequence',
      'invulnerableUntil',
      'sessionToken',
    ].map((key) => [key, structuredClone(p[key])]),
  );

test('all 42 character changes keep exact position, possessions, energy, progress and identity', () => {
  for (const from of CHARACTER_MODELS)
    for (const to of CHARACTER_MODELS) {
      if (from === to) continue;
      const p = player(from),
        r = room(p),
        before = retained(p);
      assert.equal(change(r, p, to.key).ok, true, `${from.key} -> ${to.key}`);
      assert.equal(characterModel(p).key, to.key);
      assert.equal(p.radius, to.radius ?? WORLD.playerRadius);
      assert.deepEqual(retained(p), before);
      assert.equal(attackProfile(p).key, attackProfile(to).key);
    }
});

test('invalid and same character requests leave the whole player unchanged', () => {
  for (const key of [
    undefined,
    '',
    '__proto__',
    'not-a-model',
    { species: 'ape' },
    CHARACTER_MODELS[0].key,
  ]) {
    const p = player(),
      r = room(p),
      before = structuredClone(p);
    assert.equal(handleCharacterSwitch(r, p, { targetId: key }, 10000).ok, false);
    assert.deepEqual(p, before);
  }
});

test('busy states and attack cooldown cannot be bypassed by changing characters', () => {
  for (const state of [
    { downedUntil: 12000 },
    { boatId: 'boat' },
    { mountId: 'animal' },
    { carrierId: 'ape' },
    { passengerId: 'mage' },
    { cookingEndsAt: 12000 },
    { fishing: {} },
    { coastalActivity: {} },
    { jumpAt: 10000, jumpSequence: 1 },
    { attackAt: 10000, attackSequence: 1 },
  ]) {
    const p = { ...player(), ...state },
      r = room(p),
      before = structuredClone(p);
    assert.equal(change(r, p).ok, false, JSON.stringify(state));
    assert.deepEqual(p, before);
  }
  const p = { ...player(), attackAt: 10000, attackSequence: 1 },
    r = room(p);
  const cooldown = attackProfile(p).cooldownMs;
  assert.equal(change(r, p, 'giant-ape', 10000 + cooldown - 1).ok, false);
  assert.equal(change(r, p, 'giant-ape', 10000 + cooldown).ok, true);
});

test('larger body overlapping walls or another player stays put and offers a wider place', () => {
  for (const dynamic of [false, true]) {
    const p = player(),
      obstacle = { id: 'peer', type: 'circle', x: p.x + 1, z: p.z, radius: 0.4 };
    const collision = new CollisionWorld(dynamic ? [] : [obstacle], { river: false });
    const r = room(p, collision),
      before = structuredClone(p);
    if (dynamic) r.players.set('peer', obstacle);
    const result = change(r, p);
    assert.equal(result.ok, false);
    assert.match(result.text, /広い場所/);
    assert.deepEqual(p, before);
    assert.equal(change(r, p, 'desert-fennec-mage').ok, true);
    assert.equal(p.x, before.x);
    assert.equal(p.z, before.z);
  }
});

test('character switch clears movement, own projectiles and reciprocal carry invitations', () => {
  const p = {
    ...player(),
    dx: 1,
    dz: 1,
    runningRequested: true,
    moving: true,
    velocityX: 1,
    velocityZ: 1,
    pendingStrike: {},
    target: { x: 70, z: 90 },
    carryOfferFromId: 'peer',
    carryOfferUntil: 15000,
  };
  const r = room(p);
  r.players.set('peer', {
    id: 'peer',
    x: 80,
    z: 80,
    radius: 0.76,
    carryOfferToId: p.id,
    carryOfferUntil: 15000,
  });
  r.projectiles = [{ ownerId: p.id }, { ownerId: 'peer' }];
  assert.equal(change(r, p).ok, true);
  for (const k of ['dx', 'dz', 'velocityX', 'velocityZ']) assert.equal(p[k], 0);
  assert.equal(p.runningRequested, false);
  assert.equal(p.pendingStrike, null);
  assert.equal(p.target, null);
  assert.equal(p.carryOfferFromId, null);
  assert.equal(r.players.get('peer').carryOfferToId, null);
  assert.deepEqual(r.projectiles, [{ ownerId: 'peer' }]);
});

test('prediction drops old movement and body after a switch at the same location', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  const p = player(),
    free = { move: (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz }) };
  prediction.receive(p, 0);
  prediction.setInput(1, 0, true, 0);
  prediction.step(0.05, 10, 10010, free, []);
  const changed = { ...p, species: 'ape', gender: 'male', radius: 0.76 };
  prediction.receive(changed, 16);
  const shown = prediction.step(0.016, 16, 10016, free, []);
  assert.equal(shown.x, p.x);
  assert.equal(shown.z, p.z);
  assert.equal(shown.species, 'ape');
  assert.equal(shown.moving, false);
});

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

test('late model loads and failures from replaced characters cannot restore stale actors or stop rendering', async () => {
  for (const rejectOld of [false, true]) {
    let resolve,
      reject,
      disposed = 0;
    const loading = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entity = { state: player() },
      replacement = { state: player(CHARACTER_MODELS[6]) };
    const owner = Object.create(WorldRenderer.prototype);
    Object.assign(owner, {
      canvas: { dataset: {} },
      assetsPromise: Promise.resolve(),
      assetsReady: true,
      players: new Map([['self', entity]]),
      humanAssets: new Map([['cro-magnon-woman', { create: () => loading }]]),
      failWorld: () => assert.fail('stale model must not fail the active renderer'),
    });
    const pending = owner.loadHuman(entity, 'self');
    await Promise.resolve();
    owner.players.set('self', replacement);
    if (rejectOld) reject(new Error('old model failure'));
    else resolve({ dispose: () => disposed++ });
    await pending;
    assert.equal(owner.players.get('self'), replacement);
    assert.equal(disposed, rejectOld ? 0 : 1);
    assert.notEqual(owner.canvas.dataset.characterAsset, 'error');
  }
});
test('wire switch reaches both players and checkpoint resume preserves the changed character', () => {
  let serial = 0;
  const options = {
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => 10000, id: () => `switch-${++serial}`, token: () => `token-${++serial}` },
  };
  const core = createGameCore(options),
    a = new Socket(),
    b = new Socket();
  core.connect(a, new URLSearchParams({ room: 'SWITCH', name: 'a', resume: '1' }));
  core.connect(b, new URLSearchParams({ room: 'SWITCH', name: 'b', resume: '1' }));
  const r = core.rooms.get('SWITCH'),
    p = [...r.players.values()][0],
    peer = [...r.players.values()][1];
  const original = { x: p.x, z: p.z, inventory: structuredClone(p.inventory), id: p.id },
    peerBefore = { x: peer.x, z: peer.z };
  a.emit(
    'message',
    JSON.stringify({
      type: 'action',
      action: 'changeCharacter',
      targetId: 'giant-ape',
      x: 9999,
      energy: 999,
      radius: 0.01,
    }),
  );
  assert.equal(p.species, 'ape');
  assert.equal(p.radius, 0.76);
  for (const socket of [a, b]) {
    const view = socket.messages
      .filter((m) => m.type === 'state')
      .at(-1)
      .players.find((v) => v.id === p.id);
    assert.equal(view.species, 'ape');
    assert.equal(view.x, original.x);
    assert.equal(view.z, original.z);
    assert.equal(view.sessionToken, undefined);
  }
  assert.deepEqual({ x: peer.x, z: peer.z }, peerBefore);
  const token = a.messages.find((m) => m.type === 'welcome').session;
  const restored = createGameCore(options);
  restored.importState(core.exportState());
  const c = new Socket();
  restored.connect(c, new URLSearchParams({ room: 'SWITCH', resume: '1', session: token }));
  assert.equal(c.messages.find((m) => m.type === 'welcome').resumed, true);
  const resumed = [...restored.rooms.get('SWITCH').players.values()][0];
  assert.equal(resumed.species, 'ape');
  assert.equal(resumed.id, original.id);
  assert.deepEqual(
    { x: resumed.x, z: resumed.z, inventory: resumed.inventory, id: resumed.id },
    original,
  );
});
