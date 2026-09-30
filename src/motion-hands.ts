export type Hand = 'left' | 'right';
export interface Point {
  x: number;
  y: number;
  /** Wrist-relative depth in image-width units, never absolute camera distance. */
  z?: number;
}
export interface DetectedHand {
  landmarks: Point[];
  /** Left/right classification score, NOT landmark visibility or detection accuracy. */
  handednessScore: number;
}
export type HandPair = Record<Hand, DetectedHand | null>;
export type FingerState = 'extended' | 'folded' | 'unknown';
export type HandPose = 'camera' | 'gun' | 'stroke' | 'other' | 'unknown';
/** Thumb, index, middle, ring, little finger. */
export type Fingers = [FingerState, FingerState, FingerState, FingerState, FingerState];
export interface HandSample extends Point {
  palmWidth: number;
  palmLength: number;
  fingerLength: number | null;
  waveX: number;
  open: boolean;
  roll: number;
  yaw: number | null;
  fingers: Fingers;
  pose: HandPose;
  /** Absolute vertical component of the palm normal; 1 is a horizontal palm. */
  horizontal: number | null;
}
export const HAND_POINTS = 21;
export const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export function inFrame(p: Point | undefined | null): p is Point {
  return (
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x > 0.01 &&
    p.x < 0.99 &&
    p.y > 0.01 &&
    p.y < 0.99
  );
}

/** Tasks HandLandmarker labels raw camera input directly; mirror only UI coordinates.
 * Its label map is Right/Left, unlike the legacy Solutions Hands Left/Right map. */
export function extractHands(result: {
  landmarks: readonly (readonly Point[])[];
  handedness: readonly (readonly { categoryName: string; score: number }[])[];
}): HandPair {
  const hands: HandPair = { left: null, right: null };
  const seen = new Set<Hand>();
  for (let i = 0; i < result.landmarks.length; i++) {
    const category = result.handedness[i]?.[0];
    if (!category || !Number.isFinite(category.score) || category.score < 0.55) continue;
    const side =
      category.categoryName === 'Left'
        ? 'left'
        : category.categoryName === 'Right'
          ? 'right'
          : null;
    const points = result.landmarks[i];
    if (!side || points.length !== HAND_POINTS) continue;
    // Ambiguous duplicate labels must not combine two people's hands or swap controls.
    if (seen.has(side)) {
      hands[side] = null;
      continue;
    }
    seen.add(side);
    hands[side] = {
      handednessScore: category.score,
      landmarks: points.map((p) => ({
        x: p.x,
        y: p.y,
        ...(Number.isFinite(p.z) ? { z: p.z } : {}),
      })),
    };
  }
  return hands;
}

/** Relative depth corrects foreshortening and supplies palm orientation.
 * Push still measures apparent hand scale, not absolute depth or world coordinates. */
