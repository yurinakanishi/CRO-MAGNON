import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionCamera } from '../dist/src/motion-camera.js';
import { syntheticHands } from './helpers/motion-hands.mjs';
import { MotionInputAdapter } from '../dist/src/motion-input.js';

// Exercise camera/Worker lifecycle without a browser, real images or permissions.
function rig(t, applyInput = () => {}) {
  let now = 0,
    nextId = 0;
  const timers = new Map(),
    callbacks = new Map(),
    tracks = [],
    requests = [],
    workers = [];
  const restorers = [];
  const replace = (key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restorers.push(() =>
      descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key],
    );
  };
  const timer = (fn, delay, repeat = false) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + delay, delay, repeat });
    return id;
  };
  const cancel = (id) => timers.delete(id);
  const document = { hidden: false };
  const video = {
    srcObject: null,
    readyState: 0,
    paused: true,
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    async play() {
      this.paused = false;
      this.readyState = 2;
    },
    pause() {
      this.paused = true;
    },
    requestVideoFrameCallback(fn) {
      const id = ++nextId;
      callbacks.set(id, fn);
      return id;
    },
    cancelVideoFrameCallback(id) {
      callbacks.delete(id);
    },
  };
  const stream = (deviceId) => {
    const track = Object.assign(new EventTarget(), {
      label: `Camera ${deviceId}`,
      stopped: false,
      getSettings: () => ({ deviceId }),
      stop() {
        this.stopped = true;
      },
    });
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const mediaDevices = {
    async getUserMedia(constraints) {
      // Switching must release every old camera before acquiring the next one.
      assert.ok(tracks.every((track) => track.stopped));
      requests.push(constraints);
      return stream(constraints.video.deviceId?.exact || 'A');
    },
    async enumerateDevices() {
      return ['A', 'B'].map((deviceId) => ({
        kind: 'videoinput',
        deviceId,
        label: `Camera ${deviceId}`,
      }));
    },
  };
  class Worker {
    messages = [];
    delay = 0;
    inFlight = 0;
    maxInFlight = 0;
    hands = null;
    constructor() {
      workers.push(this);
    }
    postMessage(data) {
      this.messages.push(data);
      if (data.type === 'init') this.bootId = data.bootId;
      if (data.type === 'frame') {
        this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight);
        const result = () => {
          this.inFlight--;
          this.emit({
            type: 'result',
            bootId: data.bootId,
            sessionId: data.sessionId,
            frameId: data.frameId,
            sampledAtMainMs: data.sampledAtMainMs,
            width: 640,
            height: 480,
            hands: this.hands,
            inferenceMs: this.delay || 1,
          });
        };
        if (this.delay) timer(result, this.delay);
        else queueMicrotask(result);
      }
      if (data.type === 'close') queueMicrotask(() => this.emit({ type: 'closed' }));
    }
    emit(data) {
      this.onmessage?.({ data: { bootId: this.bootId, ...data } });
    }
    terminate() {
      this.terminated = true;
    }
  }
  replace('window', { setTimeout: timer, setInterval: (fn, ms) => timer(fn, ms, true) });
  replace('clearTimeout', cancel);
  replace('clearInterval', cancel);
  replace('cancelAnimationFrame', () => {});
  replace('performance', { now: () => now });
  replace('document', document);
  replace('navigator', { mediaDevices });
  replace('isSecureContext', true);
  replace('Worker', Worker);
  replace('createImageBitmap', async () => ({ close() {} }));
  const input = new MotionInputAdapter();
  const camera = new MotionCamera(
    input,
    video,
    () => {},
    () => {},
    () => applyInput(input, now),
  );
  t.after(() => {
    camera.stop();
    for (const restore of restorers.reverse()) restore();
  });
  return {
    camera,
    input,
    video,
    document,
    tracks,
    requests,
    workers,
    mediaDevices,
    stream,
    async tick(ms, frames = true, compositor = false) {
      const end = now + ms;
      while (now < end) {
        const dt = Math.min(40, end - now);
        now += dt;
        if (frames && !video.paused) video.currentTime += dt / 1000;
        if (frames && compositor) {
          const pending = [...callbacks.values()];
          callbacks.clear();
          for (const fn of pending) fn();
        }
        for (const [id, task] of [...timers]) {
          if (!timers.has(id) || task.at > now) continue;
          if (task.repeat) task.at = now + task.delay;
          else timers.delete(id);
          task.fn();
        }
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

test('live camera survives model startup longer than the video watchdog', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  await r.tick(12000);
  assert.equal(r.camera.phase, 'model');
  assert.equal(r.camera.previewLive, true);
  assert.equal(r.input.state, 'STARTING');
  assert.equal(r.tracks[0].stopped, false);
  r.workers[0].emit({ type: 'ready', modelLoadMs: 12000 });
  assert.equal(r.input.state, 'CALIBRATING');
});

test('a folded preview keeps capturing without compositor frame callbacks', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  r.workers[0].emit({ type: 'ready', modelLoadMs: 1 });
  await r.tick(12000);
  const frames = r.workers[0].messages.filter((message) => message.type === 'frame');
  assert.ok(frames.length > 100);
  assert.ok(frames.length <= 180);
  assert.equal(r.camera.phase, 'live');
  assert.equal(r.tracks[0].stopped, false);
});

test('background video suspension does not release the camera or resume input', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  r.workers[0].emit({ type: 'ready', modelLoadMs: 1 });
  r.input.pause();
  r.document.hidden = true;
  await r.tick(12000, false);
  assert.equal(r.tracks[0].stopped, false);
  r.document.hidden = false;
  await r.tick(100);
  assert.equal(r.camera.phase, 'live');
  assert.equal(r.input.state, 'PAUSED');
});

