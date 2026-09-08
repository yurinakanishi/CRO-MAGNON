import type * as THREE from 'three';

/** Three's runtime flags also work across duplicated module instances. */
export function isTexture(value: unknown): value is THREE.Texture {
  return !!value && typeof value === 'object' && 'isTexture' in value && value.isTexture === true;
}
export function isMesh(value: unknown): value is THREE.Mesh {
  return !!value && typeof value === 'object' && 'isMesh' in value && value.isMesh === true;
}
export function isSkinnedMesh(value: unknown): value is THREE.SkinnedMesh {
  return (
    !!value && typeof value === 'object' && 'isSkinnedMesh' in value && value.isSkinnedMesh === true
  );
}
