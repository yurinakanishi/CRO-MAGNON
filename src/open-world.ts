import { isMesh } from './three-types.js';
import * as THREE from 'three';
import { WORLD } from '../shared/world.mjs';
import { BIOMES, biomeById, nearbyChunks } from '../shared/biomes.mjs';
import { installBiomeTerrain } from '../shared/terrain.mjs';
import { fitSourceRiverBank } from './source-surface-fit.js';
import { coastDistance } from '../shared/paleo-geography.mjs';

const RADIUS = 128,
  CAPACITY = 100;
import { createEarthTextures, earthTerrainMaterial, EarthOcean } from './paleo-materials.js';
const matrix = new THREE.Matrix4(),
  sphere = new THREE.Sphere();

export class OpenWorldTerrain {
  declare world: any;
  declare assets: any;
  declare root: THREE.Group<THREE.Object3DEventMap>;
  declare chunks: Map<any, any>;
  declare prepared: Map<any, any>;
  declare pending: Map<any, any>;
  declare lastUsed: Map<any, any>;
  declare batches: Map<any, any>;
  declare desired: any[];
  declare desiredKeys: Set<any>;
  declare nextPlan: number;
  declare nextCull: number;
  declare disposed: boolean;
  declare frustum: THREE.Frustum;
  declare projection: THREE.Matrix4;
  declare earthTextures:
    | {
        coast: THREE.DataTexture;
        biomes: THREE.DataTexture;
        dispose(): void;
      }
    | undefined;
  declare ocean: EarthOcean | undefined;
  declare surroundings: any[] | undefined;

