/** Bounded numeric samples only. Never persist images or body landmarks. */
export class MotionMetrics {
  private samples = new Map<string, number[]>();
  frames = 0;
  valid = 0;
  dropped = 0;
  trackingLosses = 0;
  startedAt = 0;
  startupMs = 0;
  modelLoadMs = 0;
  record(key: string, value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const values = this.samples.get(key) ?? [];
    if (values.length === 600) values.shift();
    values.push(value);
    this.samples.set(key, values);
  }
  latest(key: string) {
    const values = this.samples.get(key);
    return values?.[values.length - 1] ?? 0;
  }
  summary(now: number) {
    const distributions = Object.fromEntries(
      [...this.samples].map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [
          name,
          {
            count: sorted.length,
            median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
            p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
            over50Ms: sorted.filter((x) => x > 50).length,
          },
        ];
      }),
    );
    return {
      frames: this.frames,
      validRate: this.frames ? this.valid / this.frames : 0,
      effectiveHz: this.startedAt
        ? this.frames / Math.max(0.001, (now - this.startedAt) / 1000)
        : 0,
      dropped: this.dropped,
      trackingLosses: this.trackingLosses,
      startupMs: this.startupMs,
      modelLoadMs: this.modelLoadMs,
      distributions,
    };
  }
}
