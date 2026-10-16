import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Companion524Renderer } from '../dist/src/companion-524-renderer.js';
import { COMPANION_524 } from '../dist/shared/companion-524.mjs';
import { createCompanion } from '../dist/shared/companions.mjs';

function fixture(petterHeight) {
  const c = createCompanion(
    '524',
    '524',
    { id: 'owner', x: 50, z: 50, facing: 0 },
    { x: 50, z: 50.5 },
  );
  Object.assign(c, { petPlayerId: 'owner', petAt: 1000, petContactAt: 2000, petSequence: 1 });
  let now = c.petContactAt;
  const petter = { model: new THREE.Group(), actor: { asset: { heightMetres: petterHeight } } };
  const world = {
    state: { companions: [c], orbBots: [] },
    camera: { position: new THREE.Vector3(50, 2, 54) },
    players: new Map([['owner', petter]]),
    serverNow: () => now,
    actorBudget: { step: () => null },
    companionGroundHeight: (_x, _z, ground) => ground,
    viewedId: null,
  };
  const renderer = Object.assign(Object.create(Companion524Renderer.prototype), {
    world,
    id: c.id,
    root: new THREE.Group(),
    tilt: new THREE.Group(),
    actor: { root: new THREE.Group() },
    hearts: Array.from({ length: 5 }, () => new THREE.Sprite()),
    label: { position: new THREE.Vector3() },
    placed: false,
    floor: 0,
    height: COMPANION_524.hoverHeight,
  });
  return {
    c,
    world,
    renderer,
    at(age) {
      now = c.petContactAt + age;
      renderer.update(1 / 30);
    },
    visible: () => renderer.hearts.filter((h) => h.visible),
  };
}

test('524 hearts clear short, human and ape petters; the close-up stays anchored to 524', () => {
  for (const height of [0.8, 1.7, 3.3]) {
    const f = fixture(height);
    f.at(500);
    assert.equal(f.visible().length, 0, 'no hearts during the unfinished stroke');
    f.at(COMPANION_524.petStrokeMs + 1200);
    assert.equal(f.visible().length, 5);
    for (const heart of f.visible()) assert.ok(heart.position.y > height + 0.12);
    f.world.viewedId = f.c.id;
    f.at(COMPANION_524.petStrokeMs + 1200);
    for (const heart of f.visible())
      assert.ok(heart.position.y < f.renderer.root.position.y + 0.62);
  }
});

test('cancelled, finished, hit, stowed and missing 524s leave no affection hearts', () => {
  for (const state of ['cancelled', 'finished', 'hit', 'stowed', 'missing']) {
    const f = fixture(1.7);
    f.at(COMPANION_524.petStrokeMs + 1200);
    assert.equal(f.visible().length, 5);
    if (state === 'cancelled') Object.assign(f.c, { petPlayerId: null, petContactAt: 0 });
    if (state === 'hit')
      Object.assign(f.c, {
        hitSequence: 1,
        hitAt: f.c.petContactAt + COMPANION_524.petStrokeMs + 1200,
      });
    if (state === 'stowed') f.c.squadMode = 'stowed';
    if (state === 'missing') f.world.state.companions = [];
    f.at(COMPANION_524.petStrokeMs + (state === 'finished' ? COMPANION_524.happyMs : 1200));
    assert.equal(f.visible().length, 0, state);
  }
});
