import { MotionInputAdapter, type MotionFrame } from './motion-input.js';
import { normalizeHands } from './motion-hands.js';
import { MotionMetrics } from './motion-metrics.js';
import { debugLandmarks, type MotionDebugFrame } from './motion-debug.js';

export type MotionDelegate = 'CPU' | 'GPU' | 'preview';
export interface CameraOptions {
  delegate: MotionDelegate;
  hz: 10 | 15 | 20;
  deviceId?: string;
}
export interface MotionCameraDevice {
  deviceId: string;
  label: string;
}
const errorMessage = (error: unknown) => {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'カメラが許可されていません。ブラウザーの権限設定を確認してください。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'カメラが見つかりません。接続を確認してください。';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'カメラを開始できません。他のアプリで使用中か確認してください。';
  return 'カメラの開始に失敗しました。通常操作へ戻るか、もう一度開始してください。';
};

export class MotionCamera {
  metrics = new MotionMetrics();
  phase: 'off' | 'permission' | 'video' | 'model' | 'live' | 'error' = 'off';
  devices: MotionCameraDevice[] = [];
  activeDeviceId = '';
  deviceLabel = '';
  debugFrame: MotionDebugFrame | null = null;
  private generation = 0;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private busy = false;
  private pending: { frameId: number; at: number } | null = null;
  private frameId = 0;
  private lastVideoTime = -1;
  private lastCapture = -Infinity;
  private videoCallback = 0;
  private animationCallback = 0;
  private watchdog = 0;
  private permissionTimer = 0;
  private initializeTimer = 0;
  private lastVideoFrameAt = 0;
  private observedVideoTime = -1;
  private lastReceivedAt = 0;
  private lastResultAt = 0;
  private lastReceivedFrame = -1;
  private lossBaseline = 0;
  private lastAppliedFrame = -1;
  private removers: (() => void)[] = [];
  options: CameraOptions = { delegate: 'CPU', hz: 15 };
  constructor(
    readonly input: MotionInputAdapter,
    readonly video: HTMLVideoElement,
    private changed: () => void,
    private safetyStop: () => void,
    private applyInput: () => void = () => {},
  ) {}

