import type { CropId } from './crops.mjs';
export interface ResidentWatering {
  water: number;
  last: { day: number; plotId: string; cropId: CropId } | null;
}
export interface WateringTarget {
  plotId: string;
  requestedAt: number;
}
