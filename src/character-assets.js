import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAnimation } from './character-animation.js';

export function handGripPlacement(root) {
  root.updateMatrixWorld(true);
  const grip = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
  const rotation = new THREE.Quaternion();
  if (grip) {
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(grip.getWorldQuaternion(new THREE.Quaternion()).invert());
    rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localUp);
  }
  return { grip, rotation };
}

function disposeScene(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of node.material ? [node.material].flat() : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (node.isSkinnedMesh) node.skeleton.dispose();
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => { value.dispose(); value.source?.data?.close?.(); });
}

// One template per world; geometry/textures are shared, bones/mixers are not.
export class CharacterAssets {
  constructor(manifestURL = '/models/cro-magnon-woman/asset.json') {
    this.manifestURL = manifestURL; this.instances = new Set(); this.disposed = false;
  }

  load() {
    this.pending ??= this.loadTemplate();
    return this.pending;
  }

  async loadTemplate() {
    const started = performance.now();
    const response = await fetch(this.manifestURL);
    if (!response.ok) throw new Error(`Character manifest: HTTP ${response.status}`);
    const asset = await response.json();
    const url = new URL(asset.url, location.origin);
    if (url.origin !== location.origin) throw new Error('Character must be served by this game');
    const file = await fetch(url);
    if (!file.ok) throw new Error(`Character GLB: HTTP ${file.status}`);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== asset.bytes) throw new Error('Character GLB length does not match its verified manifest');
    // LAN play over HTTP has no SubtleCrypto. Delivery is also hashed offline;
    // secure contexts additionally verify the exact bytes in the client.
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.sha256) throw new Error('Character GLB hash does not match its verified manifest');
    }
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(resource => {
      if (!resource.startsWith('blob:') && !resource.startsWith('data:')) throw new Error('Character GLB has an external resource');
      return resource;
    });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    if (this.disposed) { disposeScene(gltf.scene); return null; }
    this.loadMilliseconds = performance.now() - started;
    this.template = { gltf, asset };
    return this.template;
  }

  async create({ color }) {
    const template = await this.load();
    if (!template || this.disposed) return null;
    const { gltf, asset } = template;
    const root = clone(gltf.scene), personalMaterials = new Map();
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const tint = original => {
        if (original.name !== 'TribeAccent') return original;
        if (!personalMaterials.has(original)) {
          const material = original.clone();
          material.color.set(color);
          personalMaterials.set(original, material);
        }
        return personalMaterials.get(original);
      };
      node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    });
    const { rotation: gripUp } = handGripPlacement(root);
    const animation = new CharacterAnimation(root, gltf.animations, {
      walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond, runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    });
    animation.mixer.update(Math.random() * animation.current.getClip().duration);
    const instance = {
      root, animation, asset, gripUp,
      dispose: () => {
        if (!this.instances.delete(instance)) return;
        animation.dispose();
        root.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
        personalMaterials.forEach(material => material.dispose());
      },
    };
    this.instances.add(instance);
    return instance;
  }

  dispose() {
    this.disposed = true;
    for (const instance of this.instances) instance.dispose();
    if (this.template) disposeScene(this.template.gltf.scene);
    this.template = null;
  }
}
