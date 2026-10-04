export interface CompanionViewCandidate {
  id: string;
  label: string;
  x: number;
  z: number;
  screenX: number;
  screenY: number;
  screenZ: number;
  clear: boolean;
}

/** Only offer nearby companions that can actually be seen from this camera. */
export function chooseCompanionView<T extends CompanionViewCandidate>(
  candidates: readonly T[],
  player: { x: number; z: number },
): T | undefined {
  return candidates
    .filter(
      (c) =>
        c.clear &&
        Math.hypot(c.x - player.x, c.z - player.z) <= 8 &&
        c.screenZ > -1 &&
        c.screenZ < 1 &&
        Math.abs(c.screenX) <= 1 &&
        Math.abs(c.screenY) <= 1,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - player.x, a.z - player.z) +
        Math.hypot(a.screenX, a.screenY) * 2 -
        Math.hypot(b.x - player.x, b.z - player.z) -
        Math.hypot(b.screenX, b.screenY) * 2,
    )[0];
}

/** Frame the unchanged body on both portrait and landscape screens. */
export function companionViewDistances(radius: number, fovDegrees: number, aspect: number) {
  const safeRadius = Number.isFinite(radius) ? Math.max(0.1, radius) : 0.3;
  const vertical = (Math.max(10, Math.min(120, fovDegrees || 57)) * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.2, aspect || 1));
  const fit = (safeRadius / Math.sin(Math.min(vertical, horizontal))) * 1.15;
  return { near: Math.max(0.35, safeRadius * 1.35, fit * 0.65), fit, far: fit * 3 };
}
