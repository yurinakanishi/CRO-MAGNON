import { isTexture, isMesh, isSkinnedMesh } from './three-types.js';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { requireEnemyClips } from './enemy-state.js';
import { PlacementGrid } from '../shared/spatial-grid.mjs';
import { createSurfaceTemplate } from './biome-surfaces.js';
import { coalesceTextures, disposeModels, loadVerifiedGLB } from './embedded-glb.js';
import { ViewUpdateGate } from './view-update-gate.js';
import {
  ACTIVE_MASCOT_MODELS,
  mascotModelReleased,
  mascotAsset,
} from '../shared/mascot-roster.mjs';
import { markActiveAttribute, markActiveInstances } from './instance-updates.js';
import { applyMeadowGrassPalette, meadowGrassTint } from './meadow-palette.js';
import { applyNatureWind } from './nature-wind.js';
import { groundcoverVisible } from './scenery-visibility.js';
import { ActionBlender, gaitPhase } from './action-blender.js';
import { applyBehemothPalette } from './behemoth-palette.js';
import { installSkinnedBounds } from './skinned-bounds.js';
import { configureActorPerformance, disposeActorPerformance } from './performance-lod.js';
import { AssetLoadQueue, LOAD_TIER, LoadTicket } from './asset-load-queue.js';
import {
  packedLevels,
  requireSeparateLevels,
  templateDownloadBytes,
  templateLevels,
} from './world-asset-levels.js';

// Verified GLB loading, image identity, texture sharing and disposal live in
// embedded-glb.ts; CharacterAssets loads its templates the same way.
export { loadVerifiedGLB };

export class WorldAssets {
  /** Verified GLB loader for every queued template: environment, companion,
   * startup, enemy and equipment; called once for all levels of a packed
   * template (world-asset-levels.ts). Tests inject delayed loaders here. */
  declare environmentLoader: typeof loadVerifiedGLB;
  declare templates: Map<any, any>;
  declare surfaceTemplates: Map<any, any>;
  declare animals: Set<any>;
  declare enemyLoads: Map<any, any>;
  declare equipmentLoads: Map<any, any>;
  declare environmentLoads: Map<any, any>;
  /** The one bounded, prioritized queue for on-demand GLB work, shared with
   * the character providers. */
  declare loadQueue: AssetLoadQueue;
  /** Loads this provider started on the queue (as opposed to recorded ones). */
  declare queuedLoads: WeakSet<Promise<unknown>>;
  /** Live actors plus pending creations per template key. */
  declare actorUsers: Map<string, number>;
  declare actorIdleSince: Map<string, number>;
  declare actorTouched: Set<string>;
  declare evictedTemplates: number;
  declare disposed: boolean;
  declare catalog: any;
  declare loadMilliseconds: number | undefined;

