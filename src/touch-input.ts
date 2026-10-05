import type { CueAction, CueContext } from './input-cues.js';

export interface TouchMovement {
  x: number;
  y: number;
  running: boolean;
}

/** Radial deadzone and gait hysteresis keep a resting thumb still. */
export function touchStick(
  dx: number,
  dy: number,
  radius: number,
  wasRunning = false,
): TouchMovement {
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || radius <= 0 || length / radius <= 0.16)
    return { x: 0, y: 0, running: false };
  const magnitude = Math.min(1, (length / radius - 0.16) / 0.84);
  return {
    x: (dx / length) * magnitude,
    y: (dy / length) * magnitude,
    running: length / radius >= (wasRunning ? 0.64 : 0.78),
  };
}

/** Each available action has its own touch target, without a keyboard's three-cue limit. */
export function touchActions(context: CueContext): { action: CueAction; label: string }[] {
  if (context.viewing && !context.automaticCamera)
    return [
      { action: 'zoomIn', label: '近く' },
      { action: 'zoomOut', label: '遠く' },
      { action: 'endInspect', label: '戻る' },
    ];
  if (context.busy) return [{ action: 'cancel', label: 'やめる' }];
  const actions: { action: CueAction; label: string }[] = [];
  const add = (action: CueAction, label?: string) => {
    if (label) actions.push({ action, label });
  };
  add('pet', context.pet);
  if (context.interaction !== context.pet) add('interact', context.interaction);
  add('ride', context.ride);
  add('board', context.board);
  if (context.inspect && !context.automaticCamera) add('inspect', `${context.inspect}を見る`);
  if (context.recall) add('recall', 'みんなを呼ぶ');
  if (context.throw) add('throw', '1匹投げる');
  add('torch', context.torch);
  return actions;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Touch orbit takes priority. Follow resumes only during travel, after a quiet interval. */
export class TouchCameraFollow {
  enabled = false;
  private heading: number | null = null;
  private holdUntil = 0;
  movement(dx: number, dz: number) {
    this.heading = Math.hypot(dx, dz) > 0.04 ? Math.atan2(dx, dz) + Math.PI : null;
  }
  hold(now: number) {
    this.holdUntil = now + 2200;
  }
  reset() {
    this.heading = null;
    this.holdUntil = 0;
  }
  step(yaw: number, now: number, dt: number, dragging: boolean) {
    if (!this.enabled || this.heading === null || dragging || now < this.holdUntil) return yaw;
    return wrap(yaw + wrap(this.heading - yaw) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.4)));
  }
}

/** Keep enough horizontal room for the world and actor on a tall, narrow phone. */
export function touchFieldOfView(aspect: number, touch: boolean) {
  return touch && aspect < 1
    ? Math.min(
        88,
        Math.max(57, (2 * Math.atan(Math.tan((44 * Math.PI) / 360) / aspect) * 180) / Math.PI),
      )
    : 57;
}
