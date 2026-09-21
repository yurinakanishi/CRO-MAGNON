// The outdoor camp stays at (50,50). All placements here are additions behind it.
// Kept dependency-free so rendering, coast data, navigation and actions agree.
export const CAMP_CAVE = Object.freeze({
  id: 'camp-cave',
  key: 'camp-cave',
  name: 'はじまりの壁画洞窟',
  x: 35,
  z: 125.15,
  yaw: Math.PI,
  scale: 1,
  clearance: 50,
  elevation: 8,
  groundOffset: -1.05,
});
// r25 retains the original rock mouth and apron, then joins the extended
// chamber before its gallery. The deep half bends west under the mountain;
// these values reproduce that bend in gameplay, wall projection and QA.
export const CAVE_BEND = Object.freeze({ depth: 72.64, offset: 38 });
export function caveCentreOffset(localZ: number) {
  const t = Math.max(0, Math.min(1, -localZ / CAVE_BEND.depth));
  return CAVE_BEND.offset * t * t * (3 - 2 * t);
}
export function caveWorldAt(localZ: number, across = 0) {
  return {
    x: CAMP_CAVE.x - caveCentreOffset(localZ) - across,
    z: CAMP_CAVE.z - localZ,
  };
}
export const CAVE_HEARTH = Object.freeze({
  id: 'cave-hearth',
  ...caveWorldAt(-20, 3),
  radius: 0.55,
});
export const CAVE_MURAL_VIEW = Object.freeze(caveWorldAt(-25));
export const CAMP_MOUNTAIN = Object.freeze({
  id: 'camp-mountain',
  key: 'camp-mountain',
  name: '白羽の丘陵',
  x: -75,
  z: 175,
  yaw: Math.PI,
  scale: 1,
  clearance: 200,
  groundOffset: 0,
  // Preserve full source detail around the outdoor camp, cave and ascent. The
  // castle lies outside this area and uses the 1/10 source-derived LOD.
  detail: Object.freeze({ x: 42, z: 86, radius: 100, hysteresis: 3 }),
});
export function campMountainVisualLod(x: number, z: number, previous = 0) {
  const { detail } = CAMP_MOUNTAIN,
    distance = Math.hypot(x - detail.x, z - detail.z);
  return previous === 0
    ? Number(distance > detail.radius + detail.hysteresis)
    : Number(distance >= detail.radius - detail.hysteresis);
}
export function caveLocal(x: number, z: number) {
  return { x: CAMP_CAVE.x - x, z: CAMP_CAVE.z - z };
}
export const CAMP_MOUNTAIN_TRAIL = Object.freeze([
  { x: 50, z: 62 },
  { x: 49, z: 73 },
  { x: 45, z: 84 },
  { x: 42, z: 95 },
  { x: 35, z: 104 },
  { x: 22, z: 102 },
  { x: 8, z: 97 },
  { x: -10, z: 91 },
  { x: -30, z: 87 },
  { x: -50, z: 90 },
  { x: -68, z: 96 },
  { x: -68, z: 116 },
  { x: -68, z: 123 },
]);
export const CAVE_APPROACH = CAMP_MOUNTAIN_TRAIL.slice(0, 5);
export function campTrailDistance(x: number, z: number) {
  let distance = Infinity;
  for (let i = 1; i < CAMP_MOUNTAIN_TRAIL.length; i++) {
    const a = CAMP_MOUNTAIN_TRAIL[i - 1],
      b = CAMP_MOUNTAIN_TRAIL[i],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return distance;
}
export function insideCaveGround(x: number, z: number) {
  const p = caveLocal(x, z);
  return p.z > -42 && p.z < 18.5 && Math.abs(p.x - caveCentreOffset(p.z)) < 7.5;
}
export function campLandformReserved(x: number, z: number, margin = 0) {
  const p = caveLocal(x, z),
    aroundCave =
      p.z > -58 - margin &&
      p.z < 21 + margin &&
      Math.abs(p.x - caveCentreOffset(p.z)) < 11 + margin;
  return aroundCave || campTrailDistance(x, z) < 5.5 + margin;
}
