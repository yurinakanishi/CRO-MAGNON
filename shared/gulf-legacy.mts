// Immutable coordinates of the first gulf. Used only for migration and for
// retaining the original continental scenery generator's random sequence.
export const LEGACY_GULF = { minX: -2110, maxX: -1370, minZ: 460, maxZ: 1130 };
export const inLegacyGulf = (x: number, z: number) =>
  x >= LEGACY_GULF.minX && x <= LEGACY_GULF.maxX && z >= LEGACY_GULF.minZ && z <= LEGACY_GULF.maxZ;
const spine = [
  [-1980, 1010],
  [-1990, 810],
  [-1930, 650],
  [-1770, 600],
  [-1620, 660],
  [-1490, 810],
  [-1480, 1000],
];
export function legacyGulfDistance(x: number, z: number) {
  let d = -Infinity;
  for (let i = 1; i < spine.length; i++) {
    const [ax, az] = spine[i - 1],
      [bx, bz] = spine[i],
      dx = bx - ax,
      dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    d = Math.max(d, 88 - Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}
export const LEGACY_SETTLEMENTS = [
  { id: 'many-hearths', x: -1770, z: 650 },
  { id: 'long-valley', x: -1900, z: 600 },
  { id: 'pale-ridge', x: -1990, z: 840 },
  { id: 'reed-shore', x: -1500, z: 850 },
];
export const LEGACY_RESOURCE_POINTS = [
  ...LEGACY_SETTLEMENTS.flatMap((s) => [
    ...Array.from({ length: 4 }, (_, i) => ({ x: s.x - 28 + i * 4, z: s.z + 23 })),
    ...Array.from({ length: 2 }, (_, i) => ({ x: s.x + 25 + i * 4, z: s.z + 17 })),
    ...Array.from({ length: 3 }, (_, i) => ({ x: s.x - 27 + i * 4, z: s.z - 20 })),
  ]),
  ...Array.from({ length: 8 }, (_, i) => ({
    x: -2020 + (i % 4) * 5,
    z: 765 + Math.floor(i / 4) * 6,
  })),
];
