import * as THREE from 'three';

type Sweep = (origin: THREE.Vector3, direction: THREE.Vector3, distance: number) => number;

/** A closeup must not shorten its orbit into the subject when the low focus is already
 * within the camera's collision radius of the ground. Raise the eye along the requested
 * bearing until the whole path is clear. The look target stays on the companion. */
export function placeCompanionCamera(
  aim: THREE.Vector3,
  desired: THREE.Vector3,
  minimumDistance: number,
  floor: (x: number, z: number) => number,
  sweep: Sweep,
  previous: THREE.Vector3,
  out: THREE.Vector3,
) {
  const candidate = desired.clone();
  // A small companion's centre can lie below a detailed floor triangle between
  // the terrain atlas samples. Sweep from a ground-cleared anchor so emerging
  // above that floor is not mistaken for entering it; keep looking at the body.
  const origin = aim.clone();
  origin.y = Math.max(origin.y, floor(origin.x, origin.z));
  const direction = new THREE.Vector3();
  const ground = floor(candidate.x, candidate.z);
  const clear = (point: THREE.Vector3, floorY = ground) => {
    if (point.distanceTo(aim) < minimumDistance - 1e-6 || point.y < floorY - 1e-6) return false;
    direction.subVectors(point, origin);
    const distance = direction.length();
    if (distance < 1e-6) return false;
    return sweep(origin, direction.divideScalar(distance), distance) >= distance - 1e-5;
  };
  const horizontal = Math.hypot(candidate.x - aim.x, candidate.z - aim.z);
  const low = Math.max(candidate.y, ground);
  // The same upper angle as manual orbiting: never turn a ground correction into a
  // vertical look down through the companion's head.
  const high = aim.y + horizontal * Math.tan(1.05);
  candidate.y = low;
  if (low <= high + 1e-6 && clear(candidate)) {
    out.copy(candidate);
    return true;
  }
  // Check intermediate heights too: a ceiling may block the highest option.
  let blocked = low;
  for (let step = 1; low < high && step <= 8; step++) {
    let open = low + ((high - low) * step) / 8;
    candidate.y = open;
    if (!clear(candidate)) {
      blocked = open;
      continue;
    }
    for (let i = 0; i < 7; i++) {
      const middle = (blocked + open) / 2;
      candidate.y = middle;
      if (clear(candidate)) open = middle;
      else blocked = middle;
    }
    candidate.y = open;
    out.copy(candidate);
    return true;
  }
  // A wall can prevent this bearing altogether. Keep the last clear view instead of
  // crossing the wall or pushing the eye into the body. If the target moved and even
  // that view is obstructed, the caller can return to the exploration camera.
  const previousHorizontal = Math.hypot(previous.x - aim.x, previous.z - aim.z);
  if (
    previousHorizontal > 1e-6 &&
    Math.abs(Math.atan2(previous.y - aim.y, previousHorizontal)) <= 1.05 + 1e-6 &&
    clear(previous, floor(previous.x, previous.z))
  ) {
    out.copy(previous);
    return true;
  }
  return false;
}
