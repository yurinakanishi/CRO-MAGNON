import type { CharacterModel, CharacterProfile, Species, Gender } from './types.mjs';
export const CHARACTER_MODELS: readonly Readonly<CharacterModel>[] = Object.freeze([
  Object.freeze({
    species: 'cro',
    gender: 'female',
    key: 'cro-magnon-woman',
    name: 'クロマニョン人 女性',
  }),
  Object.freeze({
    species: 'cro',
    gender: 'male',
    key: 'cro-magnon-hunter',
    name: 'クロマニョン人 男性',
  }),
  Object.freeze({
    species: 'nea',
    gender: 'female',
    key: 'neanderthal-woman',
    name: 'ネアンデルタール人 女性',
  }),
  Object.freeze({
    species: 'nea',
    gender: 'male',
    key: 'neanderthal-hunter',
    name: 'ネアンデルタール人 男性',
  }),
  Object.freeze({
    species: 'cat',
    gender: 'female',
    key: 'cat-kunoichi',
    name: '猫耳のクノイチ',
    weapon: 'katana',
    height: 1.68,
    radius: 0.32,
  }),
  Object.freeze({
    species: 'bear',
    gender: 'female',
    key: 'desert-fennec-mage',
    name: '砂耳の魔法使い',
    weapon: 'magic',
    height: 0.78,
    radius: 0.32,
    walkSpeed: 0.6,
    runSpeed: 1.8,
  }),
  Object.freeze({
    species: 'ape',
    gender: 'male',
    key: 'giant-ape',
    name: '巨腕の大猿',
    weapon: 'unarmed',
    height: 2,
    radius: 0.76,
    walkSpeed: 1.8,
    runSpeed: 5.4,
  }),
]);

// Missing choices (including profiles saved before gender existed) start female.
export function normalizeCharacter({ species, gender }: CharacterProfile = {}): {
  species: Species;
  gender: Gender;
} {
  if (species === 'cat' || species === 'bear') return { species, gender: 'female' };
  if (species === 'ape') return { species, gender: 'male' };
  return {
    species: species === 'nea' ? 'nea' : 'cro',
    gender: gender === 'male' ? 'male' : 'female',
  };
}

export function characterModel(profile: CharacterProfile): Readonly<CharacterModel> {
  const { species, gender } = normalizeCharacter(profile);
  return CHARACTER_MODELS.find((model) => model.species === species && model.gender === gender)!;
}
