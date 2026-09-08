import { isTexture, isMesh, isSkinnedMesh } from './three-types.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { requireEnemyClips } from './enemy-state.js';
import { PlacementGrid } from '../shared/spatial-grid.mjs';
import { createSurfaceTemplate } from './biome-surfaces.js';
import { sha256 } from './asset-hash.js';
import { ViewUpdateGate } from './view-update-gate.js';
import { markActiveInstances } from './instance-updates.js';

function disposeTemplate(root) {
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  root.traverse((node) => {
    if (node.geometry) resources.add(node.geometry);
    if (node.skeleton) resources.add(node.skeleton);
    for (const material of [node.material].flat().filter(Boolean)) {
      resources.add(material);
      for (const value of Object.values(material)) if (isTexture(value)) resources.add(value);
    }
  });
  for (const value of resources) {
    value.dispose();
    if (isTexture(value)) (value.source?.data as ImageBitmap | undefined)?.close?.();
  }
}

export async function loadVerifiedGLB(record) {
  const url = new URL(record.url, location.origin);
  if (url.origin !== location.origin) throw new Error('Models must be served by this game');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${record.url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== record.bytes) throw new Error(`${record.url}: file length mismatch`);
  if ((await sha256(bytes)) !== record.sha256) throw new Error(`${record.url}: SHA-256 mismatch`);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith('blob:') && !url.startsWith('data:'))
      throw new Error('GLB must embed its resources');
    return url;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
  {
    const view = new DataView(bytes),
      jsonEnd = 20 + view.getUint32(12, true),
      binaryStart = jsonEnd + 8;
    const hashes = await Promise.all(
      (gltf.parser.json.images ?? []).map(async (image) => {
        const range = gltf.parser.json.bufferViews[image.bufferView];
        if (!range) return null;
        return sha256(
          new Uint8Array(bytes, binaryStart + (range.byteOffset ?? 0), range.byteLength),
        );
      }),
    );
    gltf.scene.traverse((node) => {
      if (!isMesh(node)) return;
      for (const material of [node.material].flat().filter(Boolean))
        for (const value of Object.values(material))
          if (isTexture(value)) {
            const index = gltf.parser.associations.get(value)?.textures,
              source = gltf.parser.json.textures?.[index]?.source;
            if (hashes[source]) value.userData.embeddedSha256 = hashes[source];
          }
    });
  }
  return gltf;
}

function shareLodTextures(models) {
  const canonical = new Map(),
    retired = new Set<THREE.Texture>(),
    images = new Set();
  for (const model of models)
    model.scene.traverse((node) => {
      for (const material of [node.material].flat().filter(Boolean))
        for (const [slot, texture] of Object.entries(material)) {
          if (!isTexture(texture)) continue;
          const hash = texture.userData.embeddedSha256;
          if (!hash) {
            images.add(texture.source?.data);
            continue;
          }
          const key = [
            hash,
            texture.colorSpace,
            texture.wrapS,
            texture.wrapT,
            texture.minFilter,
            texture.magFilter,
            texture.flipY,
            texture.channel,
            ...texture.offset.toArray(),
            ...texture.repeat.toArray(),
            texture.rotation,
          ].join(':');
          if (canonical.has(key) && canonical.get(key) !== texture) {
            material[slot] = canonical.get(key);
            retired.add(texture);
          } else {
            canonical.set(key, texture);
            images.add(texture.source?.data);
          }
        }
    });
  const closed = new Set();
  for (const texture of retired) {
    texture.dispose();
    const data = texture.source?.data;
    if (!images.has(data) && !closed.has(data)) {
      (data as ImageBitmap | undefined)?.close?.();
      closed.add(data);
    }
  }
}

