import * as THREE from 'three';

const right = new THREE.Vector3(1, 0, 0);
// Forward tilt of the whole stance in radians, blended by locomotion state.
const IDLE = 0.17,
  WALK = 0.26,
  RUN = 0.42;
// Share of the tilt each joint carries. The pelvis pitches forward while the
// thighs counter-rotate so the feet stay planted; the neck lifts the gaze back
// toward the horizon so the crouch reads as alert rather than slumped.
const JOINTS: [string, number][] = [
  ['Hips', 0.35],
  ['UpperLegL', -0.35],
  ['UpperLegR', -0.35],
  ['Spine', 0.4],
  ['Chest', 0.25],
  ['Neck', -0.45],
];

// Layer a forward-leaning ninja crouch over the delivered locomotion clips.
// Same contract as CarrySupportPose: restore before the mixer runs, apply after.
export class LeanPose {
  private joints: THREE.Object3D[];
  private base: THREE.Quaternion[];
  private lean = 0;
  private applied = false;
  private rootQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private inverseParentQ = new THREE.Quaternion();
  private pitch = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  constructor(private root: THREE.Object3D) {
    this.joints = JOINTS.map(([name]) => root.getObjectByName(name)!);
    if (this.joints.some((bone) => !bone)) throw new Error('The leaning character is missing its spine');
    this.base = this.joints.map((bone) => bone.quaternion.clone());
  }

  restore() {
    if (!this.applied) return;
    this.joints.forEach((bone, i) => bone.quaternion.copy(this.base[i]));
    this.applied = false;
  }

  reset() {
    this.restore();
    this.lean = 0;
  }

  /** `speed` null means another full-body pose (jump, ride, downed) owns the skin. */
  update(dt: number, speed: number | null, running: boolean) {
    this.restore();
    if (speed === null) {
      this.lean = 0;
      return;
    }
    const target = speed > 0.025 ? (running ? RUN : WALK) : IDLE;
    this.lean += (target - this.lean) * (1 - Math.exp(-Math.max(0, dt) * 8));
    if (Math.abs(this.lean) < 1e-4) return;
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootQ);
    this.axis.copy(right).applyQuaternion(this.rootQ);
    this.joints.forEach((bone, i) => {
      this.base[i].copy(bone.quaternion);
      bone.parent!.getWorldQuaternion(this.parentQ);
      this.inverseParentQ.copy(this.parentQ).invert();
      this.pitch.setFromAxisAngle(this.axis, this.lean * JOINTS[i][1]);
      bone.quaternion.premultiply(this.parentQ).premultiply(this.pitch).premultiply(this.inverseParentQ);
      bone.updateWorldMatrix(false, true);
    });
    this.applied = true;
  }
}
