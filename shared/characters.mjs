export const CHARACTER_MODELS = Object.freeze([
  Object.freeze({ species: 'cro', gender: 'female', key: 'cro-magnon-woman', name: 'クロマニョン人 女性' }),
  Object.freeze({ species: 'cro', gender: 'male', key: 'cro-magnon-hunter', name: 'クロマニョン人 男性' }),
  Object.freeze({ species: 'nea', gender: 'female', key: 'neanderthal-woman', name: 'ネアンデルタール人 女性' }),
  Object.freeze({ species: 'nea', gender: 'male', key: 'neanderthal-hunter', name: 'ネアンデルタール人 男性' }),
  Object.freeze({ species: 'cat', gender: 'female', key: 'cat-kunoichi', name: '猫耳のクノイチ', weapon: 'katana', height: 1.68, radius: .32 }),
  Object.freeze({ species: 'bear', gender: 'female', key: 'floppy-ear-mage', name: '垂れ耳の魔法使い', weapon: 'magic', height: .78, radius: .28, walkSpeed: .6, runSpeed: 1.8 }),
]);

// Missing choices (including profiles saved before gender existed) start female.
export function normalizeCharacter({ species, gender } = {}) {
  if (species === 'cat' || species === 'bear') return { species, gender: 'female' };
  return { species: species === 'nea' ? 'nea' : 'cro', gender: gender === 'male' ? 'male' : 'female' };
}

export function characterModel(profile) {
  const { species, gender } = normalizeCharacter(profile);
  return CHARACTER_MODELS.find(model => model.species === species && model.gender === gender);
}
