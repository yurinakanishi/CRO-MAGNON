import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { startAttack, resolveAttack, updateProjectiles } from '../dist/shared/combat.mjs';
import {
  RIMO_NEKO,
  createRimoNeko,
  handleRimoNekoAction,
  updateRimoNeko,
  nearRimoNeko,
  hitRimoNeko,
  restoreRimoNeko,
} from '../dist/shared/rimo-neko.mjs';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { loadMotion } from '../scripts/motion-glb.mjs';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture(obstacles = []) {
  const collision = new CollisionWorld(obstacles, { coast: false, river: false, walkSurfaces: [] }),
    c = createRimoNeko(collision);
  const p = {
    id: 'p',
    x: c.x,
    z: c.z - 2,
    facing: 0,
    radius: 0.32,
    species: 'cro',
    gender: 'female',
    speed: 0,
    energy: 100,
    inventory: {},
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  return {
    c,
    p,
    room: { collision, rimoNeko: c, players: new Map([[p.id, p]]), animals: [], enemies: [] },
  };
}
function advance(room, start, seconds, dt = 0.05) {
  for (let s = dt; s < seconds + dt / 2; s += dt) {
    updateRimoNeko(room, dt, start + s * 1000);
    assert.ok(room.collision.free(room.rimoNeko, room.rimoNeko.radius));
  }
}
test('the real camp has a safe ground position for Rimo-neko separate from 524', () => {
  const collision = new CollisionWorld(),
    c = createRimoNeko(collision);
  assert.ok(collision.free(c, c.radius));
  assert.ok(dist(c, { x: 50, z: 50 }) < 6);
  assert.ok(dist(c, { x: 46, z: 53.5 }) > 3);
  assert.equal(c.followPlayerId, null);
});
test('friendship requires finished strokes; walking away, hitting and racing another pet cancel or reject', () => {
  const { c, p, room } = fixture();
  assert.equal(handleRimoNekoAction(room, p, 'petRimo', 10000), true);
  assert.equal(c.followPlayerId, null);
  advance(room, 10000, 1);
  assert.ok(c.petContactAt > 0);
  assert.equal(handleRimoNekoAction(room, { ...p, id: 'q' }, 'petRimo', 11000), false);
  assert.equal(c.followPlayerId, null);
  advance(room, 11000, 2);
  assert.equal(c.followPlayerId, p.id);
  const f = fixture();
  handleRimoNekoAction(f.room, f.p, 'petRimo', 10000);
  advance(f.room, 10000, 0.4);
  f.p.x += 1;
  advance(f.room, 10400, 2);
  assert.equal(f.c.followPlayerId, null);
  assert.equal(f.c.petPlayerId, null);
  hitRimoNeko(c, 0, 1, 15000);
  assert.equal(c.followPlayerId, null);
  assert.equal(c.petPlayerId, null);
  assert.equal(nearRimoNeko(p, c, room.collision, 15000 + RIMO_NEKO.hitMs + 100), false);
  assert.equal(handleRimoNekoAction(room, p, 'petRimo', 18000), true);
});
test('proximity cannot reach through a wall or while riding, jumping, downed, carried or fishing', () => {
  const { c, p, room } = fixture();
  for (const patch of [
    { mountId: 'm' },
    { boatId: 'b' },
    { downedUntil: 20000 },
    { carrierId: 'a' },
    { passengerId: 'a' },
    { fishing: {} },
    { jumpSequence: 1, jumpAt: 10000 },
  ])
    assert.equal(handleRimoNekoAction(room, { ...p, ...patch }, 'petRimo', 10000), false);
  room.collision = new CollisionWorld(
    [{ type: 'box', id: 'wall', x: c.x, z: c.z - 1, hx: 3, hz: 0.15, c: 1, s: 0 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  assert.equal(handleRimoNekoAction(room, p, 'petRimo', 10000), false);
});
test('follow stops comfortably, does not orbit a stationary owner, and returns after disconnect', () => {
  const { c, p, room } = fixture();
  handleRimoNekoAction(room, p, 'petRimo', 10000);
  advance(room, 10000, 4);
  const still = { x: c.x, z: c.z };
  p.facing = Math.PI;
  advance(room, 14000, 2);
  assert.ok(dist(c, still) < 0.001);
  p.z += 10;
  p.speed = 2;
  advance(room, 16000, 6);
  assert.ok(dist(c, p) < RIMO_NEKO.followDistance + 0.15);
  room.players.delete(p.id);
  advance(room, 22000, 14);
  assert.equal(c.mode, 'idle');
  assert.ok(dist(c, c.home) < 0.1);
});
test('melee and real magic cause directional recoil followed by a stationary hiss without health or loot', () => {
  const { c, p, room } = fixture();
  p.z = c.z - 1.2;
  assert.ok(startAttack(room, p, {}, 10000).accepted);
  assert.equal(resolveAttack(room, p, 10332), null);
  assert.equal(resolveAttack(room, p, 10333).kind, 'rimoNeko');
  const z = c.z;
  advance(room, 10333, 0.5);
  assert.ok(c.z - z > 0.4);
  assert.ok(Math.abs(Math.abs(c.facing) - Math.PI) < 1e-6);
  const after = c.z;
  advance(room, 10833, 1.5);
  assert.ok(c.z - after < 0.02);
  assert.equal(c.health, undefined);
  p.species = 'bear';
  p.z = c.z - 7;
  startAttack(room, p, {}, 16000);
  resolveAttack(room, p, 16400);
  const hits = updateProjectiles(room, 17600);
  assert.equal(hits[0].kind, 'rimoNeko');
  assert.equal(c.hitSequence, 2);
});
test('knockback is frame-rate independent and never crosses a solid wall', () => {
  const a = fixture(),
    b = fixture();
  for (const f of [a, b]) hitRimoNeko(f.c, 1, 0, 10000);
  advance(a.room, 10000, 0.5, 0.01);
  advance(b.room, 10000, 0.5, 0.1);
  assert.ok(dist(a.c, b.c) < 0.005);
  const f = fixture();
  f.room.collision = new CollisionWorld(
    [{ type: 'box', id: 'wall', x: f.c.x + 0.5, z: f.c.z, hx: 0.1, hz: 3, c: 1, s: 0 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  hitRimoNeko(f.c, 1, 0, 10000);
  advance(f.room, 10000, 3);
  assert.ok(f.c.x < f.c.home.x + 0.15);
});
test('five connections share one cat, and old/new saves preserve player state and clear stale owners', () => {
  let now = 10000,
    id = 0;
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    send(s) {
      this.messages.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const runtime = { now: () => now, id: () => `rimo-${++id}`, token: () => `t-${++id}` },
    core = createGameCore({ runtime, keepEmptyRooms: true, persistentSessions: true });
  const sockets = Array.from({ length: 5 }, () => new Socket());
  for (const s of sockets) core.connect(s, new URLSearchParams({ room: 'RIMO' }));
  const room = core.rooms.get('RIMO'),
    p = [...room.players.values()][0],
    c = room.rimoNeko;
  Object.assign(p, { x: c.x, z: c.z - 1.5 });
  sockets[0].emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'action', action: 'petRimo' })),
    false,
  );
  for (const s of sockets)
    assert.deepEqual(s.messages.at(-1).rimoNeko, sockets[0].messages.at(-1).rimoNeko);
  for (let i = 0; i < 70; i++) {
    now += 50;
    core.tick();
  }
  assert.equal(c.followPlayerId, p.id);
  const saved = core.exportState(),
    copy = structuredClone(saved),
    restored = createGameCore({ runtime });
  restored.importState(saved);
  assert.equal(restored.rooms.get('RIMO').rimoNeko.mode, 'returning');
  assert.deepEqual(saved, copy);
  delete saved.rooms[0].rimoNeko;
  const legacy = createGameCore({ runtime });
  legacy.importState(saved);
  assert.equal(legacy.rooms.get('RIMO').rimoNeko.mode, 'idle');
  assert.ok(legacy.rooms.get('RIMO').companion524);
});
test('all delivered characters crouch, keep both soles planted and reach the cat at different orientations', async () => {
  const cat = await loadMotion(await deliveredModel('rimo-neko'));
  const catMixer = new THREE.AnimationMixer(cat.scene),
    catAction = catMixer.clipAction(cat.animations.find((c) => c.name === 'Pet')).play();
  for (const character of CHARACTER_MODELS.filter((model) => model.bodyPlan !== 'octopus')) {
    const gltf = await loadMotion(await deliveredModel(character.key)),
      outer = new THREE.Group();
    outer.add(gltf.scene);
    const pose = new GroundPettingPose(gltf.scene),
      mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle_Loop')).play();
    const { c, p, room } = fixture();
    Object.assign(p, character);
    handleRimoNekoAction(room, p, 'petRimo', 10000);
    outer.add(cat.scene);
    cat.scene.position.set(c.petGoal.x - p.x, 0, c.petGoal.z - p.z);
    cat.scene.rotation.y = Math.PI;
    for (const yaw of [0, Math.PI / 2, Math.PI])
      for (const stroke of [0, 0.0625, 0.125, 0.1875, 0.25, 0.5, 0.5625, 0.625, 0.6875, 0.75, 1]) {
        pose.restore();
        mixer.update(0.03);
        outer.position.set(2, 0.2, -1);
        outer.rotation.y = yaw;
        outer.updateMatrixWorld(true);
        const feet = ['FootL', 'FootR'].map((n) =>
          gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()),
        );
        const hips = gltf.scene.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
        catAction.time = stroke * 1.599;
        catMixer.update(0);
        outer.updateMatrixWorld(true);
        const target = cat.scene
          .getObjectByName('PetContact')
          .getWorldPosition(new THREE.Vector3());
        pose.update(target, 1, stroke);
        assert.ok(pose.depth > 0.025, `${character.key}: crouch`);
        const gap = pose.contact.distanceTo(pose.requested);
        assert.ok(gap < 0.045, `${character.key}: hand gap ${gap}`);
        for (const [i, n] of ['FootL', 'FootR'].entries())
          assert.ok(
            gltf.scene
              .getObjectByName(n)
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(feet[i]) < 0.006,
            `${character.key}: planted ${n}`,
          );
        pose.restore();
        outer.updateMatrixWorld(true);
        assert.ok(
          gltf.scene
            .getObjectByName('Hips')
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(hips) < 1e-8,
        );
      }
  }
});
