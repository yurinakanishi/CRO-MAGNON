import { MASCOT_FAREWELL_MS } from '../shared/companions.mjs';

/** Milliseconds into a dismissed companion's goodbye, or -1 while it travels. Derived from
 * the shared start time, so a late join or a culled body never replays a whole goodbye. */
export function farewellAge(leavingAt: number | undefined, now: number) {
  return leavingAt ? Math.max(0, now - leavingAt) : -1;
}

/** Full size while it waves, then a short shrink out of the world before the server
 * removes the body. */
export function farewellScale(age: number) {
  if (age < 0) return 1;
  const t = Math.min(
    1,
    Math.max(0, (age - MASCOT_FAREWELL_MS * 0.55) / (MASCOT_FAREWELL_MS * 0.4)),
  );
  return 1 - t * t * (3 - 2 * t);
}
