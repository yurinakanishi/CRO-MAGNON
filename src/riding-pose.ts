import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
// Socket measured on the delivered mammoth GLB at the base of its neck. Its
// inverse bind transform makes the seat follow the existing animated spine.
export function mammothSeat(root) {
  root.updateMatrixWorld(true);
  const bone = root.getObjectByName('Spine');
  if (!bone) throw new Error('The verified mammoth is missing its spine');
  const local = bone.worldToLocal(root.localToWorld(new THREE.Vector3(0, 3.51, 0.6)));
  return {
    bone,
    local,
    position(out) {
      return bone.localToWorld(out.copy(local));
    },
  };
}

// A runtime pose of the delivered skin, with no replacement geometry or extra
// mixer. Bone transforms are captured before any clip runs and restored on exit.
export class RidingPose {
  declare root: any;
  declare bones: Map<any, any>;
  declare active: boolean;
  declare hips: any;
  declare point: THREE.Vector3;
  declare direction: THREE.Vector3;
  declare rootQ: THREE.Quaternion;
  declare worldQ: THREE.Quaternion;
  declare parentQ: THREE.Quaternion;
  declare delta: THREE.Quaternion;

  constructor(root) {
    this.root = root;
    this.bones = new Map();
    this.active = false;
    root.traverse((bone) => {
      if (bone.isBone)
        this.bones.set(bone.name, {
          bone,
          p: bone.position.clone(),
          q: bone.quaternion.clone(),
          s: bone.scale.clone(),
        });
    });
    this.hips = this.bones.get('Hips')?.bone;
    if (!this.hips) throw new Error('The verified rider is missing its hips');
    this.point = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.rootQ = new THREE.Quaternion();
    this.worldQ = new THREE.Quaternion();
    this.parentQ = new THREE.Quaternion();
    this.delta = new THREE.Quaternion();
  }
  restore() {
    for (const { bone, p, q, s } of this.bones.values()) {
      bone.position.copy(p);
      bone.quaternion.copy(q);
      bone.scale.copy(s);
    }
  }
  aim(name, x, y, z) {
    const bone = this.bones.get(name)?.bone;
    if (!bone) throw new Error(`Riding pose needs ${name}`);
    bone.getWorldQuaternion(this.worldQ);
    this.point.copy(up).applyQuaternion(this.worldQ);
    this.direction.set(x, y, z).normalize().applyQuaternion(this.rootQ);
    this.delta.setFromUnitVectors(this.point, this.direction).multiply(this.worldQ);
    bone.parent.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ.multiply(this.delta));
    bone.updateMatrixWorld(true);
  }
  update(animation, time, speed, boat = false) {
    if (!this.active) {
      animation.mixer.stopAllAction();
      animation.retiring.clear();
      animation.current = null;
      animation.oneShot = false;
      animation.finished = false;
      this.active = true;
    }
    this.restore();
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this.rootQ);
    const sway = Math.sin(time * 3) * Math.min(speed, 1) * 0.025;
    this.aim('Spine', sway, 1, 0.14 + Math.min(speed, 2.25) * 0.045);
    this.aim('Chest', 0, 1, 0.08);
    this.aim('Neck', 0, 1, 0);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      this.aim(
        `UpperLeg${side}`,
        sign * (boat ? 0.12 : 0.95),
        boat ? -0.25 : -0.1,
        boat ? 1 : 0.38,
      );
      this.aim(`LowerLeg${side}`, sign * (boat ? 0.06 : 0.24), boat ? -0.5 : -1, boat ? 1 : -0.12);
      this.aim(`Foot${side}`, sign * 0.1, -0.1, 1);
      this.aim(`UpperArm${side}`, sign * 0.24, -0.8, 0.55);
      this.aim(`LowerArm${side}`, sign * -0.12, -0.22, 1);
    }
    animation.name = boat ? 'Boat_Seat' : speed > 0.025 ? 'Ride_Move' : 'Ride_Idle';
  }
  pelvisOffset(out) {
    this.root.updateMatrixWorld(true);
    return this.root.worldToLocal(this.hips.getWorldPosition(out));
  }
  leave(animation) {
    if (!this.active) return;
    this.restore();
    this.active = false;
    animation.current = null;
    animation.change('Idle_Loop', 0);
  }
}
