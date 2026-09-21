import * as THREE from 'three';

// One worker per world, one job in flight. Queued geometry stays cancellable;
// transferred buffers are owned by the worker, never the shared GLB template.
export class RiverBankBuilder {
  private worker: Worker | null = null;
  private serial = 0;
  private jobs = new Map<
    number,
    {
      source: THREE.BufferGeometry;
      resolve: (geometry: THREE.BufferGeometry) => void;
      reject: (error: Error) => void;
    }
  >();
  private active: number | null = null;
  private stopped = false;
  constructor(
    private createWorker = () =>
      new Worker(new URL('./river-bank-worker.js', import.meta.url), { type: 'module' }),
  ) {}

  build(source: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
    if (this.stopped) {
      source.dispose();
      return Promise.reject(new Error('River bank builder disposed'));
    }
    return new Promise((resolve, reject) => {
      this.jobs.set(++this.serial, { source, resolve, reject });
      this.dispatch();
    });
  }
  private dispatch() {
    if (this.active !== null || this.stopped || !this.jobs.size) return;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = ({ data }) => this.complete(data);
        this.worker.onerror = () => this.stop(new Error('River bank worker failed'));
        this.worker.onmessageerror = () =>
          this.stop(new Error('Invalid river bank worker response'));
      }
      const [id, job] = this.jobs.entries().next().value!;
      this.active = id;
      const attributes = Object.fromEntries(
        Object.entries(job.source.attributes)
          .filter(([name]) => name !== 'normal' && name !== 'tangent')
          .map(([name, a]: [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute]) => {
            if (a instanceof THREE.InterleavedBufferAttribute) {
              const array = new Float32Array(a.count * a.itemSize);
              for (let i = 0; i < a.count; i++)
                for (let j = 0; j < a.itemSize; j++)
                  array[i * a.itemSize + j] = a.getComponent(i, j);
              return [name, { array, itemSize: a.itemSize, normalized: false }];
            }
            return [name, { array: a.array, itemSize: a.itemSize, normalized: a.normalized }];
          }),
      );
      const index = job.source.index?.array;
      const transfers = Object.values(attributes).map((a) => a.array.buffer as ArrayBuffer);
      if (index) transfers.push(index.buffer as ArrayBuffer);
      try {
        this.worker.postMessage({ id, attributes, index }, [...new Set(transfers)]);
      } finally {
        job.source.dispose();
      }
    } catch (error) {
      this.stop(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private complete(data: any) {
    const job = this.jobs.get(data.id);
    if (!job || this.stopped || data.id !== this.active) return;
    this.jobs.delete(data.id);
    this.active = null;
    if (data.error) job.reject(new Error(data.error));
    else {
      const geometry = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(data.attributes) as [string, any][])
        geometry.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
      if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
      geometry.computeBoundingSphere();
      job.resolve(geometry);
    }
    this.dispatch();
  }
  private stop(error: Error) {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    for (const [id, job] of this.jobs) {
      if (id !== this.active) job.source.dispose();
      job.reject(error);
    }
    this.jobs.clear();
    this.active = null;
  }
  dispose() {
    this.stop(new Error('River bank builder disposed'));
  }
}
