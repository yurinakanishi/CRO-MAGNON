import { LANDINGS } from './gulf-region.mjs';
import type { ShoalState } from './fishing-types.mjs';

// Authored gameplay grounds, not a reconstruction of a prehistoric fishery.
export const FISHING = Object.freeze({
  wood: 3,
  stone: 1,
  range: 10,
  durationMs: 6000,
  energy: 30,
});
const waterOffsets = [
  [0, 7],
  [7, 0],
  [-7, 0],
  [7, 0],
  [-7, 0],
];
export const FISHING_SITES = [
  ...LANDINGS.map((landing, i) => ({
    id: `fish-${landing.id}`,
    name: ['炉の浜の魚場', '白い岸の魚場', '葦の浜の魚場', '西の入り江の魚場', '南の浜の魚場'][i],
    x: landing.x + waterOffsets[i][0],
    z: landing.z + waterOffsets[i][1],
    shore: { x: landing.x, z: landing.z },
    boatOnly: false,
    capacity: 6,
    recoverMs: 45000,
  })),
  {
    id: 'fish-inner-water',
    name: '湾央の魚場',
    x: -2200,
    z: 840,
    shore: null,
    boatOnly: true,
    capacity: 10,
    recoverMs: 30000,
  },
  {
    id: 'fish-outer-water',
    name: '湾口の魚場',
    x: -2190,
    z: 1145,
    shore: null,
    boatOnly: true,
    capacity: 10,
    recoverMs: 30000,
  },
];
export function createShoals(saved?: ShoalState[]): ShoalState[] {
  return FISHING_SITES.map((site) => {
    const old = saved?.find?.((s) => s.id === site.id);
    return {
      id: site.id,
      amount: Number.isFinite(old?.amount)
        ? Math.max(0, Math.min(site.capacity, Math.floor(old.amount)))
        : site.capacity,
      recoveredAt: Number.isFinite(old?.recoveredAt) ? Math.max(0, old.recoveredAt) : 0,
    };
  });
}