  constructor({ loadEnvironment = loadVerifiedGLB } = {}) {
    this.environmentLoader = loadEnvironment;
    this.templates = new Map();
    this.surfaceTemplates = new Map();
    this.animals = new Set();
    this.enemyLoads = new Map();
    this.equipmentLoads = new Map();
    this.environmentLoads = new Map();
    this.loadQueue = new AssetLoadQueue();
    this.queuedLoads = new WeakSet();
    this.actorUsers = new Map();
    this.actorIdleSince = new Map();
    this.actorTouched = new Set();
    this.evictedTemplates = 0;
    this.disposed = false;
  }
  /** Queued, not yet started loads of every kind. */
  get environmentQueue() {
    return this.loadQueue.queued;
  }
  async loadCatalog() {
    if (this.catalog) return this.catalog;
    const response = await fetch('/models/world-assets.json');
    if (!response.ok) throw new Error(`World assets: HTTP ${response.status}`);
    const catalog = await response.json();
    if (catalog.status !== 'ready' || !Array.isArray(catalog.assets))
      throw new Error('World model catalog is not ready');
    for (const key of ACTIVE_MASCOT_MODELS) {
      if (catalog.assets.some((asset) => asset.modelKey === key)) continue;
      const extra = await fetch(`/models/${key}/asset.json`);
      if (!extra.ok) throw new Error(`Companion manifest: HTTP ${extra.status}`);
      const asset = await extra.json();
      if (asset.modelKey !== key) throw new Error(`Companion manifest mismatch: ${key}`);
      catalog.assets.push(asset);
    }
    catalog.assets = catalog.assets
      .filter((asset) => mascotModelReleased(asset.modelKey))
      .map(mascotAsset);
    this.catalog = catalog;
    return catalog;
  }
  /** Every non-enemy startup record (and companions unless deferred), through
   * the shared queue. The world loads only its critical set with loadStartup(). */
  async load({
    deferCompanions = false,
    onProgress,
  }: {
    deferCompanions?: boolean;
    onProgress?: (loaded: number, total: number) => void;
    /** Retained for callers; the shared queue bounds concurrency. */
    background?: boolean;
  } = {}) {
    await this.loadCatalog();
    const keys = this.catalog.assets
      .filter(
        (asset) =>
          asset.kind !== 'enemy' &&
          !asset.onDemand &&
          groundcoverVisible(asset.modelKey) &&
          !(deferCompanions && asset.kind === 'companion'),
      )
      .map((asset) => asset.modelKey);
    try {
      return await this.loadStartup(keys, { onProgress });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  /** Exactly these templates, ahead of streamed work, with progress over their
   * verified byte totals (known up front, so the total never grows). A missing
   * record or a failed download, integrity check or decode rejects. */
  async loadStartup(
    keys: readonly string[],
    {
      onProgress,
      ticket = LoadTicket.of(LOAD_TIER.initial),
    }: { onProgress?: (loaded: number, total: number) => void; ticket?: LoadTicket } = {},
  ) {
    const started = performance.now();
    await this.loadCatalog();
    if (this.disposed) return this;
    const records = [...new Set(keys)].map((key) => {
      const record = this.catalog.assets.find((asset) => asset.modelKey === key);
      if (!record) throw new Error(`Missing verified model ${key}`);
      return record;
    });
    const pending = records.filter((record) => !this.templates.has(record.modelKey));
    // A packed file counts once, not once per level. An invalid packed record is
    // refused here, before any model is requested.
    const sizes = new Map(pending.map((record) => [record, templateDownloadBytes(record)]));
    const total = pending.reduce((sum, record) => sum + sizes.get(record), 0);
    let loaded = 0;
    onProgress?.(0, total);
    try {
      await Promise.all(
        pending.map((record) =>
          this.requestTemplate(record.modelKey, record, ticket).then(() => {
            loaded += sizes.get(record);
            onProgress?.(loaded, total);
          }),
        ),
      );
    } catch (error) {
      // Shutdown settles the remaining loads; that is not a startup failure.
      if (this.disposed) return this;
      throw error;
    }
    this.loadMilliseconds = performance.now() - started;
    return this;
  }
  get(key, surface = null) {
    const template = this.templates.get(key);
    if (!template) throw new Error(`Missing model ${key}`);
    if (surface) {
      const id = `${key}:${surface}`;
      if (!this.surfaceTemplates.has(id))
        this.surfaceTemplates.set(id, createSurfaceTemplate(template, surface));
      return this.surfaceTemplates.get(id);
    }
    return template;
  }
  releaseSurface(key, surface) {
    const id = `${key}:${surface}`,
      template = this.surfaceTemplates.get(id);
    if (template) {
      template.dispose();
      this.surfaceTemplates.delete(id);
    }
  }
  surfaceDiagnostics() {
    const sourceGeometry = new Set(),
      sourceTextures = new Set(),
      variantGeometry = new Set(),
      variantTextures = new Set();
    const collect = (template, geometries, textures) => {
      for (const model of [template.gltf, ...template.lods])
        model.scene.traverse((node) => {
          if (node.geometry) geometries.add(node.geometry);
          for (const material of [node.material].flat().filter(Boolean))
            for (const value of Object.values(material)) if (isTexture(value)) textures.add(value);
        });
    };
    const keys = new Set(
      [...this.surfaceTemplates.values()].map((template) => template.asset.modelKey),
    );
    for (const key of keys) collect(this.templates.get(key), sourceGeometry, sourceTextures);
    let materials = 0;
    for (const template of this.surfaceTemplates.values()) {
      collect(template, variantGeometry, variantTextures);
      materials += template.materials.size;
    }
    return {
      variants: this.surfaceTemplates.size,
      materials,
      sourceGeometries: sourceGeometry.size,
      sourceTextures: sourceTextures.size,
      extraGeometries: [...variantGeometry].filter((value) => !sourceGeometry.has(value)).length,
      extraTextures: [...variantTextures].filter((value) => !sourceTextures.has(value)).length,
    };
  }
  /** A streamed world template: regional environments and the startup scenery,
   * grounds and landmarks. `ticket` carries the requester's priority; without one
   * the request is never withdrawn. */
  ensureEnvironment(key, ticket = LoadTicket.of(LOAD_TIER.scene)) {
    return this.ensureQueued(key, 'environment', ticket);
  }
  /** Load one startup asset ahead of the rest, retaining the same verified template. */
  ensureInitial(key, ticket = LoadTicket.of(LOAD_TIER.initial)) {
    return this.ensureQueued(key, 'initial', ticket);
  }
  ensureCompanion(key, ticket = LoadTicket.of(LOAD_TIER.companion)) {
    return this.ensureQueued(key, 'companion', ticket);
  }
  private ensureQueued(key, kind: 'environment' | 'initial' | 'companion', ticket: LoadTicket) {
    if (this.disposed) return Promise.reject(new Error('World assets disposed'));
    if (this.templates.has(key)) return Promise.resolve(this.get(key));
    const startup = (record) =>
      !record.onDemand && record.kind !== 'enemy' && record.kind !== 'companion';
    const asset = this.catalog.assets.find(
      (record) =>
        record.modelKey === key &&
        (kind === 'initial'
          ? startup(record)
          : kind === 'companion'
            ? record.kind === 'companion'
            : record.environment || startup(record)),
    );
    if (!asset) return Promise.reject(new Error(`Missing verified environment ${key}`));
    return this.requestTemplate(key, asset, ticket);
  }
  /** One verified template per key through the shared queue. A request joins the
   * queued or running load of its key; a new load starts only when none is live
   * (a load every requester withdrew from settled with LoadCancelled). */
  private requestTemplate(key, asset, ticket: LoadTicket) {
    if (this.templates.has(key)) return Promise.resolve(this.get(key));
    return this.joinOrRequest(
      this.environmentLoads,
      key,
      `template:${key}`,
      () => this.loadTemplate(asset),
      ticket,
    );
  }
  /** Join the load recorded for `key` while the queue still holds it, or start
   * one. A recorded load the queue no longer holds was cancelled or failed (a
   * completed one has already installed its template), so it is replaced even
   * before its settlement is observed; only in-flight loads stay recorded. */
  private joinOrRequest(
    loads: Map<string, Promise<unknown>>,
    key: string,
    job: string,
    start: () => Promise<unknown>,
    ticket: LoadTicket,
  ) {
    const live = loads.get(key);
    if (live && (!this.queuedLoads.has(live) || this.loadQueue.join(job, ticket))) return live;
    const load = this.loadQueue.request(job, start, ticket);
    this.queuedLoads.add(load);
    loads.set(key, load);
    const settled = () => {
      if (loads.get(key) === load) loads.delete(key);
    };
    load.then(settled, settled);
    return load;
  }
  private async loadTemplate(asset) {
    const models = [];
    try {
      if (this.disposed) throw new Error('World assets disposed');
      const plan = templateLevels(asset);
      if ('file' in plan) {
        // One download and parse for every level. The parsed model stays whole
        // until its levels are accepted, so a refusal releases all of its scenes.
        const model = await this.environmentLoader(plan.file);
        models.push(model);
        if (this.disposed) throw new Error('World assets disposed');
        models.splice(0, 1, ...packedLevels(model, plan.levels, asset.modelKey));
      } else
        for (const record of plan.files) {
          models.push(await this.environmentLoader(record));
          if (this.disposed) throw new Error('World assets disposed');
        }
      // One cohort: the template's LODs share its textures where image and state agree.
      coalesceTextures(models);
      for (const model of models) {
        model.scene.updateMatrixWorld(true);
        model.scene.traverse((node) => {
          if (isMesh(node)) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
      }
      const template = { asset, gltf: models[0], lods: models.slice(1) };
      this.templates.set(asset.modelKey, template);
      return template;
    } catch (error) {
      disposeModels(models);
      throw error;
    }
  }
  releaseEnvironment(key) {
    const template = this.templates.get(key);
    if (!template?.asset.environment || !template.asset.onDemand) return;
    for (const [id, surface] of this.surfaceTemplates)
      if (surface.asset.modelKey === key) {
        surface.dispose();
        this.surfaceTemplates.delete(id);
      }
    disposeModels([template.gltf, ...template.lods]);
    this.templates.delete(key);
  }
  create(key, level = 0, surface = null) {
    const template = this.get(key, surface),
      model = level ? template.lods[level - 1] : template.gltf;
    if (!model) throw new Error(`Missing verified LOD ${level} for ${key}`);
    const root = model.scene.clone(true);
    root.userData.assetKey = key;
    root.userData.regionalSurface = surface;
    return root;
  }
  createResource(key, surface = null) {
    const template = this.get(key, surface);
    if (!template.lods.length) return this.create(key, 0, surface);
    const root = new THREE.LOD();
    root.userData.assetKey = key;
    root.userData.regionalSurface = surface;
    root.addLevel(this.create(key, 0, surface), 0);
    for (let index = 0; index < template.lods.length; index++) {
      const distance = template.asset.lods?.[index]?.distanceMetres ?? (index === 0 ? 10 : 22);
      root.addLevel(this.create(key, index + 1, surface), distance, 0.15);
    }
    return root;
  }
  /**
   * Model-space vertex positions of a loaded template (LOD 0), evenly
   * subsampled to at most `limit` points. Used to anchor generated detail such
   * as berry fruit on the real foliage surface.
   */
  modelPoints(key, surface = null, limit = 3000): Array<[number, number, number]> {
    const template = this.templates.has(key) ? this.get(key, surface) : null;
    const points: Array<[number, number, number]> = [];
    if (!template?.gltf?.scene) return points;
    template.gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    template.gltf.scene.traverse((node) => {
      if (isMesh(node) && node.geometry?.attributes?.position) meshes.push(node);
    });
    const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    const stride = Math.max(1, Math.ceil(total / Math.max(1, limit)));
    const vertex = new THREE.Vector3();
    for (const mesh of meshes) {
      const position = mesh.geometry.attributes.position;
      for (let index = 0; index < position.count; index += stride) {
        vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        points.push([vertex.x, vertex.y, vertex.z]);
      }
    }
    return points;
  }
  /** A held weapon or rig-attached prop. `ticket` carries the requester's
   * priority; when every requester withdraws before the load starts it settles
   * with LoadCancelled, and a withdrawn requester receives null. */
  async createEquipment(key, ticket = LoadTicket.of(LOAD_TIER.scene)) {
    if (this.disposed) return null;
    if (this.templates.has(key)) return this.create(key);
    await this.ensureEquipment(key, ticket);
    return this.disposed || ticket.released ? null : this.create(key);
  }
  /** A held weapon or prop's verified template, loaded once without a copy (an
   * arrival prepares the local character's props ahead of its snapshot). */
  ensureEquipment(key, ticket = LoadTicket.of(LOAD_TIER.scene)) {
    if (this.disposed) return Promise.reject(new Error('World assets disposed'));
    if (this.templates.has(key)) return Promise.resolve(this.get(key));
    return this.joinOrRequest(
      this.equipmentLoads,
      key,
      `equipment:${key}`,
      () => this.loadEquipmentTemplate(key),
      ticket,
    );
  }
  private async loadEquipmentTemplate(key) {
    // Held weapons and rig-attached props (crow rank regalia, berry clusters) load the same way.
    const asset = this.catalog.assets.find(
      (record) =>
        record.modelKey === key && (record.kind === 'equipment' || record.kind === 'prop'),
    );
    if (!asset) throw new Error(`Missing verified equipment ${key}`);
    requireSeparateLevels(asset, 'equipment');
    const gltf = await this.environmentLoader(asset);
    if (this.disposed) {
      disposeModels([gltf]);
      return;
    }
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node) => {
      if (isMesh(node)) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    this.templates.set(key, { gltf, lods: [], asset });
  }
  createAnimal(key, initialClip = 'Idle_Loop') {
    const { gltf, lods, asset } = this.get(key),
      root = cloneSkeleton(gltf.scene),
      mixer = new THREE.AnimationMixer(root);
    configureActorPerformance(root, lods?.[0]?.scene, asset);
    installSkinnedBounds(root);
    const actions = new Map<string, THREE.AnimationAction>(
      gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]),
    );
    let current = null;
    let sampledElapsed = 0;
    const blender = new ActionBlender(actions);
    const retiring = new Map();
    const actor = {
      root,
      asset,
      mixer,
      name: null,
      play(name, speed = 1) {
        const next = actions.get(name);
        if (!next) throw new Error(`${key}: missing clip ${name}`);
        next.setEffectiveTimeScale(speed);
        if (next === current) return;
        const phase = gaitPhase(current, next);
        retiring.delete(next);
        blender.start(next, 0.2, false, speed);
        next.time = phase;
        current = next;
        actor.name = name;
      },
      sampleOnce(name, elapsed) {
        const next = actions.get(name);
        if (!next) throw new Error(`${key}: missing clip ${name}`);
        if (next !== current || elapsed < sampledElapsed) {
          retiring.clear();
          blender.start(next, elapsed > 0.15 ? 0 : 0.08, true);
          sampledElapsed = elapsed;
          current = next;
          actor.name = name;
        }
        next.time = Math.min(next.getClip().duration, Math.max(0, elapsed));
        blender.update(Math.max(0, elapsed - sampledElapsed));
        sampledElapsed = elapsed;
        mixer.update(0);
      },
      stop() {
        mixer.stopAllAction();
        retiring.clear();
        current = null;
        actor.name = null;
      },
      update(dt) {
        blender.update(dt);
        mixer.update(dt);
        for (const [action, remaining] of retiring) {
          if (remaining <= dt) {
            action.stop();
            retiring.delete(action);
          } else retiring.set(action, remaining - dt);
        }
      },
      dispose: () => {
        if (!this.animals.delete(actor)) return;
        retiring.clear();
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
        disposeActorPerformance(root);
        root.traverse((node) => {
          if (isSkinnedMesh(node)) node.skeleton.dispose();
        });
        this.holdActor(key, -1);
      },
    };
    this.animals.add(actor);
    this.holdActor(key, 1);
    try {
      actor.play(initialClip);
    } catch (error) {
      actor.dispose();
      throw error;
    }
    return actor;
  }
  /** Count a live actor or pending creation of a template (delta ±1). */
  private holdActor(key, delta: number) {
    const users = (this.actorUsers.get(key) ?? 0) + delta;
    if (users > 0) this.actorUsers.set(key, users);
    else this.actorUsers.delete(key);
    this.actorTouched.add(key);
  }
  /** One animated enemy actor. The template loads once per key through the
   * queue with the requester's `ticket`; a withdrawn requester receives null. */
  async createEnemy(key, ticket = LoadTicket.of(LOAD_TIER.visible)) {
    if (this.disposed) return null;
    // The pending creation keeps the template from eviction until its actor exists.
    this.holdActor(key, 1);
    try {
      // Older servers have no enemies: only require this verified model when a
      // snapshot actually contains one. Concurrent instances share one download.
      if (!this.templates.has(key))
        await this.joinOrRequest(
          this.enemyLoads,
          key,
          `enemy:${key}`,
          () => this.loadEnemyTemplate(key),
          ticket,
        );
      return this.disposed || ticket.released ? null : this.createAnimal(key);
    } finally {
      this.holdActor(key, -1);
    }
  }
  private async loadEnemyTemplate(key) {
    const asset = this.catalog.assets.find(
      (record) => record.modelKey === key && record.kind === 'enemy',
    );
    if (!asset) throw new Error(`Missing verified enemy ${key}`);
    requireSeparateLevels(asset, 'enemy');
    const models = [];
    try {
      for (const record of [asset, ...(asset.lods ?? [])]) {
        models.push(await this.environmentLoader(record));
        if (this.disposed) {
          disposeModels(models);
          return;
        }
      }
      requireEnemyClips(models[0].animations, key);
      coalesceTextures(models);
    } catch (error) {
      disposeModels(models);
      throw error;
    }
    const [gltf, ...lods] = models;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node) => {
      if (isMesh(node)) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (key === 'violet-behemoth')
          for (const material of [node.material].flat()) applyBehemothPalette(material);
      }
    });
    this.templates.set(key, { gltf, lods, asset });
  }
  /** Evict enemy templates that no actor or pending creation has used for
   * `grace` seconds; a later createEnemy() loads them again. Startup,
   * environment, companion and equipment templates keep their own lifecycles. */
  collectActors(now: number, grace: number) {
    let evicted = 0;
    for (const [key, template] of this.templates) {
      if (template.asset?.kind !== 'enemy') continue;
      const touched = this.actorTouched.delete(key);
      if (this.actorUsers.has(key)) {
        this.actorIdleSince.delete(key);
        continue;
      }
      const since = this.actorIdleSince.get(key);
      if (since === undefined || touched) {
        this.actorIdleSince.set(key, now);
        continue;
      }
      if (now - since < grace) continue;
      disposeModels([template.gltf, ...template.lods]);
      this.templates.delete(key);
      this.actorIdleSince.delete(key);
      this.evictedTemplates++;
      evicted++;
    }
    return evicted;
  }
  actorTemplateDiagnostics() {
    return {
      loaded: [...this.templates]
        .filter(([, template]) => template.asset?.kind === 'enemy')
        .map(([key]) => key),
      loading: [...this.enemyLoads.keys()],
      evicted: this.evictedTemplates,
    };
  }
  dispose() {
    this.disposed = true;
    // Queued callers settle now; running loads discard their late results.
    this.loadQueue.dispose();
    for (const template of this.surfaceTemplates.values()) template.dispose();
    this.surfaceTemplates.clear();
    for (const actor of [...this.animals]) actor.dispose();
    disposeModels(
      [...this.templates.values()].flatMap(({ gltf, lods }) => [gltf, ...(lods ?? [])]),
    );
    this.templates.clear();
    this.actorIdleSince.clear();
    this.actorTouched.clear();
  }
}

