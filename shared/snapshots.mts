import type { Gender, Inventory, Point, Resource, Species } from './types.mjs';
import type { GulfState, GulfProgress } from './gulf-types.mjs';

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
  cookingEndsAt: number;
  hurtSequence: number;
  hurtAt: number;
  defeatSequence: number;
  downedUntil: number;
  invulnerableUntil: number;
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
  behavior: string;
  targetId: string | null;
  attackSequence: number;
  attackAt: number;
  hitSequence: number;
  hitAt: number;
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
  createdAt: number;
  updatedAt: number;
  travelled: number;
  kind: string;
  elevation: number;
}
export interface ProjectileImpact extends Point {
  id: string;
  at: number;
  kind?: string;
  elevation?: number;
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
  type: 'state';
  room: string;
  serverTime: number;
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
  animals: AnimalSnapshot[];
  enemies: EnemySnapshot[];
  boats: BoatSnapshot[];
  projectiles: ProjectileSnapshot[];
  projectileImpacts: ProjectileImpact[];
  resources?: Resource[];
  camp?: CampSnapshot;
  cookingFires?: (Point & { id: string })[];
  npc?: NpcSnapshot;
  gulf?: GulfState;
  day: number;
  dayProgress: number;
  completed: boolean;
}
