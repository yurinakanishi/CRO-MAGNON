import type { Point } from './types.mjs';
import type { ResidentRoutine } from './village-types.mjs';

export type HouseholdStage = 'home' | 'assembling' | 'outbound' | 'visiting' | 'returning';
export interface HouseholdState {
  id: string;
  stage: HouseholdStage;
  visit: number;
  leg: number;
  stayUntil: number;
  readyAt: number;
}
export interface HouseholdDefinition {
  id: string;
  name: string;
  homeId: string;
  members: [string, string];
  route: Point[];
  guestRoutine: [ResidentRoutine[], ResidentRoutine[]];
}
