import * as THREE from 'three';
import { isMesh, isSkinnedMesh } from './three-types.js';

export const ACTOR_LOD_DISTANCE = 28;
export const ACTOR_LOD_HYSTERESIS = 2;
export const SIMPLIFIED_SHADOW_KEYS = new Set([
  'berry-bush',
  'hide-tent',
  'firewood-pile',
  'firewood-log',
  'stone-firepit',
]);

type ActorMeshLevel = {
  mesh: THREE.Mesh;
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
};

type ActorDetail = {
  level: 0 | 1;
  meshes: ActorMeshLevel[];
  proxy: THREE.Mesh;
};

function shadowOnlyMaterial() {
  const material = new THREE.MeshBasicMaterial();
  // The inexpensive proxy participates in the directional-light depth pass,
  // but contributes neither colour nor depth to the normal camera pass.
  material.colorWrite = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.side = THREE.DoubleSide;
  return material;
}

function boundsOf(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root).applyMatrix4(root.matrixWorld.clone().invert());
}

function actorShadowProxy(asset): THREE.Mesh {
  const placedMin = asset.placement?.min,
    placedMax = asset.placement?.max,
    horizontal =
      asset.kind === 'quadruped' ||
      (asset.kind === 'enemy' && (asset.lengthMetres ?? 0) > (asset.heightMetres ?? 1) * 1.15),
    height = asset.heightMetres ?? 1.8,
    width = asset.widthMetres ?? height * (horizontal ? 0.72 : 0.42),
    length = asset.lengthMetres ?? height * (horizontal ? 1.45 : 0.36),
    bounds =
      Array.isArray(placedMin) && Array.isArray(placedMax)
        ? new THREE.Box3(new THREE.Vector3(...placedMin), new THREE.Vector3(...placedMax))
        : new THREE.Box3(
            new THREE.Vector3(-width / 2, 0, -length / 2),
            new THREE.Vector3(width / 2, height, length / 2),
          ),
    size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  let geometry: THREE.BufferGeometry;
  if (horizontal) {
    geometry = new THREE.BoxGeometry(
      Math.max(0.25, size.x * 0.72),
      Math.max(0.25, size.y * 0.65),
      Math.max(0.35, size.z * 0.76),
    );
    centre.y = bounds.min.y + size.y * 0.43;
  } else {
    const radius = Math.max(0.13, Math.min(size.y * 0.23, Math.max(size.x, size.z) * 0.31));
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0.05, size.y - radius * 2), 4, 8);
  }
  const proxy = new THREE.Mesh(geometry, shadowOnlyMaterial());
  proxy.name = 'actor-simplified-shadow';
  proxy.position.copy(centre);
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.frustumCulled = true;
  return proxy;
}

/** Bind a reduced, geometry-only GLB to the adopted animated meshes. The
 * skeleton, clips, materials, transforms and gameplay collision remain those
 * of the close model. */
export function configureActorPerformance(
  root: THREE.Object3D,
  lowRoot: THREE.Object3D | null | undefined,
  asset,
) {
  const highMeshes: THREE.Mesh[] = [],
    lowMeshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (!isMesh(node)) return;
    node.castShadow = false;
    node.receiveShadow = true;
    highMeshes.push(node);
  });
  lowRoot?.traverse((node) => {
    if (isMesh(node)) lowMeshes.push(node);
  });
  const lowByName = new Map(lowMeshes.map((mesh) => [mesh.name, mesh]));
  const meshes: ActorMeshLevel[] = [];
  for (const [index, mesh] of highMeshes.entries()) {
    const reduced = lowByName.get(mesh.name) ?? lowMeshes[index];
    if (!reduced) continue;
    if (isSkinnedMesh(mesh) !== isSkinnedMesh(reduced))
      throw new Error(`${asset.modelKey}: actor LOD skin mismatch for ${mesh.name}`);
    if (
      isSkinnedMesh(mesh) &&
      (!reduced.geometry.attributes.skinIndex || !reduced.geometry.attributes.skinWeight)
    )
      throw new Error(`${asset.modelKey}: actor LOD lost weights for ${mesh.name}`);
    meshes.push({ mesh, high: mesh.geometry, low: reduced.geometry });
  }
  if (lowRoot && meshes.length !== highMeshes.length)
    throw new Error(`${asset.modelKey}: actor LOD mesh count mismatch`);
  const proxy = actorShadowProxy(asset);
  root.add(proxy);
  const detail: ActorDetail = { level: 0, meshes, proxy };
  root.userData.actorDetail = detail;
  root.userData.actorLodDistance = asset.lods?.[0]?.distanceMetres ?? ACTOR_LOD_DISTANCE;
  return detail;
}

