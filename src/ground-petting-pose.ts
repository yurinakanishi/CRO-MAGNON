import * as THREE from 'three';
import { PettingPose, pettingProgress } from './petting-pose.js';
import { RIMO_NEKO, type RimoNekoSnapshot } from '../shared/rimo-neko.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';

const up = new THREE.Vector3(0, 1, 0);
export function groundPettingProgress(
  c: RimoNekoSnapshot | undefined,
  p: PlayerSnapshot,
  now: number,
) {
  return pettingProgress(c, p, now, RIMO_NEKO);
}

/** Lower the pelvis and bend both knees while keeping the delivered soles planted.
 * The offered hand uses the existing two-bone arm solver, after the crouch.
 */
export class GroundPettingPose {
  private arm: PettingPose;
  private hips: THREE.Object3D;
  private spine: THREE.Object3D;
  private legs: THREE.Object3D[][];
  private joints: THREE.Object3D[];
  private base: { p: THREE.Vector3; q: THREE.Quaternion }[];
  private applied = false;
  private rootQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private scale = new THREE.Vector3();
  readonly contact = new THREE.Vector3();
  readonly requested = new THREE.Vector3();
  depth = 0;
  weight = 0;

  blendWeight(weight: number, dt: number) {
    this.weight = Math.max(weight, this.weight - dt * 6);
    return this.weight;
  }

  constructor(private root: THREE.Object3D) {
    this.arm = new PettingPose(root);
    this.hips = root.getObjectByName('Hips')!;
    this.spine = root.getObjectByName('Spine')!;
    this.legs = ['L', 'R'].map((side) =>
      ['UpperLeg', 'LowerLeg', 'Foot'].map((name) => root.getObjectByName(name + side)!),
    );
    this.joints = [this.hips, this.spine, ...this.legs.flat()];
    if (this.joints.some((b) => !b))
      throw new Error('Ground petting requires hips, spine and both complete legs');
    this.base = this.joints.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  }

  restore() {
    this.arm.restore();
    if (!this.applied) return;
    this.joints.forEach((b, i) => {
      b.position.copy(this.base[i].p);
      b.quaternion.copy(this.base[i].q);
    });
    this.applied = false;
    this.depth = 0;
  }

  private aim(bone: THREE.Object3D, direction: THREE.Vector3) {
    bone.getWorldQuaternion(this.q);
    this.v.copy(up).applyQuaternion(this.q);
    this.q.premultiply(new THREE.Quaternion().setFromUnitVectors(this.v, direction));
    bone.parent!.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ.multiply(this.q));
    bone.updateWorldMatrix(false, true);
  }

  update(target: THREE.Vector3, weight: number, stroke: number) {
    this.restore();
    if (weight <= 0) return;
    this.joints.forEach((b, i) => {
      this.base[i].p.copy(b.position);
      this.base[i].q.copy(b.quaternion);
    });
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootQ);
    const floor = this.root.getWorldPosition(new THREE.Vector3()).y;
    const hipHeight = this.hips.getWorldPosition(new THREE.Vector3()).y - floor;
    const footTargets = this.legs.map((leg) => ({
      at: leg[2].getWorldPosition(new THREE.Vector3()),
      q: leg[2].getWorldQuaternion(new THREE.Quaternion()),
      lengths: [
        leg[0]
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(leg[1].getWorldPosition(new THREE.Vector3())),
        leg[1]
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(leg[2].getWorldPosition(new THREE.Vector3())),
      ],
    }));
    this.depth = THREE.MathUtils.clamp((hipHeight - 0.23) * 0.83, 0.035, 0.7) * weight;
    this.hips.parent!.getWorldQuaternion(this.parentQ).invert();
    this.hips.parent!.getWorldScale(this.scale);
    this.v
      .set(0, -this.depth, -this.depth * 0.22)
      .applyQuaternion(this.rootQ)
      .applyQuaternion(this.parentQ)
      .divide(this.scale);
    this.hips.position.add(this.v);
    this.root.updateWorldMatrix(true, true);
    const pitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0).applyQuaternion(this.rootQ),
      (hipHeight < 0.4 ? 0.15 : 0.55) * weight,
    );
    this.spine.getWorldQuaternion(this.q).premultiply(pitch);
    this.spine.parent!.getWorldQuaternion(this.parentQ).invert();
    this.spine.quaternion.copy(this.parentQ.multiply(this.q));
    this.root.updateWorldMatrix(true, true);
    this.legs.forEach((leg, index) => {
      const start = leg[0].getWorldPosition(new THREE.Vector3()),
        f = footTargets[index];
      const [a, b] = f.lengths;
      const axis = f.at.clone().sub(start);
      const d = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
      axis.normalize();
      const pole = new THREE.Vector3(index ? -0.12 : 0.12, 0, 1).applyQuaternion(this.rootQ);
      pole.addScaledVector(axis, -pole.dot(axis)).normalize();
      const along = (a * a - b * b + d * d) / (2 * d);
      const knee = start
        .clone()
        .addScaledVector(axis, along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
      this.aim(leg[0], knee.clone().sub(start).normalize());
      this.aim(leg[1], f.at.clone().sub(knee).normalize());
      leg[2].parent!.getWorldQuaternion(this.parentQ).invert();
      leg[2].quaternion.copy(this.parentQ.multiply(f.q));
      leg[2].updateWorldMatrix(false, true);
    });
    this.requested
      .copy(target)
      .add(
        new THREE.Vector3(
          0,
          0,
          Math.sin(stroke * Math.PI * 4) * Math.min(0.04, hipHeight * 0.045),
        ).applyQuaternion(this.rootQ),
      );
    this.arm.update(this.requested, weight, stroke);
    this.requested.copy(this.arm.requested);
    this.contact.copy(this.arm.contact);
    this.applied = true;
  }
}
