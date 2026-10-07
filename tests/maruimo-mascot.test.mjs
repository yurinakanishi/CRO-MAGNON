import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
const { createGameCore } = await import(
  process.env.MARUIMO_CORE || '../dist/application/game-core.mjs'
);
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { MASCOT_KEYS } from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { CAVE_EXTRA_PIGMENTS } from '../dist/src/cave-gallery-layout.js';
import { loadMotion, unpack, pose } from '../scripts/motion-glb.mjs';
import { assertPublicCharacterData } from '../scripts/public-character-audit.mjs';

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
  ping() {
    this.emit('pong');
  }
}
function fixture() {
  let now = 10000,
    id = 0;
  const options = {
    runtime: { now: () => now, id: () => `m-${++id}`, token: () => `s-${++id}` },
    persistentSessions: true,
    keepEmptyRooms: true,
  };
  let core = createGameCore(options);
  const join = (session = '') => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'MARUIMO', resume: '1', session }));
    return { socket, welcome: socket.messages.find((m) => m.type === 'welcome') };
  };
  const owner = join(),
    observer = join();
  const room = () => core.rooms.get('MARUIMO');
  room().collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  room().animals = [];
  room().enemies = [];
  room().behemoth = null;
  room().sabertooth = null;
  const player = () => room().players.get(owner.welcome.id);
  Object.assign(player(), { x: room().maruimo.x, z: room().maruimo.z - 1, facing: 0 });
  const action = (action, targetId, actor = owner) => {
    now += 200;
    actor.socket.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action, targetId })),
      false,
    );
  };
  const step = (seconds) => {
    for (let i = 0; i < seconds * 20; i++) {
      now += 50;
      core.tick();
    }
  };
  return {
    room,
    player,
    owner,
    observer,
    join,
    action,
    step,
    get core() {
      return core;
    },
    restore(saved) {
      core = createGameCore(options);
      core.importState(saved);
    },
  };
}

test('the fourteenth mascot is selectable, follows, returns, and preserves another player’s ownership', () => {
  const f = fixture(),
    c = f.room().maruimo;
  assert.equal(MASCOT_KEYS.length, 14);
  assert.match(mascotMenuMarkup(f.core.snapshot(f.room())), /data-mascot="maruimo-mascot"/);
  f.action('selectMascot', 'maruimo-mascot');
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  f.action('selectMascot', 'maruimo-mascot', f.observer);
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  const q = f.room().players.get(f.observer.welcome.id);
  Object.assign(q, { x: c.x, z: c.z - 1 });
  f.action('petMaruimo', null, f.observer);
  assert.equal(c.petPlayerId, null);
  const before = c.x;
  f.player().x += 5;
  f.step(3);
  assert.ok(c.x > before + 1);
  f.action('deselectMascot', 'maruimo-mascot');
  f.step(12);
  assert.equal(c.followPlayerId, null);
  assert.equal(c.mode, 'idle');
  assert.ok(Math.hypot(c.x - c.home.x, c.z - c.home.z) < 0.08);
});

test('pet contact bonds and completes; another pet cannot start concurrently; recall cancels only the stroke', () => {
  const f = fixture(),
    c = f.room().maruimo;
  f.action('petMaruimo');
  assert.equal(c.petPlayerId, f.owner.welcome.id);
  f.step(0.7);
  assert.ok(c.petContactAt > 0);
  Object.assign(f.room().kohaku, { x: c.x, z: c.z });
  f.action('petKohaku');
  assert.equal(f.room().kohaku.petPlayerId, null);
  f.step(3);
  assert.equal(c.petPlayerId, null);
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  f.action('petMaruimo');
  assert.equal(c.petPlayerId, f.owner.welcome.id);
  f.action('recallBots');
  assert.equal(c.petPlayerId, null);
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  f.action('travelAlone');
  assert.equal(c.followPlayerId, null);
});

test('bond survives snapshot, disconnect, save and resume; old saves add an unowned mascot', () => {
  const f = fixture();
  f.player().inventory.wood = 7;
  f.action('petMaruimo');
  const snapshot = f.core.snapshot(f.room());
  assert.equal(snapshot.maruimo.followPlayerId, f.owner.welcome.id);
  assert.equal(snapshot.maruimo.path, undefined);
  f.owner.socket.close();
  f.step(0.2);
  assert.equal(f.room().maruimo.petPlayerId, null);
  const saved = JSON.parse(JSON.stringify(f.core.exportState())),
    before = structuredClone(saved);
  f.restore(saved);
  assert.deepEqual(saved, before);
  assert.equal(f.room().maruimo.followPlayerId, f.owner.welcome.id);
  const resumed = f.join(f.owner.welcome.session);
  assert.equal(resumed.welcome.resumed, true);
  assert.equal(f.room().players.get(resumed.welcome.id).inventory.wood, 7);
  assert.equal(f.room().maruimo.petPlayerId, null);
  delete saved.rooms[0].maruimo;
  f.restore(saved);
  assert.equal(f.room().maruimo.followPlayerId, null);
  assert.equal(f.room().maruimo.id, 'maruimo-mascot');
});

