/** Public, serializable gulf data; no renderer or simulation dependencies. */
export interface GulfProgress {
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
  stage: 'empty' | 'planted' | 'growing' | 'ripe';
  readyAt: number;
}
export interface GulfState {
  version: number;
  plots: PlotState[];
  stores: { wood: number; berry: number; obsidian: number };
  festivals: number;
}
