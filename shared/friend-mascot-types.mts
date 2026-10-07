import type { Point } from './types.mjs';

/** One contributor's small companion; every friend shares the same behaviour. */
export interface FriendMascotSnapshot extends Point {
  id: string;
  key: string;
  facing: number;
  radius: number;
  mode: 'idle' | 'following' | 'returning';
  followPlayerId: string | null;
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
export interface FriendMascot extends FriendMascotSnapshot {
  home: Point;
  homeFacing: number;
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
