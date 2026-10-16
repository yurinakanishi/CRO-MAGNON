import { CLOTHING_DYES, normalizeDye } from '../shared/clothing-dye.mjs';

/** Fixed-pose photographs of the delivered GLBs using the game's own clothing shader.
 * Equal world scale and floor line. Capture: assets/character-portraits/20261016-r04/capture.json. */
export const CHARACTER_PORTRAIT_REVISION = 'choice-r04';

export function characterPortraitUrl(modelKey: string, dye: unknown = null) {
  return `/models/${modelKey}/portraits/${CHARACTER_PORTRAIT_REVISION}-${normalizeDye(dye) ?? 'original'}.webp`;
}

/** Packaging uses the same list as the picker, filtered by each build's playable roster. */
export function characterPortraitUrls(modelKey: string) {
  return [null, ...CLOTHING_DYES.map((dye) => dye.key)].map((dye) =>
    characterPortraitUrl(modelKey, dye),
  );
}
