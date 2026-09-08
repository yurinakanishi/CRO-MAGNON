import type { Rift, Resource } from './types.mjs';
// Authored exploration pockets on the existing land mask. These are fictional
// game locations, including a remote shadow pocket reached through a rift.
// No coastline, source mesh, or climate reconstruction is replaced.
export const ADVENTURE_VERSION = 1;
const definitions = [
  {
    id: 'high-pass',
    name: '天風の山道',
    kind: '山岳',
    x: 736,
    z: 224,
    radius: 90,
    color: '#b9d0df',
    description: '雪を頂く山の裾を抜け、風の通り道をたどる。',
    story: '旅人は山頂を競わず、次の旅人のために道を記した。',
    task: '三つの道標をたどり、この山道で石を4個採集する。',
    material: 'stone',
    amount: 4,
    kills: 0,
    reward: { cookedMeat: 2, wood: 4 },
    fog: '#adc1d0',
    sky: '#a8cbe2',
    light: '#e0edff',
    points: [
      [-2, 24, '風待ちの岩'],
      [3, 0, '白い鞍部'],
      [-3, -26, '雲見の峠'],
    ],
  },
  {
    id: 'echo-valley',
    name: 'こだまの峡谷',
    kind: '峡谷',
    x: 96,
    z: 608,
    radius: 80,
    color: '#d49b70',
    description: '赤い岩壁の間を、声と焚き火の煙が渡る。',
    story: '絶壁に返る声は、離れた仲間がまだそこにいる印だった。',
    task: '峡谷の三つの道標をたどり、この谷で木材を4個採集する。',
    material: 'wood',
    amount: 4,
    kills: 0,
    reward: { cookedMeat: 2, stone: 4 },
    fog: '#b1aa8e',
    sky: '#d1c6a5',
    light: '#ffdaae',
    points: [
      [0, 23, '谷の入り口'],
      [-3, 0, 'こだまの壁'],
      [3, -26, '見晴らしの裂け目'],
    ],
  },
  {
    id: 'stone-forest',
    name: '星影の石の森',
    kind: '石の森',
    x: 1008,
    z: 96,
    radius: 70,
    color: '#9bbdba',
    description: '巨石と針葉樹の奥で、青い裂け目が脈打つ。',
    story: '三つの旅の証がそろうと、石の森にもう一つの空が開く。',
    task: '石の森の三つの道標をたどり、森の番人を倒す。近くの仲間にも討伐が記録される。',
    amount: 0,
    kills: 1,
    reward: { cookedMeat: 3, berry: 5 },
    fog: '#829f9a',
    sky: '#acc7ba',
    light: '#d6edca',
    points: [
      [0, 23, '苔の広場'],
      [-4, 2, '巨石の回廊'],
      [0, -26, '星の裂け目'],
    ],
  },
  {
    id: 'amber-oasis',
    name: '琥珀のオアシス',
    kind: 'オアシス',
    x: -160,
    z: 416,
    radius: 65,
    color: '#e0ba72',
    description: '砂岩の輪に囲まれた泉で、旅の疲れを癒やす。',
    story: '砂の旅人は、泉のありかを歌にして忘れないようにした。',
    task: '泉を囲む三つの道標をたどり、この地でベリーを3個採集する。',
    material: 'berry',
    amount: 3,
    kills: 0,
    reward: { cookedMeat: 2, wood: 6 },
    fog: '#d5bd8e',
    sky: '#e0d1ae',
    light: '#fff0c9',
    points: [
      [-10, 20, '砂の灯'],
      [-12, 0, '旅人の泉'],
      [2, -23, '琥珀の岩'],
    ],
  },
  {
    id: 'blue-chasm',
    name: '蒼氷の回廊',
    kind: '氷の峡谷',
    x: -1568,
    z: -96,
    radius: 65,
    color: '#82d5e3',
    description: '青い氷壁のすき間に、凍らない旅路が続く。',
    story: '氷の音を聞き分ける者だけが、白い迷路に道を残せた。',
    task: '氷の三つの道標をたどり、氷の番人を倒し、石を5個採集する。',
    material: 'stone',
    amount: 5,
    kills: 1,
    reward: { cookedMeat: 3, wood: 5 },
    fog: '#92bfd2',
    sky: '#94bbd4',
    light: '#d2efff',
    points: [
      [0, 23, '青い入口'],
      [2, 0, '氷鳴りの壁'],
      [-2, -24, '静寂の間'],
    ],
  },
  {
    id: 'shadow-realm',
    name: '裏世界・影の庭',
    kind: '裏世界',
    x: 1008,
    z: 1536,
    radius: 65,
    color: '#b598ec',
    realm: true,
    description: '紫の空、浮遊する光、黒い石柱。裂け目の向こう側へ。',
    story: '影は敵ではなく、まだ誰にも語られていない世界の記憶だった。',
    task: '影の三つの道標をたどり、二人の影の番人を倒す。',
    amount: 0,
    kills: 2,
    reward: { cookedMeat: 5, berry: 10 },
    fog: '#302d50',
    sky: '#181a3b',
    light: '#c1b3ff',
    points: [
      [0, 23, '帰還の灯'],
      [-6, 0, '忘れられた庭'],
      [0, -25, '影の奥座'],
    ],
  },
];
export const ADVENTURE_REGIONS = Object.freeze(
  definitions.map(({ points, ...region }) =>
    Object.freeze({
      ...region,
      camp: Object.freeze({ x: region.x, z: region.z + 39 }),
      checkpoints: Object.freeze(
        points.map(([dx, dz, name]: [number, number, string], i) =>
          Object.freeze({ id: `${region.id}-${i + 1}`, name, x: region.x + dx, z: region.z + dz }),
        ),
      ),
      reward: Object.freeze(region.reward),
    }),
  ),
);
export const regionById = (id) => ADVENTURE_REGIONS.find((region) => region.id === id);
export const regionAt = (x, z) =>
  ADVENTURE_REGIONS.find((region) => Math.hypot(x - region.x, z - region.z) < region.radius);
