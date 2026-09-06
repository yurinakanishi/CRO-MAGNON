import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

function disposeTemplate(root) {
  const resources = new Set();
  root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.skeleton) resources.add(node.skeleton);
    for (const material of [node.material].flat().filter(Boolean)) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const value of resources) { value.dispose(); if (value.isTexture) value.source?.data?.close?.(); }
}

export async function loadVerifiedGLB(record) {
  const url = new URL(record.url, location.origin);
  if (url.origin !== location.origin) throw new Error('Models must be served by this game');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${record.url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== record.bytes) throw new Error(`${record.url}: file length mismatch`);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== record.sha256) throw new Error(`${record.url}: SHA-256 mismatch`);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('GLB must embed its resources');
    return url;
  });
  return new GLTFLoader(manager).parseAsync(bytes, '');
}

export class WorldAssets {
  constructor() { this.templates = new Map(); this.animals = new Set(); this.disposed = false; }
  async load() {
    const started = performance.now();
    const response = await fetch('/models/world-assets.json');
    if (!response.ok) throw new Error(`World assets: HTTP ${response.status}`);
    this.catalog = await response.json();
    if (this.catalog.status !== 'ready' || !Array.isArray(this.catalog.assets)) throw new Error('World model catalog is not ready');
    const pending = [...this.catalog.assets];
    // Bound concurrent texture decoding while keeping independent downloads busy.
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (pending.length) {
        const asset = pending.shift(), gltf = await loadVerifiedGLB(asset);
        const lods = [];
        try {
          for (const lod of asset.lods ?? []) lods.push(await loadVerifiedGLB(lod));
        } catch (error) {
          for (const model of [gltf, ...lods]) disposeTemplate(model.scene);
          throw error;
        }
        if (this.disposed) { for (const model of [gltf, ...lods]) disposeTemplate(model.scene); continue; }
        for (const model of [gltf, ...lods]) {
          model.scene.updateMatrixWorld(true);
          model.scene.traverse(node => {
            if (!node.isMesh) return;
            node.castShadow = true; node.receiveShadow = true;
          });
        }
        this.templates.set(asset.modelKey, { gltf, lods, asset });
      }
    })).catch(error => { this.dispose(); throw error; });
    this.loadMilliseconds = performance.now() - started;
    return this;
  }
  get(key) {
    const template = this.templates.get(key);
    if (!template) throw new Error(`Missing model ${key}`);
    return template;
  }
  create(key, level = 0) {
    const template = this.get(key), model = level ? template.lods[level - 1] ?? template.gltf : template.gltf;
    const root = model.scene.clone(true);
    root.userData.assetKey = key;
    return root;
  }
  createResource(key) {
    const template = this.get(key);
    if (!template.lods.length) return this.create(key);
    const root = new THREE.LOD();
    root.userData.assetKey = key;
    root.addLevel(this.create(key), 0);
    for (let index = 0; index < template.lods.length; index++) {
      root.addLevel(this.create(key, index + 1), index === 0 ? 10 : 22, .15);
    }
    return root;
  }
  createAnimal(key) {
    const { gltf, asset } = this.get(key), root = cloneSkeleton(gltf.scene), mixer = new THREE.AnimationMixer(root);
    const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
    let current = null;
    const actor = {
      root, asset, mixer, name: null,
      play(name, speed = 1) {
        const next = actions.get(name);
        if (!next) throw new Error(`${key}: missing clip ${name}`);
        next.timeScale = speed;
        if (next === current) return;
        next.reset().play(); if (current) { next.crossFadeFrom(current, .45, false); } current = next; actor.name = name;
      },
      update: dt => mixer.update(dt),
      dispose: () => {
        if (!this.animals.delete(actor)) return;
        mixer.stopAllAction(); mixer.uncacheRoot(root);
        root.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
      },
    };
    this.animals.add(actor); actor.play('Idle_Loop'); return actor;
  }
  dispose() {
    this.disposed = true;
    for (const actor of this.animals) actor.dispose();
    for (const { gltf, lods } of this.templates.values()) for (const model of [gltf, ...lods]) disposeTemplate(model.scene);
    this.templates.clear();
  }
}

