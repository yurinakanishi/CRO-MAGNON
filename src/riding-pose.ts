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

// Left shoulder of the delivered 2 m ape, in root-space metres. The chest
// socket follows body sway; CarrySupportPose places the left hand beside it.
export function apeShoulderSeat(root) {
  root.updateMatrixWorld(true);
  const bone = root.getObjectByName('Chest');
  const local = bone.worldToLocal(root.localToWorld(new THREE.Vector3(0.43, 1.65, -0.16)));
  return {
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
  declare hipWidth: number;

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
    this.root.updateMatrixWorld(true);
    this.hipWidth = this.bones
      .get('UpperLegL')
      .bone.getWorldPosition(new THREE.Vector3())
      .distanceTo(this.bones.get('UpperLegR').bone.getWorldPosition(new THREE.Vector3()));
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
    // Broad hips need the knees slightly inward to keep both feet in the canoe.
    const broadBoatSeat = boat && this.hipWidth > 0.45;
    this.aim('Spine', sway, 1, 0.14 + Math.min(speed, 2.25) * 0.045);
    this.aim('Chest', 0, 1, 0.08);
    this.aim('Neck', 0, 1, 0);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      this.aim(
        `UpperLeg${side}`,
        sign * (boat ? (broadBoatSeat ? -0.08 : 0.12) : 0.95),
        boat ? -0.25 : -0.1,
        boat ? 1 : 0.38,
      );
      this.aim(
        `LowerLeg${side}`,
        sign * (boat ? (broadBoatSeat ? 0 : 0.06) : 0.24),
        boat ? -0.5 : -1,
        boat ? 1 : -0.12,
      );
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
  updateShoulder(animation, time, speed, castProgress: number | null = null) {
    this.update(animation, time, speed, true);
    this.aim('Spine', 0, 1, 0.08);
    this.aim('Chest', 0, 1, 0.03);
    this.aim('Neck', 0, 1, 0);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      this.aim(`UpperLeg${side}`, sign * 0.1, -0.3, 1);
      this.aim(`LowerLeg${side}`, sign * 0.05, -1, 0.1);
      this.aim(`Foot${side}`, 0, -0.1, 1);
      this.aim(`UpperArm${side}`, sign * 0.25, -1, 0.1);
      this.aim(`LowerArm${side}`, sign * -0.2, -0.4, 0.7);
    }
    animation.name = speed > 0.025 ? 'Carry_Move' : 'Carry_Idle';
    if (castProgress !== null && castProgress >= 0 && castProgress < 1) {
      const phase = castProgress < 0.5 ? castProgress * 2 : (1 - castProgress) * 2;
      const reach = phase * phase * (3 - 2 * phase);
      for (const [side, sign] of [
        ['L', 1],
        ['R', -1],
      ] as const) {
        this.aim(`UpperArm${side}`, sign * 0.25, -1 + reach * 1.1, 0.1 + reach * 0.9);
        this.aim(`LowerArm${side}`, sign * -0.2, -0.4 + reach * 0.5, 0.7 + reach * 0.3);
      }
      animation.name = 'Carry_Cast';
    }
  }
  leave(animation) {
    if (!this.active) return;
    this.restore();
    this.active = false;
    animation.current = null;
    animation.change('Idle_Loop', 0);
  }
}