// Far vegetation is a render of the actual GLB. The quad is only an impostor LOD;
// nearby vegetation uses the reconstructed mesh, including its source UV/albedo.
function renderImpostor(renderer, root, resolution = 512) {
  const scene = new THREE.Scene(),
    subject = root.clone(true);
  scene.add(subject, new THREE.HemisphereLight('#e4e5cc', '#596044', 2.5));
  const sun = new THREE.DirectionalLight('#fff1d4', 2.1);
  sun.position.set(-4, 8, 5);
  scene.add(sun);
  const bounds = new THREE.Box3().setFromObject(subject),
    size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  const halfWidth = Math.max(size.x, size.z) * 0.56,
    halfHeight = size.y * 0.55;
  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.01,
    size.length() * 5,
  );
  camera.position.copy(centre).add(new THREE.Vector3(0, 0, size.length() * 2));
  camera.lookAt(centre);
  // Three.js renders offscreen targets in linear light without tone mapping.
  // Retain HDR where supported and apply the game's tone mapping when displaying
  // the impostor, just as for nearby reconstructed geometry.
  const type = renderer.extensions.has('EXT_color_buffer_float')
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
  const target = new THREE.WebGLRenderTarget(resolution, resolution, { depthBuffer: true, type });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  // The render exists only on the GPU: a restored WebGL context draws it again
  // from the retained source scene.
  const draw = () => {
    const previous = renderer.getRenderTarget(),
      clear = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, alpha);
  };
  draw();
  const geometry = new THREE.PlaneGeometry(halfWidth * 2, halfHeight * 2);
  geometry.translate(centre.x, centre.y, 0);
  const material = new THREE.MeshBasicMaterial({
    map: target.texture,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: true,
  });
  return { target, geometry, material, draw };
}

