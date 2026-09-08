import type { ShoalState } from './fishing-types.mjs';
import type { ShellBedState, MiddenState } from './coastal-types.mjs';
import type { CropId } from './crops.mjs';
/** Public, serializable gulf data; no renderer or simulation dependencies. */
export interface GulfProgress {
  metResidents?: string[];
  residentHelp?: Record<string, number>;
  shellfishGathered?: number;
  shellsReturned?: number;
  bladesKnapped?: number;
  fishingKit?: boolean;
  fishCaught?: number;
  fishShared?: number;
  countryId: string | null;
  welcomed: boolean;
  visited: string[];
  harvested: number;
  procured: number;
  delivered: number;
  lastFeast: number;
  waymarks?: string[];
  trailRewarded?: boolean;
}
export interface PlotState {
  id: string;
  cropId: CropId;
  stage: 'empty' | 'planted' | 'growing' | 'ripe';
  readyAt: number;
}
export interface GulfState {
  shellBeds: ShellBedState[];
  middens: MiddenState[];
  shoals: ShoalState[];
  version: number;
  plots: PlotState[];
  stores: { wood: number; berry: number; obsidian: number };
  festivals: number;
}
