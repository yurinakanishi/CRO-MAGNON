import type { MotionIntent, Offset } from './motion-input.js';

export { interactionTarget as motionTarget } from './interaction-target.js';
export type {
  PreferredPet as MotionPet,
  InteractionTarget as MotionTarget,
} from './interaction-target.js';
interface MovementSample {
  offset: Offset | null;
  push: number | null;
  roll: number | null;
}

/** Give a pet interaction a stable standing pose, while retaining deliberate movement to cancel. */
export class MotionPetHold {
  private held: { session: number; at: number; seen: boolean; reference: MovementSample } | null =
    null;
  private changeAt: number | null = null;
  get active() {
    return !!this.held;
  }
  begin(session: number, now: number, sample: MovementSample) {
    this.held = { session, at: now, seen: false, reference: { ...sample } };
    this.changeAt = null;
  }
  reset() {
    this.held = null;
    this.changeAt = null;
  }
  filter(
    intent: MotionIntent,
    sample: MovementSample,
    petting: boolean,
    now: number,
  ): MotionIntent {
    const held = this.held;
    if (!held) return intent;
    if (held.session !== intent.sessionId) {
      this.reset();
      return intent;
    }
    if (!intent.active) return intent;
    held.seen ||= petting;
    if (!held.seen && now - held.at > 900) {
      this.reset();
      return intent;
    }
    const ref = held.reference;
    if (sample.offset) {
      if (!ref.offset) held.reference = { ...sample };
      else {
        // Deliberate forward/backward movement or a new steering gesture cancels.
        const deliberate =
          (Math.abs(intent.forward) > 0.1 &&
            sample.push !== null &&
            ref.push !== null &&
            Math.abs(sample.push - ref.push) >= 0.18) ||
          (Math.abs(intent.turn) > 0.35 && Math.abs(sample.offset.x - ref.offset.x) >= 0.25);
        this.changeAt = deliberate ? (this.changeAt ?? intent.sampledAtMainMs) : null;
        if (this.changeAt !== null && intent.sampledAtMainMs - this.changeAt >= 80) {
          this.reset();
          return intent;
        }
        if (held.seen && !petting && intent.forward === 0 && intent.turn === 0) this.reset();
      }
    }
    return { ...intent, forward: 0, turn: 0 };
  }
}
