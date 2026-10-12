// The third-person camera keeps out of models (2026-10-12): a sphere as large as the near
// plane's reach is swept instead of a ray, boxes grow by it, trees and bushes the sight would
// cross are hidden instead, the mountain's hillside counts where its shader draws it, and the
// player's own actor fades as the camera comes close.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { MeshRayGrid, nearPlaneReach, sweepTriangle } from '../dist/src/mesh-ray-grid.js';
import { CROWN_BAND, crownProfile, segmentNearTree } from '../dist/src/tree-sight.js';
import { mountainCaveClipped } from '../dist/src/mountain-materials.js';
import { ActorFade, actorDistance } from '../dist/src/camera-fade.js';
import { skinnedDistance } from '../dist/src/skinned-bounds.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  CAVE_BEND,
  caveCentreOffset,
} from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE_DATA as cave } from '../dist/shared/camp-cave-surface-data.mjs';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { landscapeFixtures } from '../scripts/benchmark-vegetation.mjs';

let seed = 20261012;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const randomUnit = () =>
  new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
const triangle = new THREE.Triangle(),
  closest = new THREE.Vector3();
const distanceTo = (point, a, b, c) =>
  triangle.set(a, b, c).closestPointToPoint(point, closest).distanceTo(point);

/** The first distance along the path at which the sphere reaches the triangle, stepping. */
function steppedContact(origin, direction, radius, a, b, c, maximum, step) {
  const r = Math.min(radius, distanceTo(origin, a, b, c) - 1e-4);
  if (r <= 0) return Infinity;
  const point = new THREE.Vector3();
  for (let t = 0; t <= maximum; t += step)
    if (distanceTo(point.copy(origin).addScaledVector(direction, t), a, b, c) <= r) return t;
  return Infinity;
}

test('a swept sphere meets a triangle where a fine stepped search finds the contact', () => {
  let contacts = 0,
    overlapping = 0;
  for (let i = 0; i < 1500; i++) {
    const a = randomUnit().multiplyScalar(2),
      b = randomUnit().multiplyScalar(2),
      c = randomUnit().multiplyScalar(2),
      origin = randomUnit().multiplyScalar(1 + random() * 2),
      radius = 0.05 + random() * 0.45;
    // Half the sweeps head about for the triangle, half anywhere.
    const direction =
      i % 2
        ? randomUnit()
        : new THREE.Vector3()
            .addVectors(a, b)
            .add(c)
            .divideScalar(3)
            .sub(origin)
            .normalize()
            .add(randomUnit().multiplyScalar(0.3))
            .normalize();
    if (distanceTo(origin, a, b, c) < radius) overlapping++;
    const swept = sweepTriangle(origin, direction, radius, a, b, c),
      stepped = steppedContact(origin, direction, radius, a, b, c, 6, 0.002);
    if (stepped === Infinity) assert.ok(swept > 6 - 0.002, `${i}: no contact within 6 m`);
    else {
      contacts++;
      assert.ok(Math.abs(swept - stepped) <= 0.0021, `${i}: ${swept} vs ${stepped}`);
    }
  }
  assert.ok(contacts > 500, `contacts ${contacts}`);
  assert.ok(overlapping > 50, `starts within the radius ${overlapping}`);
});

test('a sphere already near a triangle keeps that clearance instead of stopping at once', () => {
  const a = new THREE.Vector3(-5, 0, -5),
    b = new THREE.Vector3(5, 0, -5),
    c = new THREE.Vector3(0, 0, 5),
    origin = new THREE.Vector3(0, 0.1, 0);
  // Along the face, 0.1 m above it, with a 0.3 m sphere: no contact.
  assert.equal(sweepTriangle(origin, new THREE.Vector3(1, 0, 0), 0.3, a, b, c), Infinity);
  // Away from it: none.
  assert.equal(sweepTriangle(origin, new THREE.Vector3(0, 1, 0), 0.3, a, b, c), Infinity);
  // Into it: at once.
  assert.ok(sweepTriangle(origin, new THREE.Vector3(0, -1, 0), 0.3, a, b, c) < 1e-3);
});