  async start(options: CameraOptions = this.options) {
    this.stop();
    this.options = options;
    this.input.start();
    this.phase = 'permission';
    this.metrics = new MotionMetrics();
    this.lastResultAt = 0;
    this.lossBaseline = this.input.trackingLosses;
    const generation = ++this.generation,
      start = performance.now();
    this.changed();
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.fail('カメラには HTTPS またはこのPCの localhost が必要です。通常操作は利用できます。');
      return;
    }
    this.permissionTimer = window.setTimeout(() => {
      if (generation === this.generation) {
        this.input.reason =
          'カメラの許可を待っています。許可するか「通常操作に戻す」を押してください。';
        this.changed();
      }
    }, 10000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          ...(options.deviceId
            ? { deviceId: { exact: options.deviceId } }
            : { facingMode: 'user' }),
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      clearTimeout(this.permissionTimer);
      this.stream = stream;
      const videoTrack = stream.getVideoTracks()[0];
      this.activeDeviceId = videoTrack?.getSettings().deviceId || '';
      this.deviceLabel = videoTrack?.label || 'カメラ';
      void this.refreshDevices(generation);
      for (const track of stream.getTracks()) {
        const ended = () => this.fail('カメラが切断されました。接続を確認してください。');
        const mute = () => {
          this.input.pause('カメラ映像が一時停止しました。映像が戻ると自動再開します。');
          this.safetyStop();
          this.changed();
        };
        track.addEventListener('ended', ended);
        track.addEventListener('mute', mute);
        this.removers.push(() => {
          track.removeEventListener('ended', ended);
          track.removeEventListener('mute', mute);
        });
      }
      this.phase = 'video';
      this.input.reason = 'カメラ映像の再生を準備しています…';
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      this.changed();
      this.initializeTimer = window.setTimeout(() => {
        if (generation === this.generation)
          this.fail('映像または認識モデルの準備が時間切れになりました。');
      }, 30000);
      await this.video.play();
      if (generation !== this.generation) return;
      this.metrics.startupMs = performance.now() - start;
      this.lastVideoFrameAt = performance.now();
      this.observedVideoTime = -1;
      this.lastCapture = -Infinity;
      this.watchdog = window.setInterval(() => {
        const now = performance.now();
        const previous = this.input.state;
        this.input.read(now);
        this.metrics.trackingLosses = this.input.trackingLosses - this.lossBaseline;
        if (this.input.state !== previous) {
          this.safetyStop();
          this.changed();
        }
        // A background tab can suspend video callbacks and the recognition Worker.
        // Input has already been paused; give playback a fresh grace period on return.
        if (document.hidden) {
          this.lastVideoFrameAt = now;
          if (this.pending) this.pending.at = now;
          return;
        }
        // Observe playback independently of model startup and inference throttling.
        // A folded/scrolled preview may not submit frames to the compositor, so
        // requestVideoFrameCallback alone is not a reliable camera heartbeat.
        if (this.video.readyState >= 2 && this.video.currentTime !== this.observedVideoTime) {
          this.observedVideoTime = this.video.currentTime;
          this.lastVideoFrameAt = now;
        }
        if (this.pending && now - this.pending.at > 5000)
          this.fail(
            this.options.delegate === 'GPU'
              ? 'GPUの認識が応答しません。認識設定をCPUにして開始してください。'
              : '認識処理が応答しません。通常操作へ戻って、もう一度開始してください。',
          );
        else if (now - this.lastVideoFrameAt > 10000)
          this.fail('カメラ映像を受け取れません。カメラの接続を確認してください。');
        else void this.capture(generation);
      }, 40);
      if (options.delegate === 'preview') {
        clearTimeout(this.initializeTimer);
        this.ready = true;
        this.phase = 'live';
        this.input.pause(
          '映像だけの確認中です。操作するには通常操作へ戻り、認識を選んで開始してください。',
        );
      } else {
        this.phase = 'model';
        this.input.reason = '手の認識を準備しています…';
        this.changed();
        const worker = new Worker(new URL('./motion-worker.js', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;
        worker.onerror = () => {
          if (generation === this.generation)
            this.fail('認識 Worker の起動に失敗しました。通常操作は利用できます。');
        };
        worker.onmessageerror = () => {
          if (generation === this.generation) this.fail('認識 Worker の通信に失敗しました。');
        };
        worker.onmessage = ({ data }) => {
          if (generation !== this.generation || data.bootId !== generation) return;
          if (data.type === 'ready') {
            clearTimeout(this.initializeTimer);
            this.ready = true;
            this.phase = 'live';
            this.metrics.modelLoadMs = data.modelLoadMs;
            this.metrics.startupMs = performance.now() - start;
            // Permission/model completion must not undo a menu, blur or disconnect pause.
            if (this.input.state === 'STARTING') this.input.calibrate();
            this.changed();
            return;
          }
          if (data.type === 'error') {
            const reason =
              data.stage === 'model'
                ? '認識モデルを読み込めません。配布ファイルを確認してください。'
                : data.stage === 'wasm'
                  ? '認識用 WASM を初期化できません。GPU選択時はCPUで試してください。'
                  : '認識処理が停止しました。もう一度開始してください。';
            this.fail(reason);
            return;
          }
          if (data.type !== 'result' || data.frameId !== this.pending?.frameId) return;
          this.busy = false;
          this.pending = null;
          const now = performance.now();
          const previous = this.input.state;
          this.metrics.frames++;
          this.metrics.startedAt ||= now;
          this.metrics.record('inferenceMs', data.inferenceMs);
          this.metrics.record('captureToResultMs', now - data.sampledAtMainMs);
          if (this.lastResultAt) this.metrics.record('resultIntervalMs', now - this.lastResultAt);
          this.lastResultAt = now;
          // Debugging must also show why a result was unusable for controls.
          // Keep it separate from acceptance/calibration and discard old sessions.
          if (
            data.sessionId === this.input.sessionId &&
            Number.isFinite(data.sampledAtMainMs) &&
            data.sampledAtMainMs <= now &&
            Number.isFinite(data.width) &&
            data.width > 0 &&
            Number.isFinite(data.height) &&
            data.height > 0
          ) {
            this.debugFrame = {
              frameId: data.frameId,
              sampledAtMainMs: data.sampledAtMainMs,
              receivedAtMainMs: now,
              width: data.width,
              height: data.height,
              landmarks: debugLandmarks(data.hands),
            };
          }
          if (
            data.sessionId !== this.input.sessionId ||
            !this.input.accept(data as MotionFrame, now)
          ) {
            this.metrics.dropped++;
            this.changed();
            void this.capture(generation);
            return;
          }
          const normalized = normalizeHands(data);
          if (normalized?.left && normalized.right) this.metrics.valid++;
          this.lastReceivedAt = now;
          this.lastReceivedFrame = data.frameId;
          if (this.input.state !== 'ACTIVE' && previous === 'ACTIVE') {
            this.metrics.trackingLosses = this.input.trackingLosses - this.lossBaseline;
            this.safetyStop();
          }
          // Render callbacks can be throttled independently of live video/inference.
          // Deliver a fresh gesture now; do not let it expire waiting for a draw.
          if (this.input.state === 'ACTIVE') this.applyInput();
          this.changed();
          // A slow inference should start the freshest available frame as soon
          // as it finishes; never wait behind an extra video/timer callback.
          void this.capture(generation);
        };
        worker.postMessage({ type: 'init', bootId: generation, delegate: options.delegate });
      }
      this.changed();
      this.schedule(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(errorMessage(error));
    }
  }
  private async refreshDevices(generation: number) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (generation !== this.generation) return;
      this.devices = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `カメラ ${index + 1}`,
        }));
      this.changed();
    } catch {
      // Device discovery is optional; keep an already granted stream playing.
    }
  }
  get previewLive() {
    return !!this.stream && this.video.readyState >= 2 && !this.video.paused;
  }
  private schedule(generation: number) {
    if (generation !== this.generation) return;
    const next = () => {
      this.schedule(generation);
      void this.capture(generation);
    };
    if (typeof this.video.requestVideoFrameCallback === 'function')
      this.videoCallback = this.video.requestVideoFrameCallback(next);
    else this.animationCallback = requestAnimationFrame(next);
  }
  private async capture(generation: number) {
    if (
      generation !== this.generation ||
      document.hidden ||
      !this.ready ||
      this.video.readyState < 2 ||
      this.video.currentTime === this.lastVideoTime
    )
      return;
    const at = performance.now();
    if (at - this.lastCapture < 1000 / this.options.hz) return;
    if (this.busy) {
      this.metrics.dropped++;
      return;
    }
    this.lastVideoTime = this.video.currentTime;
    this.lastCapture = at;
    if (this.options.delegate === 'preview') return;
    this.busy = true; // Before createImageBitmap: there is never a second frame in flight.
    const frameId = ++this.frameId,
      sessionId = this.input.sessionId;
    this.pending = { frameId, at };
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(this.video);
      if (generation !== this.generation) {
        bitmap.close();
        return;
      }
      if (sessionId !== this.input.sessionId) {
        bitmap.close();
        this.busy = false;
        this.pending = null;
        return;
      }
      this.metrics.record('captureMs', performance.now() - at);
      this.worker!.postMessage(
        { type: 'frame', bootId: generation, sessionId, frameId, sampledAtMainMs: at, bitmap },
        [bitmap],
      );
      bitmap = null; // Transferred; the Worker owns and closes it in a finally block.
    } catch {
      bitmap?.close();
      if (generation === this.generation)
        this.fail('カメラのフレームを取得できません。もう一度開始してください。');
    }
  }
  applied(now: number) {
    if (
      this.input.state === 'ACTIVE' &&
      this.lastReceivedFrame !== this.lastAppliedFrame &&
      this.lastReceivedAt
    ) {
      this.lastAppliedFrame = this.lastReceivedFrame;
      this.metrics.record('resultToApplyMs', now - this.lastReceivedAt);
    }
  }
  resetMetrics() {
    const previous = this.metrics;
    this.metrics = new MotionMetrics();
    this.metrics.startedAt = performance.now();
    this.lossBaseline = this.input.trackingLosses;
    this.metrics.startupMs = previous.startupMs;
    this.metrics.modelLoadMs = previous.modelLoadMs;
  }
  fail(reason: string) {
    this.stop();
    this.phase = 'error';
    this.input.fail(reason);
    this.changed();
  }
  stop() {
    this.generation++;
    this.phase = 'off';
    this.debugFrame = null;
    this.activeDeviceId = '';
    this.deviceLabel = '';
    this.ready = false;
    this.busy = false;
    this.pending = null;
    clearTimeout(this.permissionTimer);
    clearTimeout(this.initializeTimer);
    clearInterval(this.watchdog);
    if (this.videoCallback) this.video.cancelVideoFrameCallback(this.videoCallback);
    cancelAnimationFrame(this.animationCallback);
    this.videoCallback = 0;
    this.animationCallback = 0;
    this.removers.splice(0).forEach((remove) => remove());
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.lastVideoTime = -1;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onerror = null;
      worker.onmessageerror = null;
      const timeout = window.setTimeout(() => worker.terminate(), 250);
      worker.onmessage = ({ data }) => {
        if (data.type === 'closed') {
          clearTimeout(timeout);
          worker.terminate();
        }
      };
      worker.postMessage({ type: 'close' });
    }
    this.input.stop();
    this.safetyStop();
    this.changed();
  }
}