export function updateActorPerformance(root: THREE.Object3D, distance: number) {
  const detail = root.userData.actorDetail as ActorDetail | undefined;
  if (!detail) return 0;
  const threshold = root.userData.actorLodDistance ?? ACTOR_LOD_DISTANCE;
  const level = (
    detail.level === 0
      ? distance > threshold + ACTOR_LOD_HYSTERESIS
      : distance >= threshold - ACTOR_LOD_HYSTERESIS
  )
    ? 1
    : 0;
  if (level !== detail.level) {
    for (const entry of detail.meshes) entry.mesh.geometry = level ? entry.low : entry.high;
    detail.level = level;
  }
  detail.proxy.castShadow = distance < 34;
  return detail.level;
}

export function disposeActorPerformance(root: THREE.Object3D) {
  const detail = root.userData.actorDetail as ActorDetail | undefined;
  if (!detail) return;
  for (const entry of detail.meshes) entry.mesh.geometry = entry.high;
  detail.proxy.removeFromParent();
  detail.proxy.geometry.dispose();
  for (const material of [detail.proxy.material].flat()) material.dispose();
  delete root.userData.actorDetail;
}

const shadowDistances = {
  'berry-bush': 18,
  'hide-tent': 32,
  'firewood-pile': 22,
  'firewood-log': 22,
  'stone-firepit': 24,
};

export function attachSimplifiedShadow(root: THREE.Object3D, key: string) {
  if (!SIMPLIFIED_SHADOW_KEYS.has(key) || root.userData.simplifiedShadow) return null;
  const bounds = boundsOf(root),
    size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  let geometry: THREE.BufferGeometry;
  if (key === 'berry-bush') geometry = new THREE.SphereGeometry(0.5, 8, 5);
  else if (key === 'stone-firepit')
    geometry = new THREE.CylinderGeometry(
      Math.max(size.x, size.z) * 0.48,
      Math.max(size.x, size.z) * 0.44,
      Math.max(0.08, size.y * 0.72),
      12,
      1,
    );
  else
    geometry = new THREE.BoxGeometry(
      Math.max(0.08, size.x * 0.86),
      Math.max(0.08, size.y * 0.78),
      Math.max(0.08, size.z * 0.86),
    );
  const proxy = new THREE.Mesh(geometry, shadowOnlyMaterial());
  proxy.name = `${key}-simplified-shadow`;
  proxy.position.copy(centre);
  if (key === 'berry-bush') proxy.scale.copy(size);
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  root.traverse((node) => {
    if (isMesh(node)) node.castShadow = false;
  });
  root.add(proxy);
  root.userData.simplifiedShadow = {
    proxy,
    distance: shadowDistances[key],
  };
  return proxy;
}

const shadowPosition = new THREE.Vector3();
export function updateSimplifiedShadow(root: THREE.Object3D, camera: THREE.Camera) {
  const detail = root.userData.simplifiedShadow;
  if (!detail) return;
  root.getWorldPosition(shadowPosition);
  detail.proxy.castShadow =
    shadowPosition.distanceToSquared(camera.position) < detail.distance * detail.distance;
}

export function disposeSimplifiedShadow(root: THREE.Object3D) {
  const detail = root.userData.simplifiedShadow;
  if (!detail) return;
  detail.proxy.removeFromParent();
  detail.proxy.geometry.dispose();
  for (const material of [detail.proxy.material].flat()) material.dispose();
  delete root.userData.simplifiedShadow;
}