async function placed(key, place) {
  const { url } = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const { scene } = await geometryScene(`public${url}`);
  scene.position.set(place.x, place.elevation ?? 0, place.z);
  scene.rotation.y = place.yaw;
  scene.scale.setScalar(place.scale);
  return scene;
}

test('the cave grid sweeps and measures clearance exactly as all its triangles do', async () => {
  const grid = new MeshRayGrid(await placed('camp-cave', CAMP_CAVE));
  const count = grid.vertices.length / 9,
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const corner = (id, v, k) => v.fromArray(grid.vertices, id * 9 + k * 3);
  let stopped = 0;
  for (let i = 0; i < 60; i++) {
    // Origins along the cave's bent floor at head height, swept every way.
    const depth = 8 - random() * 70,
      origin = new THREE.Vector3(
        CAMP_CAVE.x - caveCentreOffset(depth) - (random() - 0.5) * 6,
        0.4 + random() * 2,
        CAMP_CAVE.z - depth,
      ),
      direction = randomUnit(),
      radius = 0.26;
    let clear = radius,
      expected = 6;
    for (let id = 0; id < count; id++)
      clear = Math.min(
        clear,
        distanceTo(origin, corner(id, a, 0), corner(id, b, 1), corner(id, c, 2)),
      );
    assert.ok(Math.abs(grid.clearance(origin, radius) - clear) < 1e-9, `clearance ${i}`);
    const r = Math.max(1e-6, Math.min(radius, clear - 1e-3));
    for (let id = 0; id < count; id++)
      expected = Math.min(
        expected,
        sweepTriangle(origin, direction, r, corner(id, a, 0), corner(id, b, 1), corner(id, c, 2)),
      );
    const swept = grid.sweep(origin, direction, 6, radius);
    assert.equal(swept, expected, `sweep ${i}`);
    if (expected < 6) stopped++;
  }
  assert.ok(stopped > 15, `walls met ${stopped}`);
});

test('a grid built with a filter keeps only the triangles it accepts', () => {
  const geometry = new THREE.PlaneGeometry(8, 8, 8, 8).rotateX(-Math.PI / 2),
    mesh = new THREE.Mesh(geometry);
  mesh.position.set(10, 2, -3);
  const all = new MeshRayGrid(mesh),
    east = new MeshRayGrid(mesh, 2, (a, b, c) => a.x >= 0 && b.x >= 0 && c.x >= 0);
  assert.equal(all.vertices.length / 9, 128);
  assert.equal(east.vertices.length / 9, 64);
  for (let i = 0; i < east.vertices.length; i += 3) assert.ok(east.vertices[i] >= 10);
  const down = new THREE.Vector3(0, -1, 0);
  assert.ok(east.sweep(new THREE.Vector3(12, 5, -3), down, 6, 0.2) < 3);
  assert.equal(east.sweep(new THREE.Vector3(8, 5, -3), down, 6, 0.2), 6);
});

test('the swept radius reaches past every corner of the near plane', () => {
  for (const [fov, aspect, near] of [
    [57, 1.6, 0.15],
    [57, 0.46, 0.15],
    [70, 2.2, 0.15],
    [62, 1, 0.08],
  ]) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, 360);
    camera.updateProjectionMatrix();
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const corner = new THREE.Vector3(x, y, -1).applyMatrix4(camera.projectionMatrixInverse);
      assert.ok(corner.length() <= nearPlaneReach(camera) - 0.05 + 1e-9);
      assert.ok(corner.length() > nearPlaneReach(camera) - 0.05 - 1e-6);
    }
  }
});