interface LandscapePlacement {
  x: number;
  z: number;
  position: THREE.Vector3;
  height: number;
  yaw: number;
  scale: THREE.Vector3;
}

export class LandscapeInstances {
  private windTime = { value: 0 };
  private density = 1;
  private viewUpdate = new ViewUpdateGate();
  private grassTints: WeakMap<LandscapePlacement, THREE.Color> | null = null;
  private grassMaterials = new Set<THREE.Material>();
  updates = 0;
  matrixUploadBytes = 0;
  colorUploadBytes = 0;
  declare placements: any;
  declare distances: any;
  declare scene: any;
  declare levels: any[][];
  declare grid: PlacementGrid<LandscapePlacement>;
  declare generateCell: any;
  declare generated: Map<any, any>;
  declare castNearbyShadows: boolean;
  declare canopyOcclusion: boolean;
  declare sightLine: THREE.Line3;
  declare sightPoint: THREE.Vector3;
  declare capacity: number;
  declare key: any;
  declare surface: any;
  declare impostor: {
    target: THREE.WebGLRenderTarget<THREE.Texture<unknown, THREE.TextureEventMap>>;
    geometry: THREE.PlaneGeometry;
    material: THREE.MeshBasicMaterial;
    /** Draw the far-view render again (after a WebGL context restore). */
    draw: () => void;
  };
  declare matrix: THREE.Matrix4;
  declare composed: THREE.Matrix4;
  declare rotation: THREE.Quaternion;
  declare axis: THREE.Vector3;
  declare sphere: THREE.Sphere;
  declare frustum: THREE.Frustum;
  declare projection: THREE.Matrix4;
  declare examined: number | undefined;

