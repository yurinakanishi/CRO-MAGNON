export class FrameClock {
  declare interval: number;
  declare next: number;
  declare lastRender: number;

  constructor(now: number, framesPerSecond = 60) {
    this.interval = 1000 / framesPerSecond;
    this.next = now;
    this.lastRender = now;
  }
  advance(now: number, hidden = false): number | null {
    if (hidden) {
      this.next = this.lastRender = now;
      return null;
    }
    // RAF timestamps on 60 Hz screens jitter around the nominal boundary.
    // A 1 ms tolerance avoids dropping every other frame when it arrives early.
    if (now + 1 < this.next) return null;
    const dt = Math.min(Math.max(0, now - this.lastRender) / 1000, 0.06);
    this.lastRender = now;
    this.next += Math.max(1, Math.floor((now - this.next) / this.interval) + 1) * this.interval;
    return dt;
  }
}