test('the camera passes trees, stops a sphere short of rocks and is never pinned by them', () => {
  const box = (id, x, z, extra = {}) => ({
    id,
    type: 'box',
    x,
    z,
    hx: 1,
    hz: 0.5,
    c: 1,
    s: 0,
    height: 2,
    groundY: 0,
    ...extra,
  });
  const world = new CollisionWorld(
    [box('valley-boulder', 5, 0), box('valley-pine', -5, 0, { cameraPassable: true })],
    { coast: false, walkSurfaces: [] },
  );
  const origin = { x: 0, y: 1, z: 0 },
    east = { x: 1, y: 0, z: 0 },
    west = { x: -1, y: 0, z: 0 };
  assert.ok(Math.abs(world.cameraDistance(origin, east, 8, 0.3) - 3.7) < 1e-9);
  assert.equal(world.cameraDistance(origin, west, 8, 0.3), 8, 'a tree trunk is passed');
  // Pressed to the rock's corner, inside the square of its grown box: stopped only toward it.
  const corner = { x: 5 + 1 + 0.2, y: 1, z: 0.5 + 0.2 };
  assert.equal(world.cameraDistance(corner, { x: 1, y: 0, z: 0 }, 8, 0.3), 8);
  assert.equal(world.cameraDistance(corner, { x: 0, y: 0, z: 1 }, 8, 0.3), 8);
  assert.equal(world.cameraDistance(corner, { x: -1, y: 0, z: 0 }, 8, 0.3), 8, 'passes beside');
  const inward = { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 };
  assert.ok(world.cameraDistance(corner, inward, 8, 0.3) < 0.02);
  // Inside a misfit footprint the box is ignored.
  assert.equal(world.cameraDistance({ x: 5, y: 1, z: 0 }, east, 8, 0.3), 8);
});

test('the spruce crown profile holds every delivered vertex and the fixture profile', async () => {
  const asset = JSON.parse(await readFile('public/models/valley-pine/asset.json', 'utf8'));
  for (const url of [asset.url, ...asset.lods.map((lod) => lod.url)]) {
    const { scene } = await geometryScene(`public${url}`);
    const profile = crownProfile(scene),
      v = new THREE.Vector3();
    scene.traverse((node) => {
      if (!node.isMesh) return;
      const position = node.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
        const band = Math.max(0, Math.floor(v.y / CROWN_BAND));
        assert.ok(Math.hypot(v.x, v.z) <= profile[band] + 1e-6);
      }
    });
    if (url === asset.url) {
      // The vegetation fixtures (scripts/benchmark-vegetation.mjs) stand in with these values.
      const fixture = landscapeFixtures()[0].crown;
      assert.equal(fixture.length, profile.length);
      for (let k = 0; k < profile.length; k++) assert.ok(Math.abs(fixture[k] - profile[k]) < 0.01);
    }
  }
});

test('a sight inside the spruce skirt hides the tree, which the old canopy sphere missed', () => {
  const profile = landscapeFixtures()[0].crown,
    widest = Math.max(...profile),
    tree = { position: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1) };
  const eye = new THREE.Vector3(1.2, 2.4, 0),
    focus = new THREE.Vector3(5.5, 1.4, 0);
  assert.equal(segmentNearTree(profile, widest, tree, eye, focus), true);
  // The 2026-09-14 test: a sphere at 65% of the height, 0.34 h + 0.5 wide, around the sight.
  const centre = new THREE.Vector3(0, 6.5, 0),
    point = new THREE.Line3(eye, focus).closestPointToPoint(centre, true, new THREE.Vector3());
  assert.ok(point.distanceTo(centre) > 0.34 * 10 + 0.5, 'the old test kept this tree drawn');
  // Clear of the crown: drawn.
  assert.equal(
    segmentNearTree(
      profile,
      widest,
      tree,
      new THREE.Vector3(3, 2.4, 3),
      new THREE.Vector3(8, 1.4, 3),
    ),
    false,
  );
  // Over the top, beyond the margin: drawn.
  assert.equal(
    segmentNearTree(
      profile,
      widest,
      tree,
      new THREE.Vector3(-3, 11, 0),
      new THREE.Vector3(3, 11, 0),
    ),
    false,
  );
  // A scaled tree: its skirt reaches 1.98 * 1.3 m.
  const big = { position: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1.3, 1.2, 1.3) };
  assert.equal(
    segmentNearTree(
      profile,
      widest,
      big,
      new THREE.Vector3(2.4, 3.2, 0),
      new THREE.Vector3(7, 1.4, 0),
    ),
    true,
  );
});

