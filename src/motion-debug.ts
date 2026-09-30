import { MOTION } from './motion-input.js';
import { HAND_POINTS, inFrame, type Point, type HandPair } from './motion-hands.js';
export { HAND_CONNECTIONS } from './motion-hands.js';
const names = [
  '手首',
  '親指の根元',
  '親指第2関節',
  '親指第1関節',
  '親指先',
  '人差し指の根元',
  '人差し指第2関節',
  '人差し指第1関節',
  '人差し指先',
  '中指の根元',
  '中指第2関節',
  '中指第1関節',
  '中指先',
  '薬指の根元',
  '薬指第2関節',
  '薬指第1関節',
  '薬指先',
  '小指の根元',
  '小指第2関節',
  '小指第1関節',
  '小指先',
];
export const DEBUG_NAMES = ['左', '右'].flatMap((side) => names.map((name) => side + name));
export const INPUT_DEBUG_INDICES = [0, 21] as const;
export const HAND_DEBUG_INDICES = Array.from({ length: 42 }, (_, i) => i);
export type DebugQuality = 'tracked' | 'missing';
export interface MotionDebugFrame {
  frameId: number;
  sampledAtMainMs: number;
  receivedAtMainMs: number;
  width: number;
  height: number;
  landmarks: (Point | null)[] | null;
}
/** Only the latest 2D hand landmarks, never body, model z or world coordinates. */
export function debugLandmarks(hands: HandPair | null | undefined): (Point | null)[] | null {
  if (!hands?.left && !hands?.right) return null;
  return (['left', 'right'] as const).flatMap((side) =>
    Array.from({ length: HAND_POINTS }, (_, i) => {
      const p = hands[side]?.landmarks[i];
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    }),
  );
}
export function debugQuality(p: Point | null | undefined): DebugQuality {
  return inFrame(p) ? 'tracked' : 'missing';
}
export function debugPointStatus(p: Point | null | undefined, fresh: boolean) {
  if (!fresh) return '更新待ち';
  if (!p) return '未検出';
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return '座標不正';
  return inFrame(p) ? 'OK' : '枠外';
}
export function projectDebugPoint(p: Point, width: number, height: number) {
  return { x: (1 - p.x) * width, y: p.y * height };
}
export function describeMotionDebug(frame: MotionDebugFrame | null, now: number) {
  const ageMs = frame ? Math.max(0, now - frame.sampledAtMainMs) : null;
  const fresh =
    !!frame &&
    Number.isFinite(ageMs) &&
    Number.isFinite(frame.sampledAtMainMs) &&
    frame.sampledAtMainMs <= now &&
    ageMs! < MOTION.staleMs;
  const points = DEBUG_NAMES.map((label, index) => {
    const point = fresh ? frame?.landmarks?.[index] : null;
    return {
      label,
      index,
      point,
      quality: debugQuality(point),
      status: debugPointStatus(point, fresh),
    };
  });
  const missingInput = INPUT_DEBUG_INDICES.filter(
    (index) => points[index].quality !== 'tracked',
  ).map((index) => (index === 0 ? '左手' : '右手'));
  return { fresh, ageMs, detected: fresh && !!frame?.landmarks, points, missingInput };
}
