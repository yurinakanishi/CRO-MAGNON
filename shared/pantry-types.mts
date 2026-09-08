export type PantryFoodId =
  'berry' | 'cookedMeat' | 'cookedFish' | 'cookedShellfish' | 'cookedRoot' | 'herbRoot';
export interface PantryState {
  settlementId: string;
  food: Record<PantryFoodId, number>;
  supper: Record<PantryFoodId, number>;
  supperShells: number;
}
export interface PantryAllowance {
  day: number;
  taken: number;
}