export const regionWeight = (region, x, z) =>
  region
    ? Math.max(0, Math.min(1, (region.radius - Math.hypot(x - region.x, z - region.z)) / 18))
    : 0;
export const ADVENTURE_STOPS = Object.freeze(
  ADVENTURE_REGIONS.filter((r) => !r.realm).map((r) =>
    Object.freeze({ id: r.id, name: r.name, ...r.camp, continent: r.kind }),
  ),
);
export const RIFTS: readonly Rift[] = Object.freeze([
  Object.freeze({
    id: 'star-rift',
    name: '星の裂け目',
    x: 1008,
    z: 70,
    destination: 'shadow-realm',
  }),
  Object.freeze({
    id: 'return-rift',
    name: '地上への裂け目',
    x: 1008,
    z: 1575,
    destination: 'stone-forest',
    exit: true,
  }),
]);
export const riftNear = (p) => p && RIFTS.find((r) => Math.hypot(p.x - r.x, p.z - r.z) <= 4);
export const adventureReserved = (x, z, margin = 0) =>
  ADVENTURE_REGIONS.some((r) => Math.hypot(x - r.x, z - r.z) < r.radius + margin);
export const adventureProgress = (p, id) =>
  p?.adventure?.regions?.[id] ?? { visited: [], gathered: 0, kills: 0, claimed: false };
export const travelSeals = (p) =>
  ADVENTURE_REGIONS.filter((r) => !r.realm && adventureProgress(p, r.id).claimed).length;
export const regionComplete = (p, r) => {
  const s = adventureProgress(p, r.id);
  return (
    r.checkpoints.every((c) => s.visited.includes(c.id)) &&
    s.gathered >= r.amount &&
    s.kills >= r.kills
  );
};

export const ADVENTURE_RESOURCES: readonly Resource[] = Object.freeze(
  ADVENTURE_REGIONS.flatMap((r) =>
    [
      // Explicit appearances allow berry bushes beside the oasis without adding
      // living conifers or snow trees to the surrounding desert/ice biome.
      { type: r.material ?? 'stone', dx: -8, dz: 24 },
      { type: r.material ?? 'stone', dx: r.id === 'amber-oasis' ? -8 : 8, dz: 3 },
      { type: r.realm ? 'berry' : 'wood', dx: r.realm ? -12 : 7, dz: r.realm ? 14 : 35 },
    ].map(({ type, dx, dz }, i) =>
      Object.freeze({
        id: `adventure-${r.id}-${i}`,
        regionId: r.id,
        type: type as Resource['type'],
        x: r.x + dx,
        z: r.z + dz,
        amount: 9,
        maxAmount: 9,
        appearanceBiome:
          type === 'berry'
            ? 'grassland'
            : r.realm || (type === 'wood' && r.id === 'blue-chasm')
              ? 'volcano'
              : undefined,
      }),
    ),
  ),
);
export const ADVENTURE_ENEMIES = Object.freeze(
  ADVENTURE_REGIONS.filter((r) => r.kills).flatMap((r) =>
    Array.from({ length: r.kills }, (_, i) =>
      Object.freeze({
        id: `guardian-${r.id}-${i + 1}`,
        name: `${r.kind}の番人${r.kills > 1 ? `・${i + 1}` : ''}`,
        regionId: r.id,
        x: r.x + (i ? 8 : -8),
        z: r.z - (i ? 24 : 5),
        radius: 7,
        roamRadius: 2.2,
        maxHealth: r.realm ? 125 : r.id === 'blue-chasm' ? 100 : 75,
      }),
    ),
  ),
);
