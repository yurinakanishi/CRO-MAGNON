import * as THREE from 'three';
import { isMesh, isSkinnedMesh } from './three-types.js';

export const ACTOR_LOD_DISTANCE = 28;
export const ACTOR_LOD_HYSTERESIS = 2;
export const ACTOR_SHADOW_LOD_DISTANCE = 18;
export const ACTOR_SHADOW_DISTANCE = 34;
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
  shadow: THREE.Mesh | null;
  castShadow: boolean;
  receiveShadow: boolean;
};

type ActorDetail = {
  level: 0 | 1;
  meshes: ActorMeshLevel[];
  shadowLevel: 0 | 1;
};

type ActorAsset = { modelKey: string; lods?: { distanceMetres?: number }[] };

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

function actorShadowMesh(source: THREE.Mesh, geometry: THREE.BufferGeometry) {
  // Keep cutouts, sidedness and displacement consistent with the visible mesh.
  const invisible = (original: THREE.Material) => {
    const material = original.clone();
    material.colorWrite = false;
    material.depthWrite = false;
    return material;
  };
  const material = Array.isArray(source.material)
    ? source.material.map(invisible)
    : invisible(source.material);
  let shadow: THREE.Mesh;
  if (isSkinnedMesh(source)) {
    const skin = new THREE.SkinnedMesh(geometry, material);
    skin.skeleton = source.skeleton;
    skin.bindMode = source.bindMode;
    skin.bindMatrix.copy(source.bindMatrix);
    skin.bindMatrixInverse.copy(source.bindMatrixInverse);
    shadow = skin;
  } else shadow = new THREE.Mesh(geometry, material);
  shadow.name = `${source.name}-lod-shadow`;
  shadow.userData.shadowOnly = true;
  shadow.castShadow = true;
  shadow.visible = false;
  shadow.matrixAutoUpdate = false;
  shadow.morphTargetInfluences = source.morphTargetInfluences;
  // Picking uses the visible animal surface, including when this helper is hidden.
  shadow.raycast = () => {};
  // Identity child transform keeps animated mesh transforms and the shared
  // skeleton in exactly the same world space, including rider/runtime poses.
  source.add(shadow);
  return shadow;
}

/** Bind a reduced, geometry-only GLB to the adopted animated meshes. The
 * skeleton, clips, materials, transforms and gameplay collision remain those
 * of the close model. */
export function configureActorPerformance(
  root: THREE.Object3D,
  lowRoot: THREE.Object3D | null | undefined,
  asset: ActorAsset,
) {
  const highMeshes: THREE.Mesh[] = [],
    lowMeshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (!isMesh(node)) return;
    highMeshes.push(node);
  });
  lowRoot?.traverse((node) => {
    if (isMesh(node)) lowMeshes.push(node);
  });
  const lowByName = new Map(lowMeshes.map((mesh) => [mesh.name, mesh]));
  const meshes: ActorMeshLevel[] = [];
  for (const [index, mesh] of highMeshes.entries()) {
    const reduced = lowByName.get(mesh.name) ?? lowMeshes[index];
    if (!reduced && lowRoot) continue;
    if (reduced && isSkinnedMesh(mesh) !== isSkinnedMesh(reduced))
      throw new Error(`${asset.modelKey}: actor LOD skin mismatch for ${mesh.name}`);
    if (
      reduced &&
      isSkinnedMesh(mesh) &&
      (!reduced.geometry.attributes.skinIndex || !reduced.geometry.attributes.skinWeight)
    )
      throw new Error(`${asset.modelKey}: actor LOD lost weights for ${mesh.name}`);
    meshes.push({
      mesh,
      high: mesh.geometry,
      low: reduced?.geometry ?? mesh.geometry,
      shadow: null,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
    });
  }
  if (lowRoot && meshes.length !== highMeshes.length)
    throw new Error(`${asset.modelKey}: actor LOD mesh count mismatch`);
  for (const entry of meshes) {
    entry.mesh.castShadow = true;
    entry.mesh.receiveShadow = true;
    if (entry.low !== entry.high) entry.shadow = actorShadowMesh(entry.mesh, entry.low);
  }
  const detail: ActorDetail = { level: 0, meshes, shadowLevel: 0 };
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
  detail.shadowLevel = (
    detail.shadowLevel === 0
      ? distance > ACTOR_SHADOW_LOD_DISTANCE + ACTOR_LOD_HYSTERESIS
      : distance >= ACTOR_SHADOW_LOD_DISTANCE - ACTOR_LOD_HYSTERESIS
  )
    ? 1
    : 0;
  const castsShadow = distance < ACTOR_SHADOW_DISTANCE;
  for (const entry of detail.meshes) {
    // When the visible mesh already uses the low geometry, cast it directly.
    // Never draw both the source and its shadow-only copy into the shadow map.
    const separate =
      castsShadow && detail.shadowLevel === 1 && detail.level === 0 && !!entry.shadow;
    entry.mesh.castShadow = castsShadow && !separate;
    if (entry.shadow) entry.shadow.visible = separate;
  }
  return detail.level;
}

export function disposeActorPerformance(root: THREE.Object3D) {
  const detail = root.userData.actorDetail as ActorDetail | undefined;
  if (!detail) return;
  for (const entry of detail.meshes) {
    entry.mesh.geometry = entry.high;
    entry.mesh.castShadow = entry.castShadow;
    entry.mesh.receiveShadow = entry.receiveShadow;
    if (!entry.shadow) continue;
    entry.shadow.removeFromParent();
    for (const material of [entry.shadow.material].flat()) material.dispose();
    // Geometry, textures and skeleton are owned by the actor/template.
  }
  delete root.userData.actorDetail;
}

const shadowDistances: Record<string, number> = {
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
