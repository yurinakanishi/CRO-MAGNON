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
import { CAMP_CAVE, CAMP_MOUNTAIN, campMountainVisualLod } from '../shared/camp-cave-layout.mjs';
import { prepareCaveMaterials } from './cave-materials.js';
import { type CaveExtraPigment } from './cave-gallery-layout.js';
import {
  loadCaveTextures,
  releaseVerifiedTexture,
  type CaveTextureKey,
  type VerifiedTextureBatch,
  type VerifiedTextureOptions,
} from './verified-texture.js';
import { createCavePreviewLabel } from './cave-preview-label.js';
import { prepareMountainMaterials } from './mountain-materials.js';
import { prepareMountainRiverBedAsync } from './mountain-river.js';
import { RiverBankBuilder } from './river-bank-builder.js';
import { LoadDemand, isLoadCancelled, type LoadTicket } from './asset-load-queue.js';
import { landmarkPriority } from './startup-plan.js';
import { chunkMountainSurface } from './surface-chunks.js';
import { CaveSpring } from './cave-spring.js';

const RADIUS = 125,
  // A requested landmark stays wanted this much beyond the streaming radius.
  RETAIN_MARGIN = 32;

type MountainBed = { prepared: Set<number>; jobs: Map<number, Promise<void>> };

/** Whoever starts a mountain fit: its running builders are stopped at its disposal, and
 * nothing is marked fitted once it is disposed. */
export type MountainFitOwner = {
  readonly builders: Set<RiverBankBuilder>;
  readonly disposed: boolean;
};

/** Fit the camp mountain's river bed for these LOD levels off the UI thread, once each per
 * template: a level being fitted, by any owner, is joined and a fitted one skipped. Arrival
 * waits only for the level it sees; the others follow, and a level is never drawn before its
 * own fit has finished. */
export function fitCampMountain(
  template,
  levels: readonly number[],
  owner: MountainFitOwner,
): Promise<void> {
  if (!template || owner.disposed) return Promise.resolve();
  const bed: MountainBed = (template.riverBed ??= { prepared: new Set(), jobs: new Map() });
  const jobs = levels
    .filter((level) => level <= template.lods.length && !bed.prepared.has(level))
    .map((level) => {
      let job = bed.jobs.get(level);
      if (!job) {
        const gltf = level ? template.lods[level - 1] : template.gltf,
          builder = new RiverBankBuilder();
        owner.builders.add(builder);
        job = prepareMountainRiverBedAsync(gltf.scene, builder, () => !owner.disposed)
          .then(() => {
            if (!owner.disposed) bed.prepared.add(level);
          })
          .finally(() => {
            builder.dispose();
            owner.builders.delete(builder);
            bed.jobs.delete(level);
          });
        bed.jobs.set(level, job);
      }
      return job;
    });
  return Promise.all(jobs).then(() => undefined);
}

/** The arrival's mountain fit, started by world startup once the camp mountain's verified
 * template is installed, while the rest of the startup set downloads. It requests nothing:
 * it fits the template the startup set loaded and records the job there, where
 * WorldLandmarks.prepareMountain later joins or skips it. The world owns and disposes it. */
export class StartupMountainFit implements MountainFitOwner {
  readonly builders = new Set<RiverBankBuilder>();
  disposed = false;
  /** Resolves once the levels are fitted, when none is wanted or no template came, and at
   * disposal; rejects with the fit's failure. */
  readonly done: Promise<void>;
  private started = false;
  private resolve!: () => void;
  private reject!: (error: unknown) => void;

  constructor(
    private readonly assets: { templates: Map<string, any> },
    private readonly levels: readonly number[],
  ) {
    this.done = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // The startup awaits it; a failure after the startup stopped is not unhandled.
    this.done.catch(() => {});
    if (!levels.length) this.settle();
  }
  /** Start once the template is installed; later calls do nothing. `last`: the startup set
   * has loaded, so a missing template will not come. */
  poll(last = false) {
    if (this.started || this.disposed) return;
    const template = this.assets.templates.get(CAMP_MOUNTAIN.key);
    if (!template) {
      if (last) this.settle();
      return;
    }
    this.started = true;
    fitCampMountain(template, this.levels, this).then(this.resolve, this.reject);
  }
  /** Stop the running fit: its workers end and no level is marked fitted. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const builder of this.builders) builder.dispose();
    this.builders.clear();
    this.settle();
  }
  private settle() {
    this.started = true;
    this.resolve();
  }
}

export const LANDMARK_PLACEMENTS = Object.freeze([
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
  declare caveCharacter524: THREE.Texture | undefined;
  declare caveRimoPigment: THREE.Texture | undefined;
  declare caveLimestone: THREE.Texture | undefined;
  caveExtraPigments: Partial<Record<CaveExtraPigment, THREE.Texture>> = {};
  /** The cave's verified images while they load; lost-context cleanup reaches them here. */
  caveImages: VerifiedTextureBatch<CaveTextureKey> | null = null;
  /** The cave's images failed once: the world failed and nothing is requested again. */
  private caveFailed = false;
  private caveSpring: CaveSpring | null = null;
  private readonly imageOptions: VerifiedTextureOptions;
  /** Landmark requests by key, prioritized by the nearest footprint edge. */
  readonly demand = new LoadDemand();
  /** Running mountain fits this instance started (fitCampMountain). */
  readonly builders = new Set<RiverBankBuilder>();

