import type { HandPose, HandSample } from './motion-hands.js';
export type MotionAction = 'attack' | 'jump' | 'interact';
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Position gates are exclusive: chest = attack, high = jump, low = stroke. */
export class MotionHandActions {
  candidate: MotionAction | null = null;
  progress = 0;
  attackReady = false;
  pose: HandPose = 'unknown';
  private gunAt: number | null = null;
  private releaseAt: number | null = null;
  private stroke: { x: number; y: number; at: number } | null = null;
  private strokeCooldown = -Infinity;

  get hint() {
    if (this.pose === 'gun') return this.attackReady ? '胸の前で攻撃' : '指を開くと次の攻撃';
    return '上げる：ジャンプ · 低く横振り：調べる';
  }
  reset() {
    this.strokeCooldown = -Infinity;
    this.loseTracking();
  }
  loseTracking() {
    this.candidate = null;
    this.progress = 0;
    this.pose = 'unknown';
    this.attackReady = false;
    this.releaseAt = this.gunAt = null;
    this.stroke = null;
  }
  reacquire(sample: HandSample, _at: number) {
    this.loseTracking();
    this.pose = sample.pose;
  }
  update(
    sample: HandSample,
    at: number,
    scale: number,
    offset: { x: number; y: number },
    allowed = true,
  ): MotionAction | null {
    this.candidate = null;
    this.progress = 0;
    this.pose = sample.pose;
    const chest = Math.abs(offset.x) <= 0.85 && offset.y >= -0.18 && offset.y <= 0.2;
    const open =
      sample.open && sample.fingers.slice(1).filter((finger) => finger === 'extended').length >= 3;
    if (open && sample.pose !== 'gun') {
      this.releaseAt ??= at;
      if (at - this.releaseAt >= 120) this.attackReady = true;
    } else this.releaseAt = null;
    if (!allowed) {
      this.gunAt = null;
      this.stroke = null;
      return null;
    }
    if (sample.pose === 'gun' && chest && this.attackReady) {
      this.stroke = null;
      this.gunAt ??= at;
      this.candidate = 'attack';
      this.progress = clamp((at - this.gunAt) / 140);
      if (this.progress < 1) return null;
      this.attackReady = false;
      this.gunAt = null;
      return 'attack';
    }
    this.gunAt = null;
    // A low sweep does not require an exact downward palm normal.
    if (
      !open ||
      sample.pose === 'gun' ||
      offset.y < 0.22 ||
      offset.y > 1.1 ||
      at < this.strokeCooldown
    ) {
      this.stroke = null;
      return null;
    }
    this.pose = 'stroke';
    if (
      !this.stroke ||
      at - this.stroke.at > 1200 ||
      Math.abs(sample.y - this.stroke.y) > scale * 0.18
    ) {
      this.stroke = { x: sample.x, y: sample.y, at };
      return null;
    }
    const distance = Math.abs(sample.x - this.stroke.x) / scale;
    if (distance < 0.07) return null;
    this.candidate = 'interact';
    this.progress = Math.min(clamp(distance / 0.24), clamp((at - this.stroke.at) / 120));
    if (this.progress < 1) return null;
    this.strokeCooldown = at + 650;
    this.stroke = null;
    return 'interact';
  }
}

/** A raised hand fires once, then must return below the release threshold. */
export class MotionJump {
  progress = 0;
  private ready = false;
  private raisedAt: number | null = null;
  private loweredAt: number | null = null;
  reset() {
    this.loseTracking();
  }
  loseTracking() {
    this.ready = false;
    this.raisedAt = this.loweredAt = null;
    this.progress = 0;
  }
  reacquire(_y: number) {
    this.loseTracking();
  }
  update(y: number, open: boolean, at: number, allowed = true) {
    this.progress = 0;
    if (!this.ready) {
      if (y > -0.12 && open) {
        this.loweredAt ??= at;
        if (at - this.loweredAt >= 120) this.ready = true;
      } else this.loweredAt = null;
      return false;
    }
    if (!allowed || !open || y > -0.32) {
      this.raisedAt = null;
      return false;
    }
    this.raisedAt ??= at;
    this.progress = clamp((at - this.raisedAt) / 180);
    if (this.progress < 1) return false;
    this.ready = false;
    this.raisedAt = this.loweredAt = null;
    return true;
  }
}
