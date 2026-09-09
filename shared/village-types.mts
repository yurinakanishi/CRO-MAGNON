import type { Gender, Inventory, Point, Species, MovableActor } from './types.mjs';
import type { ResidentSupper } from './supper-types.mjs';
import type { ResidentForage } from './foraging-types.mjs';

export interface ResidentRoutine extends Point {
  label: string;
  clip: 'Gather' | 'Craft' | 'Idle_Loop';
  facing: number;
}
export interface ResidentDefinition {
  id: string;
  name: string;
  settlementId: string;
  species: Species;
  gender: Gender;
  introduction: string;
  request: string;
  thanks: string;
  cost: Partial<Inventory>;
  reward: Partial<Inventory>;
  routine: ResidentRoutine[];
}
export interface ResidentSnapshot extends Point {
  id: string;
  facing: number;
  radius: number;
  speed: number;
  moving: boolean;
  activity: string;
  clip: string;
  supper?: ResidentSupper | null;
  forage?: ResidentForage | null;
}
export interface Resident extends MovableActor {
  id: string;
  activity: string;
  clip: string;
  phase: number;
  routineKey: string;
  destination: ResidentRoutine | null;
  talkUntil: number;
  talkerId: string | null;
  supper: ResidentSupper | null;
  supperUntil: number;
  forage: ResidentForage | null;
  forageWork: { key: string; elapsedMs: number } | null;
}
