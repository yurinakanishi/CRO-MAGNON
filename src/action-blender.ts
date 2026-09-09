import * as THREE from 'three';

/** Keep a normalized mixture even when the next command interrupts a fade. */
export class ActionBlender {
  private from = new Map<THREE.AnimationAction, number>();
  private target: THREE.AnimationAction | null = null;
  private elapsed = 0;
  private duration = 0;

  constructor(private actions: Map<string, THREE.AnimationAction>) {}

  start(next: THREE.AnimationAction, fade: number, oneShot: boolean, speed = 1) {
    this.from.clear();
    let total = 0;
    for (const action of this.actions.values()) {
      const weight = action.isScheduled() && action.enabled ? action.getEffectiveWeight() : 0;
      if (weight > 0) {
        this.from.set(action, weight);
        total += weight;
      }
      action.stopFading();
    }
    if (total > 0) for (const [action, weight] of this.from) this.from.set(action, weight / total);
    this.target = next;
    this.elapsed = 0;
    this.duration = total > 0 ? Math.max(0, fade) : 0;
    next
      .reset()
      .setEffectiveTimeScale(speed)
      .setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    next.play();
    this.update(0);
  }

  update(dt: number) {
    if (!this.target) return;
    this.elapsed += Math.max(0, dt);
    const t = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
    const blend = t * t * (3 - 2 * t);
    for (const action of this.actions.values()) {
      const weight =
        (this.from.get(action) ?? 0) * (1 - blend) + (action === this.target ? blend : 0);
      if (weight > 0 || action === this.target) action.setEffectiveWeight(weight);
      else if (action.isScheduled()) action.stop();
    }
    if (t === 1) this.from.clear();
  }
}

export function gaitPhase(previous: THREE.AnimationAction | null, next: THREE.AnimationAction) {
  const moving = (a: THREE.AnimationAction) => ['Walk_Loop', 'Run_Loop'].includes(a.getClip().name);
  return previous && moving(previous) && moving(next)
    ? ((previous.time / previous.getClip().duration) % 1) * next.getClip().duration
    : 0;
}
