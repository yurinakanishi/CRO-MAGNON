import { SETTLEMENTS } from './gulf-region.mjs';
import type { ShellBedState, MiddenState } from './coastal-types.mjs';

// Authored game locations and recipes, not reconstructed archaeological sites.
export const COASTAL = Object.freeze({
  range: 3.4,
  gatherMs: 2400,
  knapMs: 4000,
  shellEnergy: 20,
  bedCapacity: 12,
  recoverMs: 60000,
  obsidianCost: 2,
  haftWood: 1,
  maxMidden: 999999,
  middenRadius: 0.86,
});
export const SHELL_BEDS = [
  { id: 'shell-hearth', name: '炉の浜の貝場', x: -2250, z: 532 },
  { id: 'shell-ridge', name: '白い岸の貝場', x: -2537.5, z: 870 },
  { id: 'shell-reed', name: '葦の浜の貝場', x: -1874, z: 870 },
  { id: 'shell-west', name: '西の入り江の貝場', x: -2523, z: 1170 },
  { id: 'shell-east', name: '南の浜の貝場', x: -1858, z: 1165 },
];
export const MIDDEN_SITES = SETTLEMENTS.map((s) => ({
  id: `midden-${s.id}`,
  name: `${s.name}の貝塚`,
  x: s.x - 10,
  z: s.z + 14,
}));
export const KNAPPING_SITES = SETTLEMENTS.map((s) => ({
  id: `knap-${s.id}`,
  name: `${s.name}の石器作業場`,
  x: s.x + 12,
  z: s.z + 8,
}));
export const middenStage = (shells: number) =>
  shells >= 40 ? 3 : shells >= 12 ? 2 : shells > 0 ? 1 : 0;
export const middenScale = (shells: number) => [0, 0.5, 0.8, 1][middenStage(shells)];
export const middenRadius = (shells: number) => COASTAL.middenRadius * middenScale(shells);
export function activateMiddenObstacle(obstacle, state) {
  const count = state?.middens?.find((s) => s.id === obstacle.middenId)?.shells ?? 0;
  obstacle.radius = middenRadius(count);
  return count > 0;
}
const count = (value: unknown, max: number, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.floor(value)))
    : fallback;
export function createShellBeds(saved?: ShellBedState[]): ShellBedState[] {
  return SHELL_BEDS.map((site) => {
    const old = Array.isArray(saved) ? saved.find((s) => s.id === site.id) : undefined;
    return {
      id: site.id,
      amount: count(old?.amount, COASTAL.bedCapacity, COASTAL.bedCapacity),
      recoveredAt: count(old?.recoveredAt, Number.MAX_SAFE_INTEGER),
    };
  });
}
export function createMiddens(saved?: MiddenState[]): MiddenState[] {
  return MIDDEN_SITES.map((site) => ({
    id: site.id,
    shells: count(
      Array.isArray(saved) ? saved.find((s) => s.id === site.id)?.shells : 0,
      COASTAL.maxMidden,
    ),
  }));
}
