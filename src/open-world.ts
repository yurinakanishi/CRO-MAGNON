import { isMesh } from './three-types.js';
import { markActiveInstances, markActiveAttribute } from './instance-updates.js';
import * as THREE from 'three';
import { WORLD } from '../shared/world.mjs';
import { BIOMES, biomeById, nearbyChunks } from '../shared/biomes.mjs';
import { installBiomeTerrain } from '../shared/terrain.mjs';
import { fitSourceRiverBank } from './source-surface-fit.js';
import { coastTextureData } from '../shared/paleo-geography.mjs';
import { ViewUpdateGate } from './view-update-gate.js';
import { RiverBankBuilder } from './river-bank-builder.js';
import { mountainRiverIntersects } from '../shared/mountain-river.mjs';
import { LoadDemand, isLoadCancelled, type LoadTicket } from './asset-load-queue.js';
import { STARTUP, criticalFloorKeys, terrainPriority } from './startup-plan.js';

const RADIUS = 128,
  CAPACITY = 100,
  // A requested ground stays wanted until its biome is this much farther than
  // the planning radius, so walking along a border does not cancel and repeat it.
  RETAIN_MARGIN = 32;
import {
  COAST_TREATMENT_METRES,
  createEarthTextures,
  earthTerrainMaterial,
  EarthOcean,
  OCEAN_SURFACE_Y,
} from './paleo-materials.js';
const matrix = new THREE.Matrix4(),
  sphere = new THREE.Sphere();
// Whether a chunk's tile needs the ground's coast treatment (clipped at sea, lowered within 4 m,
// beach within COAST_TREATMENT_METRES): its ground instance is then shaded with the coast field
// (earthCoastal) and it gets an ocean tile. The field is bilinear between its grid values, so
// every sample over the tile is a convex combination of the values of the cells it overlaps; when
// all of them lie COAST_TREATMENT_METRES or more inland, the plain shading is exactly the coastal
// one. The field is not Lipschitz everywhere (the measured Earth grid stops at open water), so a
// centre far inland does not by itself keep a tile clear of the sea.
const coast = coastTextureData(),
  // The field's encoding, (byte - 128) / 4 metres (shared/paleo-geography.mts).
  inlandByte = 128 + 4 * COAST_TREATMENT_METRES;
const coastIndex = (position, origin, count) =>
  Math.min(count - 1, Math.max(0, Math.floor((position - origin) / coast.cell - 0.5)));
