import type { Point } from './types.mjs';
import type { BotMode } from './orb-bot-types.mjs';

export interface RimoNekoSnapshot extends Point {
  id: string;
  facing: number;
  radius: number;
  mode: 'idle' | 'following' | 'returning';
  followPlayerId: string | null;
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
export interface RimoNeko extends RimoNekoSnapshot {
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
