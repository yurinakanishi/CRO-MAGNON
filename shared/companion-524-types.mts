import type { Point } from './types.mjs';
import type { BotMode } from './orb-bot-types.mjs';

export interface Companion524Snapshot extends Point {
  id: string;
  facing: number;
  radius: number;
  mode: 'idle' | 'following' | 'returning';
  followPlayerId: string | null;
  /** Joined after a complete pet and happy reaction; there is only one 524 per room. */
  squadPlayerId?: string | null;
  squadMode?: BotMode | null;
  petSequence: number;
  petAt: number;
  petPlayerId: string | null;
  petContactAt: number;
  petHeight: number;
  petFacing: number;
  hitSequence: number;
  hitAt: number;
  hitDirectionX: number;
  hitDirectionZ: number;
}
export interface Companion524 extends Companion524Snapshot {
  home: Point;
  velocityX: number;
  velocityZ: number;
  path: Point[];
  goal: Point | null;
  nextPathAt: number;
  trail: Point[];
  followSpeed: number;
  ownerPosition: Point | null;
  petOrigin: Point | null;
  petGoal: Point | null;
  petCharacter: string;
}
