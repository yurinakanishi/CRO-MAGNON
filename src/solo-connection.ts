/** A local message channel with the socket events the existing game view consumes. */
let previousClosed: Promise<void> = Promise.resolve();
export class SoloConnection extends EventTarget {
  readyState = 0;
  readonly bufferedAmount = 0;
  private worker: Worker | null = null;
  private closing = false;
  private finish!: () => void;
  private leaving: { promise: Promise<boolean>; resolve: (saved: boolean) => void } | null = null;

  constructor(profile: Record<string, string>) {
    super();
    const previous = previousClosed;
    previousClosed = new Promise((resolve) => {
      this.finish = resolve;
    });
    void previous.then(() => {
      if (this.closing) {
        this.closed(1000, '');
        return;
      }
      try {
        this.worker = new Worker(new URL('./solo-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'open') {
            this.readyState = 1;
            this.dispatchEvent(new Event('open'));
          } else if (data.type === 'message')
            this.dispatchEvent(new MessageEvent('message', { data: data.data }));
          else if (data.type === 'close-refused') {
            if (!this.closing) this.readyState = 1;
            this.leaving?.resolve(false);
            this.leaving = null;
          } else if (data.type === 'closed') this.closed(data.code, data.reason);
        };
        this.worker.onerror = () => {
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                type: 'error',
                code: 'SOLO_UNAVAILABLE',
                text: 'ソロプレイを開始できませんでした。再読み込みしてください。',
              }),
            }),
          );
          this.closed(4009, 'Worker unavailable');
        };
        this.worker.postMessage({ type: 'start', profile });
        window.addEventListener('pagehide', this.checkpoint);
        document.addEventListener('visibilitychange', this.hidden);
      } catch {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              type: 'error',
              code: 'SOLO_UNAVAILABLE',
              text: 'ソロプレイを開始できませんでした。再読み込みしてください。',
            }),
          }),
        );
        this.closed(4009, 'Worker unavailable');
      }
    });
  }

  send(data: string) {
    if (this.readyState === 1) this.worker?.postMessage({ type: 'command', data });
  }
  /** Resolve only after the final transaction commits, or keep playing on failure. */
  leave(): Promise<boolean> {
    if (this.leaving) return this.leaving.promise;
    if (this.readyState !== 1 || this.closing) return Promise.resolve(false);
    let resolve!: (saved: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    this.leaving = { promise, resolve };
    this.readyState = 2;
    this.worker!.postMessage({ type: 'leave' });
    return promise;
  }
  close() {
    if (this.closing || this.readyState === 3) return;
    this.closing = true;
    this.readyState = 2;
    this.worker?.postMessage({ type: 'close' });
  }
  private checkpoint = () => this.worker?.postMessage({ type: 'save' });
  private hidden = () => {
    if (document.hidden) this.checkpoint();
  };
  private closed(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.worker?.terminate();
    window.removeEventListener('pagehide', this.checkpoint);
    document.removeEventListener('visibilitychange', this.hidden);
    this.leaving?.resolve(code === 1000);
    this.leaving = null;
    this.finish();
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}
