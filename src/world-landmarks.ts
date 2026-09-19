import { isMesh } from './three-types.js';
import * as THREE from 'three';
import { LANDMARKS } from '../shared/landmarks.mjs';
import { CASTLE } from '../shared/castle-layout.mjs';
import { MeshRayGrid } from './mesh-ray-grid.js';
import { REGION_FEATURES } from '../shared/region-features.mjs';
import { terrainHeight } from '../shared/terrain.mjs';
import { regionFeatureDiagnostics } from './region-feature-diagnostics.js';
import { ADVENTURE_LANDMARKS } from '../shared/adventure-layout.mjs';
import { AdventureMaterials } from './adventure-materials.js';
import { GULF_LANDMARKS } from '../shared/gulf-region.mjs';
import { CAMP_CAVE, CAMP_MOUNTAIN } from '../shared/camp-cave-layout.mjs';
import { prepareCaveMaterials } from './cave-materials.js';
import { prepareMountainMaterials } from './mountain-materials.js';

const PLACEMENTS = Object.freeze([
  ...LANDMARKS,
  ...REGION_FEATURES,
  CASTLE,
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  ...ADVENTURE_LANDMARKS,
  ...GULF_LANDMARKS,
]);

// Meshes and all LODs are verified image-to-3D files. Only nearby landmark types
// are decoded; copies share geometries and materials, and inactive types expire.
export class WorldLandmarks {
  declare world: any;
  declare assets: any;
  declare placements: readonly any[];
  declare featureKeys: Set<any>;
  declare instances: Map<any, any>;
  declare pending: Map<any, any>;
  declare used: Map<any, any>;
  declare next: number;
  declare disposed: boolean;
  declare coatings: AdventureMaterials;
  declare castleCamera: MeshRayGrid | null | undefined;
  declare caveCamera: MeshRayGrid | null | undefined;
  declare cavePigment: THREE.Texture | undefined;
  declare caveLimestone: THREE.Texture | undefined;

