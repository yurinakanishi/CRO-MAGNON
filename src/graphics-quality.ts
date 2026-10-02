export type GraphicsMode = 'auto' | 'low' | 'standard';
export type GraphicsTier = Exclude<GraphicsMode, 'auto'>;
export const GRAPHICS_KEY = 'cro-graphics-quality';
export const GRAPHICS_LABELS = { auto: '自動', low: '軽量', standard: '標準' } as const;

export function graphicsMode(value: unknown): GraphicsMode {
  return value === 'low' || value === 'standard' ? value : 'auto';
}

export function readGraphicsMode(): GraphicsMode {
  try {
    return graphicsMode(localStorage.getItem(GRAPHICS_KEY));
  } catch {
    return 'auto';
  }
}

export function graphicsPixelRatio(width: number, height: number, dpr: number, tier: GraphicsTier) {
  const pixels = tier === 'low' ? 1280 * 720 : 1920 * 1080;
  return Math.min(
    Math.max(0.1, dpr || 1),
    tier === 'low' ? 1 : 1.25,
    Math.sqrt(pixels / (Math.max(1, width) * Math.max(1, height))),
  );
}

/** Auto starts conservatively on small CPUs. Sustained slow frames downgrade
 * once per session; it never oscillates or mistakes a 30 FPS cap for spare GPU. */
export class GraphicsQuality {
  mode: GraphicsMode;
  tier: GraphicsTier;
  private warmupUntil = Infinity;
  private elapsed = 0;
  private frames = 0;
  private slowWindows = 0;

  constructor(
    mode: GraphicsMode,
    private cores = 8,
    private memoryGB = 8,
  ) {
    this.mode = mode;
    this.tier = this.initialTier();
  }
  private initialTier(): GraphicsTier {
    return this.mode === 'auto'
      ? this.cores <= 4 || this.memoryGB <= 4
        ? 'low'
        : 'standard'
      : this.mode;
  }
  get fps() {
    return this.tier === 'low' ? 30 : 60;
  }
  setMode(mode: GraphicsMode, now: number) {
    this.mode = mode;
    this.tier = this.initialTier();
    this.ready(now);
  }
  ready(now: number) {
    this.warmupUntil = now + 8000;
    this.resetWindow();
  }
  private resetWindow() {
    this.elapsed = this.frames = this.slowWindows = 0;
  }
  observe(now: number, frameMs: number, active: boolean): boolean {
    if (!active || frameMs > 250 || frameMs <= 0) {
      this.resetWindow();
      this.warmupUntil = Math.max(this.warmupUntil, now + 2000);
      return false;
    }
    if (this.mode !== 'auto' || this.tier === 'low' || now < this.warmupUntil) return false;
    this.elapsed += frameMs;
    this.frames++;
    if (this.elapsed < 3000) return false;
    const slow = (this.frames * 1000) / this.elapsed < 45;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.elapsed = this.frames = 0;
    if (this.slowWindows < 2) return false;
    this.tier = 'low';
    return true;
  }
}