export class WorldAssets {
  declare environmentLoader: typeof loadVerifiedGLB;
  declare templates: Map<any, any>;
  declare surfaceTemplates: Map<any, any>;
  declare animals: Set<any>;
  declare enemyLoads: Map<any, any>;
  declare equipmentLoads: Map<any, any>;
  declare environmentLoads: Map<any, any>;
  declare environmentQueue: any[];
  declare environmentActive: number;
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
    this.environmentQueue = [];
    this.environmentActive = 0;
    this.disposed = false;
  }
  async load() {
    const started = performance.now();
    const response = await fetch('/models/world-assets.json');
    if (!response.ok) throw new Error(`World assets: HTTP ${response.status}`);
    this.catalog = await response.json();
    if (this.catalog.status !== 'ready' || !Array.isArray(this.catalog.assets))
      throw new Error('World model catalog is not ready');
    const pending = this.catalog.assets.filter(
      (asset) => asset.kind !== 'enemy' && !asset.onDemand,
    );
    // Bound concurrent texture decoding while keeping independent downloads busy.
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (pending.length) {
          const asset = pending.shift(),
            gltf = await loadVerifiedGLB(asset);
          const lods = [];
          try {
            for (const lod of asset.lods ?? []) lods.push(await loadVerifiedGLB(lod));
          } catch (error) {
            for (const model of [gltf, ...lods]) disposeTemplate(model.scene);
            throw error;
          }
          if (this.disposed) {
            for (const model of [gltf, ...lods]) disposeTemplate(model.scene);
            continue;
          }
          shareLodTextures([gltf, ...lods]);
          for (const model of [gltf, ...lods]) {
            model.scene.updateMatrixWorld(true);
            model.scene.traverse((node) => {
              if (!isMesh(node)) return;
              node.castShadow = true;
              node.receiveShadow = true;
            });
          }
          this.templates.set(asset.modelKey, { gltf, lods, asset });
        }
      }),
    ).catch((error) => {
      this.dispose();
      throw error;
    });
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
  ensureEnvironment(key) {
    if (this.disposed) return Promise.reject(new Error('World assets disposed'));
    if (this.templates.has(key)) return Promise.resolve(this.get(key));
    if (this.environmentLoads.has(key)) return this.environmentLoads.get(key);
    const asset = this.catalog.assets.find(
      (record) => record.modelKey === key && record.environment,
    );
    if (!asset) return Promise.reject(new Error(`Missing verified environment ${key}`));
    const promise = new Promise((resolve, reject) =>
      this.environmentQueue.push({ asset, resolve, reject }),
    );
    this.environmentLoads.set(key, promise);
    this.pumpEnvironment();
    return promise;
  }
  pumpEnvironment() {
    while (this.environmentActive < 2 && this.environmentQueue.length) {
      const job = this.environmentQueue.shift();
      this.environmentActive++;
      (async () => {
        const models = [];
        try {
          if (this.disposed) throw new Error('World assets disposed');
          for (const record of [job.asset, ...(job.asset.lods ?? [])]) {
            models.push(await this.environmentLoader(record));
            if (this.disposed) throw new Error('World assets disposed');
          }
          shareLodTextures(models);
          for (const model of models) {
            model.scene.updateMatrixWorld(true);
            model.scene.traverse((node) => {
              if (isMesh(node)) {
                node.castShadow = true;
                node.receiveShadow = true;
              }
            });
          }
          const template = { asset: job.asset, gltf: models[0], lods: models.slice(1) };
          this.templates.set(job.asset.modelKey, template);
          job.resolve(template);
        } catch (error) {
          for (const model of models) disposeTemplate(model.scene);
          job.reject(error);
        } finally {
          this.environmentActive--;
          this.environmentLoads.delete(job.asset.modelKey);
          this.pumpEnvironment();
        }
      })();
    }
  }
  releaseEnvironment(key) {
    const template = this.templates.get(key);
    if (!template?.asset.environment || !template.asset.onDemand) return;
    for (const model of [template.gltf, ...template.lods]) disposeTemplate(model.scene);
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
      root.addLevel(this.create(key, index + 1, surface), index === 0 ? 10 : 22, 0.15);
    }
    return root;
  }
  async createEquipment(key) {
    if (this.templates.has(key)) return this.create(key);
    if (!this.equipmentLoads.has(key))
      this.equipmentLoads.set(
        key,
        (async () => {
          const asset = this.catalog.assets.find(
            (record) => record.modelKey === key && record.kind === 'equipment',
          );
          if (!asset) throw new Error(`Missing verified equipment ${key}`);
          const gltf = await loadVerifiedGLB(asset);
          if (this.disposed) {
            disposeTemplate(gltf.scene);
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
        })(),
      );
    await this.equipmentLoads.get(key);
    return this.disposed ? null : this.create(key);
  }
  createAnimal(key) {
    const { gltf, asset } = this.get(key),
      root = cloneSkeleton(gltf.scene),
      mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>(
      gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]),
    );
    let current = null;
    const retiring = new Map();
    const actor = {
      root,
      asset,
      mixer,
      name: null,
      play(name, speed = 1) {
        const next = actions.get(name);
        if (!next) throw new Error(`${key}: missing clip ${name}`);
        next.timeScale = speed;
        if (next === current) return;
        retiring.delete(next);
        next.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = false;
        next.play();
        if (current) {
          next.crossFadeFrom(current, 0.45, false);
          retiring.set(current, 0.45);
        }
        current = next;
        actor.name = name;
      },
      sampleOnce(name, elapsed) {
        const next = actions.get(name);
        if (!next) throw new Error(`${key}: missing clip ${name}`);
        if (next !== current) {
          mixer.stopAllAction();
          retiring.clear();
          next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
          next.play();
          current = next;
          actor.name = name;
        }
        next.time = Math.min(next.getClip().duration, Math.max(0, elapsed));
        mixer.update(0);
      },
      stop() {
        mixer.stopAllAction();
        retiring.clear();
        current = null;
        actor.name = null;
      },
      update(dt) {
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
        root.traverse((node) => {
          if (isSkinnedMesh(node)) node.skeleton.dispose();
        });
      },
    };
    this.animals.add(actor);
    actor.play('Idle_Loop');
    return actor;
  }
  async createEnemy(key) {
    // Older servers have no enemies: only require this verified model when a
    // snapshot actually contains one. Concurrent instances share one download.
    if (!this.enemyLoads.has(key))
      this.enemyLoads.set(
        key,
        (async () => {
          const asset = this.catalog.assets.find(
            (record) => record.modelKey === key && record.kind === 'enemy',
          );
          if (!asset) throw new Error(`Missing verified enemy ${key}`);
          const gltf = await loadVerifiedGLB(asset);
          try {
            requireEnemyClips(gltf.animations, key);
          } catch (error) {
            disposeTemplate(gltf.scene);
            throw error;
          }
          if (this.disposed) {
            disposeTemplate(gltf.scene);
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
        })(),
      );
    await this.enemyLoads.get(key);
    return this.disposed ? null : this.createAnimal(key);
  }
  dispose() {
    this.disposed = true;
    for (const template of this.surfaceTemplates.values()) template.dispose();
    this.surfaceTemplates.clear();
    for (const actor of this.animals) actor.dispose();
    for (const { gltf, lods } of this.templates.values())
      for (const model of [gltf, ...lods]) disposeTemplate(model.scene);
    this.templates.clear();
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
  const previous = renderer.getRenderTarget(),
    clear = renderer.getClearColor(new THREE.Color()),
    alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
  const geometry = new THREE.PlaneGeometry(halfWidth * 2, halfHeight * 2);
  geometry.translate(centre.x, centre.y, 0);
  const material = new THREE.MeshBasicMaterial({
    map: target.texture,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: true,
  });
  return { target, geometry, material };
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
  private viewUpdate = new ViewUpdateGate();
  updates = 0;
  matrixUploadBytes = 0;
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
        const mesh = new THREE.InstancedMesh(node.geometry, node.material, this.capacity);
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
    this.matrix = new THREE.Matrix4();
    this.composed = new THREE.Matrix4();
    this.rotation = new THREE.Quaternion();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.sphere = new THREE.Sphere();
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
  }
  update(camera, time, riderFocus = null) {
    if (!(this.viewUpdate ??= new ViewUpdateGate()).shouldUpdate(camera, time, riderFocus)) return;
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
      const distance = item.position.distanceTo(camera.position);
      if (distance > this.distances[2]) continue;
      // A raised riding camera can enter a canopy. Cull only the trees blocking
      // its short sight line; the body colliders and other players' views remain.
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
      for (const { mesh, local } of this.levels[level])
        mesh.setMatrixAt(counts[level], this.composed.multiplyMatrices(this.matrix, local));
      counts[level]++;
    }
    for (const [level, meshes] of this.levels.entries())
      for (const { mesh } of meshes) {
        mesh.count = counts[level];
        this.matrixUploadBytes = (this.matrixUploadBytes ?? 0) + markActiveInstances(mesh);
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
  }
}
