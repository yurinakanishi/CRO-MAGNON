import * as THREE from 'three';
import { COMPANION_524, type Companion524Snapshot } from '../shared/companion-524.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';
import { jumpProgress } from '../shared/jumping.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';

const up = new THREE.Vector3(0, 1, 0);
const smooth = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Seek the shared event, including a late join, instead of replaying an old pet. */
export function pettingProgress(
  c: Companion524Snapshot | undefined,
  p: PlayerSnapshot,
  now: number,
) {
  if (
    !c ||
    c.petPlayerId !== p.id ||
    p.moving ||
    p.downedUntil ||
    p.mountId ||
    p.boatId ||
    p.carrierId ||
    p.passengerId ||
    p.cookingEndsAt ||
    p.fishing ||
    p.coastalActivity ||
    jumpProgress(p, now) !== null ||
    (p.attackSequence > 0 && now - p.attackAt < attackProfile(p).durationMs)
  )
    return { weight: 0, stroke: 0 };
  const age = now - c.petAt;
  const contact = c.petContactAt > 0 ? now - c.petContactAt : -1;
  if (age < 0 || (contact < 0 && age > COMPANION_524.petApproachMs))
    return { weight: 0, stroke: 0 };
  return {
    weight:
      smooth(age / 350) *
      (contact >= 0 ? 1 - smooth((contact - COMPANION_524.petStrokeMs) / 250) : 1),
    stroke: contact >= 0 ? THREE.MathUtils.clamp(contact / COMPANION_524.petStrokeMs, 0, 1) : 0,
  };
}

/** Reach, stroke twice and withdraw using the delivered arm and spine. No root motion. */
export class PettingPose {
  private arm: THREE.Object3D[];
  private torso: THREE.Object3D[];
  private joints: THREE.Object3D[];
  private rest: THREE.Quaternion[];
  private base: THREE.Quaternion[];
  private lengths: number[];
  private palmLength: number;
  private applied = false;
  private rootQ = new THREE.Quaternion();
  private worldQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private rotation = new THREE.Quaternion();
  private shoulder = new THREE.Vector3();
  private target = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private bend = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private current = new THREE.Vector3();
  private fingers = new THREE.Vector3();
  readonly contact = new THREE.Vector3();
  readonly requested = new THREE.Vector3();
  weight = 0;

  constructor(private root: THREE.Object3D) {
    this.arm = ['UpperArmR', 'LowerArmR', 'HandR'].map((name) => root.getObjectByName(name)!);
    this.torso = ['Spine', 'Chest', 'Neck'].map((name) => root.getObjectByName(name)!);
    this.joints = [...this.torso, ...this.arm];
    if (this.joints.some((bone) => !bone))
      throw new Error('The petting character is missing its arm or spine');
    this.rest = this.arm.map((bone) => bone.quaternion.clone());
    this.base = this.joints.map((bone) => bone.quaternion.clone());
    root.updateWorldMatrix(true, true);
    this.lengths = this.arm
      .slice(1)
      .map((bone) =>
        bone
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(bone.parent!.getWorldPosition(new THREE.Vector3())),
      );
    const grip = root.getObjectByName('GripR');
    this.palmLength = grip
      ? grip
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(this.arm[2].getWorldPosition(new THREE.Vector3()))
      : this.lengths[1] * 0.25;
  }

  restore() {
    if (!this.applied) return;
    this.joints.forEach((bone, i) => bone.quaternion.copy(this.base[i]));
    this.applied = false;
    this.weight = 0;
  }

  private aim(bone: THREE.Object3D, direction: THREE.Vector3) {
    bone.getWorldQuaternion(this.worldQ);
    this.current.copy(up).applyQuaternion(this.worldQ);
    this.rotation.setFromUnitVectors(this.current, direction).multiply(this.worldQ);
    bone.parent!.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ.multiply(this.rotation));
    bone.updateWorldMatrix(false, true);
  }

  update(position: THREE.Vector3, weight: number, stroke: number) {
    this.restore();
    if (weight <= 0) return;
    this.weight = weight;
    this.joints.forEach((bone, i) => this.base[i].copy(bone.quaternion));
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootQ);
    this.axis.set(1, 0, 0).applyQuaternion(this.rootQ);
    for (const [i, pitch] of [0.16, 0.12, -0.12].entries()) {
      const bone = this.torso[i];
      bone.parent!.getWorldQuaternion(this.parentQ);
      this.rotation.setFromAxisAngle(this.axis, pitch * weight);
      bone.quaternion
        .premultiply(this.parentQ)
        .premultiply(this.rotation)
        .premultiply(this.parentQ.invert());
      bone.updateWorldMatrix(false, true);
    }
    this.arm.forEach((bone, i) => bone.quaternion.copy(this.rest[i]));
    this.root.updateWorldMatrix(true, true);
    this.arm[0].getWorldPosition(this.shoulder);
    this.fingers.set(0, -0.12, 1).normalize().applyQuaternion(this.rootQ);
    this.requested.copy(position);
    const sweep = Math.min(0.035, (this.lengths[0] + this.lengths[1]) * 0.12);
    this.direction.set(Math.sin(stroke * Math.PI * 4) * sweep, 0, 0).applyQuaternion(this.rootQ);
    this.requested.add(this.direction);
    this.target.copy(this.requested).addScaledVector(this.fingers, -this.palmLength);
    this.axis.subVectors(this.target, this.shoulder);
    const [a, b] = this.lengths;
    const distance = THREE.MathUtils.clamp(
      this.axis.length(),
      Math.abs(a - b) + 0.001,
      a + b - 0.002,
    );
    this.axis.normalize();
    this.target.copy(this.shoulder).addScaledVector(this.axis, distance);
    this.bend.set(-1, -0.45, -0.2).applyQuaternion(this.rootQ);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    this.elbow
      .copy(this.shoulder)
      .addScaledVector(this.axis, along)
      .addScaledVector(this.bend, Math.sqrt(Math.max(0, a * a - along * along)));
    this.aim(this.arm[0], this.direction.subVectors(this.elbow, this.shoulder).normalize());
    this.aim(this.arm[1], this.direction.subVectors(this.target, this.elbow).normalize());
    this.aim(this.arm[2], this.fingers);
    this.arm.forEach((bone, i) =>
      bone.quaternion.slerp(this.base[i + this.torso.length], 1 - weight),
    );
    this.root.updateWorldMatrix(true, true);
    this.arm[2].getWorldPosition(this.contact);
    this.arm[2].getWorldQuaternion(this.worldQ);
    this.direction.copy(up).applyQuaternion(this.worldQ);
    this.contact.addScaledVector(this.direction, this.palmLength);
    this.applied = true;
  }
}
