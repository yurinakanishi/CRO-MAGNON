import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldRenderer } from '../dist/src/world3d.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { LOAD_TIER, loadPriority, isLoadCancelled } from '../dist/src/asset-load-queue.js';

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const calls = [];
  const worldAssets = new WorldAssets({
    loadEnvironment: (record) => {
      const gate = deferred();
      calls.push({ key: record.modelKey, ...gate });
      return gate.promise;
    },
  });
  worldAssets.catalog = {
    assets: [
      ...[
        'yellow-524-mascot',
        'rimo-neko',
        'orb-bot-white',
        'orb-bot-blue',
        'howkey-scientist',
      ].map((modelKey) => ({ modelKey, kind: 'companion', url: `/${modelKey}.glb`, lods: [] })),
      { modelKey: 'howkey-flask', kind: 'equipment', url: '/flask.glb', lods: [] },
    ],
  };
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    worldAssets,
    assetsReady: true,
    disposed: false,
    failed: false,
    selfId: 'self',
    players: new Map([['self', { actor: {}, state: { x: 0, z: 0 } }]]),
    state: { players: [], companions: [], orbBots: [] },
    companionRenderers: { renderers: new Map(), sync() {}, update() {} },
    orbBotRenderer: { bots: new Map(), update() {} },
    failWorld(message, cause) {
      this.failed = true;
      this.failure = cause;
    },
  });
  const finish = (key) => calls.find((c) => c.key === key).resolve({ scene: new THREE.Group() });
  return { world, calls, finish };
}

test('chosen companions bypass the arrival streaming hold, load once, and include held equipment only', async (t) => {
  const { world, calls, finish } = fixture();
  t.after(() => world.worldAssets.dispose());
  const release = world.worldAssets.loadQueue.deferFrom(loadPriority(LOAD_TIER.near));
  t.after(release);
  let ready = false;
  const preparing = world
    .prepareCompanions(['524', 'howkey-scientist', 'white', '524'])
    .then(() => {
      ready = true;
    });
  await settle();
  // Complete queued jobs as slots open, keeping the last companion unresolved.
  const completed = new Set();
  for (let pass = 0; pass < 4; pass++) {
    for (const { key } of calls)
      if (key !== 'orb-bot-white' && !completed.has(key)) {
        completed.add(key);
        finish(key);
      }
    await settle();
  }
  assert.deepEqual(
    calls.map((c) => c.key).sort(),
    ['yellow-524-mascot', 'howkey-scientist', 'howkey-flask', 'orb-bot-white'].sort(),
  );
  assert.equal(ready, false, 'the last selected model must finish too');
  finish('orb-bot-white');
  await preparing;
  await world.prepareCompanions(['white', '524']);
  assert.equal(calls.length, 4, 'cached templates are reused at actual arrival');
});

test('the gallery prepares the chosen party before the snapshot, while none and keep request no guessed model', async (t) => {
  const { world, calls, finish } = fixture();
  t.after(() => world.worldAssets.dispose());
  world.humanAssets = new Map([['giant-ape', { load: async () => {} }]]);
  for (const mascot of ['none', 'keep'])
    await world.prepareSelf({ species: 'ape', gender: 'male', mascot });
  assert.equal(calls.length, 0);
  let ready = false;
  const preparing = world
    .prepareSelf({ species: 'ape', gender: 'male', mascot: '524,white' })
    .then(() => {
      ready = true;
    });
  await settle();
  assert.deepEqual(calls.map((c) => c.key).sort(), ['orb-bot-white', 'yellow-524-mascot']);
  finish('yellow-524-mascot');
  await settle();
  assert.equal(ready, false);
  finish('orb-bot-white');
  await preparing;
  assert.equal(ready, true);
});

test('travelling alone requests no companion; missing or invalid selected assets reject entry', async (t) => {
  const { world, calls } = fixture();
  t.after(() => world.worldAssets.dispose());
  await world.prepareCompanions([]);
  assert.equal(calls.length, 0);
  await assert.rejects(world.prepareCompanions(['missing']), /Missing verified/);
  const preparing = world.prepareCompanions(['524']);
  await settle();
  calls[0].reject(new Error('integrity mismatch'));
  await assert.rejects(preparing, /integrity mismatch/);
  assert.equal(world.worldAssets.templates.size, 0, 'no substitute model');
});

test('arrival prepares a saved party and waits for both kinds of owned body, without waiting for other players', async (t) => {
  const { world, calls, finish } = fixture();
  t.after(() => world.worldAssets.dispose());
  // Legacy selection plus an actual owned dot; proxies do not count as extra bodies.
  world.players.get('self').state.mascot = '524';
  world.state.companions = [
    { id: '524@self', key: '524', ownerId: 'self' },
    { id: 'rimo@other', key: 'rimo-neko', ownerId: 'other' },
  ];
  world.state.orbBots = [
    { id: 'white@self', kind: 'white', ownerId: 'self' },
    { id: 'orb:524@self', kind: '524', ownerId: 'self', companionId: '524@self' },
    { id: 'blue@other', kind: 'blue', ownerId: 'other' },
  ];
  let allowAttach = false,
    arrived = false;
  world.companionRenderers.sync = () => {
    if (allowAttach) world.companionRenderers.renderers.set('524@self', {});
  };
  world.orbBotRenderer.update = () => world.orbBotRenderer.bots.set('white@self', {});
  const arriving = world.arrival().then(() => {
    arrived = true;
  });
  await settle();
  assert.deepEqual(calls.map((c) => c.key).sort(), ['orb-bot-white', 'yellow-524-mascot']);
  finish('yellow-524-mascot');
  await pause();
  assert.equal(arrived, false, 'one selected template remains missing');
  finish('orb-bot-white');
  await pause();
  assert.equal(arrived, false, 'download alone does not make a body ready');
  allowAttach = true;
  await arriving;
  assert.equal(arrived, true);
  assert.equal(world.companionRenderers.renderers.size, 1, 'another player never blocks entry');
});

test('a failed saved companion stops entry; leaving during that load does not show a failure', async (t) => {
  for (const leave of [false, true]) {
    const { world, calls } = fixture();
    t.after(() => world.worldAssets.dispose());
    world.players.get('self').state.mascots = ['524'];
    let current = true;
    const arriving = world.arrival(() => current).catch((error) => error);
    await settle();
    if (leave) current = false;
    calls[0].reject(new Error('selected model failed'));
    const error = await arriving;
    assert.equal(isLoadCancelled(error), leave);
    assert.equal(world.failed, !leave);
    if (!leave) assert.match(error.message, /selected model failed/);
  }
});
