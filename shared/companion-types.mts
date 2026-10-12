import type { Point } from './types.mjs';
import type { BotMode } from './orb-bot-types.mjs';

/** One player's own 524, りもねこ or walking friend. Any number of players may choose
 * the same mascot; each choice is a separate body that exists while its person is here. */
export interface CompanionSnapshot extends Point {
  id: string;
  /** Mascot selection key ('524', 'rimo-neko' or a friend's model key). */
  key: string;
  ownerId: string;
  facing: number;
  radius: number;
  /** The dots engine's state for a throwable body; a walker only follows or is stowed. */
  squadMode: BotMode;
  /** Server time the goodbye began, 0 while travelling. The body leaves after the farewell. */
  leavingAt: number;
  petSequence: number;
  petAt: number;
  /** Whoever is stroking it now. Petting never changes the owner. */
  petPlayerId: string | null;
  petContactAt: number;
  petHeight: number;
  petFacing: number;
  hitSequence: number;
  hitAt: number;
  hitDirectionX: number;
  hitDirectionZ: number;
}
export interface Companion extends CompanionSnapshot {
  velocityX: number;
  velocityZ: number;
  path: Point[];
  goal: Point | null;
  nextPathAt: number;
  followSpeed: number;
  ownerPosition: Point | null;
  /** The owner's previous position and warp, to notice a warp between updates. */
  lastOwner: Point;
  warpSequence: number;
  petOrigin: Point | null;
  petGoal: Point | null;
  petCharacter: string;
}
