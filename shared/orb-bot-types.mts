import type { Point } from './types.mjs';

export type BotKind =
  | 'white'
  | 'blue'
  | 'green'
  | 'purple'
  | 'orange'
  | 'beret'
  | 'frog'
  | 'triangle'
  | 'heart'
  | '524'
  | 'rimo-neko';
export type BotMode =
  | 'following'
  | 'queued'
  | 'windup'
  | 'airborne'
  | 'landing'
  | 'waiting'
  | 'returning'
  | 'catching'
  | 'stowed'
  | 'leaving';
export interface OrbBotSnapshot extends Point {
  id: string;
  /** The player this companion travels with; every dot belongs to exactly one person. */
  ownerId: string;
  kind: BotKind;
  /** The 524 or りもねこ body this squad entry throws and recalls; absent for a dot. */
  companionId?: string;
  mode: BotMode;
  y: number;
  facing: number;
  speed: number;
  phaseAt: number;
  throwAt: number;
  sequence: number;
  origin: { x: number; y: number; z: number } | null;
  landing: Point | null;
  landingY: number;
  recall: boolean;
  /** Shared gesture time, independent of the companion's return/landing phase. */
  recallAt?: number;
  /** A companion can be occupied by petting or an impact reaction. */
  busy?: boolean;
  /** Whoever is stroking this dot now. Petting never changes the owner. */
  petPlayerId?: string | null;
  petAt?: number;
  petContactAt?: number;
  petFacing?: number;
  /** Server time the goodbye began, 0 while travelling (mode 'leaving'). */
  leavingAt: number;
}
export interface OrbBot extends OrbBotSnapshot {
  path: Point[];
  nextPathAt: number;
  lastOwner: Point;
  warpSequence: number;
  stuckAt: number;
  petOrigin?: Point | null;
  petGoal?: Point | null;
  petCharacter?: string;
  petMode?: BotMode;
  petWarpSequence?: number;
}
