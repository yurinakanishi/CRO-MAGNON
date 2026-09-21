import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { measureCaveAisle } from '../scripts/measure-cave-length.mjs';
import { measureCaveRoom } from '../scripts/measure-cave-room.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  CAVE_MURAL_VIEW,
  caveWorldAt,
  caveCentreOffset,
} from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from '../dist/shared/camp-cave-surface.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
import { CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';

test('every exposed mountain triangle has matching ground, including former shoreline and steep flanks', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json'));
  const { scene } = await geometryScene(`public${asset.url}`);
  scene.updateMatrixWorld(true);
  let samples = 0,
    worst = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position,
      index = node.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const point = new THREE.Vector3();
      for (let j = 0; j < 3; j++)
        point.add(
          new THREE.Vector3()
            .fromBufferAttribute(p, index.getX(i + j))
            .applyMatrix4(node.matrixWorld),
        );
      point.multiplyScalar(1 / 3);
      if (point.y < 0.1) continue; // Buried skirts are not walking surfaces.
      const x = CAMP_MOUNTAIN.x - point.x,
        z = CAMP_MOUNTAIN.z - point.z;
      const error = Math.abs(mountainHeight(x, z) - point.y);
      worst = Math.max(worst, error);
      samples++;
      assert.ok(error < 0.12, `terrain mismatch ${x},${z}: ${error}`);
    }
  });
  assert.ok(samples > 150000);
  assert.ok(worst < 0.12);
});

test('the extended chamber doubles the measured aisle and keeps paintings in its deep half', async (t) => {
  const old = await geometryScene('public/models/camp-cave/model-r07.glb');
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const next = await geometryScene(`public${asset.url}`);
  const a = new THREE.Box3().setFromObject(old.scene),
    b = new THREE.Box3().setFromObject(next.scene);
  assert.ok(Math.abs(b.max.z - a.max.z) < 0.001, 'entrance moved');
  assert.ok((b.max.z - b.min.z) / (a.max.z - a.min.z) > 1.5);
  const before = measureCaveAisle(old.scene),
    after = measureCaveAisle(next.scene, caveCentreOffset),
    ratio = after.lengthMetres / before.lengthMetres;
  assert.ok(ratio > 1.95 && ratio < 2.15, `walkable length ratio ${ratio}`);
  t.diagnostic(
    `Measured aisle: ${before.lengthMetres.toFixed(2)} m → ${after.lengthMetres.toFixed(2)} m`,
  );
  assert.ok(CAVE_MURAL_VIEW.z - 107 > 40);
  const first = caveWorldAt(16);
  let previous = walkHeight(first.x, first.z);
  for (let localZ = 15.9; localZ >= -31.5; localZ -= 0.1) {
    const p = caveWorldAt(localZ);
    assert.ok(CAMP_CAVE_SURFACE.free(p.x, p.z, 0.76), `blocked interior ${localZ}`);
    const h = walkHeight(p.x, p.z);
    assert.ok(Math.abs(h - previous) < 0.08, `floor discontinuity ${localZ}`);
    assert.ok(Math.abs(h - CAMP_CAVE.elevation) < 0.65);
    previous = h;
  }
  const end = caveWorldAt(-33.5);
  assert.equal(CAMP_CAVE_SURFACE.free(end.x, end.z, 0.32), false);
  for (const mural of CAVE_MURALS) {
    const entranceEdge = mural.centre + mural.width / 2,
      nearest = after.samples.find((s) => s.z <= entranceEdge);
    assert.ok(nearest.distance > after.lengthMetres / 2, `${mural.motif} crosses the midpoint`);
  }
  const cat = CAVE_MURALS.find((m) => m.motif === 'cat'),
    creature = CAVE_MURALS.find((m) => m.motif === 'creature524');
  assert.equal(cat.wall, 'east');
  assert.equal(creature.wall, 'west');
  assert.ok(Math.abs(cat.centre - creature.centre) > 4);
});

test('both animal galleries retain a broad room and full standing height all the way to the back', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const { scene } = await geometryScene(`public${asset.url}`);
  const room = measureCaveRoom(scene);
  assert.ok(room.minWidth >= 10.5, `gallery narrows to ${room.minWidth} m`);
  assert.ok(room.minHeadroom >= 4.5, `gallery roof descends to ${room.minHeadroom} m`);
  for (const section of room.records) {
    assert.ok(section.heights[1].headroom > 5.35);
    for (const across of [-3.5, 0, 3.5]) {
      const p = caveWorldAt(section.z, across);
      assert.ok(CAMP_CAVE_SURFACE.free(p.x, p.z, 0.76), `blocked gallery ${section.z},${across}`);
    }
  }
  const animals = ['redHorse', 'ochreHorse', 'mammoth', 'bison', 'deer'];
  for (const wall of ['east', 'west']) {
    const paintings = CAVE_MURALS.filter((m) => m.wall === wall);
    assert.deepEqual(
      paintings
        .filter((m) => animals.includes(m.motif))
        .map((m) => m.motif)
        .sort(),
      [...animals].sort(),
    );
    const character = paintings.find((m) => m.motif === (wall === 'east' ? 'cat' : 'creature524'));
    assert.ok(paintings.some((m) => animals.includes(m.motif) && m.centre > character.centre));
    assert.ok(paintings.some((m) => animals.includes(m.motif) && m.centre < character.centre));
  }
});

test('the blind end shares closed seam edges with the delivered original cave walls', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const { scene } = await geometryScene(`public${asset.url}`);
  scene.updateMatrixWorld(true);
  const edges = new Map();
  scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position,
      index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const points = [0, 1, 2].map((j) =>
        new THREE.Vector3()
          .fromBufferAttribute(positions, index.getX(i + j))
          .applyMatrix4(mesh.matrixWorld),
      );
      for (let j = 0; j < 3; j++) {
        const a = points[j],
          b = points[(j + 1) % 3];
        if (Math.abs(a.z + 24.5) > 0.00001 || Math.abs(b.z + 24.5) > 0.00001) continue;
        if (a.distanceTo(b) < 0.00001) continue;
        const key = [a, b]
          .map((p) =>
            p
              .toArray()
              .map((v) => v.toFixed(5))
              .join(','),
          )
          .sort()
          .join('/');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  });
  assert.ok(edges.size > 600, 'the source cross-section must be reused along all three rock skins');
  assert.ok(
    [...edges.values()].every((count) => count === 2),
    'each seam edge must connect exactly two faces',
  );
});

test('the actual rock arch stays at the original entrance, ahead of the mountain face', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const scenes = await Promise.all(
    ['public/models/camp-cave/model-r07.glb', `public${asset.url}`].map(async (file) => {
      const { scene } = await geometryScene(file);
      scene.updateMatrixWorld(true);
      scene.traverse((node) => {
        if (node.isMesh)
          for (const material of [node.material].flat()) material.side = THREE.DoubleSide;
      });
      return scene;
    }),
  );
  const ray = new THREE.Raycaster();
  // The open apron alone cannot establish where the doorway is. Measure the
  // actual overhang across the mouth, where rising terrain must be covered.
  for (const z of [9.2, 9.4, 9.6]) {
    for (const x of [-2, -1, 0, 1, 2]) {
      ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
      const [before, after] = scenes.map((scene) => ray.intersectObject(scene, true)[0]?.point.y);
      assert.ok(before > 6, `missing reference arch at ${x},${z}`);
      // Triangles touching the smooth inner transition differ by up to a few
      // millimetres; the former error removed the entire 7 m-high rock arch.
      assert.ok(Math.abs(after - before) < 0.005, `arch moved behind the hill at ${x},${z}`);
    }
  }
});
