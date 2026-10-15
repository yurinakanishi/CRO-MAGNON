import { openSoloSave } from './solo-save.mjs';
import { SoloRuntime, type SoloOutput } from './solo-runtime.mjs';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: SoloOutput): void;
};
let runtime: SoloRuntime | null = null;
let release: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let chain = Promise.resolve();
let ticking = false;
let closed = false;
const output = (message: SoloOutput) => {
  scope.postMessage(message);
  if (message.type === 'closed') {
    closed = true;
    clearInterval(timer);
    release?.();
  }
};
const fail = (text: string) => {
  output({
    type: 'message',
    data: JSON.stringify({ type: 'error', code: 'SOLO_UNAVAILABLE', text }),
  });
  output({ type: 'closed', code: 4009, reason: 'Solo unavailable' });
};
const enqueue = (task: () => Promise<unknown>) => {
  chain = chain.then(task).then(
    () => {},
    () =>
      fail(
        'ソロの保存を開けませんでした。保存データは消していません。通常のブラウザーで開き直してください。',
      ),
  );
};

scope.onmessage = ({ data }) => {
  if (data.type === 'start') {
    if (runtime || closed) return;
    enqueue(async () => {
      if (!navigator.locks) throw new Error('Web Locks required for safe autosave');
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request('cro-magnon-solo-play', { ifAvailable: true }, async (lock) => {
            if (!lock) {
              fail(
                '別のタブでソロプレイ中です。そのタブをタイトルへ戻してから、もう一度始めてください。',
              );
              resolve();
              return;
            }
            const held = new Promise<void>((done) => {
              release = done;
            });
            try {
              runtime = new SoloRuntime(await openSoloSave(), output);
              await runtime.start(data.profile);
              if (!closed)
                timer = setInterval(() => {
                  if (ticking || closed) return;
                  ticking = true;
                  enqueue(async () => {
                    try {
                      await runtime?.tick();
                    } finally {
                      ticking = false;
                    }
                  });
                }, 50);
              resolve();
              await held;
            } catch (error) {
              release?.();
              reject(error);
            }
          })
          .catch(reject);
      });
    });
  } else
    enqueue(async () => {
      if (data.type === 'command') await runtime?.command(data.data);
      else if (data.type === 'save') await runtime?.save();
      else if (data.type === 'close') {
        clearInterval(timer);
        await runtime?.close();
        if (!closed) output({ type: 'closed', code: 1000, reason: '' });
      }
    });
};