  constructor(world, placements = PLACEMENTS) {
    this.world = world;
    this.assets = world.worldAssets;
    this.placements = placements;
    this.featureKeys = new Set(REGION_FEATURES.map((item) => item.key));
    this.instances = new Map();
    this.pending = new Map();
    this.used = new Map();
    this.next = 0;
    this.disposed = false;
    this.coatings = new AdventureMaterials();
  }
  update(camera, time) {
    if (this.disposed || time < this.next) return;
    this.next = time + 0.3;
    const desired = this.placements.filter(
      (item) =>
        Math.hypot(camera.position.x - item.x, camera.position.z - item.z) < 125 + item.clearance,
    );
    let created = 0;
    const ids = new Set(desired.map((item) => item.id));
    for (const [id, root] of this.instances)
      if (!ids.has(id)) {
        this.world.scene.remove(root);
        for (const material of root.userData.ownedMaterials ?? []) material.dispose();
        this.instances.delete(id);
        if (id === CASTLE.id) this.castleCamera = null;
        if (id === CAMP_CAVE.id) this.caveCamera = null;
      }
    for (const item of desired) {
      this.used.set(item.key, time);
      if (item.surface) this.coatings.touch(item.key, time);
      if (!this.assets.templates.has(item.key)) {
        if (!this.pending.has(item.key)) {
          const promise = this.assets
            .ensureEnvironment(item.key)
            .then(() => {
              if (!this.disposed) this.world.updateAssetDiagnostics();
            })
            .catch((error) => {
              if (!this.disposed)
                this.world.failWorld(
                  '地域の3D素材を読み込めませんでした。再読み込みしてください。',
                  error,
                );
            })
            .finally(() => this.pending.delete(item.key));
          this.pending.set(item.key, promise);
        }
        continue;
      }
      if (!this.instances.has(item.id)) {
        if (created >= 4) continue;
        created++;
        const template = this.assets.get(item.key),
          root = new THREE.LOD();
        root.name = item.id;
        root.userData.landmarkId = item.id;
        if (this.featureKeys.has(item.key)) root.userData.regionFeature = item.key;
        if (item.key === CAMP_CAVE.key && !template.cavePrepared) {
          if (!this.cavePigment) {
            this.cavePigment = new THREE.TextureLoader().load(
              template.asset.pigment.url,
              undefined,
              undefined,
              (error) => {
                if (!this.disposed)
                  this.world.failWorld(
                    '洞窟の壁画を読み込めませんでした。再読み込みしてください。',
                    error,
                  );
              },
            );
            this.cavePigment.colorSpace = THREE.SRGBColorSpace;
            this.cavePigment.anisotropy = Math.min(
              8,
              this.world.renderer.capabilities.getMaxAnisotropy(),
            );
          }
          if (!this.caveLimestone) {
            this.caveLimestone = new THREE.TextureLoader().load(
              template.asset.rockSurface.url,
              undefined,
              undefined,
              (error) => {
                if (!this.disposed)
                  this.world.failWorld(
                    '洞窟の岩肌を読み込めませんでした。再読み込みしてください。',
                    error,
                  );
              },
            );
            this.caveLimestone.colorSpace = THREE.SRGBColorSpace;
            this.caveLimestone.wrapS = this.caveLimestone.wrapT = THREE.RepeatWrapping;
            this.caveLimestone.anisotropy = Math.min(
              8,
              this.world.renderer.capabilities.getMaxAnisotropy(),
            );
          }
          template.cavePrepared = true;
          for (const gltf of [template.gltf, ...template.lods])
            prepareCaveMaterials(gltf.scene, this.cavePigment, this.caveLimestone);
        }
        if (item.key === CAMP_MOUNTAIN.key && !template.trailPrepared) {
          template.trailPrepared = true;
          for (const gltf of [template.gltf, ...template.lods])
            template.caveRoofTexture = prepareMountainMaterials(gltf.scene);
        }
        if (item.key === 'volcanic-cone' && !template.lavaPrepared) {
          template.lavaPrepared = true;
          for (const gltf of [template.gltf, ...template.lods])
            gltf.scene.traverse((node) => {
              if (isMesh(node))
                for (const material of [node.material].flat()) {
                  material.onBeforeCompile = (shader) => {
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <emissivemap_fragment>',
                      `#include <emissivemap_fragment>
              float lava=clamp((diffuseColor.r-max(diffuseColor.g,diffuseColor.b)*1.6)*8.0,0.0,1.0);
              totalEmissiveRadiance+=vec3(1.0,.17,.02)*lava*.9;`,
                    );
                  };
                  material.customProgramCacheKey = () => 'source-volcano-lava-1';
                  material.needsUpdate = true;
                }
            });
        }
        root.position.set(
          item.x,
          (item.elevation ?? (item.id === CAMP_MOUNTAIN.id ? 0 : terrainHeight(item.x, item.z))) +
            (item.groundOffset ?? -0.08),
          item.z,
        );
        root.rotation.y = item.yaw;
        root.scale.setScalar(item.scale);
        for (let level = 0; level <= template.lods.length; level++) {
          const model = this.assets.create(item.key, level);
          if (item.surface) this.coatings.apply(model, item.surface, item.key, time);
          model.traverse((node) => {
            if (isMesh(node)) {
              node.castShadow = level === 0;
              node.receiveShadow = true;
            }
          });
          // Measure distance beyond the landmark's footprint. A mountain's
          // centre can be far away while its nearest visible face is close.
          root.addLevel(
            model,
            level === 0 ? 0 : item.clearance + (level === 1 ? 35 : 80) * Math.max(0.7, item.scale),
            0.15,
          );
        }
        root.updateMatrixWorld(true);
        root.traverse((node) => (node.matrixAutoUpdate = false));
        this.instances.set(item.id, root);
        this.world.scene.add(root);
        if (item.id === CASTLE.id) this.castleCamera = new MeshRayGrid(root);
        if (item.id === CAMP_CAVE.id) this.caveCamera = new MeshRayGrid(root);
      }
      this.instances.get(item.id).update(camera);
    }
    for (const [key, last] of this.used)
      if (time - last > 12 && !this.pending.has(key)) {
        this.assets.templates.get(key)?.caveRoofTexture?.dispose();
        this.assets.releaseEnvironment(key);
        if (key === CAMP_CAVE.key) {
          this.cavePigment?.dispose();
          this.cavePigment = undefined;
          this.caveLimestone?.dispose();
          this.caveLimestone = undefined;
        }
        this.used.delete(key);
        this.world.updateAssetDiagnostics();
      }
    this.world.canvas.dataset.landmarks = String(this.instances.size);
    this.coatings.evict(time);
    this.world.canvas.dataset.adventureMaterials = String(this.coatings.cache.size);
  }
  diagnostics() {
    return regionFeatureDiagnostics(this.assets, this.instances, this.featureKeys);
  }
  dispose() {
    this.disposed = true;
    for (const root of this.instances.values()) {
      this.world.scene.remove(root);
      for (const material of root.userData.ownedMaterials ?? []) material.dispose();
    }
    this.instances.clear();
    this.coatings.dispose();
    this.assets.templates.get(CAMP_MOUNTAIN.key)?.caveRoofTexture?.dispose();
    this.cavePigment?.dispose();
    this.caveLimestone?.dispose();
    this.caveCamera = this.castleCamera = null;
  }
}
