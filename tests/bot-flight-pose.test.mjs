import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyBotFlightTurn, botFlightTurn } from '../dist/src/bot-flight-pose.js';
import { OrbBotRenderer } from '../dist/src/orb-bot-renderer.js';
import { Companion524Renderer } from '../dist/src/companion-524-renderer.js';
import {
  BOT_KINDS,
  ORB_BOTS,
  botFlightPosition,
  botGroundHeight,
} from '../dist/shared/orb-bots.mjs';
import { COMPANION_524 } from '../dist/shared/companion-524.mjs';
import { createCompanion } from '../dist/shared/companions.mjs';
import { person } from './mascot-fixture.mjs';
import { ActorUpdateBudget } from '../dist/src/actor-update-budget.js';

test('one forward turn keeps the body centre fixed and returns upright at every heading', () => {
  assert.equal(botFlightTurn(-1), 0);
  assert.equal(botFlightTurn(2), Math.PI * 2);
  const position = new THREE.Vector3(5, 4, 3);
  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const root = new THREE.Group();
    let previous = 0;
    for (let i = 0; i <= 108; i++) {
      const t = i / 108;
      applyBotFlightTurn(root, position, facing, t, 0.14);
      root.updateMatrixWorld(true);
      assert.ok(root.rotation.x >= previous && root.rotation.x <= Math.PI * 2);
      previous = root.rotation.x;
      const centre = root.localToWorld(new THREE.Vector3(0, 0.14, 0));
      assert.ok(centre.distanceTo(position.clone().add(new THREE.Vector3(0, 0.14, 0))) < 1e-12);
      if (i === 54) {
        const top = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
        assert.ok(top.y < -0.999999, 'upside down at the apex');
      }
    }
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    assert.ok(forward.distanceTo(new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing))) < 1e-12);
    assert.ok(root.position.distanceTo(position) < 1e-12);
  }
});

function fixture() {
  let now = 10000;
  const c = createCompanion('524', '524@owner', person('owner'), { x: 50, z: 50 });
  const bots = [...BOT_KINDS, '524'].map((kind) => ({
    id: `bot:${kind}`,
    ownerId: kind === '524' ? 'owner' : `owner-${kind}`,
    companionId: kind === '524' ? c.id : undefined,
    kind,
    mode: 'airborne',
    x: 50,
    y: 2,
    z: 50,
    speed: 0,
    facing: 0.7,
    sequence: 1,
    throwAt: 10000,
    phaseAt: 10260,
    origin: { x: 50, y: 2, z: 50 },
    landing: { x: 50, z: 58 },
    landingY: botGroundHeight(50, 58),
  }));
  const actor = (key) => ({
    root: new THREE.Group(),
    asset: { modelKey: key, heightMetres: 0.28 },
    mixer: { setTime() {} },
    play(name) {
      this.name = name;
    },
    sampleOnce(name, elapsed) {
      this.name = name;
      this.elapsed = elapsed;
    },
    update() {},
    dispose() {},
  });
  const world = {
    scene: new THREE.Scene(),
    state: { orbBots: bots, companions: [c] },
    selfId: 'owner',
    focus: new THREE.Vector3(50, 0, 50),
    camera: { position: new THREE.Vector3(50, 5, 50) },
    players: new Map([['owner', { model: new THREE.Group() }]]),
    collision: { segmentFree: () => true },
    actorBudget: new ActorUpdateBudget(),
    worldAssets: {
      createAnimal: actor,
      templates: new Map(BOT_KINDS.map((kind) => [`orb-bot-${kind}`, {}])),
    },
    serverNow: () => now,
  };
  const dots = new OrbBotRenderer(world);
  const mascot = Object.assign(Object.create(Companion524Renderer.prototype), {
    world,
    id: c.id,
    root: new THREE.Group(),
    tilt: new THREE.Group(),
    actor: actor(COMPANION_524.modelKey),
    hearts: [],
    label: { position: new THREE.Vector3() },
    placed: false,
    floor: 0,
    height: COMPANION_524.hoverHeight,
  });
  mascot.root.add(mascot.tilt);
  return {
    world,
    bots,
    dots,
    mascot,
    at(progress, dt = 1 / 60) {
      now = 10000 + ORB_BOTS.windupMs + progress * ORB_BOTS.flightMs;
      dots.update(dt);
      mascot.update(dt);
    },
  };
}

test('all nine rendered dots and 524 share the flight phase, including a late first frame', () => {
  const f = fixture();
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    f.at(t);
    for (const { actor } of f.dots.bots.values()) {
      assert.equal(actor.root.rotation.x, botFlightTurn(t));
      assert.equal(actor.name, 'Thrown_Loop');
      assert.ok(Math.abs(actor.elapsed - (t * ORB_BOTS.flightMs) / 1000) < 1e-12);
    }
    assert.equal(f.mascot.tilt.rotation.x, botFlightTurn(t));
  }
  f.at(0.73, 0.15);
  const late = fixture();
  late.at(0.73, 0.001);
  for (const [id, { actor }] of f.dots.bots) {
    const other = late.dots.bots.get(id).actor;
    assert.ok(actor.root.quaternion.angleTo(other.root.quaternion) < 1e-7);
    assert.ok(actor.root.position.distanceTo(other.root.position) < 1e-12);
  }
  assert.equal(f.mascot.tilt.rotation.x, late.mascot.tilt.rotation.x);
});

test('dots remain visible when owner models are streamed out and disappear when their snapshot is removed', () => {
  const f = fixture();
  f.world.players.clear();
  f.at(0.5);
  assert.equal(f.dots.bots.size, 9);
  for (const [id, { actor }] of f.dots.bots) {
    assert.equal(actor.root.visible, true);
    assert.equal(actor.root.userData.animalId, id);
  }
  const removed = [...f.dots.bots.values()].map(({ actor }) => actor.root);
  f.world.state.orbBots = [];
  f.at(0.6);
  assert.equal(f.dots.bots.size, 0);
  for (const root of removed) assert.equal(root.parent, null);
});

test('landing and recall clear the flight rotation for every companion', () => {
  const f = fixture();
  f.at(0.6);
  for (const mode of ['landing', 'waiting', 'returning', 'catching', 'following']) {
    for (const bot of f.bots) {
      const end = botFlightPosition(bot, 10000 + ORB_BOTS.windupMs + ORB_BOTS.flightMs);
      Object.assign(bot, { ...end, mode, phaseAt: 11160 });
    }
    f.at(1.1);
    for (const { actor } of f.dots.bots.values()) {
      assert.equal(actor.root.rotation.x, 0, mode);
      assert.equal(actor.root.rotation.z, 0, mode);
    }
    assert.equal(f.mascot.tilt.rotation.x, 0, mode);
  }
});