test('a tree the camera turns into is hidden on that frame, not at the next rebuild', () => {
  const fixtures = landscapeFixtures(),
    [pines] = fixtures,
    camera = new THREE.PerspectiveCamera(57, 1.6, 0.15, 360);
  const tree = pines.placements.find((p) => p.scale.y > 1.1);
  const base = tree.position;
  const focus = new THREE.Vector3(base.x + 4, base.y + 1.4, base.z);
  const drawn = () =>
    pines.levels
      .flatMap((parts) => parts.slice(0, 1))
      .some(({ mesh }) =>
        Array.from(
          { length: mesh.count },
          (_, i) =>
            Math.abs(mesh.instanceMatrix.array[i * 16 + 12] - base.x) < 1e-4 &&
            Math.abs(mesh.instanceMatrix.array[i * 16 + 14] - base.z) < 1e-4,
        ).some(Boolean),
      );
  try {
    camera.position.set(base.x + 9, base.y + 2.4, base.z);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    pines.update(camera, 1, focus);
    assert.equal(drawn(), true, 'drawn while the sight is clear');
    // 10 ms later, well inside the 0.18 s rebuild interval, the camera swings into the skirt.
    camera.position.set(base.x + 1.3, base.y + 2.4, base.z);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    pines.update(camera, 1.01, focus);
    assert.equal(drawn(), false, 'hidden on the frame the camera enters it');
  } finally {
    for (const f of fixtures)
      for (const { mesh } of f.levels.flat()) {
        mesh.dispose();
        mesh.geometry.dispose();
      }
  }
});

test('the mountain is discarded only inside the cave envelope, below its measured roof', () => {
  let clipped = 0,
    kept = 0;
  for (let iz = 0; iz < cave.nz; iz += 3)
    for (let ix = 0; ix < cave.nx; ix += 3) {
      const roof = cave.roofs[iz * cave.nx + ix];
      // Texel centres sample the measured roof exactly.
      const localX = cave.minX + (ix + 0.5) * cave.step,
        localZ = cave.minZ + (iz + 0.5) * cave.step;
      const x = CAMP_MOUNTAIN.x - (CAMP_CAVE.x - localX),
        z = CAMP_MOUNTAIN.z - (CAMP_CAVE.z - localZ),
        bend = Math.min(Math.max(-localZ / CAVE_BEND.depth, 0), 1),
        centre = CAVE_BEND.offset * bend * bend * (3 - 2 * bend),
        floor = CAMP_CAVE.elevation + CAMP_CAVE.groundOffset;
      const inside = Math.abs(localX - centre) < 5.9 && roof > 1.4;
      const below = mountainCaveClipped(x, floor + roof - 0.25, z),
        above = mountainCaveClipped(x, floor + roof - 0.05, z);
      assert.equal(above, false, 'the hill above the roof is drawn');
      if (inside) {
        assert.equal(below, true, `discarded under the roof at ${ix},${iz}`);
        clipped++;
      } else if (Math.abs(localX - centre) > 6.7 || roof < 1.2) {
        assert.equal(below, false, `drawn outside the envelope at ${ix},${iz}`);
        kept++;
      }
    }
  assert.ok(clipped > 200 && kept > 200, `${clipped} discarded, ${kept} drawn`);
  // Beyond the measured roofs, nothing is discarded.
  assert.equal(mountainCaveClipped(CAMP_MOUNTAIN.x - 200, -5, CAMP_MOUNTAIN.z), false);
});

