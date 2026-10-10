/** The game's only graphics profile, formerly 軽量. No player setting, stored
 * preference or device probe selects another one: every host uses these values. */
export const FRAME_RATE = 30;
/** Drawing-buffer budget: 1280×720 pixels, at a device pixel ratio no higher than 1. */
export const MAX_DRAWING_PIXELS = 1280 * 720;
/** Hidden per-axis buffer scale after sustained overload. It is not a quality option. */
export const SAFETY_BUFFER_SCALE = 0.75;

const WARMUP_MS = 8000;
const RESUME_WARMUP_MS = 2000;
const WINDOW_MS = 3000;
const SLOW_WINDOWS = 3;
// A longer interval is a timing gap (stall, suspended tab), not a frame rate.
const GAP_MS = 250;
// 20 FPS is the vsync step below the 30 FPS cap on 60 Hz displays. The 2% margin
// keeps that step (50.05 ms at 59.94 Hz) from counting as falling below it.
const SLOW_FRAME_MS = (1000 / 20) * 1.02;
// The longest tenth of a window's intervals are isolated stalls, not its pace.
const STALL_SHARE = 0.1;

/** Drawing-buffer pixels per CSS pixel. The DOM size itself is never reduced. */
export function graphicsPixelRatio(width: number, height: number, dpr: number, scale = 1) {
  const fit = Math.sqrt(MAX_DRAWING_PIXELS / (Math.max(1, width) * Math.max(1, height)));
  return scale * Math.min(Math.max(0.1, dpr || 1), 1, fit);
}

function typicalFrameMs(intervals: number[]) {
  const kept = intervals
    .slice()
    .sort((a, b) => a - b)
    .slice(0, intervals.length - Math.floor(intervals.length * STALL_SHARE));
  return kept.reduce((sum, ms) => sum + ms, 0) / kept.length;
}

/** The fixed 30 FPS cap and the drawing buffer's hidden safety scale. Only
 * sustained, active rendering below 20 FPS lowers the scale, once per session.
 * Loading, hidden or covered views, stalls and timing gaps restart the
 * measurement, and frames paced by the 30 FPS cap never count as overload. */
export class GraphicsBudget {
  readonly fps = FRAME_RATE;
  /** Effective drawing-buffer safety scale: 1, or SAFETY_BUFFER_SCALE. */
  scale = 1;
  private warmupUntil = Infinity;
  private elapsed = 0;
  private intervals: number[] = [];
  private slowWindows = 0;

  /** The world became ready; measure only after its first frames have settled. */
  ready(now: number) {
    this.warmupUntil = now + WARMUP_MS;
    this.restart();
  }
  private restart() {
    this.elapsed = this.slowWindows = 0;
    this.intervals.length = 0;
  }
  /** Record one drawn frame. Returns true when the buffer scale changed. */
  observe(now: number, frameMs: number, active: boolean): boolean {
    if (!active || !(frameMs > 0 && frameMs <= GAP_MS)) {
      this.restart();
      this.warmupUntil = Math.max(this.warmupUntil, now + RESUME_WARMUP_MS);
      return false;
    }
    if (this.scale !== 1 || now < this.warmupUntil) return false;
    this.intervals.push(frameMs);
    this.elapsed += frameMs;
    if (this.elapsed < WINDOW_MS) return false;
    this.slowWindows = typicalFrameMs(this.intervals) > SLOW_FRAME_MS ? this.slowWindows + 1 : 0;
    this.elapsed = 0;
    this.intervals.length = 0;
    if (this.slowWindows < SLOW_WINDOWS) return false;
    this.scale = SAFETY_BUFFER_SCALE;
    return true;
  }
}
