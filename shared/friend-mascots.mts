import { GROUND_MASCOTS, type FriendMascotDefinition } from './friend-mascot-roster.mjs';
// The same frozen definitions for every importer (the title reads the roster directly).
export {
  FIRST_MASCOTS,
  FRIEND_MASCOTS,
  GROUND_MASCOTS,
  type FriendMascotDefinition,
} from './friend-mascot-roster.mjs';
/** Every walking mascot's selection key, in card order. */
export const GROUND_MASCOT_KEYS = GROUND_MASCOTS.map((f) => f.key);

export const FRIEND_TIMING = Object.freeze({
  petRange: 2.6,
  petCooldownMs: 1400,
  petApproachMs: 4000,
  petStrokeMs: 1400,
  happyMs: 1400,
  hitMs: 650,
  impulse: 2.4,
  damping: 7,
  followDistance: 1.65,
  followAcceleration: 4,
});

export function friendDefinition(key: string): FriendMascotDefinition | undefined {
  return GROUND_MASCOTS.find((f) => f.key === key);
}
