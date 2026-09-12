// Per-room tuning. The exhibition floor restores fallen players fully and
// brings every creature back within seconds so a short visit always has
// something to fight. Null fields mean "use the creature's own constant".
export type RoomRules = {
  recoveryEnergy: number;
  respawnMs: number | null;
  meatLingerMs: number | null;
};
export const DEFAULT_RULES: RoomRules = Object.freeze({
  recoveryEnergy: 50,
  respawnMs: null,
  meatLingerMs: null,
});
export const EXHIBITION_RULES: RoomRules = Object.freeze({
  recoveryEnergy: 100,
  respawnMs: 10000,
  meatLingerMs: 10000,
});
export const respawnDelay = (room, fallback: number) => room.rules?.respawnMs ?? fallback;
