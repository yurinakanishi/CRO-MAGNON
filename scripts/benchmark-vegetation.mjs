import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SCENERY, grassForChunk } from '../dist/shared/scenery-layout.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { terrainHeight } from '../dist/shared/terrain.mjs';
import { PlacementGrid } from '../dist/shared/spatial-grid.mjs';
import { LandscapeInstances } from '../dist/src/world-assets.js';

// Exercise the real placement update with real world placements, without loading
// textures or needing a GPU. This measures CPU work and requested buffer bytes,
// not FPS or GPU execution time. Empty meshes stand in only for the upload sinks.
export function landscapeFixtures(Type = LandscapeInstances) {
  const grassPlacement = (item) => ({
    ...item,
    position: new THREE.Vector3(item.x, terrainHeight(item.x, item.z) - 0.018, item.z),
    scale: new THREE.Vector3().setScalar(item.scale),
  });
  const specs = [
    {
      key: 'valley-pine',
      distances: [14, 38, 110],
      placements: SCENERY.trees
        .filter((p) => !p.surface)
        .map((p) => ({
          ...p,
          position: new THREE.Vector3(p.x, terrainHeight(p.x, p.z), p.z),
          scale: new THREE.Vector3(...p.scale),
        })),
    },
    {
      key: 'meadow-grass',
      distances: [1.1, 1.1, 28],
      foliage: true,
      placements: SCENERY.grass.filter((p) => (p.key ?? 'meadow-grass') === 'meadow-grass').map(grassPlacement),
      generateCell: (x, z) =>
        grassForChunk(x - WORLD.minX / 32, z - WORLD.minZ / 32)
          .filter((p) => !p.surface && p.key === 'meadow-grass')
          .map(grassPlacement),
    },
    {
      key: 'valley-boulder',
      distances: [28, 28, 110],
      placements: SCENERY.rocks
        .filter((p) => !p.surface)
        .map((p) => ({
          ...p,
          height: 1.7 * p.scale,
          position: new THREE.Vector3(p.x, terrainHeight(p.x, p.z), p.z),
          scale: new THREE.Vector3().setScalar(p.scale),
        })),
    },
  ];
  return specs.map((spec) => {
    const grid = new PlacementGrid(spec.placements);
    const capacity =
      grid.maximumNearby(spec.distances[2]) +
      (spec.generateCell ? 250 * (Math.ceil(spec.distances[2] / 32) * 2 + 2) ** 2 : 0);
    const landscape = Object.create(Type.prototype);
    const geometry = new THREE.BufferGeometry(),
      material = new THREE.MeshBasicMaterial();
    Object.assign(landscape, spec, {
      grid,
      nextUpdate: 0,
      generated: new Map(),
      castNearbyShadows: !spec.foliage,
      canopyOcclusion: spec.key === 'valley-pine',
      sightLine: new THREE.Line3(),
      sightPoint: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      composed: new THREE.Matrix4(),
      rotation: new THREE.Quaternion(),
      axis: new THREE.Vector3(0, 1, 0),
      sphere: new THREE.Sphere(),
      frustum: new THREE.Frustum(),
      projection: new THREE.Matrix4(),
      levels: Array.from({ length: 3 }, () => [
        { mesh: new THREE.InstancedMesh(geometry, material, capacity), local: new THREE.Matrix4() },
      ]),
    });
    return landscape;
  });
}

export function benchmark(Type) {
  return ['stationary', 'moving'].map((scenario) => {
    const results = [];
    for (let round = 0; round < 7; round++) {
      const fixtures = landscapeFixtures(Type),
        camera = new THREE.PerspectiveCamera(48, 1035 / 618, 0.1, 200);
      camera.position.set(47.23, 2.44, 62.4);
      camera.lookAt(48, 1.4, 57);
      camera.updateMatrixWorld(true);
      const meshes = fixtures.flatMap((f) => f.levels.flat().map((p) => p.mesh));
      let requestedBytes = 0,
        updates = 0,
        examined = 0;
      const started = performance.now();
      for (let tick = 0; tick < 300; tick++) {
        if (scenario === 'moving') {
          camera.position.set(47.23 + Math.sin(tick * 0.018) * 18, 2.44, 62.4 - tick * 0.08);
          camera.lookAt(48 + Math.sin(tick * 0.018) * 18, 1.4, 57 - tick * 0.08);
          camera.updateMatrixWorld(true);
        }
        for (const f of fixtures) {
          const version = f.levels[2][0].mesh.instanceMatrix.version;
          f.update(camera, tick * 0.2);
          if (f.levels[2][0].mesh.instanceMatrix.version !== version) {
            updates++;
            examined += f.examined;
          }
        }
        for (const mesh of meshes) {
          const attribute = mesh.instanceMatrix;
          if (attribute.version !== (attribute.userVersion ?? 0)) {
            requestedBytes += attribute.updateRanges.length
              ? attribute.updateRanges.reduce((sum, r) => sum + r.count * 4, 0)
              : attribute.array.byteLength;
            attribute.userVersion = attribute.version;
            attribute.clearUpdateRanges();
          }
        }
      }
      results.push({
        milliseconds: performance.now() - started,
        requestedBytes,
        updates,
        examined,
      });
      for (const mesh of meshes) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    results.sort((a, b) => a.milliseconds - b.milliseconds);
    return { scenario, ticks: 300, rounds: 7, ...results[3] };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = { current: benchmark(LandscapeInstances) };
  if (process.argv[2]) {
    const Original = (await import(pathToFileURL(resolve(process.argv[2])).href))
      .LandscapeInstances;
    result.baseline = benchmark(Original);
    const original = landscapeFixtures(Original),
      current = landscapeFixtures();
    const camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 200);
    for (let tick = 0; tick < 120; tick++) {
      camera.position.set(tick > 90 ? 1000 : 48 + Math.min(tick, 30) * 0.1, 3, tick > 90 ? 90 : 57);
      camera.rotation.y = tick > 60 ? 0.5 : 0;
      camera.fov = tick > 45 ? 65 : 48;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const focus = tick > 75 && tick < 85 ? new THREE.Vector3(50, 1, 52) : null;
      for (let i = 0; i < current.length; i++) {
        current[i].update(camera, tick * 0.2, focus);
        original[i].update(camera, tick * 0.2, focus);
        for (let level = 0; level < 3; level++) {
          const a = current[i].levels[level][0].mesh,
            b = original[i].levels[level][0].mesh;
          assert.equal(a.count, b.count);
          assert.deepEqual(
            a.instanceMatrix.array.slice(0, a.count * 16),
            b.instanceMatrix.array.slice(0, b.count * 16),
          );
        }
      }
    }
    result.equivalence = { views: 120, sameVisibleMatrices: true };
    for (const f of [...original, ...current])
      for (const { mesh } of f.levels.flat()) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
  }
  console.log(JSON.stringify(result, null, 2));
}
