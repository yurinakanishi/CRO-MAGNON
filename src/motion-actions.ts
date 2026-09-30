import type { HandPose, HandSample } from './motion-hands.js';
export type MotionAction = 'attack' | 'jump' | 'interact';
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Right-hand modes are exclusive: a pose transition cannot also drag the camera. */
export class MotionHandActions {
  candidate: MotionAction | null = null;
  progress = 0;
  attackReady = true;
  pose: HandPose = 'unknown';
  cameraDelta = { x: 0, y: 0 };
  cameraTravel = { x: 0, y: 0 };
  cameraDragging = false;
  private poseAt = 0;
  private releaseAt: number | null = null;
  private cameraAnchor: { x: number; y: number } | null = null;
  private stroke: { x: number; y: number; at: number } | null = null;
  private strokeCooldown = -Infinity;

  get hint() {
    if (this.pose === 'gun')
      return this.attackReady ? '銃の形を確認中' : '次の攻撃は指を開いてから、もう一度銃の形へ';
    if (this.pose === 'stroke') return '手のひらを水平にして横になでる → 撫でる・採取';
    if (this.pose === 'camera') return '手を上下左右になぞる → 視点 · 止めると視点も停止';
    if (this.pose === 'other') return '視点は停止 · 軽く握って手を戻し、開くと続けられます';
    return '指先まで映してください · 親・人・中を伸ばし、薬・小を曲げると攻撃';
  }
  reset() {
    this.attackReady = true;
    this.cameraTravel = { x: 0, y: 0 };
    this.strokeCooldown = -Infinity;
    this.interrupt();
  }
  private interrupt() {
    this.candidate = null;
    this.progress = 0;
    this.pose = 'unknown';
    this.releaseAt = null;
    this.cameraAnchor = this.stroke = null;
    this.cameraDelta = { x: 0, y: 0 };
    this.cameraDragging = false;
  }
  loseTracking() {
    // Missing/uncertain fingers are not a release or a new gun pose.
    if (this.pose === 'gun') this.attackReady = false;
    this.interrupt();
  }
  reacquire(sample: HandSample, at: number) {
    this.interrupt();
    this.pose = sample.pose;
    this.poseAt = at;
    if (sample.pose === 'gun') this.attackReady = false;
  }
  update(sample: HandSample, at: number, scale: number): MotionAction | null {
    this.candidate = null;
    this.progress = 0;
    this.cameraDelta = { x: 0, y: 0 };
    this.cameraDragging = false;
    if (sample.pose !== this.pose) {
      this.pose = sample.pose;
      this.poseAt = at;
      this.cameraAnchor = this.stroke = null;
    }
    if (this.pose !== 'gun' && this.pose !== 'unknown') {
      this.releaseAt ??= at;
      if (at - this.releaseAt >= 100) this.attackReady = true;
    } else this.releaseAt = null;
    if (this.pose === 'gun') {
      if (!this.attackReady) return null;
      this.candidate = 'attack';
      this.progress = clamp((at - this.poseAt) / 100);
      if (this.progress < 1) return null;
      this.attackReady = false;
      return 'attack';
    }
    if (this.pose === 'camera') {
      if (at - this.poseAt < 70) return null;
      this.cameraDragging = true;
      const anchor = this.cameraAnchor;
      if (!anchor || Math.hypot(sample.x - anchor.x, sample.y - anchor.y) > 0.12) {
        this.cameraAnchor = { x: sample.x, y: sample.y };
        return null;
      }
      // A small sticky dead zone removes stationary jitter without discarding slow strokes.
      const travel = (delta: number) =>
        Math.abs(delta) > 0.004 + 1e-9 ? Math.sign(delta) * (Math.abs(delta) - 0.004) : 0;
      const dx = travel(sample.x - anchor.x),
        dy = travel(sample.y - anchor.y);
      anchor.x += dx;
      anchor.y += dy;
      this.cameraDelta = { x: dx * 4, y: dy * 3 };
      this.cameraTravel.x += this.cameraDelta.x;
      this.cameraTravel.y += this.cameraDelta.y;
      return null;
    }
    if (this.pose !== 'stroke') return null;
    if (
      at - this.poseAt < 70 ||
      at < this.strokeCooldown ||
      !this.stroke ||
      at - this.stroke.at > 1400 ||
      Math.abs(sample.y - this.stroke.y) > scale * 0.22
    ) {
      this.stroke = { x: sample.x, y: sample.y, at };
      return null;
    }
    const distance = Math.abs(sample.x - this.stroke.x) / scale;
    if (distance < 0.07) return null;
    this.candidate = 'interact';
    this.progress = Math.min(clamp(distance / 0.22), clamp((at - this.stroke.at) / 100));
    if (this.progress < 1) return null;
    this.strokeCooldown = at + 600;
    this.stroke = null;
    return 'interact';
  }
}

/** Raising the movement hand leaves both right-hand camera axes available. */
export class MotionJump {
  progress = 0;
  private ready = true;
  private raisedAt: number | null = null;
  private loweredAt: number | null = null;
  reset() {
    this.ready = true;
    this.loseTracking();
  }
  loseTracking() {
    if (this.raisedAt !== null) this.ready = false;
    this.raisedAt = this.loweredAt = null;
    this.progress = 0;
  }
  reacquire(y: number) {
    this.loseTracking();
    if (y < -0.28) this.ready = false;
  }
  update(y: number, open: boolean, at: number) {
    this.progress = 0;
    if (!this.ready) {
      if (y > -0.12 && open) {
        this.loweredAt ??= at;
        if (at - this.loweredAt >= 80) this.ready = true;
      } else this.loweredAt = null;
      return false;
    }
    if (!open || y > -0.28) {
      this.raisedAt = null;
      return false;
    }
    this.raisedAt ??= at;
    this.progress = clamp((at - this.raisedAt) / 200);
    if (this.progress < 1) return false;
    this.ready = false;
    this.raisedAt = null;
    return true;
  }
}
