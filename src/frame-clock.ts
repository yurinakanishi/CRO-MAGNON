import { FRAME_RATE } from './graphics-quality.js';

/** The game's only frame cap. The loading cave and the world both draw through
 * the world loop's clock, so every game renderer runs at FRAME_RATE. */
export class FrameClock {
  readonly interval = 1000 / FRAME_RATE;
  declare next: number;
  declare lastRender: number;

  constructor(now: number) {
    this.next = now;
    this.lastRender = now;
  }
  advance(now: number, hidden = false): number | null {
    if (hidden) {
      this.next = this.lastRender = now;
      return null;
    }
    // RAF timestamps jitter around the nominal vsync. A 1 ms tolerance keeps a
    // due frame that arrives slightly early instead of waiting another refresh.
    if (now + 1 < this.next) return null;
    const dt = Math.min(Math.max(0, now - this.lastRender) / 1000, 0.06);
    this.lastRender = now;
    this.next += Math.max(1, Math.floor((now - this.next) / this.interval) + 1) * this.interval;
    return dt;
  }
}
