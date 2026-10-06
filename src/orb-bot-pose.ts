import * as THREE from 'three';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';
import type { OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import { botHandPosition, canHandleBot, ORB_BOTS } from '../shared/orb-bots.mjs';
import { caveInteriorWeight } from '../shared/cave-light.mjs';

const up = new THREE.Vector3(0, 1, 0);
const clamp = (n: number) => THREE.MathUtils.clamp(n, 0, 1);
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

/** Upper-body throw and calling gestures layered over each delivered character's locomotion. */
export class OrbBotPose {
  private arm: THREE.Object3D[];
  private torso: THREE.Object3D[];
  private joints: THREE.Object3D[];
  private base: THREE.Quaternion[];
  private rest: THREE.Quaternion[];
  private lengths: number[];
  private grip: THREE.Object3D;
  private head: THREE.Object3D;
  private palm: number;
  private applied = false;
  private key = '';
  private lastAt = -Infinity;
  private lastWeight = 0;
  private last: THREE.Quaternion[];
  private transition: THREE.Quaternion[] | null = null;
  private transitionWeight = 0;
  readonly contact = new THREE.Vector3();
  readonly requested = new THREE.Vector3();
  weight = 0;
  gesture: 'throw' | 'call' | null = null;

  constructor(private root: THREE.Object3D) {
    this.arm = ['UpperArmL', 'LowerArmL', 'HandL'].map((n) => root.getObjectByName(n)!);
    this.torso = ['Spine', 'Chest', 'Neck'].map((n) => root.getObjectByName(n)!);
    this.grip = root.getObjectByName('GripL')!;
    this.head = root.getObjectByName('Head')!;
    this.joints = [...this.torso, ...this.arm];
    if (this.joints.some((b) => !b) || !this.grip || !this.head)
      throw new Error('Bot gestures need the delivered left arm, grip, spine and head');
    root.updateWorldMatrix(true, true);
    this.base = this.joints.map((b) => b.quaternion.clone());
    this.last = this.base.map((q) => q.clone());
    this.rest = this.arm.map((b) => b.quaternion.clone());
    const positions = [...this.arm, this.grip].map((b) => b.getWorldPosition(new THREE.Vector3()));
    this.lengths = [positions[0].distanceTo(positions[1]), positions[1].distanceTo(positions[2])];
    this.palm = positions[2].distanceTo(positions[3]);
  }

  restore() {
    if (this.applied) this.joints.forEach((b, i) => b.quaternion.copy(this.base[i]));
    this.applied = false;
    this.weight = 0;
    this.gesture = null;
  }

  private rotate(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion
      .premultiply(parent)
      .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
      .premultiply(parent.invert());
    bone.updateWorldMatrix(false, true);
  }

  private aim(bone: THREE.Object3D, direction: THREE.Vector3) {
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    const child = this.arm[this.arm.indexOf(bone) + 1] ?? this.grip;
    const current = child
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .normalize();
    q.premultiply(new THREE.Quaternion().setFromUnitVectors(current, direction));
    bone.quaternion.copy(
      bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q),
    );
    bone.updateWorldMatrix(false, true);
  }

  update(
    bot: OrbBotSnapshot | undefined,
    player: PlayerSnapshot,
    now: number,
    model: THREE.Object3D,
  ) {
    this.restore();
    if (caveInteriorWeight(player) > 0) {
      this.key = '';
      this.lastWeight = 0;
      this.transition = null;
      return;
    }
    const callAge = bot?.recallAt ? now - bot.recallAt : -1;
    const calling = callAge >= 0 && callAge < ORB_BOTS.callMs;
    const age = calling ? callAge : now - (bot?.throwAt ?? 0);
    const released = age - ORB_BOTS.windupMs;
    let weight = 0;
    if (bot && canHandleBot(player, now)) {
      if (calling) weight = smooth(age / 180) * (1 - smooth((age - 780) / 320));
      else if (age >= 0 && (bot.mode === 'windup' || bot.mode === 'airborne'))
        weight =
          smooth(age / ORB_BOTS.pickupMs) * (1 - smooth(released / ORB_BOTS.followThroughMs));
    }
    if (!bot || weight <= 0) {
      // Keep the previous rendered pose only at the exact start of a new volley stroke.
      if (!bot || age !== 0 || !canHandleBot(player, now)) {
        this.key = '';
        this.lastWeight = 0;
        this.transition = null;
        return;
      }
    }
    const key = calling ? `call:${bot!.recallAt}` : `throw:${bot!.id}:${bot!.throwAt}`;
    if (key !== this.key) {
      this.transition =
        this.lastWeight > 0 && now >= this.lastAt && now - this.lastAt < 150
          ? this.last.map((q) => q.clone())
          : null;
      this.transitionWeight = this.lastWeight;
      this.key = key;
    }
    this.gesture = calling ? 'call' : 'throw';
    this.joints.forEach((b, i) => this.base[i].copy(b.quaternion));
    this.arm.forEach((b, i) => b.quaternion.copy(this.rest[i]));
    this.root.updateWorldMatrix(true, true);
    const facing = model.rotation.y;
    const front = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const side = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const reach = this.lengths[0] + this.lengths[1];
    // Draw back to the shoulder, accelerate through the release, then lower the arm.
    const swing = clamp((age - 140) / (ORB_BOTS.windupMs - 140));
    const travel = swing * swing;
    const follow = clamp(released / ORB_BOTS.followThroughMs);
    const pitch = calling ? 0.055 : THREE.MathUtils.lerp(-0.07, 0.12, travel);
    const twist = calling ? -0.035 : THREE.MathUtils.lerp(0.22, -0.16, travel);
    for (let i = 0; i < this.torso.length; i++) {
      this.rotate(this.torso[i], side, i === 2 ? -pitch * 0.6 : pitch * (i ? 0.6 : 0.4));
      this.rotate(this.torso[i], up, twist * (i === 2 ? -0.55 : 0.5));
    }
    const shoulder = this.arm[0].getWorldPosition(new THREE.Vector3());
    const fingers = front.clone();
    if (calling) {
      // A hand beside the mouth, followed by a small outward beckon. The target uses
      // the actual head/arm proportions, including the mage and octopus rigs.
      const beckon = Math.sin(Math.PI * clamp((age - 560) / 330));
      this.requested
        .copy(this.head.getWorldPosition(new THREE.Vector3()))
        .addScaledVector(side, reach * 0.16)
        .addScaledVector(up, -reach * 0.07)
        .addScaledVector(front, reach * (0.24 + beckon * 0.22) + 0.015);
      fingers.addScaledVector(up, 0.7).addScaledVector(side, -0.35).normalize();
    } else {
      const release = botHandPosition(
        { ...player, x: model.position.x, z: model.position.z, facing },
        model.position.y,
      );
      this.requested
        .copy(shoulder)
        .addScaledVector(side, reach * 0.2)
        .addScaledVector(up, reach * 0.5)
        .addScaledVector(front, -reach * 0.2)
        .lerp(new THREE.Vector3(release.x, release.y, release.z), travel)
        .addScaledVector(side, reach * 0.28 * Math.sin(travel * Math.PI));
      this.requested
        .addScaledVector(front, reach * 0.08 * Math.sin(follow * Math.PI))
        .addScaledVector(up, -reach * 0.16 * Math.sin(follow * Math.PI));
      fingers.copy(up).lerp(front, travel).normalize();
    }
    const wrist = this.requested.clone().addScaledVector(fingers, -this.palm);
    const axis = wrist.clone().sub(shoulder);
    const [a, b] = this.lengths;
    const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.001, a + b - 0.002);
    axis.normalize();
    wrist.copy(shoulder).addScaledVector(axis, distance);
    const bend = side.clone().addScaledVector(up, -0.4).addScaledVector(front, -0.15);
    bend.addScaledVector(axis, -bend.dot(axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const elbow = shoulder
      .clone()
      .addScaledVector(axis, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    this.aim(this.arm[0], elbow.clone().sub(shoulder).normalize());
    this.aim(this.arm[1], wrist.clone().sub(elbow).normalize());
    this.aim(this.arm[2], fingers);
    this.joints.forEach((bone, i) => bone.quaternion.slerp(this.base[i], 1 - weight));
    // Rapid one-button throws overlap the previous follow-through. Blend from the
    // visible pose instead of snapping through idle on every new queued throw.
    if (this.transition) {
      const blend = smooth(age / ORB_BOTS.pickupMs);
      this.joints.forEach((bone, i) =>
        bone.quaternion.slerpQuaternions(this.transition![i], bone.quaternion.clone(), blend),
      );
      weight = THREE.MathUtils.lerp(this.transitionWeight, weight, blend);
      if (blend >= 1) this.transition = null;
    }
    this.root.updateWorldMatrix(true, true);
    this.grip.getWorldPosition(this.contact);
    this.weight = weight;
    this.lastWeight = weight;
    this.lastAt = now;
    this.joints.forEach((bone, i) => this.last[i].copy(bone.quaternion));
    this.applied = true;
  }
}
