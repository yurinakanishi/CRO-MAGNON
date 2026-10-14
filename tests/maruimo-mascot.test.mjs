import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { MASCOT_KEYS } from '../dist/shared/mascot-selection.mjs';
import { CAVE_EXTRA_PIGMENTS } from '../dist/src/cave-gallery-layout.js';
import { loadMotion, unpack, pose } from '../scripts/motion-glb.mjs';
import { assertPublicCharacterData } from '../scripts/public-character-audit.mjs';
import { mascotCore } from './mascot-fixture.mjs';
import { companionBehavior } from './companion-behavior.mjs';
companionBehavior('maruimo-mascot');

test('Maruimo is a separate companion for each chooser and a visitor can pet it', (t) => {
  const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS });
  const a = w.join('A'),
    b = w.join('B', '', { x: 56, z: 50 });
  w.act(a, 'selectMascot', 'maruimo-mascot');
  w.act(b, 'selectMascot', 'maruimo-mascot');
  const ca = w.active(a),
    cb = w.active(b);
  assert.notEqual(ca.id, cb.id);
  Object.assign(b.player(), { x: ca.x, z: ca.z - 1 });
  w.act(b, 'petMascot', ca.id);
  assert.equal(ca.petPlayerId, b.id);
  assert.equal(ca.ownerId, a.id);
  assert.equal(cb.ownerId, b.id);
  w.act(a, 'deselectMascot');
  w.step(50, 30);
  assert.ok(!w.room().companions.includes(ca));
  assert.equal(w.active(b), cb);
});
test('the cave permits Maruimo petting but refuses attacks and throwing', (t) => {
  const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS }),
    a = w.join();
  w.act(a, 'selectMascot', 'maruimo-mascot');
  const c = w.active(a),
    p = a.player();
  Object.assign(p, caveWorldAt(-12));
  Object.assign(c, { x: p.x, z: p.z + 1 });
  const before = p.attackSequence;
  w.act(a, 'attack', c.id);
  assert.equal(p.attackSequence, before);
  w.act(a, 'throwBot', c.id);
  assert.equal(c.squadMode, 'following');
  w.act(a, 'petMascot', c.id);
  assert.equal(c.petPlayerId, p.id);
  assert.equal(c.ownerId, p.id);
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
    // Every mascot is painted; Howkey is the one playable character in a frieze, and
    // @daredaro_F the one person painted as themself rather than as a mascot.
    new Set([...MASCOT_KEYS, 'howkey-scientist', 'daredaro']),
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
