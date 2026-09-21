import * as THREE from 'three';
import { isSkinnedMesh } from './three-types.js';

type Bounds = {
  bind: THREE.Matrix4;
  inverses: THREE.Matrix4[];
  boxes: THREE.Box3[];
  centres: THREE.Vector3[];
  halves: THREE.Vector3[];
  weightError: number;
};
const cache = new WeakMap<THREE.BufferGeometry, Bounds[]>();
const installed = new WeakSet<THREE.SkinnedMesh>();

function boneBounds(mesh: THREE.SkinnedMesh): Bounds {
  const records = cache.get(mesh.geometry) ?? [];
  const existing = records.find(
    (r) => r.inverses === mesh.skeleton.boneInverses && r.bind.equals(mesh.bindMatrix),
  );
  if (existing) return existing;
  const boxes = mesh.skeleton.bones.map(() => new THREE.Box3());
  const transforms = mesh.skeleton.boneInverses.map((m) => m.clone().multiply(mesh.bindMatrix));
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const vertex = new THREE.Vector3(),
    point = new THREE.Vector3();
  let weightError = 0;
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      const weight = skinWeight.getComponent(i, j);
      if (weight < 0 || !Number.isFinite(weight)) throw new Error('Invalid skin weight');
      sum += weight;
      if (!weight) continue;
      const bone = skinIndex.getComponent(i, j);
      boxes[bone].expandByPoint(point.copy(vertex).applyMatrix4(transforms[bone]));
    }
    weightError = Math.max(weightError, Math.abs(sum - 1));
  }
  const bounds = {
    bind: mesh.bindMatrix.clone(),
    inverses: mesh.skeleton.boneInverses,
    boxes,
    centres: boxes.map((b) => b.getCenter(new THREE.Vector3())),
    halves: boxes.map((b) => b.getSize(new THREE.Vector3()).multiplyScalar(0.5)),
    weightError,
  };
  records.push(bounds);
  cache.set(mesh.geometry, records);
  return bounds;
}

/** A skinned vertex is a convex combination of its bone-transformed positions.
 * Union the transformed influence boxes to enclose every vertex without skinning
 * tens of thousands of vertices on its first visible frame. Transforming all
 * eight box corners also supports nonuniform scales and sheared parent matrices.
 * This affects culling only, never mesh geometry, animation or gameplay collision. */
export function installSkinnedBounds(root: THREE.Object3D) {
  root.traverse((mesh) => {
    if (
      !isSkinnedMesh(mesh) ||
      installed.has(mesh) ||
      mesh.geometry.morphAttributes.position?.length
    )
      return;
    const bounds = boneBounds(mesh);
    const box = new THREE.Box3(),
      matrix = new THREE.Matrix4();
    const sphere = new THREE.Sphere();
    // Runtime Three.js uses null as its lazy-bound sentinel; @types declares Sphere.
    const mutable: { boundingSphere: THREE.Sphere | null } = mesh;
    mesh.computeBoundingSphere = function () {
      box.makeEmpty();
      for (let i = 0; i < bounds.boxes.length; i++) {
        if (bounds.boxes[i].isEmpty()) continue;
        matrix.multiplyMatrices(this.bindMatrixInverse, this.skeleton.bones[i].matrixWorld);
        // Affine AABB transform: centre' = M centre, half' = abs(M) half.
        // Exactly the same bounds as transforming eight corners, without the
        // temporary vectors and repeated transforms for every bone every frame.
        const e = matrix.elements,
          c = bounds.centres[i],
          h = bounds.halves[i];
        const x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12],
          y = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13],
          z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14],
          hx = Math.abs(e[0]) * h.x + Math.abs(e[4]) * h.y + Math.abs(e[8]) * h.z,
          hy = Math.abs(e[1]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[9]) * h.z,
          hz = Math.abs(e[2]) * h.x + Math.abs(e[6]) * h.y + Math.abs(e[10]) * h.z;
        box.min.x = Math.min(box.min.x, x - hx);
        box.max.x = Math.max(box.max.x, x + hx);
        box.min.y = Math.min(box.min.y, y - hy);
        box.max.y = Math.max(box.max.y, y + hy);
        box.min.z = Math.min(box.min.z, z - hz);
        box.max.z = Math.max(box.max.z, z + hz);
      }
      // Include the zero-weight result and floating-point normalization error.
      const e = this.bindMatrixInverse.elements;
      if (box.isEmpty())
        box.setFromCenterAndSize(new THREE.Vector3(e[12], e[13], e[14]), new THREE.Vector3());
      const extent = Math.max(
        Math.abs(box.min.x),
        Math.abs(box.max.x),
        Math.abs(box.min.y),
        Math.abs(box.max.y),
        Math.abs(box.min.z),
        Math.abs(box.max.z),
      );
      box.expandByScalar(
        bounds.weightError *
          (extent + Math.max(Math.abs(e[12]), Math.abs(e[13]), Math.abs(e[14]))) +
          1e-5,
      );
      this.boundingSphere = box.getBoundingSphere(sphere);
    };
    const update = mesh.updateMatrixWorld;
    mesh.updateMatrixWorld = function (force?: boolean) {
      update.call(this, force);
      // The renderer queries after the entire hierarchy (including sibling
      // bones) has updated, not halfway through the scene traversal.
      mutable.boundingSphere = null;
    };
    mutable.boundingSphere = null;
    installed.add(mesh);
  });
}