  constructor({
    assets,
    key,
    surface = null,
    placements,
    renderer,
    scene,
    distances,
    foliage = false,
    generateCell = null,
  }) {
    this.placements = placements;
    this.distances = distances;
    this.scene = scene;
    this.levels = [];
    this.grid = new PlacementGrid<LandscapePlacement>(placements);
    this.generateCell = generateCell;
    this.generated = new Map();
    this.castNearbyShadows = !foliage;
    this.canopyOcclusion = key === 'valley-pine';
    this.sightLine = new THREE.Line3();
    this.sightPoint = new THREE.Vector3();
    const generatorCapacity = generateCell ? 250 * (Math.ceil(distances[2] / 32) * 2 + 2) ** 2 : 0;
    this.capacity = this.grid.maximumNearby(distances[2]) + generatorCapacity;
    this.key = key;
    this.surface = surface;
    if (!surface && (key === 'meadow-grass' || key === 'meadow-sprig'))
      this.grassTints = new WeakMap();
    const template = assets.get(key, surface);
    for (const model of [template.gltf, template.lods[0]]) {
      if (!model) {
        this.levels.push([]);
        continue;
      }
      const meshes = [];
      model.scene.updateMatrixWorld(true);
      model.scene.traverse((node) => {
        if (!isMesh(node)) return;
        const grassMaterial = (source: THREE.Material) => {
          const material = source.clone();
          applyMeadowGrassPalette(material, key);
          applyNatureWind(material, node.geometry, this.windTime);
          this.grassMaterials.add(material);
          return material;
        };
        const material = this.grassTints
          ? Array.isArray(node.material)
            ? node.material.map(grassMaterial)
            : grassMaterial(node.material)
          : node.material;
        const mesh = new THREE.InstancedMesh(node.geometry, material, this.capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = !foliage && this.levels.length === 0;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        scene.add(mesh);
        meshes.push({ mesh, local: node.matrixWorld.clone() });
      });
      this.levels.push(meshes);
    }
    this.impostor = renderImpostor(renderer, template.gltf.scene, surface ? 256 : 512);
    if (this.grassTints) {
      applyMeadowGrassPalette(this.impostor.material, key);
      applyNatureWind(this.impostor.material, this.impostor.geometry, this.windTime);
    }
    const billboard = new THREE.InstancedMesh(
      this.impostor.geometry,
      this.impostor.material,
      this.capacity,
    );
    billboard.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    billboard.count = 0;
    billboard.frustumCulled = false;
    scene.add(billboard);
    this.levels.push([{ mesh: billboard, local: new THREE.Matrix4() }]);
    if (this.grassTints)
      for (const level of this.levels)
        for (const { mesh } of level)
          mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.capacity * 3),
            3,
          ).setUsage(THREE.DynamicDrawUsage);
    this.matrix = new THREE.Matrix4();
    this.composed = new THREE.Matrix4();
    this.rotation = new THREE.Quaternion();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.sphere = new THREE.Sphere();
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
  }
  update(camera, time, riderFocus = null, foliageDensity = 1) {
    if (this.windTime) this.windTime.value = time;
    const density = !this.castNearbyShadows ? foliageDensity : 1;
    const changed = density !== this.density;
    this.density = density;
    if (!(this.viewUpdate ??= new ViewUpdateGate()).shouldUpdate(camera, time, riderFocus, changed))
      return;
    this.updates = (this.updates ?? 0) + 1;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const counts = [0, 0, 0];
    if (riderFocus) this.sightLine.set(camera.position, riderFocus);
    const nearby = [...this.grid.near(camera.position.x, camera.position.z, this.distances[2])];
    if (this.generateCell) {
      const active = new Set(),
        radius = this.distances[2];
      for (
        let x = Math.floor((camera.position.x - radius) / 32);
        x <= Math.floor((camera.position.x + radius) / 32);
        x++
      )
        for (
          let z = Math.floor((camera.position.z - radius) / 32);
          z <= Math.floor((camera.position.z + radius) / 32);
          z++
        ) {
          const key = `${x},${z}`;
          active.add(key);
          if (!this.generated.has(key)) this.generated.set(key, this.generateCell(x, z));
          nearby.push(...this.generated.get(key));
        }
      for (const key of this.generated.keys()) if (!active.has(key)) this.generated.delete(key);
    }
    this.examined = nearby.length;
    for (const item of nearby) {
      // Stable spatial thinning changes decorative grass only, never resources/colliders.
      if (
        density < 1 &&
        (((Math.floor(item.x * 17) * 73856093) ^ (Math.floor(item.z * 17) * 19349663)) >>> 0) %
          100 >=
          density * 100
      )
        continue;
      const distance = item.position.distanceTo(camera.position);
      if (distance > this.distances[2]) continue;
      // Walking and riding cameras can both enter a canopy. Cull only the trees
      // blocking this view's sight line; body colliders and other views remain.
      if (this.canopyOcclusion && riderFocus && distance < 22) {
        this.sphere.center.copy(item.position);
        this.sphere.center.y += item.height * 0.65;
        this.sightLine.closestPointToPoint(this.sphere.center, true, this.sightPoint);
        if (this.sightPoint.distanceToSquared(this.sphere.center) < (item.height * 0.34 + 0.5) ** 2)
          continue;
      }
      this.sphere.center.copy(item.position);
      this.sphere.center.y += item.height * 0.5;
      this.sphere.radius = item.height * 0.75;
      if (
        !this.frustum.intersectsSphere(this.sphere) &&
        !(this.castNearbyShadows && distance < Math.min(24, this.distances[0]))
      )
        continue;
      const level =
        distance < this.distances[0]
          ? 0
          : distance < this.distances[1] && this.levels[1].length
            ? 1
            : 2;
      const yaw =
        level === 2
          ? Math.atan2(camera.position.x - item.position.x, camera.position.z - item.position.z)
          : item.yaw;
      this.rotation.setFromAxisAngle(this.axis, yaw);
      this.matrix.compose(item.position, this.rotation, item.scale);
      let tint: THREE.Color | undefined;
      if (this.grassTints) {
        tint = this.grassTints.get(item);
        if (!tint) {
          tint = meadowGrassTint(this.key, item.position.x, item.position.z);
          this.grassTints.set(item, tint);
        }
      }
      for (const { mesh, local } of this.levels[level]) {
        mesh.setMatrixAt(counts[level], this.composed.multiplyMatrices(this.matrix, local));
        if (tint) mesh.setColorAt(counts[level], tint);
      }
      counts[level]++;
    }
    for (const [level, meshes] of this.levels.entries())
      for (const { mesh } of meshes) {
        mesh.count = counts[level];
        this.matrixUploadBytes = (this.matrixUploadBytes ?? 0) + markActiveInstances(mesh);
        if (mesh.instanceColor)
          this.colorUploadBytes =
            (this.colorUploadBytes ?? 0) + markActiveAttribute(mesh.instanceColor, mesh.count);
      }
  }
  dispose() {
    for (const meshes of this.levels)
      for (const { mesh } of meshes) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    this.impostor.geometry.dispose();
    this.impostor.material.dispose();
    this.impostor.target.dispose();
    for (const material of this.grassMaterials) material.dispose();
  }
}
