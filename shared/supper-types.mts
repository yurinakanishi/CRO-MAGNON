import type { PantryFoodId } from './pantry-types.mjs';

export interface ResidentSupper {
  day: number;
  settlementId: string;
  foodId: PantryFoodId;
}
