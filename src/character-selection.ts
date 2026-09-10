import { CHARACTER_MODELS, normalizeCharacter } from '../shared/characters.mjs';

// One card per playable look. Humans are listed as separate female/male cards so
// the player never has to pick a species first and a gender second.
export const characterValue = (profile) => {
  const { species, gender } = normalizeCharacter(profile);
  return `${species}-${gender}`;
};

export function parseCharacterValue(value: unknown) {
  const [species, gender] = String(value ?? '').split('-');
  return normalizeCharacter({ species, gender });
}

export function characterChoicesMarkup() {
  return `<fieldset class="character-options"><legend class="character-legend">キャラクターを選ぶ</legend><div class="character-choice-grid">${CHARACTER_MODELS.map(
    (model) => {
      const [name, variant] = model.name.split(' ');
      return `<label class="character-choice"><input type="radio" name="character" value="${model.species}-${model.gender}" required><img class="character-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><span class="character-name"><strong>${name}</strong>${variant ? `<small>${variant}</small>` : ''}</span><i class="character-check" aria-hidden="true"></i></label>`;
    },
  ).join('')}</div></fieldset>`;
}

export function bindCharacterSelection(form, profile) {
  const input = form.querySelector(
    `input[name="character"][value="${characterValue(profile)}"]`,
  ) as HTMLInputElement | null;
  if (input) input.checked = true;
}
