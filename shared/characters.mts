import type { CharacterModel, CharacterProfile, Species, Gender } from './types.mjs';
import { CHARACTER_MODELS } from './character-profiles.mjs';
export { CHARACTER_MODELS } from './character-profiles.mjs';

// Missing choices (including profiles saved before gender existed) start female.
export function normalizeCharacter({ species, gender }: CharacterProfile = {}): {
  species: Species;
  gender: Gender;
} {
  const choices = CHARACTER_MODELS.filter((model) => model.species === species);
  const available = choices.length
    ? choices
    : CHARACTER_MODELS.filter((model) => model.species === 'cro');
  const model =
    available.find((choice) => choice.gender === (gender === 'male' ? 'male' : 'female')) ||
    available[0];
  return { species: model.species, gender: model.gender };
}

export function characterModel(profile: CharacterProfile): Readonly<CharacterModel> {
  const { species, gender } = normalizeCharacter(profile);
  return CHARACTER_MODELS.find((model) => model.species === species && model.gender === gender)!;
}

export function isCarryable(profile: CharacterProfile | null | undefined): boolean {
  return !!profile && characterModel(profile).carryable;
}
