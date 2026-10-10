/** Start terrain preparation once its verified dependencies arrive. The remaining
 * props may keep downloading, but arrival still waits for both. The world owns
 * the resulting terrain; cancellation stops its pending workers. */
export class StartupTerrain {
  readonly done: Promise<void>;
  private readonly required: Set<string>;
  private started = false;
  private disposed = false;
  private resolve!: () => void;
  private reject!: (error: unknown) => void;

  constructor(
    private readonly world: {
      disposed: boolean;
      failed?: boolean;
      worldAssets: { templates: Map<string, unknown> };
      openWorld?: { disposed: boolean; dispose(): void };
    },
    floorKeys: readonly string[],
    private readonly build: (cancelled: () => boolean) => Promise<void>,
  ) {
    this.required = new Set([...floorKeys, 'river-water', 'wood-footbridge']);
    this.done = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // A late failure after another startup task failed must still be observed.
    this.done.catch(() => {});
  }

  poll(last = false) {
    if (this.started || this.disposed) return;
    if (this.world.disposed || this.world.failed) return this.dispose();
    const missing = [...this.required].filter((key) => !this.world.worldAssets.templates.has(key));
    if (missing.length) {
      if (last) {
        this.started = true;
        this.reject(new Error(`Missing verified terrain dependencies ${missing.join(', ')}`));
      }
      return;
    }
    this.started = true;
    // Convert a synchronous build failure to the same observed rejection.
    Promise.resolve()
      .then(() => {
        if (this.disposed || this.world.disposed || this.world.failed) return;
        return this.build(() => this.disposed || this.world.disposed || !!this.world.failed);
      })
      .then(this.resolve, this.reject);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.started && this.world.openWorld && !this.world.openWorld.disposed)
      this.world.openWorld.dispose();
    this.resolve();
  }
}
