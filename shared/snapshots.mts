import type { Gender, Inventory, Point, Resource, Species } from './types.mjs';
import type { FishingActivity } from './fishing-types.mjs';
import type { CoastalActivity } from './coastal-types.mjs';
import type { GulfState, GulfProgress } from './gulf-types.mjs';
import type { ResidentSnapshot } from './village-types.mjs';
import type { MaritimeWeather } from './maritime-types.mjs';
import type { HouseholdState } from './household-types.mjs';
import type { BarterSnapshot } from './barter-types.mjs';

/** Public wire data. Connections, session tokens and simulation paths never belong here. */
export interface AdventureProgress {
  visited: string[];
  gathered: number;
  kills: number;
  claimed: boolean;
  discovered?: boolean;
  defeated?: string[];
}
export interface PlayerSnapshot extends Point {
  id: string;
  name: string;
  species: Species;
  gender: Gender;
  radius: number;
  color: string;
  inventory: Inventory;
  gathered: number;
  tool: boolean;
  ready: boolean;
  energy: number;
  facing: number;
  moving: boolean;
  running: boolean;
  speed: number;
  attackSequence: number;
  attackAt: number;
  jumpAt?: number;
  jumpSequence?: number;
  warpSequence?: number;
  lastExpeditionAt?: number;
  cookingEndsAt: number;
  cookingKind?: 'fish' | 'meat' | 'shellfish' | 'root' | 'herbRoot';
  coastalActivity?: CoastalActivity | null;
  spearHead?: 'wood' | 'obsidian';
  fishing?: FishingActivity | null;
  hurtSequence: number;
  hurtAt: number;
  defeatSequence: number;
  downedUntil: number;
  invulnerableUntil: number;
  carrierId?: string | null;
  passengerId?: string | null;
  carryOfferFromId?: string | null;
  carryOfferToId?: string | null;
  carryOfferUntil?: number;
  mountId: string | null;
  boatId: string | null;
  adventure: { regions: Record<string, AdventureProgress> };
  gulf?: GulfProgress;
}
export interface AnimalSnapshot extends Point {
  id: string;
  facing: number;
  speed: number;
  scale: number;
  radius: number;
  clip: string;
  phase: string;
  health: number;
  maxHealth: number;
  meatRemaining: number;
  phaseStartedAt: number;
  respawnMs?: number;
  riderId: string | null;
}
export interface EnemySnapshot extends Point {
  riderId?: string | null;
  id: string;
  modelKey: string;
  name: string;
  hostile: boolean;
  scale: number;
  facing: number;
  speed: number;
  radius: number;
  clip: string;
  phase: string;
  health: number;
  maxHealth: number;
  phaseStartedAt: number;
  respawnMs?: number;
  behavior: string;
  targetId: string | null;
  attackSequence: number;
  attackAt: number;
  hitSequence: number;
  hitAt: number;
  crowRole?: string;
  // Rank 1..5 of the castle cult and whether it is praying behind the seal.
  crowTier?: number;
  sealed?: boolean;
  airborneHeight?: number;
  // Floor height under the body (castle-relative), for effects drawn at the actor.
  elevation?: number;
}
export interface BoatSnapshot extends Point {
  id: string;
  facing: number;
  radius: number;
  riderId: string | null;
  speed: number;
  moving: boolean;
  running: boolean;
}
export interface ProjectileSnapshot extends Point {
  id: string;
  ownerId: string;
  dx: number;
  dz: number;
  speed?: number;
  createdAt: number;
  updatedAt: number;
  travelled: number;
  kind: string;
  elevation: number;
}
// The sorcerer's area spell: a red ring telegraph, then a detonation at `at`.
export interface HexBurstSnapshot extends Point {
  id: string;
  ownerId: string;
  elevation: number;
  radius: number;
  startedAt: number;
  at: number;
  detonatedAt: number | null;
}
export interface ProjectileImpact extends Point {
  id: string;
  at: number;
  kind?: string;
  elevation?: number;
}
export interface PoisonShot extends Point {
  id: string;
  ownerId: string;
  y: number;
  originX: number;
  originY: number;
  originZ: number;
  vx: number;
  vy: number;
  vz: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
export interface PoisonSplash extends Point {
  id: string;
  y: number;
  floorY?: number;
  radius?: number;
  at: number;
  hit: boolean;
}
export interface CampSnapshot extends Point {
  wood: number;
  stone: number;
  level: number;
  goalWood: number;
  goalStone: number;
}
export interface NpcSnapshot extends Point {
  name: string;
  species: string;
  gender: string;
  greeting: string;
}
export interface GameSnapshot {
  mapPins?: import('./map-pins.mjs').MapPin[];
  type: 'state';
  room: string;
  serverTime: number;
  maritime?: MaritimeWeather;
  boatingVersion: number;
  adventureVersion: number;
  ridingVersion: number;
  combatVersion: number;
  characterVersion: number;
  enemyVersion: number;
  worldVersion: number;
  playerLimit?: number;
  worldWidth: number;
  worldDepth: number;
  epochYearsBP: number;
  players: PlayerSnapshot[];
  residents?: ResidentSnapshot[];
  households?: HouseholdState[];
  barters?: BarterSnapshot[];
  animals: AnimalSnapshot[];
  enemies: EnemySnapshot[];
  boats: BoatSnapshot[];
  projectiles: ProjectileSnapshot[];
  projectileImpacts: ProjectileImpact[];
  poisonShots?: PoisonShot[];
  poisonSplashes?: PoisonSplash[];
  hexBursts?: HexBurstSnapshot[];
  resources?: Resource[];
  camp?: CampSnapshot;
  cookingFires?: (Point & { id: string })[];
  npc?: NpcSnapshot;
  gulf?: GulfState;
  day: number;
  dayProgress: number;
  completed: boolean;
}