test('cave still refuses attacks and throwing while permitting Maruimo petting', () => {
  const f = fixture(),
    p = f.player(),
    c = f.room().maruimo;
  Object.assign(p, caveWorldAt(-12));
  Object.assign(c, { x: p.x, z: p.z + 1 });
  const attack = p.attackSequence,
    hits = c.hitSequence;
  f.action('attack', c.id);
  f.step(1);
  assert.equal(p.attackSequence, attack);
  assert.equal(c.hitSequence, hits);
  f.action('throwBot', c.id);
  assert.equal(c.mode, 'idle');
  f.action('petMaruimo');
  assert.equal(c.petPlayerId, p.id);
});

test('the retained pre-remake mascot preserves every original octopus geometry, skin, UV, texture and animation buffer', async () => {
  const source = JSON.parse(await readFile('public/models/maruimo-octopus/asset.json')).provenance
    .previousDelivery;
  const mascot = JSON.parse(await readFile('public/models/maruimo-mascot/asset.json')).provenance
    .previousDelivery;
  assert.equal(source.url, '/models/maruimo-octopus/model-r10.glb');
  assert.equal(mascot.url, '/models/maruimo-mascot/model-r01.glb');
  for (const [a, b] of [[source, mascot]]) {
    const first = await readFile('public' + a.url),
      second = await readFile('public' + b.url);
    assert.equal(createHash('sha256').update(first).digest('hex'), a.sha256);
    assert.equal(createHash('sha256').update(second).digest('hex'), b.sha256);
    assert.deepEqual(unpack(first).binary, unpack(second).binary);
    for (const key of ['meshes', 'skins', 'animations', 'accessors', 'bufferViews', 'materials'])
      assert.deepEqual(unpack(first).doc[key], unpack(second).doc[key]);
  }
});

test('the 2026-10 remake mascot keeps the octopus rig and clips at 55 cm with its head contact socket', async () => {
  const octopus = JSON.parse(await readFile('public/models/maruimo-octopus/asset.json'));
  const mascot = JSON.parse(await readFile('public/models/maruimo-mascot/asset.json'));
  assert.equal(mascot.candidate, 2);
  for (const record of [mascot, mascot.lods[0]]) {
    const bytes = await readFile('public' + record.url);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  }
  assert.ok(mascot.triangles < mascot.provenance.previousDelivery.triangles / 3);
  const doc = (bytes) => unpack(bytes).doc;
  const a = doc(await readFile('public' + octopus.url)),
    b = doc(await readFile('public' + mascot.url));
  const joints = (d) => d.skins[0].joints.map((i) => d.nodes[i].name);
  assert.deepEqual(joints(b), joints(a));
  assert.deepEqual(
    b.animations.map((clip) => clip.name),
    a.animations.map((clip) => clip.name),
  );
  assert.ok(b.materials.every((m) => m.normalTexture));
  const gltf = await loadMotion('public' + mascot.url);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  assert.ok(Math.abs(box.max.y - box.min.y - 0.55) < 0.001);
  assert.ok(Math.abs(box.min.y) < 0.001);
  for (const name of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Wave']) {
    const mixer = pose(
      gltf,
      gltf.animations.find((c) => c.name === name),
      0.2,
    );
    const socket = gltf.scene.getObjectByName('PetContact').getWorldPosition(new THREE.Vector3());
    assert.ok(socket.y > 0.45 && socket.y < 0.7, `${name}: ${socket.y}`);
    mixer.stopAllAction();
  }
  assert.deepEqual(
    new Set(['rimo-neko', '524', ...Object.values(CAVE_EXTRA_PIGMENTS).flatMap((p) => p.subjects)]),
    new Set(MASCOT_KEYS),
  );
});

test('release audit admits the named mascot but rejects excluded playable models and definitions', () => {
  const check = (path, value) =>
    assertPublicCharacterData(
      path,
      Buffer.from(value),
      new Set(['maruimo-octopus']),
      new Set(['maruimo']),
    );
  assert.doesNotThrow(() =>
    check('src/maruimo-mascot-renderer.js', "createLabel('まるぃも'); state.maruimo"),
  );
  assert.doesNotThrow(() =>
    check(
      'models/maruimo-mascot/asset.json',
      JSON.stringify({
        modelKey: 'maruimo-mascot',
        kind: 'companion',
        url: '/models/maruimo-mascot/model-r01.glb',
      }),
    ),
  );
  assert.throws(() => check('models/maruimo-octopus/model-r10.glb', ''), /Excluded/);
  assert.throws(
    () => check('shared/character-profiles.mjs', "const model={ species: 'maruimo' };"),
    /Excluded/,
  );
  assert.throws(
    () =>
      check(
        'models/world-assets.json',
        JSON.stringify({ assets: [{ modelKey: 'maruimo-octopus' }] }),
      ),
    /Excluded/,
  );
});
