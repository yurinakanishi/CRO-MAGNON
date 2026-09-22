// Per-room tuning. The exhibition floor restores fallen players fully and
// brings every creature back within seconds so a short visit always has
// something to fight. Null fields mean "use the creature's own constant".
//
// A visitor has a minute or two: they always run (and faster), fell creatures
// in a few blows, cannot be downed, and may strike any rank of the crow keep.
export type RoomRules = {
  recoveryEnergy: number;
  respawnMs: number | null;
  meatLingerMs: number | null;
  /** Players on foot, mounted or aboard always use the running gait. */
  alwaysRun: boolean;
  /** Multiplies a player's speed on foot. */
  speedScale: number;
  /** Multiplies every blow a player lands. */
  playerDamageScale: number;
  /** Replaces the personal difficulty multiplier when set. */
  incomingDamageScale: number | null;
  /** Damage never lowers a player's energy below this; 0 allows being downed. */
  minimumEnergy: number;
  /** Attacking and gathering cost no energy. */
  freeActions: boolean;
  /** The crow keep's ranks must be felled from the lowest upward. */
  castleSeal: boolean;
  /** A title start may name one of SPAWN_SITES instead of the camp. */
  spawnChoice: boolean;
};
export const DEFAULT_RULES: RoomRules = Object.freeze({
  recoveryEnergy: 50,
  respawnMs: null,
  meatLingerMs: null,
  alwaysRun: false,
  speedScale: 1,
  playerDamageScale: 1,
  incomingDamageScale: null,
  minimumEnergy: 0,
  freeActions: false,
  castleSeal: true,
  spawnChoice: false,
});
export const EXHIBITION_RULES: RoomRules = Object.freeze({
  recoveryEnergy: 100,
  respawnMs: 10000,
  meatLingerMs: 10000,
  alwaysRun: true,
  speedScale: 1.4,
  playerDamageScale: 4,
  incomingDamageScale: 0.2,
  minimumEnergy: 1,
  freeActions: true,
  castleSeal: false,
  spawnChoice: true,
});
// Fixtures and old saves may carry only some fields.
export const roomRules = (room): RoomRules => ({ ...DEFAULT_RULES, ...room?.rules });
export const respawnDelay = (room, fallback: number) => room.rules?.respawnMs ?? fallback;
/** The part of the rules a client needs to predict its own movement and gait. */
export const clientRules = (room) => {
  const { alwaysRun, speedScale, spawnChoice } = roomRules(room);
  return { alwaysRun, speedScale, spawnChoice };
};
