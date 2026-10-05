const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const wrapHeading = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
export const ASSISTED_CONTROLS_KEY = 'cro-magnon-assisted-controls-v1';
export function readAssistedControls() {
  try {
    return localStorage.getItem(ASSISTED_CONTROLS_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Steering owns its heading; animation, attacks and reverse velocity never replace it. */
export class AssistedNavigation {
  heading = 0;
  private identity = '';
  private previousAt: number | null = null;
  reset() {
    this.identity = '';
    this.previousAt = null;
  }
  pause() {
    this.previousAt = null;
  }
  step(forward: number, turn: number, now: number, identity: string, initialFacing: number) {
    if (identity !== this.identity) {
      this.identity = identity;
      this.heading = wrapHeading(initialFacing || 0);
      this.previousAt = null;
    }
    const dt = this.previousAt === null ? 0 : clamp((now - this.previousAt) / 1000, 0, 0.1);
    this.previousAt = now;
    // Positive stick/hand x is a right turn when viewed from behind the actor.
    this.heading = wrapHeading(this.heading - clamp(turn, -1, 1) * 1.65 * dt);
    const speed = clamp(forward, -1, 1);
    return {
      dx: Math.sin(this.heading) * speed,
      dz: Math.cos(this.heading) * speed,
      // Idle packets must not undo an action's facing or cancel a pet approach.
      facing: forward || turn ? this.heading : undefined,
    };
  }
}

export interface AssistCandidate<T> {
  id: string;
  score: number;
  value: T;
}
/** Keep a valid target until a substantially better one stays preferable for 450 ms. */
export class StableAssistTarget<T> {
  private selected = '';
  private challenger = '';
  private since = 0;
  reset() {
    this.selected = this.challenger = '';
  }
  choose(candidates: AssistCandidate<T>[], now: number): T | null {
    const best = candidates.reduce<AssistCandidate<T> | null>(
      (a, b) => (!a || b.score < a.score ? b : a),
      null,
    );
    const current = candidates.find((c) => c.id === this.selected);
    if (!current) {
      this.selected = best?.id ?? '';
      this.challenger = '';
      return best?.value ?? null;
    }
    if (best && best.id !== current.id && best.score + 0.25 < current.score * 0.65) {
      if (this.challenger !== best.id) {
        this.challenger = best.id;
        this.since = now;
      }
      if (now - this.since >= 450) {
        this.selected = best.id;
        this.challenger = '';
        return best.value;
      }
    } else this.challenger = '';
    return current.value;
  }
}
