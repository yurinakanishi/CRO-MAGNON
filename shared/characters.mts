import type { CharacterModel, CharacterProfile, Species, Gender } from './types.mjs';
import { CHARACTER_MODELS } from './character-profiles.mjs';
import { characterSpeciesReleased } from './character-roster.mjs';
export { CHARACTER_MODELS } from './character-profiles.mjs';
export const PLAYABLE_CHARACTER_MODELS = CHARACTER_MODELS.filter(
  (model) => model.playable !== false && characterSpeciesReleased(model.species),
);

// A model key picks its look when it agrees with the species and gender given beside it (a
// profile whose species changed without its key falls back to them). Otherwise the first look
// of the species and gender; missing choices (including profiles saved before gender existed)
// start female.
export function normalizeCharacter({ species, gender, character }: CharacterProfile = {}): {
  species: Species;
  gender: Gender;
  character: string;
} {
  const chosen = CHARACTER_MODELS.find((model) => model.key === character);
  const model =
    chosen &&
    (species == null || species === chosen.species) &&
    (gender == null || gender === chosen.gender)
      ? chosen
      : firstLook(species, gender);
  return { species: model.species, gender: model.gender, character: model.key };
}

function firstLook(species: unknown, gender: unknown) {
  const choices = CHARACTER_MODELS.filter((model) => model.species === species);
  const available = choices.length
    ? choices
    : CHARACTER_MODELS.filter((model) => model.species === 'cro');
  return (
    available.find((choice) => choice.gender === (gender === 'male' ? 'male' : 'female')) ||
    available[0]
  );
}

export function characterModel(profile: CharacterProfile): Readonly<CharacterModel> {
  const { character } = normalizeCharacter(profile);
  return CHARACTER_MODELS.find((model) => model.key === character)!;
}

export function isCarryable(profile: CharacterProfile | null | undefined): boolean {
  return !!profile && characterModel(profile).carryable;
}
