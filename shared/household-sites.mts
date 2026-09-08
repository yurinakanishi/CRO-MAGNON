import { MANY_HEARTHS, SETTLEMENTS } from './gulf-region.mjs';
import { VILLAGE } from './village-sites.mjs';
import type { Point } from './types.mjs';
import type { HouseholdDefinition, HouseholdState } from './household-types.mjs';
import type { ResidentRoutine } from './village-types.mjs';

// Fictional shared hearths, visits and gifts; no claim about prehistoric kinship.
export const JOURNEYS = Object.freeze({
  stayMs: VILLAGE.dayMs * 2,
  restMs: VILLAGE.dayMs,
  separation: 12,
  reach: 9,
  cost: { wood: 2, berry: 3, water: 1 },
  reward: { seed: 1, rootSeed: 1, herbSeed: 1 },
});
function guestRoutine(x: number, z: number, second: boolean): ResidentRoutine[] {
  const points: ResidentRoutine[] = [
    { x: x - 4, z: z - 2, label: '滞在先で食べ物を選んでいる', clip: 'Gather', facing: 0 },
    { x: x + 3, z: z - 4, label: '旅の道具を手入れしている', clip: 'Craft', facing: Math.PI },
    {
      x: x * 0.4,
      z: z > 0 ? (second ? 13 : 10) : second ? -9 : -12,
      label: '集い場で炉を囲んでいる',
      clip: 'Idle_Loop',
      facing: z > 0 ? Math.PI : 0,
    },
    { x, z, label: '訪問用の天幕のそばで休んでいる', clip: 'Idle_Loop', facing: Math.PI / 2 },
  ];
  return points.map((p) => ({ ...p, x: MANY_HEARTHS.x + p.x, z: MANY_HEARTHS.z + p.z }));
}
const routes: [string, string, [string, string], Point[], [number, number]][] = [
  [
    'valley-hearth',
    '谷道の世帯',
    ['mira', 'tovan'],
    [
      { x: -2440, z: 355 },
      { x: -2360, z: 395 },
    ],
    [-24, 17],
  ],
  [
    'ridge-hearth',
    '白石の世帯',
    ['ena', 'rok'],
    [
      { x: -2690, z: 710 },
      { x: -2630, z: 590 },
      { x: -2570, z: 450 },
      { x: -2460, z: 410 },
      { x: -2360, z: 415 },
    ],
    [-22, -18],
  ],
  [
    'reed-hearth',
    '葦辺の世帯',
    ['neri', 'daro'],
    [
      { x: -1750, z: 750 },
      { x: -1830, z: 640 },
      { x: -1970, z: 470 },
      { x: -2110, z: 395 },
      { x: -2230, z: 405 },
    ],
    [24, 17],
  ],
];
export const HOUSEHOLDS: HouseholdDefinition[] = routes.map(
  ([id, name, members, stops, guest], i) => {
    const home = SETTLEMENTS[i + 1];
    return {
      id,
      name,
      members,
      homeId: home.id,
      route: [
        { x: home.x, z: home.z + 6 },
        ...stops,
        { x: MANY_HEARTHS.x + guest[0], z: MANY_HEARTHS.z + guest[1] },
      ],
      guestRoutine: [
        guestRoutine(guest[0], guest[1], false),
        guestRoutine(guest[0] + 5, guest[1] + 4, true),
      ],
    };
  },
);
export const householdFor = (residentId: string) =>
  HOUSEHOLDS.find((h) => h.members.includes(residentId));
export const householdGoal = (
  d: HouseholdDefinition,
  h: HouseholdState,
  member: number,
): Point => ({
  x: d.route[h.leg].x + (member ? 1 : -1),
  z: d.route[h.leg].z + (member ? 1 : -1),
});
export function householdLabel(h?: HouseholdState, now = 0) {
  if (!h) return '国で暮らしている';
  if (h.stage === 'home')
    return h.readyAt > now ? '帰着して休んでいる' : '国で暮らしている · 旅支度を相談できる';
  return {
    assembling: '炉のそばで出発のために集合中',
    outbound: '集い場へ歩いている',
    visiting: '多くの炉の集い場に滞在中',
    returning: '国へ帰る道中',
  }[h.stage];
}