  constructor(world) {
    this.world = world;
    this.assets = world.worldAssets;
    this.root = new THREE.Group();
    this.root.name = 'Streamed TRELLIS world';
    this.chunks = new Map();
    this.prepared = new Map();
    this.pending = new Map();
    this.lastUsed = new Map();
    this.batches = new Map();
    this.desired = [];
    this.desiredKeys = new Set();
    this.nextPlan = 0;
    this.nextCull = 0;
    this.disposed = false;
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.world.scene.add(this.root);
    world.terrain = this.root;
  }
  async initialize(position) {
    this.earthTextures = createEarthTextures();
    this.ocean = new EarthOcean(this.world, this.earthTextures, CAPACITY);
    const fields = Object.fromEntries(
      BIOMES.map((b) => [
        b.id,
        this.assets.catalog.assets.find((a) => a.modelKey === b.ground)?.placement?.heightField,
      ]),
    );
    this.world.releaseTerrainSampler = installBiomeTerrain(fields);
    this.plan(position.x, position.z, 0);
    await Promise.all([...this.pending.values()]);
    if (this.disposed) return;
    // The nearest floor exists before characters become visible; distant chunks
    // are then admitted in a bounded amount of work each frame.
    for (const chunk of this.desired.filter((c) => c.distance < 55)) this.admit(chunk);
  }
  plan(x, z, time) {
    this.surroundings = nearbyChunks(x, z, RADIUS);
    this.desired = this.surroundings.filter((c) => c.land);
    this.desiredKeys = new Set(this.desired.map((c) => c.key));
    if (this.desired.length > CAPACITY)
      throw new Error('Terrain working set exceeded its allocation');
    for (const [key, chunk] of this.chunks)
      if (!this.desiredKeys.has(key)) {
        this.removeChunk(chunk);
        this.chunks.delete(key);
      }
    for (const chunk of this.desired) {
      const key = biomeById(chunk.biome).ground;
      this.lastUsed.set(key, time);
      if (this.assets.templates.has(key) || this.pending.has(key)) continue;
      const promise = this.assets
        .ensureEnvironment(key)
        .then(() => {
          if (!this.disposed) this.world.updateAssetDiagnostics();
        })
        .catch((error) => {
          if (!this.disposed)
            this.world.failWorld(
              '地域の3D素材を読み込めませんでした。再読み込みしてください。',
              error,
            );
          throw error;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
      promise.catch(() => {});
    }
    for (const [key, last] of this.lastUsed)
      if (time - last > 12 && !this.pending.has(key)) {
        this.releasePrepared(key);
        this.assets.releaseEnvironment(key);
        this.lastUsed.delete(key);
        this.world.updateAssetDiagnostics();
      }
  }
  prepare(key) {
    if (this.prepared.has(key)) return this.prepared.get(key);
    const template = this.assets.get(key),
      biome = BIOMES.find((b) => b.ground === key),
      levels = [];
    for (const gltf of [template.gltf, ...template.lods]) {
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene),
        size = box.getSize(new THREE.Vector3()),
        centre = box.getCenter(new THREE.Vector3());
      gltf.scene.traverse((node) => {
        if (!isMesh(node)) return;
        const geometry = node.geometry
          .clone()
          .applyMatrix4(node.matrixWorld)
          .translate(-centre.x, -(template.asset.placement.surfaceHeightMetres ?? 0), -centre.z)
          .scale(32 / size.x, 1, 32 / size.z);
        geometry.computeBoundingSphere();
        geometry.setAttribute(
          'earthCoastal',
          new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1),
        );
        const material = earthTerrainMaterial(node.material, biome, this.earthTextures),
          mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        parts.push({ geometry, material, mesh });
      });
      levels.push(parts);
    }
    this.prepared.set(key, levels);
    return levels;
  }
  admit(chunk) {
    if (this.chunks.has(chunk.key)) return;
    const key = biomeById(chunk.biome).ground;
    if (!this.assets.templates.has(key)) return;
    const levels = this.prepare(key),
      bank = chunk.x + 16 >= 57 && chunk.x - 16 <= 73 && chunk.z + 16 >= -64 && chunk.z - 16 <= 184;
    const record = { ...chunk, assetKey: key, bankMeshes: [] };
    if (bank)
      for (const part of levels[0]) {
        const source = part.geometry.clone().rotateY(chunk.yaw).translate(chunk.x, 0, chunk.z);
        source.deleteAttribute('earthCoastal');
        const geometry = fitSourceRiverBank(source);
        if (source !== geometry) source.dispose();
        const mesh = new THREE.Mesh(geometry, part.material);
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        record.bankMeshes.push(mesh);
      }
    this.chunks.set(chunk.key, record);
  }
  update(camera, time) {
    if (this.disposed) return;
    if (time >= this.nextPlan) {
      this.plan(camera.position.x, camera.position.z, time);
      this.nextPlan = time + 0.3;
    }
    if (this.ocean) this.ocean.time.value = time;
    const started = performance.now();
    let admitted = 0;
    for (const chunk of this.desired)
      if (!this.chunks.has(chunk.key) && this.assets.templates.has(biomeById(chunk.biome).ground)) {
        this.admit(chunk);
        if (++admitted >= 2 || performance.now() - started > 3) break;
      }
    if (time < this.nextCull && !admitted) return;
    this.nextCull = time + 0.1;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.ocean?.update(
      this.surroundings.filter((c) => {
        sphere.center.set(c.x, -0.52, c.z);
        sphere.radius = 25;
        return coastDistance(c.x, c.z) < 26 && this.frustum.intersectsSphere(sphere);
      }),
      time,
    );
    for (const levels of this.prepared.values())
      for (const parts of levels) for (const part of parts) part.mesh.count = 0;
    let visible = 0;
    for (const chunk of this.chunks.values()) {
      sphere.center.set(chunk.x, 0, chunk.z);
      sphere.radius = 24;
      if (!this.frustum.intersectsSphere(sphere)) {
        for (const mesh of chunk.bankMeshes) mesh.visible = false;
        continue;
      }
      visible++;
      if (chunk.bankMeshes.length) {
        for (const mesh of chunk.bankMeshes) mesh.visible = true;
        continue;
      }
      const distance = Math.hypot(camera.position.x - chunk.x, camera.position.z - chunk.z),
        levels = this.prepared.get(chunk.assetKey);
      const level = Math.min(levels.length - 1, distance < 44 ? 0 : distance < 82 ? 1 : 2);
      matrix.makeRotationY(chunk.yaw).setPosition(chunk.x, 0, chunk.z);
      for (const part of levels[level]) {
        part.mesh.setMatrixAt(part.mesh.count, matrix);
        part.geometry?.attributes.earthCoastal?.setX(
          part.mesh.count,
          coastDistance(chunk.x, chunk.z) < 26 ? 1 : 0,
        );
        part.mesh.count++;
      }
    }
    for (const levels of this.prepared.values())
      for (const parts of levels)
        for (const part of parts) {
          part.mesh.instanceMatrix.needsUpdate = true;
          if (part.geometry?.attributes.earthCoastal)
            part.geometry.attributes.earthCoastal.needsUpdate = true;
          // InstancedMesh caches this on its first raycast. Streaming changes both
          // the count and positions, so the next ground click needs fresh bounds.
          part.mesh.boundingSphere = null;
          part.mesh.boundingBox = null;
        }
    Object.assign(this.world.canvas.dataset, {
      terrainChunks: String(this.chunks.size),
      terrainVisibleChunks: String(visible),
      terrainChunkLimit: String(CAPACITY),
      terrainRadius: String(RADIUS),
      terrainAssetTypes: String(this.prepared.size),
      terrainPending: String(this.pending.size),
    });
  }
  removeChunk(chunk) {
    for (const mesh of chunk.bankMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
  }
  releasePrepared(key) {
    const levels = this.prepared.get(key);
    if (!levels) return;
    for (const parts of levels)
      for (const part of parts) {
        this.root.remove(part.mesh);
        part.mesh.dispose();
        part.geometry.dispose();
        part.material.dispose();
      }
    this.prepared.delete(key);
  }
  dispose() {
    this.disposed = true;
    for (const chunk of this.chunks.values()) this.removeChunk(chunk);
    this.chunks.clear();
    for (const key of [...this.prepared.keys()]) this.releasePrepared(key);
    this.ocean?.dispose();
    this.earthTextures?.dispose();
    this.world.scene.remove(this.root);
  }
}
