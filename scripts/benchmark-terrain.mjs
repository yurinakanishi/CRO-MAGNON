// Real terrain selection/culling and coastal data; lightweight mesh sinks.
// Measures CPU and requested buffer bytes, excluding GPU time and initial allocation.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { OpenWorldTerrain } from '../dist/src/open-world.js';
import { EarthOcean } from '../dist/src/paleo-materials.js';
import { BIOMES } from '../dist/shared/biomes.mjs';

export function terrainFixture(Type = OpenWorldTerrain) {
  const assets = {
    templates: new Map(),
    get(key) {
      return this.templates.get(key);
    },
    releaseEnvironment() {},
  };
  const sources = [];
  for (const key of [...BIOMES.map((b) => b.ground), 'river-water']) {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    );
    sources.push(mesh);
    scene.add(mesh);
    assets.templates.set(key, {
      asset: { modelKey: key, placement: { surfaceHeightMetres: 0 } },
      gltf: { scene },
      lods: [{ scene }, { scene }],
    });
  }
  const world = {
    scene: new THREE.Scene(),
    worldAssets: assets,
    canvas: { dataset: {} },
    updateAssetDiagnostics() {},
  };
  const terrain = new Type(world, null); // Synchronous CPU fixture; browsers use the worker.
  const coast = new THREE.DataTexture(),
    biomes = new THREE.DataTexture();
  terrain.earthTextures = {
    coast,
    biomes,
    dispose() {
      coast.dispose();
      biomes.dispose();
    },
  };
  terrain.ocean = new EarthOcean(world, terrain.earthTextures, 100);
  const camera = new THREE.PerspectiveCamera(48, 1.6, 0.1, 250);
  camera.position.set(48, 12, 64);
  camera.lookAt(48, 0, 48);
  camera.updateMatrixWorld(true);
  terrain.plan(camera.position.x, camera.position.z, 0);
  for (const chunk of terrain.desired) terrain.admit(chunk);
  return {
    terrain,
    camera,
    dispose() {
      terrain.dispose();
      for (const mesh of sources) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}

export function buffers(terrain) {
  return [...terrain.prepared.values()]
    .flat(2)
    .flatMap((p) => [p.mesh.instanceMatrix, p.geometry.attributes.earthCoastal])
    .concat(terrain.ocean.parts.map((p) => p.mesh.instanceMatrix));
}

export function snapshot(terrain) {
  return {
    chunks: [...terrain.chunks.keys()],
    land: [...terrain.prepared].map(([key, levels]) => [
      key,
      levels.map((parts) =>
        parts.map((p) => ({
          count: p.mesh.count,
          matrices: Array.from(p.mesh.instanceMatrix.array.slice(0, p.mesh.count * 16)),
          coast: Array.from(p.geometry.attributes.earthCoastal.array.slice(0, p.mesh.count)),
        })),
      ),
    ]),
    ocean: terrain.ocean.parts.map((p) => ({
      count: p.mesh.count,
      matrices: Array.from(p.mesh.instanceMatrix.array.slice(0, p.mesh.count * 16)),
    })),
    banks: [...terrain.chunks.values()].map((c) => [c.key, c.bankMeshes.map((m) => m.visible)]),
  };
}

function position(camera, tick, moving) {
  if (moving) {
    camera.position.set(48 + Math.sin(tick * 0.035) * 24, 12, 64 - tick * 0.12);
    camera.lookAt(camera.position.x, 0, camera.position.z - 16);
    camera.updateMatrixWorld(true);
  }
}

export function benchmark(Type) {
  return [false, true].map((moving) => {
    const rounds = [];
    for (let round = 0; round < 8; round++) {
      const fixture = terrainFixture(Type),
        versions = new Map();
      let requestedBytes = 0,
        placementUpdates = 0;
      const started = performance.now();
      for (let tick = 0; tick < 300; tick++) {
        position(fixture.camera, tick, moving);
        fixture.terrain.update(fixture.camera, tick * 0.2);
        let changed = false;
        for (const attribute of buffers(fixture.terrain)) {
          if (attribute.version !== (versions.get(attribute) ?? 0)) {
            changed = true;
            requestedBytes += attribute.updateRanges.reduce(
              (sum, range) => sum + range.count * 4,
              0,
            );
            versions.set(attribute, attribute.version);
            attribute.clearUpdateRanges();
          }
        }
        if (changed) placementUpdates++;
      }
      rounds.push({ milliseconds: performance.now() - started, requestedBytes, placementUpdates });
      fixture.dispose();
    }
    const measured = rounds.slice(1).sort((a, b) => a.milliseconds - b.milliseconds);
    return { scenario: moving ? 'moving' : 'stationary', ticks: 300, rounds: 7, ...measured[3] };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = { current: benchmark(OpenWorldTerrain) };
  if (process.argv[2]) {
    const Original = (await import(pathToFileURL(resolve(process.argv[2])).href)).OpenWorldTerrain;
    result.baseline = benchmark(Original);
    const a = terrainFixture(),
      b = terrainFixture(Original);
    try {
      for (let tick = 0; tick < 180; tick++) {
        for (const f of [a, b]) {
          position(f.camera, tick, tick > 25);
          f.camera.fov = tick > 100 ? 65 : 48;
          f.camera.updateProjectionMatrix();
          f.terrain.update(f.camera, tick * 0.2);
        }
        assert.deepEqual(snapshot(a.terrain), snapshot(b.terrain), `view ${tick}`);
      }
      result.equivalentViews = 180;
    } finally {
      a.dispose();
      b.dispose();
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
