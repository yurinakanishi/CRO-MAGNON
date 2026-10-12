import type { PlayerSnapshot } from './snapshots.mjs';
import { characterModel } from './characters.mjs';
import { equipmentInfo, equippedItem } from './equipment.mjs';
import { adventureProgress, travelSeals } from './adventure-regions.mjs';
import { mascotName } from './mascot-selection.mjs';

/** A self-introduction fits a short card: about two lines on a phone. */
export const INTRO_MAX_LENGTH = 80;
/** Changing it again waits this long, like chat. */
export const INTRO_COOLDOWN_MS = 1000;

/** What a traveler standing nearby can read about another: their own words and the
 * state anyone could see in the world, never their inventory or private progress. */
export function playerProfile(p: PlayerSnapshot, intro = '') {
  const shadow = adventureProgress(p, 'shadow-realm').claimed;
  return {
    name: p.name,
    character: characterModel(p).name,
    intro,
    energy: Math.round(Math.max(0, Math.min(100, p.energy ?? 0))),
    equipment: equipmentInfo(p, equippedItem(p)).name,
    companion: p.mascot ? mascotName(p.mascot) : null,
    seals: travelSeals(p),
    gathered: Math.max(0, Math.floor(p.gathered ?? 0)),
    title: shadow ? '境界を渡る者' : null,
  };
}
export type PlayerProfile = ReturnType<typeof playerProfile>;
