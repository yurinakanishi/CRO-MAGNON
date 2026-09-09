import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);

// Layer only the carrying arm over locomotion. The chest-space wrist target is
// measured beside the delivered mage's dangling legs on the left shoulder.
export class CarrySupportPose {
  private chest: THREE.Object3D;
  private arm: THREE.Object3D[];
  private rest: THREE.Quaternion[];
  private base: THREE.Quaternion[];
  private wrist: THREE.Vector3;
  private pole: THREE.Vector3;
  private fingers: THREE.Vector3;
  private lengths: number[];
  private blend = 0;
  private applied = false;
  private shoulder = new THREE.Vector3();
  private target = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private bend = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private current = new THREE.Vector3();
  private chestQ = new THREE.Quaternion();
  private worldQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private rotation = new THREE.Quaternion();

  constructor(private root: THREE.Object3D) {
    this.chest = root.getObjectByName('Chest')!;
    this.arm = ['UpperArmL', 'LowerArmL', 'HandL'].map((name) => root.getObjectByName(name)!);
    if (!this.chest || this.arm.some((bone) => !bone))
      throw new Error('The carrying ape is missing its left arm');
    this.rest = this.arm.map((bone) => bone.quaternion.clone());
    this.base = this.rest.map((q) => q.clone());
    root.updateWorldMatrix(true, true);
    this.wrist = this.chest.worldToLocal(root.localToWorld(new THREE.Vector3(0.7, 1.5, 0.03)));
    const rootToChest = this.chest
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(root.getWorldQuaternion(new THREE.Quaternion()));
    this.pole = new THREE.Vector3(1, -0.65, -0.15).normalize().applyQuaternion(rootToChest);
    this.fingers = new THREE.Vector3(-0.9, 0.4, -0.1).normalize().applyQuaternion(rootToChest);
    this.lengths = this.arm
      .slice(1)
      .map((bone) =>
        bone
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(bone.parent!.getWorldPosition(new THREE.Vector3())),
      );
  }

  // Restore before the mixer: constant animation channels may skip rewriting a
  // value, so leaving last frame's overlay in place would accumulate the pose.
  restore() {
    if (!this.applied) return;
    this.arm.forEach((bone, i) => bone.quaternion.copy(this.base[i]));
    this.applied = false;
  }

  reset() {
    this.restore();
    this.blend = 0;
  }

  private aim(bone: THREE.Object3D, direction: THREE.Vector3) {
    bone.getWorldQuaternion(this.worldQ);
    this.current.copy(up).applyQuaternion(this.worldQ);
    this.rotation.setFromUnitVectors(this.current, direction).multiply(this.worldQ);
    bone.parent!.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ.multiply(this.rotation));
    bone.updateWorldMatrix(false, true);
  }

  update(dt: number, carrying: boolean) {
    this.restore();
    this.blend = THREE.MathUtils.clamp(
      this.blend + ((carrying ? 1 : -1) * Math.max(0, dt)) / 0.22,
      0,
      1,
    );
    if (!this.blend) return;
    this.arm.forEach((bone, i) => {
      this.base[i].copy(bone.quaternion);
      bone.quaternion.copy(this.rest[i]);
    });
    this.root.updateWorldMatrix(true, true);
    this.chest.getWorldQuaternion(this.chestQ);
    this.arm[0].getWorldPosition(this.shoulder);
    this.chest.localToWorld(this.target.copy(this.wrist));
    this.axis.subVectors(this.target, this.shoulder);
    const [a, b] = this.lengths;
    const distance = THREE.MathUtils.clamp(
      this.axis.length(),
      Math.abs(a - b) + 0.001,
      a + b - 0.001,
    );
    this.axis.normalize();
    this.target.copy(this.shoulder).addScaledVector(this.axis, distance);
    this.bend.copy(this.pole).applyQuaternion(this.chestQ);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    this.elbow
      .copy(this.shoulder)
      .addScaledVector(this.axis, along)
      .addScaledVector(this.bend, Math.sqrt(Math.max(0, a * a - along * along)));
    this.aim(this.arm[0], this.direction.subVectors(this.elbow, this.shoulder).normalize());
    this.aim(this.arm[1], this.direction.subVectors(this.target, this.elbow).normalize());
    this.aim(this.arm[2], this.direction.copy(this.fingers).applyQuaternion(this.chestQ));
    const weight = this.blend * this.blend * (3 - 2 * this.blend);
    this.arm.forEach((bone, i) => bone.quaternion.slerp(this.base[i], 1 - weight));
    this.root.updateWorldMatrix(true, true);
    this.applied = true;
  }
}
