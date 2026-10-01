import * as THREE from 'three';

interface PoseAnimation {
  mixer: THREE.AnimationMixer;
  current: THREE.AnimationAction | null;
  retiring: Map<THREE.AnimationAction, number>;
  oneShot: boolean;
  finished: boolean;
  name: string;
  change(name: string, fade: number): void;
}

/** Seek the delivered octopus clips on the actor's existing mixer. */
class OctopusClipPose {
  active = false;
  private action: THREE.AnimationAction | null = null;
  private rest: { bone: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];

  constructor(protected root: THREE.Object3D, private clips: THREE.AnimationClip[]) {
    root.traverse((bone) => {
      if ((bone as THREE.Bone).isBone)
        this.rest.push({ bone, p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() });
    });
  }

  protected sample(animation: PoseAnimation, name: string, seconds: number) {
    const clip = this.clips.find((entry) => entry.name === name);
    if (!clip) throw new Error(`Octopus pose requires ${name}`);
    if (!this.active || this.action?.getClip() !== clip) {
      animation.mixer.stopAllAction();
      animation.retiring.clear();
      this.action = animation.mixer.clipAction(clip);
      this.action.reset().setEffectiveWeight(1).setLoop(THREE.LoopOnce, 1).play();
      this.action.clampWhenFinished = true;
      this.action.paused = true;
      this.active = true;
    }
    this.action!.time = THREE.MathUtils.clamp(seconds, 0, clip.duration);
    animation.current = this.action;
    animation.oneShot = false;
    animation.finished = false;
    animation.name = name;
    animation.mixer.update(0);
    this.root.updateWorldMatrix(true, true);
  }

  restore() {
    for (const { bone, p, q, s } of this.rest) {
      bone.position.copy(p);
      bone.quaternion.copy(q);
      bone.scale.copy(s);
    }
  }

  leave(animation: PoseAnimation) {
    if (!this.active) return;
    this.action?.stop();
    this.action = null;
    this.restore();
    this.active = false;
    animation.current = null;
    animation.change('Idle_Loop', 0);
  }
}

export class OctopusRidingPose extends OctopusClipPose {
  private boat = false;
  update(animation: PoseAnimation, time: number, _speed: number, boat = false) {
    this.boat = boat;
    this.sample(animation, boat ? 'Boat_Loop' : 'Ride_Loop', ((time % 2) + 2) % 2);
  }

  pelvisOffset(out: THREE.Vector3) {
    const hips = this.root.getObjectByName('Hips');
    if (!hips) throw new Error('The octopus is missing its mantle socket');
    this.root.updateWorldMatrix(true, true);
    this.root.worldToLocal(hips.getWorldPosition(out));
    // The mammoth socket is 12 cm above its measured back. An octopus rests
    // on its lower arms, so aligning human-like hips would bury the mantle.
    if (!this.boat) out.y = 0.12;
    return out;
  }
}

export class OctopusJumpPose extends OctopusClipPose {
  update(animation: PoseAnimation, progress: number) {
    // The authored clip is one second; world movement follows the shared jump arc.
    this.sample(animation, 'Jump', THREE.MathUtils.clamp(progress, 0, 1));
  }
}

/** Reach with the flexible right tentacle while its supporting arms stay planted. */
export class OctopusPettingPose {
  private bones: THREE.Object3D[];
  private tip: THREE.Object3D;
  private base: THREE.Quaternion[];
  private lengths: number[];
  private points: THREE.Vector3[];
  private applied = false;
  private origin = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private target = new THREE.Vector3();
  private rootQ = new THREE.Quaternion();
  private worldQ = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  readonly requested = new THREE.Vector3();
  readonly contact = new THREE.Vector3();
  weight = 0;
  depth = 0;

  constructor(private root: THREE.Object3D) {
    this.bones = [];
    root.traverse((bone) => {
      if ((bone as THREE.Bone).isBone && /^ArmR\d+$/.test(bone.name)) this.bones.push(bone);
    });
    this.bones.sort((a, b) => a.name.localeCompare(b.name));
    const tip = root.getObjectByName('GripR');
    if (this.bones.length < 6 || !tip) throw new Error('The octopus needs its complete tentacle chain');
    this.tip = tip;
    this.base = this.bones.map((bone) => bone.quaternion.clone());
    root.updateWorldMatrix(true, true);
    this.points = [...this.bones, tip].map((bone) => bone.getWorldPosition(new THREE.Vector3()));
    this.lengths = this.bones.map((_, i) => this.points[i].distanceTo(this.points[i + 1]));
    if (this.lengths.some((length) => length <= 0)) throw new Error('Invalid octopus tentacle length');
  }

  blendWeight(weight: number, dt: number) {
    this.weight = Math.max(weight, this.weight - dt * 6);
    return this.weight;
  }

  restore() {
    if (!this.applied) return;
    this.bones.forEach((bone, i) => bone.quaternion.copy(this.base[i]));
    this.applied = false;
  }

  update(position: THREE.Vector3, weight: number, stroke: number) {
    this.restore();
    this.weight = weight;
    if (weight <= 0) return;
    this.bones.forEach((bone, i) => this.base[i].copy(bone.quaternion));
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootQ);
    [...this.bones, this.tip].forEach((bone, i) => bone.getWorldPosition(this.points[i]));
    this.origin.copy(this.points[0]);
    this.requested.copy(position).add(
      this.direction.set(Math.sin(stroke * Math.PI * 4) * 0.035, 0, 0).applyQuaternion(this.rootQ),
    );
    const total = this.lengths.reduce((sum, value) => sum + value, 0);
    this.direction.subVectors(this.requested, this.origin).clampLength(0, total * 0.998);
    this.target.copy(this.origin).add(this.direction);
    const last = this.points.length - 1;
    // FABRIK preserves every segment length; only the delivered skin is deformed.
    for (let iteration = 0; iteration < 32; iteration++) {
      this.points[last].copy(this.target);
      for (let i = last - 1; i >= 0; i--) {
        this.direction.subVectors(this.points[i], this.points[i + 1]).normalize();
        this.points[i].copy(this.points[i + 1]).addScaledVector(this.direction, this.lengths[i]);
      }
      this.points[0].copy(this.origin);
      for (let i = 0; i < last; i++) {
        this.direction.subVectors(this.points[i + 1], this.points[i]).normalize();
        this.points[i + 1].copy(this.points[i]).addScaledVector(this.direction, this.lengths[i]);
      }
      if (this.points[last].distanceToSquared(this.target) < 1e-8) break;
    }
    for (const [i, bone] of this.bones.entries()) {
      bone.getWorldQuaternion(this.worldQ);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.worldQ);
      this.direction.subVectors(this.points[i + 1], this.points[i]).normalize();
      this.worldQ.premultiply(new THREE.Quaternion().setFromUnitVectors(up, this.direction));
      bone.parent!.getWorldQuaternion(this.parentQ).invert();
      bone.quaternion.copy(this.parentQ.multiply(this.worldQ));
      bone.updateWorldMatrix(false, true);
    }
    this.bones.forEach((bone, i) => bone.quaternion.slerp(this.base[i], 1 - weight));
    this.root.updateWorldMatrix(true, true);
    this.tip.getWorldPosition(this.contact);
    this.applied = true;
  }
}
