import type { Inventory } from './types.mjs';
import type { PlotState } from './gulf-types.mjs';

/** Fictional crops, recipes and accelerated growth; not reconstructed ancient agriculture. */
export type CropId = 'berry' | 'root' | 'herb';
export interface Crop {
  id: CropId;
  name: string;
  seed: keyof Inventory;
  seedName: string;
  harvest: keyof Inventory;
  harvestName: string;
  yield: number;
  water: number;
  growFactor: number;
  model: string;
  scale: number;
  tint: number;
  use: string;
}
export const CROPS: readonly Crop[] = Object.freeze([
  {
    id: 'berry',
    name: 'ベリー',
    seed: 'seed',
    seedName: 'ベリーの種',
    harvest: 'berry',
    harvestName: 'ベリー',
    yield: 4,
    water: 1,
    growFactor: 1,
    model: 'berry-bush',
    scale: 1,
    tint: 0xffffff,
    use: 'そのまま食べて元気+25。次の種や宴にも。',
  },
  {
    id: 'root',
    name: '火根草',
    seed: 'rootSeed',
    seedName: '火根草の種',
    harvest: 'rawRoot',
    harvestName: '火根',
    yield: 3,
    water: 2,
    growFactor: 4 / 3,
    model: 'meadow-grass',
    scale: 1.6,
    tint: 0xd6c49c,
    use: '収穫するのは根。炉で焼くと元気+35。香草と焼くと+50。',
  },
  {
    id: 'herb',
    name: '香り草',
    seed: 'herbSeed',
    seedName: '香り草の種',
    harvest: 'herb',
    harvestName: '香草',
    yield: 3,
    water: 1,
    growFactor: 2 / 3,
    model: 'meadow-grass',
    scale: 0.85,
    tint: 0xa2d5aa,
    use: '早く育つ香草。火根と一緒に焼いて食事に。',
  },
]);
export const cropById = (id: unknown) => CROPS.find((crop) => crop.id === id);
export const plotCrop = (plot?: { cropId?: unknown }) => cropById(plot?.cropId) ?? CROPS[0];
export const cropGrowMs = (crop: Crop, seasonMs: number) => Math.round(seasonMs * crop.growFactor);
export function startCropGrowth(plot: PlotState, now: number, seasonMs: number) {
  const duration = cropGrowMs(plotCrop(plot), seasonMs);
  plot.stage = 'growing';
  plot.readyAt = now + duration;
  plot.waterRequestAt = 0;
  return duration;
}
export const cropHarvestText = (crop: Crop) =>
  `${crop.harvestName}${crop.yield}・${crop.seedName}2`;
export const CROP_INVENTORY = [
  'rootSeed',
  'herbSeed',
  'rawRoot',
  'herb',
  'cookedRoot',
  'herbRoot',
] as const;
export const ROOT_RECIPES = Object.freeze([
  {
    kind: 'root' as const,
    action: 'cookRoot',
    eatAction: 'eatRoot',
    name: '焼き根',
    ingredients: { rawRoot: 1, herb: 0 },
    costText: '火根1',
    output: 'cookedRoot' as const,
    energy: 35,
    offerAction: 'gulfOfferRoot',
  },
  {
    kind: 'herbRoot' as const,
    action: 'cookHerbRoot',
    eatAction: 'eatHerbRoot',
    name: '香草焼き根',
    ingredients: { rawRoot: 1, herb: 1 },
    costText: '火根1・香草1',
    output: 'herbRoot' as const,
    energy: 50,
    offerAction: 'gulfOfferHerbRoot',
  },
]);
