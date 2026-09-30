import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { extractHands } from './motion-hands.js';

// A module Worker has no page import map. Both JS and module WASM are local and versioned.
const scope = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown) => void;
  close: () => void;
};
let model: HandLandmarker | null = null;
let bootId = 0;
let closing = false;
let lastTimestamp = -Infinity;
const modelHash = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
scope.onmessage = async ({ data }) => {
  if (data.type === 'close') {
    closing = true;
    model?.close();
    model = null;
    scope.postMessage({ type: 'closed', bootId });
    scope.close();
    return;
  }
  if (data.type === 'init') {
    if (bootId) return;
    bootId = data.bootId;
    let stage = 'model';
    const start = performance.now();
    try {
      const response = await fetch(
        new URL('../motion/hand_landmarker-float16-v1.task', import.meta.url),
      );
      if (!response.ok) throw new Error('model-fetch');
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (hash !== modelHash) throw new Error('model-integrity');
      stage = 'wasm';
      const vision: typeof import('@mediapipe/tasks-vision') = await import(
        new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href
      );
      const files = await vision.FilesetResolver.forVisionTasks(
        new URL('../vendor/mediapipe/wasm', import.meta.url).href,
        true,
      );
      const next = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetBuffer: new Uint8Array(bytes),
          delegate: data.delegate === 'GPU' ? 'GPU' : 'CPU',
        },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (closing) {
        next.close();
        return;
      }
      model = next;
      scope.postMessage({ type: 'ready', bootId, modelLoadMs: performance.now() - start });
    } catch {
      scope.postMessage({ type: 'error', bootId, stage });
    }
    return;
  }
  if (data.type !== 'frame') return;
  const bitmap: ImageBitmap = data.bitmap;
  try {
    if (closing || !model || data.bootId !== bootId || data.sampledAtMainMs <= lastTimestamp)
      return;
    lastTimestamp = data.sampledAtMainMs;
    const start = performance.now();
    const result = model.detectForVideo(bitmap, data.sampledAtMainMs);
    scope.postMessage({
      type: 'result',
      bootId,
      sessionId: data.sessionId,
      frameId: data.frameId,
      sampledAtMainMs: data.sampledAtMainMs,
      width: bitmap.width,
      height: bitmap.height,
      hands: extractHands(result),
      inferenceMs: performance.now() - start,
    });
  } catch {
    scope.postMessage({ type: 'error', bootId, stage: 'inference' });
  } finally {
    bitmap.close();
  }
};
