import { CHARACTER_MODELS } from './characters.mjs';
import type { CharacterModel } from './types.mjs';

/** Host policy, independent of character/model source files and saved progress. */
export interface ContentVisibility {
  readonly hiddenCharacters: readonly string[];
  readonly hideMae: boolean;
}

export const ALL_CONTENT: ContentVisibility = Object.freeze({
  hiddenCharacters: Object.freeze([]),
  hideMae: false,
});

export function visibleCharacters(visibility: ContentVisibility) {
  return CHARACTER_MODELS.filter((model) => characterVisible(model, visibility));
}

export function characterVisible(
  model: Readonly<CharacterModel> | undefined,
  visibility: ContentVisibility,
) {
  return (
    !!model && model.playable !== false && !visibility.hiddenCharacters.includes(model.species)
  );
}
