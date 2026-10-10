import * as THREE from 'three';
import { isSkinnedMesh } from './three-types.js';

const along = new THREE.Vector3(0, 1, 0);
type GripGeometry = { geometry: THREE.BufferGeometry; users: number };
const cache = new WeakMap<THREE.BufferGeometry, Map<string, GripGeometry>>();
const percentile = (values: number[], fraction: number) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

/** A reversible finger curl of the delivered surface, in the hand's bind frame.
 * The original vertices, UVs, weights and GLBs stay untouched. */
export class TorchGrasp {
  readonly grip = new THREE.Object3D();
  readonly normal = new THREE.Vector3(-1, 0, 0);
  readonly width = new THREE.Vector3(0, 0, 1);
  private meshes: THREE.SkinnedMesh[] = [];
  private replacements = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  private previous = new Map<
    THREE.SkinnedMesh,
    {
      influences: number[] | undefined;
      dictionary: { [name: string]: number } | undefined;
    }
  >();
  private baseY: number;
  private centre: number;
  private radius: number;
  private hand: THREE.Object3D;
  private cacheKey: string;

  constructor(
    private actor: THREE.Object3D,
    diameter: number,
  ) {
    this.hand = actor.getObjectByName('HandL')!;
    const points: THREE.Vector3[] = [];
    actor.traverse((mesh) => {
      if (!isSkinnedMesh(mesh)) return;
      this.meshes.push(mesh);
      this.handVertices(mesh, mesh.geometry, (point, weight) => {
        if (weight > 0.65) points.push(point.clone());
      });
    });
    const length = Math.max(...points.map((point) => point.y));
    this.baseY = length * 0.4;
    const palm = points.filter((point) => point.y > length * 0.2 && point.y < length * 0.55);
    const spread = (axis: 'x' | 'z') =>
      percentile(
        palm.map((p) => p[axis]),
        0.9,
      ) -
      percentile(
        palm.map((p) => p[axis]),
        0.1,
      );
    // Most hands have their palm normal on X; the octopus hand is authored on Z.
    if (spread('z') < spread('x') * 0.75) this.normal.set(0, 0, -1);
    this.width.crossVectors(this.normal, along);
    const thickness = palm.map((point) => point.dot(this.normal));
    const middle = percentile(thickness, 0.5);
    this.centre = percentile(thickness, 0.9) + diameter * 0.5;
    this.radius = Math.max(
      diameter * 0.4,
      Math.min(this.centre - middle, (length - this.baseY) / 2.6),
    );
    this.cacheKey = [diameter, this.baseY, this.centre, this.radius, ...this.normal.toArray()].join(
      ':',
    );
    this.grip.name = 'TorchGrip';
    this.grip.position
      .copy(this.normal)
      .multiplyScalar(this.centre)
      .addScaledVector(along, this.baseY);
    this.hand.add(this.grip);
    for (const mesh of this.meshes) {
      this.previous.set(mesh, {
        influences: mesh.morphTargetInfluences,
        dictionary: mesh.morphTargetDictionary,
      });
      const detail = actor.userData.actorDetail;
      const entry = detail?.meshes.find((entry) => entry.mesh === mesh);
      if (entry) {
        entry.high = this.geometry(mesh, entry.high);
        entry.low = this.geometry(mesh, entry.low);
        mesh.geometry = detail.level ? entry.low : entry.high;
      } else mesh.geometry = this.geometry(mesh, mesh.geometry);
      mesh.updateMorphTargets();
      this.previous.get(mesh)?.influences?.forEach((value, i) => {
        mesh.morphTargetInfluences![i] = value;
      });
    }
  }