test('slow inference immediately captures the latest frame without a queued bitmap or extra idle tick', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  const worker = r.workers[0];
  worker.delay = 160;
  worker.emit({ type: 'ready', modelLoadMs: 1 });
  await r.tick(1000);
  const frames = worker.messages.filter((message) => message.type === 'frame');
  assert.ok(frames.length >= 6);
  for (let i = 1; i < frames.length; i++)
    assert.equal(frames[i].sampledAtMainMs - frames[i - 1].sampledAtMainMs, 160);
  assert.equal(worker.maxInFlight, 1);
  assert.equal(r.camera.metrics.latest('resultIntervalMs'), 160);
});

test('an actual foreground video stall still stops and releases the camera', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'preview', hz: 15 });
  await r.tick(100);
  await r.tick(11000, false);
  assert.equal(r.input.state, 'ERROR');
  assert.equal(r.tracks[0].stopped, true);
  assert.equal(r.video.srcObject, null);
});

test('camera selection releases the old track and requests the exact selected device', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'preview', hz: 15 });
  assert.equal(r.camera.devices.length, 2);
  await r.camera.start({ delegate: 'CPU', hz: 15, deviceId: 'B' });
  assert.equal(r.tracks[0].stopped, true);
  assert.deepEqual(r.requests[1].video.deviceId, { exact: 'B' });
  assert.equal(r.requests[1].audio, false);
  assert.equal(r.camera.activeDeviceId, 'B');
  assert.equal(r.camera.deviceLabel, 'Camera B');
  assert.equal(r.input.state, 'STARTING');
});

test('late permission after stop cannot restart the preview', async (t) => {
  const r = rig(t);
  let grant;
  r.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const starting = r.camera.start({ delegate: 'preview', hz: 15 });
  assert.equal(r.camera.phase, 'permission');
  r.camera.stop();
  grant(r.stream('late'));
  await starting;
  assert.equal(r.tracks[0].stopped, true);
  assert.equal(r.camera.phase, 'off');
  assert.equal(r.video.srcObject, null);
});