// Far vegetation is a render of the actual GLB. The quad is only an impostor LOD;
// nearby vegetation uses the reconstructed mesh, including its source UV/albedo.
function renderImpostor(renderer, root) {
  const scene = new THREE.Scene(), subject = root.clone(true);
  scene.add(subject, new THREE.HemisphereLight('#e4e5cc', '#596044', 2.5));
  const sun = new THREE.DirectionalLight('#fff1d4', 2.1); sun.position.set(-4, 8, 5); scene.add(sun);
  const bounds = new THREE.Box3().setFromObject(subject), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
  const halfWidth = Math.max(size.x, size.z) * .56, halfHeight = size.y * .55;
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, .01, size.length() * 5);
  camera.position.copy(centre).add(new THREE.Vector3(0, 0, size.length() * 2)); camera.lookAt(centre);
  // Three.js renders offscreen targets in linear light without tone mapping.
  // Retain HDR where supported and apply the game's tone mapping when displaying
  // the impostor, just as for nearby reconstructed geometry.
  const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const target = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true, type });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const previous = renderer.getRenderTarget(), clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
  renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha);
  const geometry = new THREE.PlaneGeometry(halfWidth * 2, halfHeight * 2); geometry.translate(centre.x, centre.y, 0);
  const material = new THREE.MeshBasicMaterial({ map: target.texture, alphaTest: .45, side: THREE.DoubleSide, toneMapped: true, fog: true });
  return { target, geometry, material };
}

export class LandscapeInstances {
  constructor({ assets, key, placements, renderer, scene, distances, foliage = false }) {
    this.placements = placements; this.distances = distances; this.scene = scene; this.levels = []; this.nextUpdate = 0;
    const template = assets.get(key);
    for (const model of [template.gltf, template.lods[0] ?? template.gltf]) {
      const meshes = []; model.scene.updateMatrixWorld(true);
      model.scene.traverse(node => {
        if (!node.isMesh) return;
        const mesh = new THREE.InstancedMesh(node.geometry, node.material, placements.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
        mesh.castShadow = !foliage; mesh.receiveShadow = true; scene.add(mesh); meshes.push({ mesh, local: node.matrixWorld.clone() });
      });
      this.levels.push(meshes);
    }
    this.impostor = renderImpostor(renderer, template.gltf.scene);
    const billboard = new THREE.InstancedMesh(this.impostor.geometry, this.impostor.material, placements.length);
    billboard.instanceMatrix.setUsage(THREE.DynamicDrawUsage); billboard.count = 0; billboard.frustumCulled = false; scene.add(billboard);
    this.levels.push([{ mesh: billboard, local: new THREE.Matrix4() }]);
    this.matrix = new THREE.Matrix4(); this.composed = new THREE.Matrix4(); this.rotation = new THREE.Quaternion(); this.axis = new THREE.Vector3(0, 1, 0); this.sphere = new THREE.Sphere();
    this.frustum = new THREE.Frustum(); this.projection = new THREE.Matrix4();
  }
  update(camera, time) {
    if (time < this.nextUpdate) return; this.nextUpdate = time + .18;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projection);
    const counts = [0, 0, 0];
    for (const item of this.placements) {
      const distance = item.position.distanceTo(camera.position);
      if (distance > this.distances[2]) continue;
      this.sphere.center.copy(item.position); this.sphere.center.y += item.height * .5; this.sphere.radius = item.height * .75;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const level = distance < this.distances[0] ? 0 : distance < this.distances[1] ? 1 : 2;
      const yaw = level === 2 ? Math.atan2(camera.position.x - item.position.x, camera.position.z - item.position.z) : item.yaw;
      this.rotation.setFromAxisAngle(this.axis, yaw); this.matrix.compose(item.position, this.rotation, item.scale);
      for (const { mesh, local } of this.levels[level]) mesh.setMatrixAt(counts[level], this.composed.multiplyMatrices(this.matrix, local));
      counts[level]++;
    }
    for (const [level, meshes] of this.levels.entries()) for (const { mesh } of meshes) { mesh.count = counts[level]; mesh.instanceMatrix.needsUpdate = true; }
  }
  dispose() {
    for (const meshes of this.levels) for (const { mesh } of meshes) { this.scene.remove(mesh); mesh.dispose(); }
    this.impostor.geometry.dispose(); this.impostor.material.dispose(); this.impostor.target.dispose();
  }
}
