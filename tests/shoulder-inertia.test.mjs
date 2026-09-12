import test from 'node:test';
import assert from 'node:assert/strict';
import { movePlayer } from '../dist/shared/movement.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  startAttack,
  resolveAttack,
  updateProjectiles,
  stopActor,
} from '../dist/shared/combat.mjs';
import * as THREE from 'three';
import { SpellEffects } from '../dist/src/spell-effects.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fixture() {
  const ape = {
    id: 'ape',
    species: 'ape',
    x: 20,
    z: 20,
    radius: 0.7,
    facing: 0,
    passengerId: 'mage',
    dx: 0,
    dz: 0,
    lastInput: 1000,
    runningRequested: false,
  };
  const mage = {
    id: 'mage',
    species: 'bear',
    x: 20,
    z: 20,
    radius: 0.28,
    facing: 0,
    carrierId: 'ape',
    energy: 100,
    attackSequence: 0,
  };
  const room = {
    players: new Map([
      ['ape', ape],
      ['mage', mage],
    ]),
    animals: [],
    enemies: [],
    collision: new CollisionWorld([], { river: false }),
  };
  assert.equal(startAttack(room, mage, { velocityX: 999, speed: 999 }, 1000).accepted, true);
  return { room, ape, mage };
}
function release(f) {
  f.mage.x = f.ape.x;
  f.mage.z = f.ape.z;
  resolveAttack(f.room, f.mage, 1400);
  return f.room.projectiles[0];
}

test('release adds actual carrier velocity in all directions and preserves forward-relative speed and lifetime', () => {
  for (const running of [false, true])
    for (const [dx, dz] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [0, -1],
      [Math.SQRT1_2, Math.SQRT1_2],
    ]) {
      const f = fixture();
      Object.assign(f.ape, { dx, dz, runningRequested: running, lastInput: 1400 });
      movePlayer(f.ape, 0.1, 1400);
      const vx = f.ape.velocityX,
        vz = f.ape.velocityZ,
        orb = release(f),
        origin = { x: orb.x, z: orb.z };
      near(orb.dx * orb.speed, vx);
      near(orb.dz * orb.speed, 7 + vz);
      updateProjectiles(f.room, 1900);
      near(orb.x - origin.x - vx * 0.5, 0);
      near(orb.z - origin.z - vz * 0.5, 3.5);
      updateProjectiles(f.room, 1400 + 8000 / 7 - 0.01);
      assert.equal(f.room.projectiles.length, 1);
      updateProjectiles(f.room, 1400 + 8000 / 7 + 0.01);
      assert.equal(f.room.projectiles.length, 0);
    }
});

test('wall sliding inherits only the resolved tangent; blocked, released and expired movement add no inertia', () => {
  for (const mode of ['slide', 'blocked', 'released', 'expired']) {
    const f = fixture();
    Object.assign(f.ape, {
      dx: 1,
      dz: mode === 'slide' ? 1 : 0,
      runningRequested: true,
      lastInput: 1400,
    });
    const wall = new CollisionWorld(
      [{ type: 'box', id: 'wall', x: 21.7, z: 20, hx: 1, hz: 8, c: 1, s: 0 }],
      { river: false },
    );
    movePlayer(f.ape, 0.1, 1400, (p, x, z) => wall.move(p, x, z, p.radius));
    movePlayer(f.ape, 0.1, 1400, (p, x, z) => wall.move(p, x, z, p.radius));
    if (mode === 'released') stopActor(f.ape);
    if (mode === 'expired') movePlayer(f.ape, 0.1, 2000);
    const orb = release(f);
    near(orb.dx * orb.speed, 0);
    near(orb.dz * orb.speed, mode === 'slide' ? 7 + 6.4 / Math.sqrt(2) : 7);
  }
});

test('flight retains release velocity after carrier turns, stops or passenger dismounts', () => {
  const f = fixture();
  Object.assign(f.ape, { dz: 1, runningRequested: true, lastInput: 1400 });
  movePlayer(f.ape, 0.1, 1400);
  const orb = release(f),
    origin = orb.z;
  Object.assign(f.ape, { dx: 1, dz: 0, lastInput: 1500 });
  movePlayer(f.ape, 0.1, 1500);
  updateProjectiles(f.room, 1600);
  near(orb.z - origin, 13.4 * 0.2);
  stopActor(f.ape);
  f.mage.carrierId = null;
  f.ape.passengerId = null;
  updateProjectiles(f.room, 2000);
  near(orb.z - origin, 13.4 * 0.6);
});

test('boosted flight sweeps walls and hits once even when a long tick crosses the target', () => {
  for (const wall of [false, true]) {
    const f = fixture();
    Object.assign(f.ape, { dz: 1, runningRequested: true, lastInput: 1400 });
    movePlayer(f.ape, 0.1, 1400);
    const orb = release(f);
    const target = {
      id: 'enemy',
      x: orb.x,
      z: orb.z + 10,
      radius: 0.4,
      health: 75,
      hostile: true,
      phase: 'alive',
    };
    f.room.enemies = [target];
    if (wall)
      f.room.collision = new CollisionWorld(
        [{ type: 'box', x: orb.x, z: orb.z + 3, hx: 2, hz: 0.01, c: 1, s: 0 }],
        { river: false },
      );
    const hits = updateProjectiles(f.room, 2400);
    assert.equal(hits.length, wall ? 0 : 1);
    assert.equal(target.health, wall ? 75 : 15);
    assert.equal(updateProjectiles(f.room, 2500).length, 0);
  }
});

test('rendered boosted orbs follow the combined flight direction and advance ahead of the moving ape', () => {
  for (const vx of [0, 6.4]) {
    const vz = vx ? 0 : 6.4,
      speed = Math.hypot(vx, 7 + vz),
      dx = vx / speed,
      dz = (7 + vz) / speed;
    const effects = new SpellEffects(new THREE.Scene());
    const model = new THREE.Group(),
      left = new THREE.Object3D(),
      right = new THREE.Object3D();
    left.position.set(-0.1, 1.9, 0.25);
    right.position.set(0.1, 1.9, 0.25);
    model.add(left, right);
    const players = new Map([
      [
        'mage',
        { state: { species: 'bear', carrierId: 'ape' }, model, gripLeft: left, gripRight: right },
      ],
    ]);
    const orb = {
      id: 'orb',
      ownerId: 'mage',
      x: 0,
      z: 0,
      dx,
      dz,
      speed,
      travelled: 0,
      elevation: 0,
    };
    for (let i = 0; i < 60; i++) {
      const time = i / 60;
      model.position.set(vx * time, 0, vz * time);
      if (i % 5 === 0)
        Object.assign(orb, { x: vx * time, z: (7 + vz) * time, travelled: speed * time });
      effects.update({ projectiles: [orb] }, players, 1400 + time * 1000, 1 / 60, 900);
      if (time > 0.2)
        assert.ok(effects.xyz[2] > model.position.z, 'visible head stays ahead of carrier');
      if (time > 0.6) {
        assert.ok(Math.abs(effects.xyz[0] * dz - effects.xyz[2] * dx) < 1e-5);
      }
    }
    effects.dispose();
  }
});