test('a fade dithers its own copies, spares the actors sharing them and gives them back', () => {
  const shared = new THREE.MeshStandardMaterial({ color: 0x886644 }),
    accent = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8 }),
    hook = () => {};
  shared.onBeforeCompile = hook;
  const actor = new THREE.Group(),
    other = new THREE.Mesh(new THREE.BoxGeometry(), shared),
    body = new THREE.Mesh(new THREE.BoxGeometry(), shared),
    parts = new THREE.Mesh(new THREE.BoxGeometry(), [shared, accent]);
  actor.add(body, parts);
  const fade = new ActorFade([actor]);
  // Before its dithered programs are linked, the actor is shown or not drawn, never dithered.
  fade.set(0.6);
  assert.equal(body.material, shared);
  fade.set(0.4);
  assert.equal(body.material.visible, false);
  assert.equal(fade.opacity, 0);
  fade.ready = true; // As prepare() leaves it once the renderer has linked the programs.
  fade.set(0.5);
  assert.notEqual(body.material, shared);
  assert.equal(body.material.alphaHash, true);
  assert.equal(body.material.opacity, 0.5);
  assert.equal(body.material.onBeforeCompile, hook, 'program hooks are kept');
  assert.equal(parts.material[1].opacity, 0.4);
  assert.equal(parts.material[0], body.material, 'one copy per shared material');
  assert.equal(other.material, shared);
  assert.equal(shared.opacity, 1);
  assert.equal(shared.alphaHash, false);
  fade.set(0);
  assert.equal(body.material.visible, false, 'not drawn at all');
  // An actor LOD gives the mesh another material while it is faded.
  const reduced = new THREE.MeshStandardMaterial();
  body.material = reduced;
  fade.set(0.3);
  assert.equal(body.material.alphaHash, true);
  assert.notEqual(body.material, reduced);
  const disposed = [];
  for (const m of [parts.material[0], body.material])
    m.addEventListener('dispose', () => disposed.push(m));
  fade.set(1);
  assert.equal(body.material, reduced);
  assert.equal(parts.material[0], shared);
  assert.equal(parts.material[1], accent);
  fade.dispose();
  assert.equal(disposed.length, 2);
});

test('the distance to a posed skinned actor never exceeds the distance to its vertices', () => {
  const geometry = new THREE.BoxGeometry(0.4, 2, 0.3, 2, 10, 2).translate(0, 1, 0);
  const position = geometry.attributes.position,
    indices = [],
    weights = [];
  // A rigid skin: each vertex follows one bone.
  for (let i = 0; i < position.count; i++) {
    indices.push(position.getY(i) > 1 ? 1 : 0, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const hip = new THREE.Bone(),
    knee = new THREE.Bone();
  knee.position.y = 1;
  hip.add(knee);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(hip);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hip, knee]));
  const actor = new THREE.Group().add(mesh);
  actor.position.set(3, 0.5, -2);
  actor.rotation.y = 0.7;
  knee.rotation.z = 1.1;
  actor.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < 300; i++) {
    const point = new THREE.Vector3(3, 1, -2).add(randomUnit().multiplyScalar(random() * 3));
    let nearest = Infinity;
    for (let v = 0; v < position.count; v++)
      nearest = Math.min(
        nearest,
        mesh.getVertexPosition(v, vertex).applyMatrix4(mesh.matrixWorld).distanceTo(point),
      );
    const boxes = skinnedDistance(mesh, point);
    assert.ok(boxes <= nearest + 1e-6, `${boxes} > ${nearest}`);
    assert.ok(boxes >= nearest - 1, 'the bone boxes stay near the surface');
    assert.equal(actorDistance([actor], point), Math.max(0, boxes));
  }
});
