import type { Resource, SceneryPlacement } from './types.mjs';

// Authored fantasy, not an archaeological coast or recovered political geography.
// Independent data: safe for geography, game rules and rendering to import.
export const GULF = Object.freeze({
  id: 'three-shores',
  name: '三つの岸の湾',
  version: 2,
  minX: -2950,
  maxX: -1470,
  minZ: 70,
  maxZ: 1410,
});
export const GULF_SPINE = [
  { x: -2690, z: 1170 },
  { x: -2710, z: 770 },
  { x: -2590, z: 450 },
  { x: -2270, z: 350 },
  { x: -1970, z: 470 },
  { x: -1710, z: 770 },
  { x: -1690, z: 1150 },
];
export function inGulf(x: number, z: number, margin = 0) {
  // The north-east tangent encloses the authored shore while excluding the
  // original continental corner inside the rectangular map extent. Include
  // the shoreline grid's 32 m band of shallow water beyond the 176 m land radius.
  const a = GULF_SPINE[4],
    b = GULF_SPINE[5];
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const innerDistance = (dx * (z - a.z) - dz * (x - a.x)) / Math.hypot(dx, dz);
  return (
    x >= GULF.minX - margin &&
    x <= GULF.maxX + margin &&
    z >= GULF.minZ - margin &&
    z <= GULF.maxZ + margin &&
    innerDistance >= -208 - margin
  );
}
export function gulfLandDistance(x: number, z: number) {
  let distance = -Infinity;
  for (let i = 1; i < GULF_SPINE.length; i++) {
    const a = GULF_SPINE[i - 1],
      b = GULF_SPINE[i];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    // A continuous horseshoe: open sea to the south, walking round the head.
    distance = Math.max(distance, 176 - Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return distance;
}
export const MANY_HEARTHS = Object.freeze({
  id: 'many-hearths',
  name: '多くの炉の集い場',
  x: -2270,
  z: 450,
});
export const COUNTRIES = Object.freeze([
  {
    id: 'long-valley',
    name: '長い谷の国',
    x: -2530,
    z: 350,
    color: '#97b886',
    motto: '種と道を分かち合う',
    environment: '草地と川沿いの林。季節の狩りとベリー畑を行き来する。',
    craft: '木の柄、獣皮、編み紐。緑の結び紐を旅の目印にする。',
    custom: '収穫の初めに、旅人と種を分ける。集い場には食べ物と狩場の便りを持ち寄る。',
  },
  {
    id: 'pale-ridge',
    name: '白い尾根の国',
    x: -2710,
    z: 830,
    color: '#d7b18c',
    motto: 'よい石には、よい手を',
    environment: '石の露頭と風を避ける山裾。採集、畑、小動物の狩りで暮らす。',
    craft: '石刃と骨の道具。淡い石の飾りと黄土色の獣皮を使う。',
    custom: '石を割る技を囲炉裏で教える。黒曜石を湾へ運び、木材や食料と交換する。',
  },
  {
    id: 'reed-shore',
    name: '葦の岸の国',
    x: -1730,
    z: 850,
    color: '#7dc0c3',
    motto: '帰る岸を覚えておく',
    environment: '入り江と海岸林。浜の採集、漁、陸の採集、ベリー畑を組み合わせる。',
    craft: '小舟の修繕、結び紐、貝の飾り。青緑の獣皮を使う。',
    custom: '出発する舟に天気と上陸地を伝える。集い場では道具と航路の知識を交換する。',
  },
]);
export const SETTLEMENTS = [MANY_HEARTHS, ...COUNTRIES];
export const GULF_STOPS = [
  {
    id: 'terrace-rest',
    name: '谷道の休み場',
    countryId: 'long-valley',
    x: -2420,
    z: 330,
    description: '集い場と谷を結ぶ分かれ道。木材を集め、炉で休んでから畑へ向かう。',
  },
  {
    id: 'spring-grove',
    name: '泉の林',
    countryId: 'long-valley',
    x: -2250,
    z: 220,
    description: '湾奥の山裾に残る林。実と水を補給できる寄り道。',
  },
  {
    id: 'quarry-camp',
    name: '石割りの野営地',
    countryId: 'pale-ridge',
    x: -2780,
    z: 735,
    description: '黒曜石の露頭のそばの炉。採れた石を見比べ、帰りの道を確かめる。',
  },
  {
    id: 'west-cove',
    name: '西の舟待ち浜',
    countryId: 'pale-ridge',
    x: -2690,
    z: 1130,
    description: '西岸の先まで続く道の野営地。木材と水を整えて外湾へ出る。',
  },
  {
    id: 'reed-lookout',
    name: '海岸林の見晴らし',
    countryId: 'reed-shore',
    x: -1900,
    z: 600,
    description: '岩の肩を回る道から湾を見渡す。東の国と集い場をつなぐ休み場。',
  },
  {
    id: 'south-cove',
    name: '葦の外湾',
    countryId: 'reed-shore',
    x: -1735,
    z: 1130,
    description: '東岸の南の入り江。採集と舟旅の拠点になり、外湾の対岸を望む。',
  },
];
export const GULF_ENTRY = {
  ...MANY_HEARTHS,
  z: MANY_HEARTHS.z + 5,
  continent: '創作世界 · 三つの岸',
};
export const SPRINGS = [...SETTLEMENTS, ...GULF_STOPS].map((s) => ({
  id: `spring-${s.id}`,
  name: `${s.name}の水場`,
  x: s.x - 16,
  z: s.z - 13,
}));
export const LANDINGS = [
  { id: 'hearth-landing', name: '集い場の浜', x: -2270, z: 538.5 },
  { id: 'ridge-landing', name: '尾根の浜', x: -2531.5, z: 850 },
  { id: 'reed-landing', name: '葦の浜', x: -1880, z: 850 },
  { id: 'west-outer-landing', name: '西の外湾の浜', x: -2516.5, z: 1150 },
  { id: 'east-outer-landing', name: '東の外湾の浜', x: -1864.5, z: 1145 },
];
export const FARM_PLOTS = SETTLEMENTS.flatMap((s) =>
  Array.from({ length: 12 }, (_, i) => ({
    id: `plot-${s.id}-${i + 1}`,
    settlementId: s.id,
    x: s.x + 16 + (i % 4) * 3,
    z: s.z - 10 + Math.floor(i / 4) * 3,
  })),
);
export const GULF_RESOURCES: Resource[] = [...SETTLEMENTS, ...GULF_STOPS].flatMap((s) =>
  [
    ...Array.from({ length: 4 }, (_, i) => ({
      type: 'wood' as const,
      x: s.x - 28 + i * 4,
      z: s.z + 23,
      amount: 12,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      type: 'stone' as const,
      x: s.x + 25 + i * 4,
      z: s.z + 17,
      amount: 10,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      type: 'berry' as const,
      x: s.x - 27 + i * 4,
      z: s.z - 20,
      amount: 8,
    })),
  ].map((r, i) => ({
    ...r,
    id: `gulf-${s.id}-${i}`,
    maxAmount: r.amount,
    appearanceBiome: 'grassland',
  })),
);
export const OBSIDIAN_OUTCROPS: Resource[] = Array.from({ length: 8 }, (_, i) => ({
  id: `gulf-obsidian-${i + 1}`,
  type: 'obsidian',
  x: -2770 + (i % 4) * 5,
  z: 680 + Math.floor(i / 4) * 6,
  amount: 8,
  maxAmount: 8,
  appearanceBiome: 'grassland',
}));
export const GULF_SCENERY: Record<'trees' | 'props' | 'fires', SceneryPlacement[]> = {
  trees: [],
  props: [],
  fires: [],
};
for (const s of [...SETTLEMENTS, ...GULF_STOPS]) {
  const countryId = 'countryId' in s ? s.countryId : s.id;
  const surface =
    countryId === 'pale-ridge' ? 'sand' : countryId === 'reed-shore' ? 'shore' : 'valley';
  const add = (key, dx, dz, scale = 1, yaw = 0) =>
    GULF_SCENERY.props.push({ key, x: s.x + dx, z: s.z + dz, scale, yaw, surface });
  GULF_SCENERY.fires.push({
    id: `gulf-fire-${s.id}`,
    key: 'stone-firepit',
    x: s.x,
    z: s.z,
    scale: 0.7,
    yaw: 0,
    surface,
  });
  const tents = s.id === MANY_HEARTHS.id ? 10 : 'countryId' in s ? 2 : 4;
  for (let i = 0; i < tents; i++) {
    const angle = (i / tents) * Math.PI * 2;
    // Camping ring leaves the centre, farms and spring approaches open.
    add('hide-tent', Math.cos(angle) * 39, Math.sin(angle) * 33, 0.85, -angle - Math.PI / 2);
  }
  add('firewood-pile', -9, 5, 0.85);
  add('stone-firepit', 8, 8, 0.55);
  for (let i = 0; i < 7; i++)
    GULF_SCENERY.trees.push({
      key: 'valley-pine',
      x: s.x - 47 + i * 8,
      z: s.z - 45,
      yaw: i,
      scale: [0.65, 0.6 + (i % 3) * 0.06, 0.65],
    });
}
export const GULF_WAYPOINTS = [
  ...SETTLEMENTS.map((s) => ({ ...s, z: s.z + 5 })),
  { id: 'headland-path', name: '湾奥を回る道', x: -2050, z: 430 },
  { id: 'ridge-path', name: '尾根の分かれ道', x: -2630, z: 590 },
  { id: 'shore-path', name: '海岸林の道', x: -1830, z: 640 },
  { id: 'obsidian-path', name: '黒曜石の露頭', x: -2753, z: 693 },
  ...GULF_STOPS.map((s) => ({ ...s, z: s.z + 5 })),
  ...LANDINGS,
];
export function gulfActivitySpace(x: number, z: number) {
  if (!inGulf(x, z)) return false;
  return (
    FARM_PLOTS.some((p) => Math.abs(x - p.x) < 1.5 && Math.abs(z - p.z) < 1.5) ||
    SPRINGS.some((p) => Math.hypot(x - p.x, z - p.z) < 3) ||
    [...SETTLEMENTS, ...GULF_STOPS].some((p) => Math.hypot(x - p.x, z - p.z) < 12) ||
    GULF_LANDMARKS.some((p) => Math.hypot(x - p.x, z - p.z) < p.clearance + 2) ||
    LANDINGS.some((p) => Math.hypot(x - p.x, z - p.z) < 5)
  );
}

// The terrain between these reconstructed rock formations is walkable; the
// mountains themselves keep their measured, solid footprints.
export const GULF_LANDMARKS = [
  {
    id: 'gulf-valley-north',
    key: 'volcanic-cone',
    x: -2510,
    z: 272,
    scale: 0.55,
    yaw: 0.3,
    surface: 'moss',
    clearance: 45,
  },
  {
    id: 'gulf-valley-south',
    key: 'volcanic-cone',
    x: -2510,
    z: 435,
    scale: 0.55,
    yaw: 1.8,
    surface: 'moss',
    clearance: 45,
  },
  {
    id: 'gulf-spring-shoulder',
    key: 'volcanic-cone',
    x: -2340,
    z: 247,
    scale: 0.5,
    yaw: 0.8,
    surface: 'moss',
    clearance: 42,
  },
  {
    id: 'gulf-ridge-west',
    key: 'volcanic-cone',
    x: -2740,
    z: 557,
    scale: 0.48,
    yaw: 1.9,
    surface: 'ochre',
    clearance: 40,
  },
  {
    id: 'gulf-ridge-east',
    key: 'volcanic-cone',
    x: -2570,
    z: 582,
    scale: 0.48,
    yaw: 2.8,
    surface: 'ochre',
    clearance: 40,
  },
  {
    id: 'gulf-reed-headland',
    key: 'volcanic-cone',
    x: -1788,
    z: 703,
    scale: 0.42,
    yaw: 0.4,
    surface: 'moss',
    clearance: 36,
  },
  ...[-1, 1].flatMap((side) =>
    Array.from({ length: 4 }, (_, i) => ({
      id: `gulf-pass-${side}-${i}`,
      key: 'volcanic-basalt-columns',
      x: -2640 + side * 23 + i * 2,
      z: 565 + i * 16,
      scale: 1.7,
      yaw: i * 0.65,
      surface: 'ochre',
      clearance: 7,
    })),
  ),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `gulf-quarry-rock-${i}`,
    key: 'volcanic-basalt-columns',
    x: -2802 + i * 8,
    z: 642 + (i % 2) * 6,
    scale: 1.2,
    yaw: i * 0.7,
    surface: 'moss',
    clearance: 6,
  })),
];

// Seeded, sparse groves along journeys; existing model dimensions are retained.
for (let i = 0; i < 240; i++) {
  const segment = i % (GULF_SPINE.length - 1),
    a = GULF_SPINE[segment],
    b = GULF_SPINE[segment + 1];
  const t = ((i * 73) % 239) / 239;
  const x = a.x + (b.x - a.x) * t + Math.sin(i * 2.39996) * 125;
  const z = a.z + (b.z - a.z) * t + Math.cos(i * 2.39996) * 100;
  if (gulfLandDistance(x, z) < 18 || gulfActivitySpace(x, z)) continue;
  if (
    [...SETTLEMENTS, ...GULF_STOPS, ...GULF_WAYPOINTS].some(
      (p) => Math.hypot(x - p.x, z - p.z) < 58,
    )
  )
    continue;
  if ([...GULF_RESOURCES, ...OBSIDIAN_OUTCROPS].some((p) => Math.hypot(x - p.x, z - p.z) < 8))
    continue;
  GULF_SCENERY.trees.push({
    id: `gulf-grove-${i}`,
    key: 'valley-pine',
    x,
    z,
    yaw: i,
    scale: 0.8 + (i % 4) * 0.1,
    surface: 'valley',
  });
}
