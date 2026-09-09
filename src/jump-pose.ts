import { RidingPose } from './riding-pose.js';

/** Pose the existing skin; the shared arc moves its root above the walking surface. */
export class JumpPose extends RidingPose {
  update(animation, progress: number) {
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
    const tuck = Math.sin(Math.PI * progress);
    this.aim('Spine', 0, 1, 0.08);
    this.aim('Chest', 0, 1, 0.04);
    this.aim('Neck', 0, 1, 0);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      this.aim(`UpperLeg${side}`, sign * 0.08, -1, 0.1 + tuck * 0.65);
      this.aim(`LowerLeg${side}`, 0, -1, -0.1 - tuck * 0.8);
      this.aim(`Foot${side}`, sign * 0.05, -0.1, 1);
      this.aim(`UpperArm${side}`, sign * 0.28, -1, -0.12);
      this.aim(`LowerArm${side}`, sign * -0.08, -0.65, 0.65);
    }
    animation.name = 'Jump';
  }
}
