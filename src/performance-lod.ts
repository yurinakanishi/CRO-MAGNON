import * as THREE from 'three';
import { isMesh, isSkinnedMesh } from './three-types.js';

export const ACTOR_LOD_DISTANCE = 28;
export const ACTOR_LOD_HYSTERESIS = 2;
/** The one graphics profile switches actors at half their authored LOD distance. */
export const ACTOR_LOD_SCALE = 0.5;

type ActorMaterial = THREE.Material | THREE.Material[];

type ActorMeshLevel = {
  mesh: THREE.Mesh;
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  /** The adopted material (tinted or recompiled per actor), worn with the close geometry. */
  highMaterial: ActorMaterial;
  /** Worn with the reduced geometry: highMaterial itself, or this actor's compatible variant. */
  lowMaterial: ActorMaterial;
};

type ActorDetail = {
  level: 0 | 1;
  meshes: ActorMeshLevel[];
  /** Materials this actor owns, released by disposeActorPerformance. */
  variants: THREE.Material[];
};

type ActorAsset = { modelKey: string; lods?: { distanceMetres?: number }[] };

// GLTFLoader.assignFinalMaterial (three r185) finalizes a glTF material for the geometry it is
// drawn with: without a tangent attribute the normal map uses derivative tangents, so it negates
// normalScale.y and clearcoatNormalScale.y; with a colour attribute it sets vertexColors; without
// normals it sets flatShading. A reduced GLB can differ from the close one in these attributes
// while the actor keeps the close mesh's material, so the reduced level wears that material
// finalized again for its own geometry.
function finalState(geometry: THREE.BufferGeometry) {
  const { tangent, color, normal } = geometry.attributes;
  return { derivativeTangents: !tangent, vertexColors: !!color, flatShading: !normal };
}

// The adopted material for the reduced geometry: the same object when the two geometries need the
// same final state, otherwise one variant per adopted material and change, owned by this actor. A
// variant keeps everything the adopted material has (textures by reference, colour, the
// onBeforeCompile/customProgramCacheKey hooks Material.copy drops, and its userData object).
function compatibleMaterial(
  material: ActorMaterial,
  from: THREE.BufferGeometry,
  to: THREE.BufferGeometry,
  owned: Map<THREE.Material, Map<string, THREE.Material>>,
  variants: THREE.Material[],
): ActorMaterial {
  const close = finalState(from),
    far = finalState(to);
  const flip = close.derivativeTangents !== far.derivativeTangents,
    colors = close.vertexColors !== far.vertexColors,
    flat = close.flatShading !== far.flatShading;
  if (!flip && !colors && !flat) return material;
  const change = `${+flip}${+colors}${+flat}`;
  const variant = (source: THREE.Material) => {
    const standard = source as THREE.Material & {
      normalScale?: THREE.Vector2;
      clearcoatNormalScale?: THREE.Vector2;
      flatShading?: boolean;
    };
    if (
      !(flip && (standard.normalScale || standard.clearcoatNormalScale)) &&
      !(colors && source.vertexColors !== far.vertexColors) &&
      !(flat && (standard.flatShading ?? false) !== far.flatShading)
    )
      return source;
    const byChange = owned.get(source) ?? new Map<string, THREE.Material>();
    owned.set(source, byChange);
    const existing = byChange.get(change);
    if (existing) return existing;
    const copy = source.clone() as typeof standard;
    const hooks = source as unknown as Record<string, unknown>,
      target = copy as unknown as Record<string, unknown>;
    for (const key of Object.keys(hooks))
      if (typeof hooks[key] === 'function') target[key] = hooks[key];
    copy.userData = source.userData;
    if (source.defines) copy.defines = { ...source.defines };
    if (flip) {
      if (copy.normalScale) copy.normalScale.y *= -1;
      if (copy.clearcoatNormalScale) copy.clearcoatNormalScale.y *= -1;
    }
    if (colors) copy.vertexColors = far.vertexColors;
    if (flat) copy.flatShading = far.flatShading;
    byChange.set(change, copy);
    variants.push(copy);
    return copy;
  };
  if (!Array.isArray(material)) return variant(material);
  const list = material.map(variant);
  return list.every((entry, i) => entry === material[i]) ? material : list;
}

/** Bind a reduced, geometry-only GLB to the adopted animated meshes. The
 * skeleton, clips, materials, transforms and gameplay collision remain those
 * of the close model; a material changes only where the reduced geometry needs
 * another final state (compatibleMaterial). There is no sun shadow map, so no
 * shadow-only helper. */
export function configureActorPerformance(
  root: THREE.Object3D,
  lowRoot: THREE.Object3D | null | undefined,
  asset: ActorAsset,
) {
  // A repeated configuration starts from the adopted state and releases its earlier variants.
  disposeActorPerformance(root);
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
  const pairs: [THREE.Mesh, THREE.BufferGeometry][] = [];
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
    pairs.push([mesh, reduced?.geometry ?? mesh.geometry]);
  }
  if (lowRoot && pairs.length !== highMeshes.length)
    throw new Error(`${asset.modelKey}: actor LOD mesh count mismatch`);
  const owned = new Map<THREE.Material, Map<string, THREE.Material>>(),
    variants: THREE.Material[] = [];
  const meshes: ActorMeshLevel[] = pairs.map(([mesh, low]) => ({
    mesh,
    high: mesh.geometry,
    low,
    highMaterial: mesh.material,
    lowMaterial: compatibleMaterial(mesh.material, mesh.geometry, low, owned, variants),
  }));
  const detail: ActorDetail = { level: 0, meshes, variants };
  root.userData.actorDetail = detail;
  root.userData.actorLodDistance = asset.lods?.[0]?.distanceMetres ?? ACTOR_LOD_DISTANCE;
  return detail;
}

export function updateActorPerformance(root: THREE.Object3D, distance: number) {
  const detail = root.userData.actorDetail as ActorDetail | undefined;
  if (!detail) return 0;
  const threshold = (root.userData.actorLodDistance ?? ACTOR_LOD_DISTANCE) * ACTOR_LOD_SCALE;
  const hysteresis = Math.min(ACTOR_LOD_HYSTERESIS, threshold * 0.2);
  const level = (
    detail.level === 0 ? distance > threshold + hysteresis : distance >= threshold - hysteresis
  )
    ? 1
    : 0;
  if (level !== detail.level) {
    for (const entry of detail.meshes) {
      entry.mesh.geometry = level ? entry.low : entry.high;
      entry.mesh.material = level ? entry.lowMaterial : entry.highMaterial;
    }
    detail.level = level;
  }
  return detail.level;
}

export function disposeActorPerformance(root: THREE.Object3D) {
  const detail = root.userData.actorDetail as ActorDetail | undefined;
  if (!detail) return;
  // Geometry, textures, skeleton and the adopted materials are owned by the actor/template;
  // only this actor's variants are released.
  for (const entry of detail.meshes) {
    entry.mesh.geometry = entry.high;
    entry.mesh.material = entry.highMaterial;
  }
  for (const material of detail.variants) material.dispose();
  delete root.userData.actorDetail;
}
