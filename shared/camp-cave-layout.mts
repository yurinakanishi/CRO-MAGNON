import { riverX, riverHalfWidth, riverBankDrop } from './river-profile.mjs';
// The outdoor camp stays at (50,50). Shared by rendering and terrain physics.
export const CAMP_CAVE = Object.freeze({
  id: 'camp-cave',
  key: 'camp-cave',
  name: 'アプデの洞窟',
  x: 52,
  z: 94,
  yaw: Math.PI,
  scale: 1,
  clearance: 50,
  elevation: 0,
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
  clearance: 320,
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
  { x: 42, z: 70 },
  { x: 34, z: 73 },
  { x: 16, z: 84 },
  { x: 18, z: 85 },
  { x: 19, z: 86 },
  { x: 21, z: 87 },
  { x: -8, z: 88 },
  { x: -29, z: 88 },
  { x: -68, z: 96 },
  { x: -68, z: 122 },
  { x: -68, z: 123 },
]);
// A separate level approach reaches the mountain foot without climbing the
// castle trail. The original cave mouth is local Z=9.4; the apron begins at 18.
export const CAVE_APPROACH = Object.freeze([
  { x: 48, z: 60 },
  { x: 52, z: 66 },
  { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 24 },
  { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 18 },
  { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 12 },
]);
export const CAVE_FOOT = Object.freeze({
  minX: CAMP_CAVE.x - 15,
  maxX: CAMP_CAVE.x + 15,
  minZ: CAMP_CAVE.z - 29,
  maxZ: CAMP_CAVE.z - 1,
});
export const CAVE_HILL = Object.freeze({ minX: -16, maxX: 145, minZ: 58, maxZ: 200 });
function smooth(v: number) {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}
// Broaden the source mountain's eastern skirt to cover the complete cave.
// The inverse is shared by measured terrain; both visual LODs retain their UVs.
function caveHillWidth(z: number) {
  return 1 + 1.6 * smooth((z - 58) / 22) * (1 - smooth((z - 140) / 60));
}
export function expandedCaveHillX(x: number, z: number) {
  return x <= 0 ? x : x * caveHillWidth(z);
}
export function sourceCaveHillX(x: number, z: number) {
  return x <= 0 ? x : x / caveHillWidth(z);
}
// Extend the main mountain's eastern slope, filling its former saddle. Height
// increases toward the original massif, rather than peaking above the cave.
export function caveFootHeight(x: number, z: number, height: number) {
  if (z < CAVE_HILL.minZ || z > CAVE_HILL.maxZ) return height;
  const shoulder = 1 - smooth((x - 28) / 82);
  const foothill = 38 * shoulder * smooth((z - 59) / 77) * (1 - smooth((z - 138) / 62));
  const delta = Math.max(0, foothill - height);
  const joined = height + delta * smooth(delta / 2);
  // A wide, shallow approach reaches the original ground-level mouth.
  const approach =
    (1 - smooth((Math.abs(x - CAMP_CAVE.x) - 4.2) / 14)) * (1 - smooth((z - 75) / 9));
  const bankWidth = 20 + 12 * smooth((z - 94) / 28);
  const bank = smooth((riverX(z) - riverHalfWidth(z) - x) / bankWidth);
  return joined * (1 - approach) * bank - riverBankDrop(x, z);
}
export function campTrailDistance(x: number, z: number) {
  let distance = Infinity;
  for (const trail of [CAMP_MOUNTAIN_TRAIL, CAVE_APPROACH])
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1],
        b = trail[i],
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
