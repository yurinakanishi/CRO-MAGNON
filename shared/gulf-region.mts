import type { Resource, SceneryPlacement } from './types.mjs';

// Authored fantasy, not an archaeological coast or recovered political geography.
// Independent data: safe for geography, game rules and rendering to import.
export const GULF = Object.freeze({
  id: 'three-shores',
  name: '三つの岸の湾',
  version: 1,
  minX: -2110,
  maxX: -1370,
  minZ: 460,
  maxZ: 1130,
});
export const GULF_SPINE = [
  { x: -1980, z: 1010 },
  { x: -1990, z: 810 },
  { x: -1930, z: 650 },
  { x: -1770, z: 600 },
  { x: -1620, z: 660 },
  { x: -1490, z: 810 },
  { x: -1480, z: 1000 },
];
export function inGulf(x: number, z: number, margin = 0) {
  return (
    x >= GULF.minX - margin &&
    x <= GULF.maxX + margin &&
    z >= GULF.minZ - margin &&
    z <= GULF.maxZ + margin
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
    distance = Math.max(distance, 88 - Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return distance;
}
export const MANY_HEARTHS = Object.freeze({
  id: 'many-hearths',
  name: '多くの炉の集い場',
  x: -1770,
  z: 650,
});
export const COUNTRIES = Object.freeze([
  {
    id: 'long-valley',
    name: '長い谷の国',
    x: -1900,
    z: 600,
    color: '#97b886',
    motto: '種と道を分かち合う',
    environment: '草地と川沿いの林。季節の狩りとベリー畑を行き来する。',
    craft: '木の柄、獣皮、編み紐。緑の結び紐を旅の目印にする。',
    custom: '収穫の初めに、旅人と種を分ける。集い場には食べ物と狩場の便りを持ち寄る。',
  },
  {
    id: 'pale-ridge',
    name: '白い尾根の国',
    x: -1990,
    z: 840,
    color: '#d7b18c',
    motto: 'よい石には、よい手を',
    environment: '石の露頭と風を避ける山裾。採集、畑、小動物の狩りで暮らす。',
    craft: '石刃と骨の道具。淡い石の飾りと黄土色の獣皮を使う。',
    custom: '石を割る技を囲炉裏で教える。黒曜石を湾へ運び、木材や食料と交換する。',
  },
  {
    id: 'reed-shore',
    name: '葦の岸の国',
    x: -1500,
    z: 850,
    color: '#7dc0c3',
    motto: '帰る岸を覚えておく',
    environment: '入り江と海岸林。浜の採集、漁、陸の採集、ベリー畑を組み合わせる。',
    craft: '小舟の修繕、結び紐、貝の飾り。青緑の獣皮を使う。',
    custom: '出発する舟に天気と上陸地を伝える。集い場では道具と航路の知識を交換する。',
  },
]);
export const SETTLEMENTS = [MANY_HEARTHS, ...COUNTRIES];
export const GULF_ENTRY = {
  ...MANY_HEARTHS,
  z: MANY_HEARTHS.z + 5,
  continent: '創作世界 · 三つの岸',
};
export const SPRINGS = SETTLEMENTS.map((s) => ({
  id: `spring-${s.id}`,
  name: `${s.name}の水場`,
  x: s.x - 16,
  z: s.z - 13,
}));
export const LANDINGS = [
  { id: 'hearth-landing', name: '集い場の浜', x: -1770, z: 694 },
  { id: 'ridge-landing', name: '尾根の浜', x: -1901, z: 850 },
  { id: 'reed-landing', name: '葦の浜', x: -1575, z: 850 },
];
export const FARM_PLOTS = SETTLEMENTS.flatMap((s) =>
  Array.from({ length: 12 }, (_, i) => ({
    id: `plot-${s.id}-${i + 1}`,
    settlementId: s.id,
    x: s.x + 16 + (i % 4) * 3,
    z: s.z - 10 + Math.floor(i / 4) * 3,
  })),
);
export const GULF_RESOURCES: Resource[] = SETTLEMENTS.flatMap((s) =>
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
  x: -2020 + (i % 4) * 5,
  z: 765 + Math.floor(i / 4) * 6,
  amount: 8,
  maxAmount: 8,
  appearanceBiome: 'grassland',
}));
export const GULF_SCENERY: Record<'trees' | 'props' | 'fires', SceneryPlacement[]> = {
  trees: [],
  props: [],
  fires: [],
};
for (const s of SETTLEMENTS) {
  const surface = s.id === 'pale-ridge' ? 'sand' : s.id === 'reed-shore' ? 'shore' : 'valley';
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
  const tents = s.id === MANY_HEARTHS.id ? 10 : 4;
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
  { id: 'headland-path', name: '湾奥を回る道', x: -1660, z: 640 },
  { id: 'ridge-path', name: '尾根の分かれ道', x: -1950, z: 720 },
  { id: 'shore-path', name: '海岸林の道', x: -1550, z: 745 },
  { id: 'obsidian-path', name: '黒曜石の露頭', x: -2003, z: 778 },
  ...LANDINGS,
];
export function gulfActivitySpace(x: number, z: number) {
  if (!inGulf(x, z)) return false;
  return (
    FARM_PLOTS.some((p) => Math.abs(x - p.x) < 1.5 && Math.abs(z - p.z) < 1.5) ||
    SPRINGS.some((p) => Math.hypot(x - p.x, z - p.z) < 3) ||
    SETTLEMENTS.some((p) => Math.hypot(x - p.x, z - p.z) < 12) ||
    LANDINGS.some((p) => Math.hypot(x - p.x, z - p.z) < 5)
  );
}
