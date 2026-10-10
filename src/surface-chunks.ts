import * as THREE from 'three';
import { isMesh } from './three-types.js';

/** Partition an opaque, static triangle surface for frustum culling. Every
 * triangle retains its exact indices, winding and attributes; only its draw
 * batch changes. Long triangles stay whole and expand their chunk's bounds. */
export function surfaceChunks(source: THREE.BufferGeometry, cellSize = 64): THREE.BufferGeometry[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Invalid surface chunk size');
  const position = source.getAttribute('position'),
    index = source.getIndex();
  const count = index?.count ?? position?.count ?? 0;
  if (
    !position ||
    count < 3000 ||
    count % 3 ||
    source.groups.length > 1 ||
    source.groups.some(
      (group) => group.start !== 0 || group.count !== count || group.materialIndex !== 0,
    ) ||
    source.drawRange.start !== 0 ||
    source.drawRange.count < count ||
    Object.keys(source.morphAttributes).length
  )
    return [];
  const groups = new Map<string, { indices: number[]; bounds: THREE.Box3 }>();
  const point = new THREE.Vector3();
  const at = (i: number) => (index ? index.getX(i) : i);
  for (let offset = 0; offset < count; offset += 3) {
    const a = at(offset),
      b = at(offset + 1),
      c = at(offset + 2);
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
      z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    let group = groups.get(key);
    if (!group) {
      group = { indices: [], bounds: new THREE.Box3() };
      groups.set(key, group);
    }
    group.indices.push(a, b, c);
    for (const i of [a, b, c]) group.bounds.expandByPoint(point.fromBufferAttribute(position, i));
  }
  if (groups.size <= 1) return [];
  return [...groups].map(([key, group]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.name = `${source.name || 'surface'} chunk ${key}`;
    // Shared immutable attributes upload once. All chunks belong to the same
    // template lifetime and are released together by its existing collector.
    for (const [name, attribute] of Object.entries(source.attributes))
      geometry.setAttribute(name, attribute);
    geometry.setIndex(group.indices);
    geometry.boundingBox = group.bounds;
    geometry.boundingSphere = group.bounds.getBoundingSphere(new THREE.Sphere());
    return geometry;
  });
}

/** The fitted mountain template is still undrawn here. Replace only its large
 * opaque static meshes; its instances then share the same chunk geometries.
 * Its original vertex buffers, local transform and material stay unchanged. */
export function chunkMountainSurface(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  let changed = 0;
  for (const mesh of meshes) {
    if (
      !mesh.parent ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      Array.isArray(mesh.material) ||
      mesh.material.transparent ||
      mesh.children.length
    )
      continue;
    const chunks = surfaceChunks(mesh.geometry);
    if (!chunks.length) continue;
    const holder = new THREE.Group().copy(mesh, false);
    for (const geometry of chunks) {
      const part = new THREE.Mesh(geometry, mesh.material);
      part.name = geometry.name;
      part.castShadow = mesh.castShadow;
      part.receiveShadow = mesh.receiveShadow;
      part.renderOrder = mesh.renderOrder;
      part.layers.mask = mesh.layers.mask;
      holder.add(part);
    }
    mesh.parent.add(holder);
    mesh.removeFromParent();
    // No GPU copy exists before first presentation. This retires the superseded
    // index buffer without changing the attributes shared by the new chunks.
    mesh.geometry.dispose();
    changed += chunks.length;
  }
  return changed;
}
