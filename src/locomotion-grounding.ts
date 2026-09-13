import * as THREE from 'three';
import { isSkinnedMesh } from './three-types.js';

/** Keep interpolated gait soles above the actor's local floor without bending
 * the joints again. Only used while idle/walk/run poses crossfade. */
export class LocomotionGrounding {
  private hips: THREE.Object3D;
  private samples: { mesh: THREE.SkinnedMesh; index: number }[] = [];
  private meshes: THREE.SkinnedMesh[] = [];
  private inverse = new THREE.Matrix4();
  private point = new THREE.Vector3();
  private lift = new THREE.Vector3();
  private base = new THREE.Vector3();
  private applied = false;

  constructor(private root: THREE.Object3D) {
    this.hips = root.getObjectByName('Hips')!;
    if (!this.hips) throw new Error('Locomotion grounding requires Hips');
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    this.inverse.copy(root.matrixWorld).invert();
    const candidates: { mesh: THREE.SkinnedMesh; index: number; y: number }[] = [];
    root.traverse((mesh) => {
      if (!isSkinnedMesh(mesh)) return;
      this.meshes.push(mesh);
      const a = mesh.geometry.attributes;
      for (let i = 0; i < a.position.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) {
          const name = mesh.skeleton.bones[a.skinIndex.array[i * 4 + j]]?.name;
          if (/^(Foot|Toe)[LR]$/.test(name)) weight += a.skinWeight.array[i * 4 + j];
        }
        if (weight > 0.7) {
          mesh
            .getVertexPosition(i, this.point)
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(this.inverse);
          candidates.push({ mesh, index: i, y: this.point.y });
        }
      }
    });
    const lowest = Math.min(...candidates.map((s) => s.y));
    this.samples = candidates.filter((s) => s.y < lowest + 0.04);
    if (!this.samples.length) throw new Error('Locomotion grounding requires skinned soles');
  }

  restore() {
    if (!this.applied) return;
    this.hips.position.copy(this.base);
    this.applied = false;
  }

  apply(actions: Map<string, THREE.AnimationAction>) {
    const active = [...actions.entries()].filter(
      ([, a]) => a.enabled && a.isScheduled() && a.getEffectiveWeight() > 0.0001,
    );
    const blended =
      active.length > 1 &&
      active.every(([name]) => ['Idle_Loop', 'Walk_Loop', 'Run_Loop'].includes(name));
    if (!blended) return;
    // SkinnedMesh updates its attached bind inverse in updateMatrixWorld;
    // updateWorldMatrix alone would skin a moved actor in the wrong space.
    this.root.updateWorldMatrix(true, false);
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const mesh of this.meshes) mesh.skeleton.update();
    let lowest = Infinity;
    for (const s of this.samples) {
      s.mesh
        .getVertexPosition(s.index, this.point)
        .applyMatrix4(s.mesh.matrixWorld)
        .applyMatrix4(this.inverse);
      lowest = Math.min(lowest, this.point.y);
    }
    if (lowest >= 0.0025) return;
    this.base.copy(this.hips.position);
    // Transform the model-space displacement into the hips parent's space;
    // do not move the server-owned actor container or change any joint angle.
    this.point.set(0, 0, 0).applyMatrix4(this.root.matrixWorld);
    this.lift.set(0, 0.003 - lowest, 0).applyMatrix4(this.root.matrixWorld);
    this.hips.parent!.worldToLocal(this.point);
    this.hips.parent!.worldToLocal(this.lift);
    this.hips.position.add(this.lift.sub(this.point));
    this.hips.updateWorldMatrix(false, true);
    this.applied = true;
  }
}