export function coastalChunk(chunk) {
  const half = WORLD.chunkSize / 2,
    x0 = coastIndex(chunk.x - half, coast.minX, coast.width),
    x1 = Math.min(coast.width - 1, coastIndex(chunk.x + half, coast.minX, coast.width) + 1),
    z0 = coastIndex(chunk.z - half, coast.minZ, coast.height),
    z1 = Math.min(coast.height - 1, coastIndex(chunk.z + half, coast.minZ, coast.height) + 1);
  for (let z = z0; z <= z1; z++)
    for (let x = x0, row = z * coast.width; x <= x1; x++)
      if (coast.data[row + x] < inlandByte) return true;
  return false;
}

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
  private readonly viewGate = new ViewUpdateGate(0.1);
  private cullDirty = true;
  private cullUpdates = 0;
  private uploadBytes = 0;
  private planX = NaN;
  private planZ = NaN;
  private bankJobs = new Map<string, Promise<void>>();
  /** Ground requests by key, prioritized by the nearest desired chunk. */
  readonly demand = new LoadDemand();
  /** Nearest land chunk per ground key within the retain radius. */
  private retained = new Map<string, number>();
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

  constructor(
    world,
    private bankBuilder: RiverBankBuilder | null = new RiverBankBuilder(),
  ) {
    this.world = world;
    this.assets = world.worldAssets;
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    this.root.name = 'Streamed TRELLIS world';
    this.chunks = new Map();
    this.prepared = new Map();
    this.pending = new Map();
    this.lastUsed = new Map();
    this.batches = new Map();
    this.desired = [];
    this.desiredKeys = new Set();
    this.nextPlan = 0;
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
    await this.arrive(position);
  }
  /** Plan around an arrival point and hold until its floor exists: only the
   * ground within STARTUP.floorRadius is awaited, and the nearest chunks are
   * admitted before characters become visible. Farther ground keeps loading
   * nearest first and is admitted in a bounded amount of work each frame. */
  async arrive(position, time = 0) {
    this.plan(position.x, position.z, time);
    const floor = criticalFloorKeys(
      this.desired.map((chunk) => ({ ...chunk, ground: biomeById(chunk.biome).ground })),
    );
    await Promise.all(floor.map((key) => this.pending.get(key)));
    if (this.disposed) return;
    const missing = floor.filter((key) => !this.assets.templates.has(key));
    if (missing.length) throw new Error(`Missing verified terrain floor ${missing.join(', ')}`);
    for (const chunk of this.desired.filter((c) => c.distance < STARTUP.admitRadius))
      this.admit(chunk);
    await Promise.all(this.bankJobs.values());
  }
  plan(x, z, time) {
    if (x !== this.planX || z !== this.planZ) {
      this.planX = x;
      this.planZ = z;
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
      this.retained.clear();
      for (const chunk of nearbyChunks(x, z, RADIUS + RETAIN_MARGIN)) {
        if (!chunk.land) continue;
        const key = biomeById(chunk.biome).ground;
        this.retained.set(key, Math.min(this.retained.get(key) ?? Infinity, chunk.distance));
      }
    }
    // Retain request retries, usage timestamps and eviction while stationary.
    // Requests follow the nearest desired chunk of each ground: the local floor
    // first, then the visible band, then fogged ground.
    const wanted = new Map<string, number>();
    for (const chunk of this.desired) {
      const key = biomeById(chunk.biome).ground;
      this.lastUsed.set(key, time);
      if (this.assets.templates.has(key)) continue;
      wanted.set(key, Math.min(wanted.get(key) ?? Infinity, terrainPriority(chunk.distance)));
    }
    for (const key of this.demand.keys())
      if (!wanted.has(key) && this.retained.has(key) && !this.assets.templates.has(key))
        wanted.set(key, terrainPriority(this.retained.get(key)));
    // A ground leaving the retained area is withdrawn: its queued load is cancelled.
    this.demand.update(wanted, (key, ticket) => this.request(key, ticket));
    this.assets.loadQueue?.pump();
    for (const [key, last] of this.lastUsed)
      if (time - last > 12 && !this.pending.has(key)) {
        this.releasePrepared(key);
        this.assets.releaseEnvironment(key);
        this.lastUsed.delete(key);
        this.world.updateAssetDiagnostics();
      }
  }
  private request(key: string, ticket: LoadTicket) {
    const promise = this.assets
      .ensureEnvironment(key, ticket)
      .then(() => {
        if (!this.disposed) this.world.updateAssetDiagnostics();
      })
      .catch((error) => {
        // Ground withdrawn after travel is not an asset failure; a needed one is.
        if (isLoadCancelled(error)) return;
        if (!this.disposed)
          this.world.failWorld(
            '地域の3D素材を読み込めませんでした。再読み込みしてください。',
            error,
          );
        throw error;
      })
      .finally(() => {
        this.demand.settle(key, ticket);
        // A newer request for the same ground keeps its own entry.
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    promise.catch(() => {});
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
    if (this.disposed || this.chunks.has(chunk.key) || this.bankJobs.has(chunk.key)) return;
    const key = biomeById(chunk.biome).ground;
    if (!this.assets.templates.has(key)) return;
    const levels = this.prepare(key),
      bank =
        (chunk.x + 16 >= 57 && chunk.x - 16 <= 73 && chunk.z + 16 >= -64 && chunk.z - 16 <= 184) ||
        mountainRiverIntersects(chunk.x - 16, chunk.x + 16, chunk.z - 16, chunk.z + 16);
    const record = { ...chunk, assetKey: key, bankMeshes: [] };
    if (bank && this.bankBuilder) {
      const jobs = levels[0].map((part) => {
        const source = part.geometry.clone().rotateY(chunk.yaw).translate(chunk.x, 0, chunk.z);
        source.deleteAttribute('earthCoastal');
        return this.bankBuilder.build(source);
      });
      const job = Promise.allSettled(jobs)
        .then((results) => {
          const failed = results.find((r) => r.status === 'rejected');
          if (
            failed ||
            this.disposed ||
            !this.desiredKeys.has(chunk.key) ||
            this.prepared.get(key) !== levels
          ) {
            for (const r of results) if (r.status === 'fulfilled') r.value.dispose();
            if (failed && !this.disposed) throw failed.reason;
            return;
          }
          for (const [i, result] of results.entries()) {
            if (result.status !== 'fulfilled') continue;
            const mesh = new THREE.Mesh(result.value, levels[0][i].material);
            mesh.matrixAutoUpdate = false;
            mesh.receiveShadow = true;
            this.root.add(mesh);
            record.bankMeshes.push(mesh);
          }
          this.chunks.set(chunk.key, record);
          this.cullDirty = true;
        })
        .finally(() => this.bankJobs.delete(chunk.key));
      this.bankJobs.set(chunk.key, job);
      job.catch((error) => {
        if (!this.disposed)
          this.world.failWorld('川岸の地形を準備できませんでした。再読み込みしてください。', error);
      });
      return;
    }
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
    this.cullDirty = true;
  }
  update(camera, time) {
    if (this.disposed) return;
    // A warp, boat crossing or new spawn replans at once: its floor becomes urgent.
    const jumped =
      Math.hypot(camera.position.x - this.planX, camera.position.z - this.planZ) >
      STARTUP.jumpMetres;
    if (time >= this.nextPlan || jumped) {
      this.plan(camera.position.x, camera.position.z, time);
      this.nextPlan = time + 0.3;
    }
    if (this.ocean) this.ocean.time.value = time;
    const started = performance.now();
    let admitted = 0;
    for (const chunk of this.desired)
      if (
        !this.chunks.has(chunk.key) &&
        !this.bankJobs.has(chunk.key) &&
        this.assets.templates.has(biomeById(chunk.biome).ground)
      ) {
        this.admit(chunk);
        if (++admitted >= 2 || performance.now() - started > 3) break;
      }
    // Membership changes must refresh even at a fixed camera or within the
    // throttle interval. Water time above continues advancing on every frame.
    if (!this.viewGate.shouldUpdate(camera, time, null, this.cullDirty)) return;
    this.cullDirty = false;
    this.cullUpdates++;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.uploadBytes +=
      this.ocean?.update(
        this.surroundings.filter((c) => {
          sphere.center.set(c.x, OCEAN_SURFACE_Y, c.z);
          sphere.radius = 25;
          // Each plan's chunk objects are fresh, so the scan runs once per chunk and plan.
          return this.frustum.intersectsSphere(sphere) && (c.coastal ??= coastalChunk(c));
        }),
        time,
      ) ?? 0;
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
      // An admitted chunk keeps its record, so its tile is scanned once.
      const level = Math.min(levels.length - 1, distance < 44 ? 0 : distance < 82 ? 1 : 2),
        coastal = (chunk.coastal ??= coastalChunk(chunk)) ? 1 : 0;
      matrix.makeRotationY(chunk.yaw).setPosition(chunk.x, 0, chunk.z);
      for (const part of levels[level]) {
        part.mesh.setMatrixAt(part.mesh.count, matrix);
        part.geometry?.attributes.earthCoastal?.setX(part.mesh.count, coastal);
        part.mesh.count++;
      }
    }
    for (const levels of this.prepared.values())
      for (const parts of levels)
        for (const part of parts) {
          this.uploadBytes += markActiveInstances(part.mesh);
          if (part.geometry?.attributes.earthCoastal)
            this.uploadBytes += markActiveAttribute(
              part.geometry.attributes.earthCoastal,
              part.mesh.count,
            );
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
      terrainBankPending: String(this.bankJobs.size),
      terrainUpdates: String(this.cullUpdates),
      terrainUploadBytes: String(this.uploadBytes),
    });
  }
  removeChunk(chunk) {
    this.cullDirty = true;
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
    this.cullDirty = true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Queued ground nobody else wants is cancelled.
    this.demand.clear();
    this.bankBuilder?.dispose();
    for (const chunk of this.chunks.values()) this.removeChunk(chunk);
    this.chunks.clear();
    for (const key of [...this.prepared.keys()]) this.releasePrepared(key);
    this.ocean?.dispose();
    this.earthTextures?.dispose();
    this.world.scene.remove(this.root);
  }
}
