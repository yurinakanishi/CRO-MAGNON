import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeCompanionCamera } from '../dist/src/companion-camera.js';
import { MeshRayGrid, nearPlaneReach } from '../dist/src/mesh-ray-grid.js';
import { WorldRenderer } from '../dist/src/world3d.js';

const aim = new THREE.Vector3(0, 0.14, 0);
const orbit = (distance, yaw, pitch) =>
  new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  )
    .multiplyScalar(distance)
    .add(aim);
// Invisible test collision surfaces only. The sampled floor is gentler than the
// detailed slope, as can happen between the game's terrain-height samples.
function hillside(ceiling = false) {
  const root = new THREE.Group();
  const slope = new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2);
  const p = slope.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, 0.8 * p.getX(i));
  root.add(new THREE.Mesh(slope));
  if (ceiling) {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2));
    roof.position.y = 1;
    root.add(roof);
  }
  return new MeshRayGrid(root);
}

test('a ground correction never collapses a small companion orbit into its body', () => {
  const grid = hillside();
  for (const aspect of [1280 / 800, 390 / 844, 844 / 390]) {
    const reach = nearPlaneReach(new THREE.PerspectiveCamera(57, aspect, 0.15, 360));
    const floor = (x) => 0.2 * x + Math.max(0.25, reach);
    const sweep = (o, d, n) => grid.sweep(o, d, n, reach);
    const world = { cameraFloor: floor, sweepCamera: sweep };
    const legacyDirection = new THREE.Vector3();
    const legacyDistance = WorldRenderer.prototype.cameraReach.call(
      world,
      aim,
      orbit(1, Math.PI / 2, -0.5).sub(aim),
      0.523,
      reach,
      legacyDirection,
    );
    const oldEye = aim.clone().addScaledVector(legacyDirection, legacyDistance);
    oldEye.y = Math.max(oldEye.y, 0.2 * oldEye.x + 0.25);
    assert.ok(
      Math.atan2(oldEye.y - aim.y, Math.hypot(oldEye.x, oldEye.z)) > 1.5,
      'the old shortened sweep reproduces the almost vertical downward view',
    );
    for (const distance of [0.35, 0.523, 1.02])
      for (let i = 0; i < 64; i++) {
        const desired = orbit(distance, (i * Math.PI) / 32, -0.5);
        const eye = new THREE.Vector3();
        assert.equal(
          placeCompanionCamera(aim, desired, 0.35, floor, sweep, orbit(1, 0, 0.3), eye),
          true,
        );
        assert.ok(eye.distanceTo(aim) >= 0.35 - 1e-6, 'never enters the subject');
        assert.ok(Math.hypot(eye.x, eye.z) > 0.3, 'keeps horizontal stand-off');
        assert.ok(Math.atan2(eye.y - aim.y, Math.hypot(eye.x, eye.z)) <= 1.05 + 1e-6);
        assert.ok(eye.y >= floor(eye.x, eye.z) - 1e-6);
        const origin = aim.clone().setY(floor(aim.x, aim.z));
        const direction = eye.clone().sub(origin),
          length = direction.length();
        assert.ok(
          sweep(origin, direction.normalize(), length) >= length - 1e-5,
          'the whole path is clear',
        );
      }
  }
});

test('a tiny target below a detailed floor triangle does not trap the camera beneath it', () => {
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2));
  floorMesh.position.y = 0.2;
  const grid = new MeshRayGrid(floorMesh),
    floor = () => 0.265;
  for (let i = 0; i < 32; i++) {
    const desired = orbit(0.35, (i * Math.PI) / 16, -0.5),
      eye = new THREE.Vector3();
    assert.equal(
      placeCompanionCamera(
        aim,
        desired,
        0.35,
        floor,
        (o, d, n) => grid.sweep(o, d, n, 0.265),
        orbit(1, 0, 0.3),
        eye,
      ),
      true,
    );
    assert.ok(Math.hypot(eye.x, eye.z) < 0.4, 'zoom remains responsive');
    assert.ok(
      Math.abs(Math.atan2(eye.x, eye.z) - Math.atan2(desired.x, desired.z)) < 1e-6,
      'rotation follows the requested bearing',
    );
    assert.ok(eye.y >= 0.265);
  }
});

test('closeups sample a detailed floor above the atlas without raising an open floor or water', () => {
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2));
  floorMesh.position.y = 0.466;
  const grid = new MeshRayGrid(floorMesh);
  const world = {
    companionGroundHeight: WorldRenderer.prototype.companionGroundHeight,
    cameraFloor: (_x, _z, clearance) => 0.159 + clearance,
    sweepCamera: (origin, direction, distance, radius) =>
      grid.sweep(origin, direction, distance, radius),
  };
  const floor = WorldRenderer.prototype.companionCameraFloor.call(world, 0, 0, 0.265);
  assert.ok(Math.abs(floor - (0.466 + 0.265)) < 1e-5);
  world.sweepCamera = (_o, _d, n) => n;
  assert.equal(
    WorldRenderer.prototype.companionCameraFloor.call(world, 0, 0, 0.265),
    0.159 + 0.265,
  );
  world.cameraFloor = () => 1.3;
  assert.ok(
    Math.abs(WorldRenderer.prototype.companionCameraFloor.call(world, 0, 0, 0.265) - 1.3) < 1e-9,
  );
});

test('an intermediate clear height is found when the highest candidate meets a ceiling', () => {
  const grid = hillside(true),
    reach = 0.265,
    eye = new THREE.Vector3();
  assert.equal(
    placeCompanionCamera(
      aim,
      orbit(0.523, Math.PI / 2, -0.5),
      0.35,
      (x) => 0.2 * x + 0.265,
      (o, d, n) => grid.sweep(o, d, n, reach),
      orbit(1, 0, 0.3),
      eye,
    ),
    true,
  );
  assert.ok(eye.x > 0.4, 'uses the requested bearing instead of the previous view');
  assert.ok(eye.y > 0.6 && eye.y < 0.8, 'fits between the slope and ceiling');
});

test('a blocked wall bearing keeps the previous clear view without crossing the wall', () => {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateY(Math.PI / 2));
  wall.position.x = 0.3;
  const grid = new MeshRayGrid(wall),
    previous = orbit(0.6, -Math.PI / 2, 0.25),
    eye = new THREE.Vector3();
  assert.equal(
    placeCompanionCamera(
      aim,
      orbit(0.6, Math.PI / 2, 0.2),
      0.35,
      () => 0.25,
      (o, d, n) => grid.sweep(o, d, n, 0.265),
      previous,
      eye,
    ),
    true,
  );
  assert.deepEqual(eye.toArray(), previous.toArray());
});

test('an entirely blocked closeup fails without replacing the eye with an unsafe position', () => {
  const previous = orbit(0.6, 0, 0.3),
    out = previous.clone();
  assert.equal(
    placeCompanionCamera(
      aim,
      orbit(0.6, Math.PI / 2, 0.2),
      0.35,
      () => 0.25,
      () => 0,
      previous,
      out,
    ),
    false,
  );
  assert.deepEqual(out.toArray(), previous.toArray());
});

test('clear raised or level views keep the requested orbit and accept an aliased output', () => {
  for (const pitch of [0.2, 0.5, 1.05]) {
    const desired = orbit(1, 1, pitch),
      eye = orbit(2, 0, 0.2);
    assert.equal(
      placeCompanionCamera(
        aim,
        desired,
        0.35,
        () => 0.25,
        (_o, _d, n) => n,
        eye,
        eye,
      ),
      true,
    );
    assert.ok(eye.distanceTo(desired) < 1e-9);
  }
});
