import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { ViewUpdateGate } from '../dist/src/view-update-gate.js';
import { markActiveInstances } from '../dist/src/instance-updates.js';
import { landscapeFixtures } from '../scripts/benchmark-vegetation.mjs';

test('view cache invalidates for translation, rotation, projection and riding changes', () => {
  const gate = new ViewUpdateGate(),
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  camera.updateMatrixWorld(true);
  assert.equal(gate.shouldUpdate(camera, 0), true);
  assert.equal(gate.shouldUpdate(camera, 1), false);
  camera.position.x = 1;
  camera.updateMatrixWorld(true);
  assert.equal(gate.shouldUpdate(camera, 1.01), false);
  assert.equal(gate.shouldUpdate(camera, 1.2), true);
  camera.rotation.y = 0.2;
  camera.updateMatrixWorld(true);
  assert.equal(gate.shouldUpdate(camera, 2), true);
  camera.aspect = 2;
  camera.updateProjectionMatrix();
  assert.equal(gate.shouldUpdate(camera, 3), true);
  const focus = new THREE.Vector3(0, 2, 0);
  assert.equal(gate.shouldUpdate(camera, 4, focus), true);
  assert.equal(gate.shouldUpdate(camera, 5, focus), false);
  focus.z = 1;
  assert.equal(gate.shouldUpdate(camera, 6, focus), true);
  assert.equal(gate.shouldUpdate(camera, 7), true);
  camera.position.x += 1e-7;
  camera.updateMatrixWorld(true);
  assert.equal(gate.shouldUpdate(camera, 8), false);
  camera.position.x += 2e-6;
  camera.updateMatrixWorld(true);
  assert.equal(gate.shouldUpdate(camera, 9), true);
});

test('Three uploader sends the active matrix prefix through shrink, empty and grow transitions', () => {
  const uploads = [];
  const gl = {
    FLOAT: 5126,
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    bufferSubData: (_type, offset, array, start = 0, count = array.length) =>
      uploads.push({ offset, start, count, data: Array.from(array.slice(start, start + count)) }),
  };
  const attributes = WebGLAttributes(gl),
    mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 100);
  attributes.update(mesh.instanceMatrix, 34962); // Initial allocation always uploads capacity.
  for (const count of [12, 3, 0, 8]) {
    mesh.count = count;
    for (let i = 0; i < count; i++)
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, count, 0));
    const before = uploads.length;
    assert.equal(markActiveInstances(mesh), count * 64);
    attributes.update(mesh.instanceMatrix, 34962);
    assert.equal(uploads.length - before, count ? 1 : 0);
    if (count) {
      const upload = uploads.at(-1);
      assert.equal(upload.count, count * 16);
      assert.equal(upload.data.at(-4), count - 1);
      assert.equal(upload.data.at(-3), count);
    }
  }
  attributes.remove(mesh.instanceMatrix);
  mesh.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('cached vegetation matches a fresh calculation through travel, turns, zoom and canopy culling', () => {
  const cached = landscapeFixtures(),
    camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 200);
  let time = 0;
  for (const [x, z, yaw, fov, mounted] of [
    [48, 57, 0, 48, false],
    [49, 56, 0.1, 48, false],
    [90, 25, 0.9, 65, false],
    [25, 21, 2, 48, true],
    [25, 21, 2, 48, false],
    [1000, 90, 0, 48, false],
    [48, 57, 0, 48, false],
  ]) {
    camera.position.set(x, 3, z);
    camera.rotation.y = yaw;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const focus = mounted ? new THREE.Vector3(x, 1, z - 5) : null,
      fresh = landscapeFixtures();
    time++;
    for (let i = 0; i < cached.length; i++) {
      cached[i].update(camera, time, focus);
      fresh[i].update(camera, time, focus);
      for (let level = 0; level < 3; level++) {
        const actual = cached[i].levels[level][0].mesh,
          expected = fresh[i].levels[level][0].mesh;
        assert.equal(actual.count, expected.count);
        assert.deepEqual(
          actual.instanceMatrix.array.slice(0, actual.count * 16),
          expected.instanceMatrix.array.slice(0, expected.count * 16),
        );
        const version = actual.instanceMatrix.version;
        cached[i].update(camera, time + 0.2, focus);
        assert.equal(actual.instanceMatrix.version, version, 'stationary view must not re-upload');
      }
    }
    for (const f of fresh)
      for (const { mesh } of f.levels.flat()) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
  }
  for (const f of cached)
    for (const { mesh } of f.levels.flat()) {
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
});

test('a walking sight line hides its blocking canopy and restores trees when the camera leaves', () => {
  const a = landscapeFixtures(),
    b = landscapeFixtures();
  const camera = new THREE.PerspectiveCamera(57, 1.6, 0.15, 360);
  const focus = new THREE.Vector3(76, 1.4, 68);
  const positions = (landscape) =>
    landscape.levels
      .flatMap((parts) =>
        parts.flatMap(({ mesh }) =>
          Array.from({ length: mesh.count }, (_, i) =>
            [mesh.instanceMatrix.array[i * 16 + 12], mesh.instanceMatrix.array[i * 16 + 14]].join(
              ',',
            ),
          ),
        ),
      )
      .sort();
  try {
    camera.position.set(74.5074, 2.44, 73.1907);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    a[0].update(camera, 1, focus);
    b[0].update(camera, 1);
    const walking = positions(a[0]),
      unobstructedPolicy = positions(b[0]);
    assert.ok(
      walking.length < unobstructedPolicy.length,
      'the canopy covering the walking camera must be hidden',
    );
    assert.ok(walking.every((p) => unobstructedPolicy.includes(p)));
    assert.deepEqual(positions(b[0]), unobstructedPolicy, 'one view cannot change another view');
    a[0].update(camera, 2, null);
    assert.deepEqual(
      positions(a[0]),
      unobstructedPolicy,
      'trees return when the sight line is cleared',
    );
  } finally {
    for (const f of [...a, ...b])
      for (const { mesh } of f.levels.flat()) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
  }
});