test('device enumeration failure does not stop an already permitted preview', async (t) => {
  const r = rig(t);
  r.mediaDevices.enumerateDevices = async () => {
    throw new Error('unavailable');
  };
  await r.camera.start({ delegate: 'preview', hz: 15 });
  await r.tick(11000);
  assert.equal(r.camera.phase, 'live');
  assert.equal(r.camera.previewLive, true);
});

test('debug recognition updates during input pause without reactivating controls and clears on stop', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  const worker = r.workers[0];
  worker.hands = syntheticHands();
  worker.emit({ type: 'ready', modelLoadMs: 1 });
  r.input.pause();
  await r.tick(100);
  assert.equal(r.input.state, 'PAUSED');
  assert.equal(r.input.read(100).active, false);
  assert.equal(r.camera.debugFrame.landmarks.length, 42);
  assert.equal(r.camera.debugFrame.width, 640);
  const firstId = r.camera.debugFrame.frameId;
  worker.hands = null;
  await r.tick(100);
  assert.ok(r.camera.debugFrame.frameId > firstId);
  assert.equal(r.camera.debugFrame.landmarks, null);
  r.camera.stop();
  assert.equal(r.camera.debugFrame, null);
});

test('late results from a previous input session cannot repopulate the debug overlay', async (t) => {
  const r = rig(t);
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  const worker = r.workers[0];
  worker.delay = 160;
  worker.hands = syntheticHands();
  worker.emit({ type: 'ready', modelLoadMs: 1 });
  await r.tick(40);
  r.input.pause();
  await r.tick(160);
  assert.equal(r.camera.debugFrame, null);
  await r.tick(160);
  assert.equal(r.input.state, 'PAUSED');
  assert.ok(r.camera.debugFrame);
});

test('fresh actions reach the game without a render callback, before their 230ms expiry', async (t) => {
  const events = [];
  let applied = 0;
  const r = rig(t, (input, now) => {
    applied++;
    events.push(...input.consumeActions(now));
  });
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  const worker = r.workers[0];
  worker.hands = syntheticHands();
  worker.emit({ type: 'ready', modelLoadMs: 1 });
  await r.tick(3800, true, false);
  assert.equal(r.input.state, 'ACTIVE');
  worker.hands = syntheticHands(undefined, { gun: true });
  await r.tick(1600, true, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'attack');
  assert.ok(events[0].emittedAtMainMs - events[0].sampledAtMainMs < 230);
  // The next rendering pass cannot duplicate the action already delivered.
  assert.deepEqual(r.input.consumeActions(performance.now()), []);
  r.input.pause();
  const before = applied;
  worker.hands = syntheticHands();
  await r.tick(500);
  assert.equal(applied, before);
});

test('fresh missing-hand results deliver held edge movement; stalled capture still cancels it', async (t) => {
  const delivered = [];
  const r = rig(t, (input, now) => delivered.push(input.read(now)));
  await r.camera.start({ delegate: 'CPU', hz: 15 });
  const worker = r.workers[0];
  worker.hands = syntheticHands();
  worker.emit({ type: 'ready', modelLoadMs: 1 });
  await r.tick(3800);
  worker.hands = syntheticHands({ push: 0.4 });
  await r.tick(500);
  for (let step = 1; step <= 10; step++) {
    worker.hands = syntheticHands({ push: 0.4, x: (-1.35 * step) / 10 });
    await r.tick(160);
  }
  assert.ok(r.input.forward > 0.5);
  delivered.length = 0;
  worker.hands = null;
  await r.tick(1800);
  assert.equal(r.input.edgeHolding, true);
  assert.ok(delivered.length >= 15);
  assert.ok(delivered.every((i) => i.active && i.forward > 0.5 && i.turn < 0));
  await r.tick(300, false);
  assert.equal(r.input.edgeHolding, false);
  assert.equal(r.input.read(performance.now()).active, false);
});
