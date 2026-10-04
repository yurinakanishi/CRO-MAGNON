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
  | 'home'
  | 'goingHome'
  | 'following'
  | 'queued'
  | 'windup'
  | 'airborne'
  | 'landing'
  | 'waiting'
  | 'returning'
  | 'catching'
  | 'stowed';
export interface OrbBotSnapshot extends Point {
  id: string;
  /** Empty until invited by petting or a whistle; each kind is shared by the room. */
  ownerId: string;
  kind: BotKind;
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
  /** A recruited companion can be occupied by petting or an impact reaction. */
  busy?: boolean;
  petPlayerId?: string | null;
  petAt?: number;
  petContactAt?: number;
  petFacing?: number;
  /** Every participant shares one gesture, contact time and completion. */
  petGroupLeaderId?: string;
  returnHome?: boolean;
}
export interface OrbBot extends OrbBotSnapshot {
  path: Point[];
  nextPathAt: number;
  lastOwner: Point;
  warpSequence: number;
  stuckAt: number;
  home?: Point;
  petOrigin?: Point | null;
  petGoal?: Point | null;
  petCharacter?: string;
  petMode?: BotMode;
  petWarpSequence?: number;
}