  constructor(
    world,
    placements = LANDMARK_PLACEMENTS,
    { images = {} }: { images?: VerifiedTextureOptions } = {},
  ) {
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
    this.imageOptions = images;
    // An arrival beside the cave verifies its images while the mountain is fitted,
    // so the cave can be drawn from the first frames.
    const focus = world.focus,
      cave = placements.find((item) => item.id === CAMP_CAVE.id);
    if (
      focus &&
      cave &&
      this.assets.templates?.has(cave.key) &&
      Math.hypot(focus.x - cave.x, focus.z - cave.z) < RADIUS + cave.clearance
    )
      this.prepareCave();
  }
  /** Fit the camp mountain's river bed for these LOD levels off the UI thread,
   * once each (fitCampMountain); a level the startup is fitting is joined. */
  prepareMountain(levels: readonly number[]): Promise<void> {
    return fitCampMountain(this.assets.templates.get(CAMP_MOUNTAIN.key), levels, this);
  }
  /** Whether every listed landmark is instanced (arrival preparation). */
  hasInstances(ids: readonly string[]) {
    return ids.every((id) => this.instances.has(id));
  }
  private request(key: string, ticket: LoadTicket) {
    const promise = this.assets
      .ensureEnvironment(key, ticket)
      .then(() => {
        if (!this.disposed) this.world.updateAssetDiagnostics();
      })
      .catch((error) => {
        // A landmark withdrawn after travel is not an asset failure; a needed one is.
        if (!this.disposed && !isLoadCancelled(error))
          this.world.failWorld(
            '地域の3D素材を読み込めませんでした。再読み込みしてください。',
            error,
          );
      })
      .finally(() => {
        this.demand.settle(key, ticket);
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
  }
  private failMountain = (error) => {
    if (!this.disposed)
      this.world.failWorld('山の地形を準備できませんでした。再読み込みしてください。', error);
  };
  /** Whether the cave's verified images are installed in its template's materials.
   * The first call loads them, once; the cave is instanced only after that. */
  private prepareCave(): boolean {
    const template = this.assets.get(CAMP_CAVE.key);
    if (template.cavePrepared) return true;
    if (this.caveImages || this.caveFailed || this.disposed) return false;
    let images: VerifiedTextureBatch<CaveTextureKey>;
    try {
      const anisotropy = Math.min(8, this.world.renderer.capabilities.getMaxAnisotropy());
      images = loadCaveTextures(template.asset, anisotropy, this.imageOptions);
    } catch (error) {
      this.failCave(null, error);
      return false;
    }
    this.caveImages = images;
    const preparing = images.ready
      .then(
        () => {
          // A cancelled batch (disposal) has released its textures itself.
          if (this.caveImages !== images) return;
          this.caveImages = null;
          this.installCave(template, images.take());
        },
        (error) => {
          if (this.caveImages !== images) return;
          this.caveImages = null;
          this.failCave(images.failedKey, error);
        },
      )
      .finally(() => {
        if (this.pending.get(CAMP_CAVE.key) === preparing) this.pending.delete(CAMP_CAVE.key);
      });
    // In flight like a landmark load: the cave is not released meanwhile.
    this.pending.set(CAMP_CAVE.key, preparing);
    return false;
  }
  /** Install the taken textures in the template's materials, all or nothing. Never
   * throws: when installing fails (a browser without a 2D canvas for the label) every
   * taken texture and the label are released once and the world fails once. */
  private installCave(template, textures: Record<CaveTextureKey, THREE.Texture>) {
    const taken: THREE.Texture[] = Object.values(textures);
    if (this.disposed || this.assets.templates.get(CAMP_CAVE.key) !== template) {
      taken.forEach(releaseVerifiedTexture);
      return;
    }
    try {
      const comingSoon = createCavePreviewLabel();
      taken.push(comingSoon);
      const { pigment, rockSurface, characterPigment, rimoPigment, ...extras } = textures;
      const extraPigments = { ...extras, comingSoon };
      for (const gltf of [template.gltf, ...template.lods])
        prepareCaveMaterials(
          gltf.scene,
          pigment,
          rockSurface,
          characterPigment,
          rimoPigment,
          extraPigments as Record<CaveExtraPigment, THREE.Texture>,
        );
      // Installed: from here the fields own them.
      this.releaseCaveTextures();
      this.cavePigment = pigment;
      this.caveLimestone = rockSurface;
      this.caveCharacter524 = characterPigment;
      this.caveRimoPigment = rimoPigment;
      this.caveExtraPigments = extraPigments;
      template.cavePrepared = true;
    } catch (error) {
      // A template material set up before the failure is never drawn: the world fails.
      taken.forEach(releaseVerifiedTexture);
      this.failCave(null, error);
    }
  }
  private failCave(image: CaveTextureKey | null, error) {
    if (this.caveFailed) return;
    this.caveFailed = true;
    if (this.disposed) return;
    this.world.failWorld(
      image === 'rockSurface'
        ? '洞窟の岩肌を読み込めませんでした。再読み込みしてください。'
        : image === 'rimoPigment'
          ? 'りもねこの壁画を読み込めませんでした。再読み込みしてください。'
          : '洞窟の壁画を読み込めませんでした。再読み込みしてください。',
      error,
    );
  }
  private caveTextures(): THREE.Texture[] {
    return [
      this.cavePigment,
      this.caveLimestone,
      this.caveCharacter524,
      this.caveRimoPigment,
      ...Object.values(this.caveExtraPigments),
    ].filter((texture): texture is THREE.Texture => !!texture);
  }
  /** The cave's own images, each released once: verified textures and the label. */
  private releaseCaveTextures() {
    for (const texture of this.caveTextures()) releaseVerifiedTexture(texture);
    this.cavePigment = this.caveLimestone = undefined;
    this.caveCharacter524 = this.caveRimoPigment = undefined;
    this.caveExtraPigments = {};
  }
  /** A mountain level's own copy, once its river bed is fitted. */
  private fillMountainLevel(root: THREE.LOD, template, item, level: number, time: number) {
    const holder = root.levels[level]?.object;
    if (!holder || holder.children.length || !template.riverBed?.prepared.has(level)) return;
    const scene = (level ? template.lods[level - 1] : template.gltf).scene;
    if (!scene.userData.mountainMaterials) {
      // The open world owns (and disposes) the coast field; only the roof data is ours.
      const roof = prepareMountainMaterials(scene, this.world.openWorld.earthTextures);
      chunkMountainSurface(scene);
      scene.userData.mountainMaterials = true;
      (template.caveRoofTextures ??= []).push(roof);
    }
    const model = this.levelModel(item, level, time);
    holder.add(model);
    holder.updateMatrixWorld(true);
    model.traverse((node) => (node.matrixAutoUpdate = false));
  }
  private levelModel(item, level: number, time: number) {
    const model = this.assets.create(item.key, level);
    if (item.surface) this.coatings.apply(model, item.surface, item.key, time);
    model.traverse((node) => {
      if (isMesh(node)) {
        node.castShadow = level === 0;
        node.receiveShadow = true;
      }
    });
    return model;
  }
  update(camera, time) {
    this.caveSpring?.update(time);
    if (this.disposed || time < this.next) return;
    this.next = time + 0.3;
    const desired = [],
      retained = new Map<string, number>();
    for (const item of this.placements) {
      const distance = Math.hypot(camera.position.x - item.x, camera.position.z - item.z);
      if (distance < RADIUS + item.clearance) desired.push(item);
      else if (distance < RADIUS + RETAIN_MARGIN + item.clearance && this.demand.has(item.key))
        retained.set(
          item.key,
          Math.min(retained.get(item.key) ?? Infinity, distance - item.clearance),
        );
    }
    const wanted = new Map<string, number>();
    let created = 0;
    const ids = new Set(desired.map((item) => item.id));
    for (const [id, root] of this.instances)
      if (!ids.has(id)) {
        this.world.scene.remove(root);
        for (const material of root.userData.ownedMaterials ?? []) material.dispose();
        this.instances.delete(id);
        if (id === CASTLE.id) this.castleCamera = null;
        if (id === CAMP_CAVE.id) {
          this.caveCamera = null;
          this.caveSpring?.dispose();
          this.caveSpring = null;
        }
      }
    for (const item of desired) {
      this.used.set(item.key, time);
      if (item.surface) this.coatings.touch(item.key, time);
      if (!this.assets.templates.has(item.key)) {
        const distance = Math.hypot(camera.position.x - item.x, camera.position.z - item.z);
        wanted.set(
          item.key,
          Math.min(wanted.get(item.key) ?? Infinity, landmarkPriority(distance - item.clearance)),
        );
        continue;
      }
      const mountain = item.key === CAMP_MOUNTAIN.key;
      if (mountain && !this.assets.get(item.key).riverBed?.prepared.size) {
        // Never fit the mountain on the UI thread: draw it once a level is fitted.
        const level = campMountainVisualLod(camera.position.x, camera.position.z);
        this.prepareMountain([level]).catch(this.failMountain);
        continue;
      }
      if (!this.instances.has(item.id)) {
        // The cave is drawn only once its verified images are installed.
        if (item.key === CAMP_CAVE.key && !this.prepareCave()) continue;
        if (created >= 4) continue;
        created++;
        const template = this.assets.get(item.key),
          root = new THREE.LOD();
        root.name = item.id;
        root.userData.landmarkId = item.id;
        if (this.featureKeys.has(item.key)) root.userData.regionFeature = item.key;
        if (item.id === CAMP_MOUNTAIN.id) root.autoUpdate = false;
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
          // Mountain levels are filled once their river bed is fitted.
          const model = mountain ? new THREE.Group() : this.levelModel(item, level, time);
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
        if (item.id === CAMP_CAVE.id) {
          this.caveCamera = new MeshRayGrid(root);
          this.caveSpring = new CaveSpring();
          root.add(this.caveSpring.root);
          this.caveSpring.update(time);
        }
      }
      const instance = this.instances.get(item.id);
      if (item.id === CAMP_MOUNTAIN.id && instance.levels.length > 1) {
        const template = this.assets.get(item.key),
          bed: MountainBed = template.riverBed;
        for (let level = 0; level < instance.levels.length; level++)
          this.fillMountainLevel(instance, template, item, level, time);
        const previous = instance.userData.performanceLod ?? 0;
        let level = campMountainVisualLod(camera.position.x, camera.position.z, previous);
        if (!bed.prepared.has(level)) {
          // Keep drawing the fitted level until this one is fitted as well.
          this.prepareMountain([level]).catch(this.failMountain);
          level = bed.prepared.has(previous) ? previous : [...bed.prepared][0];
        }
        for (const [index, record] of instance.levels.entries())
          record.object.visible = index === level;
        instance.userData.performanceLod = level;
        this.world.canvas.dataset.campMountainLod = String(level);
      } else instance.update(camera);
    }
    for (const [key, distance] of retained)
      if (!wanted.has(key) && !this.assets.templates.has(key))
        wanted.set(key, landmarkPriority(distance));
    // A landmark leaving the retained area is withdrawn: its queued load is cancelled.
    this.demand.update(wanted, (key, ticket) => this.request(key, ticket));
    this.assets.loadQueue?.pump();
    for (const [key, last] of this.used)
      if (time - last > 12 && !this.pending.has(key)) {
        const template = this.assets.templates.get(key);
        this.assets.releaseEnvironment(key);
        // Only a released template's roof data goes; the mountain stays resident.
        if (template && !this.assets.templates.has(key))
          for (const roof of template.caveRoofTextures ?? []) roof.dispose();
        if (key === CAMP_CAVE.key) {
          if (template && !this.assets.templates.has(key)) {
            // The cave left with its template: its own images go too.
            this.caveImages?.cancel();
            this.caveImages = null;
            this.releaseCaveTextures();
          }
          // A resident cave keeps its installed images; only their GPU copies go,
          // uploaded again when it is drawn.
          else for (const texture of this.caveTextures()) texture.dispose();
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
    this.caveSpring?.dispose();
    this.caveSpring = null;
    // Queued landmarks nobody else wants are cancelled; running fits stop.
    this.demand.clear();
    for (const builder of this.builders) builder.dispose();
    this.builders.clear();
    for (const root of this.instances.values()) {
      this.world.scene.remove(root);
      for (const material of root.userData.ownedMaterials ?? []) material.dispose();
    }
    this.instances.clear();
    this.coatings.dispose();
    for (const roof of this.assets.templates?.get(CAMP_MOUNTAIN.key)?.caveRoofTextures ?? [])
      roof.dispose();
    // Images still loading are released by their batch, now or as they arrive.
    this.caveImages?.cancel();
    this.caveImages = null;
    this.releaseCaveTextures();
    this.caveCamera = this.castleCamera = null;
  }
}
