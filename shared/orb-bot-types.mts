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
  | '524';
export type BotMode =
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
}
export interface OrbBot extends OrbBotSnapshot {
  path: Point[];
  nextPathAt: number;
  lastOwner: Point;
  warpSequence: number;
  stuckAt: number;
}