  private handVertices(
    mesh: THREE.SkinnedMesh,
    geometry: THREE.BufferGeometry,
    visit: (point: THREE.Vector3, weight: number, index: number, matrix: THREE.Matrix4) => void,
  ) {
    const handIndex = mesh.skeleton.bones.indexOf(this.hand as THREE.Bone);
    if (handIndex < 0) return;
    const matrix = mesh.skeleton.boneInverses[handIndex].clone().multiply(mesh.bindMatrix);
    const { position, skinIndex, skinWeight } = geometry.attributes;
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++)
        if (skinIndex.getComponent(i, j) === handIndex) weight += skinWeight.getComponent(i, j);
      if (weight < 0.01) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      visit(point, weight, i, matrix);
    }
  }

  private geometry(mesh: THREE.SkinnedMesh, source: THREE.BufferGeometry) {
    const previous = this.replacements.get(source);
    if (previous) return previous;
    const cached = cache.get(source)?.get(this.cacheKey);
    if (cached) {
      cached.users++;
      this.replacements.set(source, cached.geometry);
      return cached.geometry;
    }
    const positions = new Float32Array(source.attributes.position.count * 3);
    const normals = new Float32Array(positions.length);
    const vector = new THREE.Vector3(),
      normal = new THREE.Vector3();
    let changed = false;
    this.handVertices(mesh, source, (point, weight, i, toHand) => {
      const length = point.y - this.baseY;
      if (length <= 0) return;
      changed = true;
      const radial = this.centre - point.dot(this.normal);
      // Keep the arc's travel within the delivered finger length: using one
      // radius for every point stretches already bent fingers on stylized hands.
      const curve = Math.max(this.radius, Math.abs(radial));
      const angle = Math.min(Math.PI * 0.88, length / curve);
      const tail = Math.max(0, length - angle * curve);
      const x = this.centre - radial * Math.cos(angle) + tail * Math.sin(angle);
      const y = this.baseY + radial * Math.sin(angle) + tail * Math.cos(angle);
      vector.copy(point).addScaledVector(this.normal, x - point.dot(this.normal));
      vector.y = y;
      vector.applyMatrix4(toHand.clone().invert());
      vector
        .sub(new THREE.Vector3().fromBufferAttribute(source.attributes.position, i))
        .multiplyScalar(weight)
        .toArray(positions, i * 3);
      normal.fromBufferAttribute(source.attributes.normal, i).transformDirection(toHand);
      normal.applyAxisAngle(this.width, -angle).transformDirection(toHand.clone().invert());
      normal
        .sub(new THREE.Vector3().fromBufferAttribute(source.attributes.normal, i))
        .multiplyScalar(weight)
        .toArray(normals, i * 3);
    });
    if (!changed) return source;
    const geometry = source.clone();
    geometry.morphTargetsRelative =
      source.morphTargetsRelative || !source.morphAttributes.position?.length;
    if (!geometry.morphTargetsRelative) {
      for (let i = 0; i < source.attributes.position.count; i++)
        for (let axis = 0; axis < 3; axis++) {
          positions[i * 3 + axis] += source.attributes.position.getComponent(i, axis);
          normals[i * 3 + axis] += source.attributes.normal.getComponent(i, axis);
        }
    }
    const position = new THREE.Float32BufferAttribute(positions, 3);
    position.name = 'TorchGrasp';
    geometry.morphAttributes.position = [...(geometry.morphAttributes.position ?? []), position];
    geometry.morphAttributes.normal = [
      ...(geometry.morphAttributes.normal ?? []),
      new THREE.Float32BufferAttribute(normals, 3),
    ];
    if (!cache.has(source)) cache.set(source, new Map());
    cache.get(source)!.set(this.cacheKey, { geometry, users: 1 });
    this.replacements.set(source, geometry);
    return geometry;
  }

  update(weight: number) {
    for (const mesh of this.meshes)
      if (mesh.morphTargetDictionary?.TorchGrasp !== undefined)
        mesh.morphTargetInfluences[mesh.morphTargetDictionary!.TorchGrasp] = weight;
  }

  dispose() {
    this.grip.removeFromParent();
    const original = new Map([...this.replacements].map(([a, b]) => [b, a]));
    const detail = this.actor.userData.actorDetail;
    for (const entry of detail?.meshes ?? []) {
      entry.high = original.get(entry.high) ?? entry.high;
      entry.low = original.get(entry.low) ?? entry.low;
    }
    for (const mesh of this.meshes) {
      mesh.geometry = original.get(mesh.geometry) ?? mesh.geometry;
      const previous = this.previous.get(mesh)!;
      mesh.morphTargetInfluences = previous.influences;
      mesh.morphTargetDictionary = previous.dictionary;
    }
    for (const source of this.replacements.keys()) {
      const cached = cache.get(source)!.get(this.cacheKey)!;
      if (--cached.users === 0) {
        cached.geometry.dispose();
        cache.get(source)!.delete(this.cacheKey);
      }
    }
    this.replacements.clear();
  }
}