export function measureHand(
  hand: DetectedHand | null | undefined,
  width: number,
  height: number,
): HandSample | null {
  if (
    !hand ||
    hand.landmarks.length !== HAND_POINTS ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(hand.handednessScore) ||
    hand.handednessScore < 0.55
  )
    return null;
  const p = hand.landmarks;
  if (![0, 5, 9, 13, 17].every((i) => inFrame(p[i]))) return null;
  const depth = p.every((point) => Number.isFinite(point.z));
  const vector = (a: number, b: number) => ({
    x: p[b].x - p[a].x,
    y: ((p[b].y - p[a].y) * height) / width,
    z: depth ? p[b].z! - p[a].z! : 0,
  });
  const distance = (a: number, b: number) => Math.hypot(...Object.values(vector(a, b)));
  const palmWidth = distance(5, 17),
    palmLength = distance(0, 9);
  if (palmWidth < 0.018 || palmLength < 0.025 || palmWidth > 0.55 || palmLength > 0.65) return null;
  const full = [6, 8, 10, 12, 14, 16, 18, 20].every((i) => inFrame(p[i]));
  const extended = full
    ? [5, 9, 13, 17].filter(
        (i) =>
          distance(0, i + 3) > distance(0, i) * 1.45 &&
          distance(0, i + 3) > distance(0, i + 1) * 1.05,
      ).length
    : 0;
  const aspect = palmWidth / palmLength;
  const up = vector(0, 9),
    across = vector(5, 17);
  const normal = {
    x: across.y * up.z - across.z * up.y,
    y: across.z * up.x - across.x * up.z,
    z: across.x * up.y - across.y * up.x,
  };
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  const horizontal = depth && normalLength > 0.00001 ? Math.abs(normal.y) / normalLength : null;
  const straightness = (a: number, b: number, c: number) => {
    const u = vector(a, b),
      v = vector(b, c);
    const size = distance(a, b) * distance(b, c);
    return size > 0.000001 ? (u.x * v.x + u.y * v.y + u.z * v.z) / size : -1;
  };
  // Joint bends and radial reach are invariant to image position, scale and palm rotation.
  // A clipped/uncertain finger stays unknown; it never counts as deliberately folded.
  const fingers: Fingers = [0, 5, 9, 13, 17].map((base): FingerState => {
    const joints = base === 0 ? [1, 2, 3, 4] : [base, base + 1, base + 2, base + 3];
    if (!depth || !joints.every((i) => inFrame(p[i]))) return 'unknown';
    if (base === 0) {
      const bend = straightness(2, 3, 4),
        reach = distance(0, 4) / distance(0, 2);
      if (bend > 0.5 && reach > 1.2 && distance(4, 5) > palmLength * 0.35) return 'extended';
      return bend < 0.25 || reach < 1.05 ? 'folded' : 'unknown';
    }
    const bend = straightness(base, base + 1, base + 2);
    const reach = distance(0, base + 3) / distance(0, base);
    if (bend > 0.45 && straightness(base + 1, base + 2, base + 3) > 0.1 && reach > 1.3)
      return 'extended';
    return bend < 0.25 || reach < 1.15 ? 'folded' : 'unknown';
  }) as Fingers;
  const gun = fingers.every((state, i) => state === (i < 3 ? 'extended' : 'folded'));
  const spread = fingers.slice(1).every((state) => state === 'extended');
  const pose: HandPose = gun
    ? 'gun'
    : spread && horizontal !== null && horizontal >= 0.72
      ? 'stroke'
      : spread &&
          horizontal !== null &&
          horizontal < 0.6 &&
          Math.abs(normal.z) / normalLength > 0.45
        ? 'camera'
        : fingers.every((state) => state !== 'unknown')
          ? 'other'
          : 'unknown';
  // Choose the camera-facing normal for either hand; mirror its horizontal axis.
  const yaw =
    depth && Math.abs(normal.z) > 0.0001
      ? Math.atan2(-normal.x * Math.sign(normal.z), Math.abs(normal.z))
      : null;
  return {
    x: 1 - p[0].x,
    y: (p[0].y * height) / width,
    palmWidth,
    palmLength,
    fingerLength: full ? median([distance(0, 8), distance(0, 12), distance(0, 16)]) : null,
    waveX: 1 - p[9].x,
    // Clipped fingertips do not switch off a completely visible palm.
    open: (!full || extended >= 3) && aspect >= 0.45 && aspect <= 1.8,
    roll: Math.atan2(-up.x, -up.y),
    yaw,
    fingers,
    pose,
    horizontal,
  };
}

export function normalizeHands(frame: { hands: HandPair | null; width: number; height: number }) {
  const left = measureHand(frame.hands?.left, frame.width, frame.height);
  const right = measureHand(frame.hands?.right, frame.width, frame.height);
  return left || right ? { left, right } : null;
}

export function measurePush(hand: HandSample | null, neutral: HandSample) {
  if (!hand) return { push: null, palmRatio: null, fingerRatio: null };
  const ratios = [
    hand.palmWidth / neutral.palmWidth,
    hand.palmLength / neutral.palmLength,
    hand.fingerLength !== null && neutral.fingerLength !== null
      ? hand.fingerLength / neutral.fingerLength
      : null,
  ];
  const palmRatio = Math.min(ratios[0]!, ratios[1]!),
    fingerRatio = ratios[2];
  const measured = ratios.filter((ratio): ratio is number => ratio !== null);
  const min = Math.min(...measured),
    max = Math.max(...measured);
  // Finger extension alone cannot produce a push. Partial tips use the two palm dimensions.
  const valid = hand.open && measured.every(Number.isFinite) && min > 0 && max / min < 1.35;
  return { push: valid ? min - 1 : null, palmRatio, fingerRatio };
}
