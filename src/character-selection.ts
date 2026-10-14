import {
  CHARACTER_MODELS,
  PLAYABLE_CHARACTER_MODELS,
  characterModel,
  normalizeCharacter,
} from '../shared/characters.mjs';
import type { CharacterModel, CharacterProfile } from '../shared/types.mjs';

// One card per playable look. Humans are listed as separate female/male cards so the player
// never has to pick a species first and a gender second. The first look of a species and gender
// keeps its species-gender value (saved choices and QA selectors from before the chibi cast);
// further looks of the pair are valued by their model key.
export const cardValue = (model: Readonly<CharacterModel>) =>
  CHARACTER_MODELS.find((first) => first.species === model.species && first.gender === model.gender)
    ?.key === model.key
    ? `${model.species}-${model.gender}`
    : model.key;

export const characterValue = (profile: CharacterProfile) => cardValue(characterModel(profile));

export function parseCharacterValue(value: unknown) {
  const text = String(value ?? '');
  if (CHARACTER_MODELS.some((model) => model.key === text))
    return normalizeCharacter({ character: text });
  // A species-gender value from before the cards carried model keys.
  const [species, gender] = text.split('-');
  return normalizeCharacter({ species, gender });
}

export function characterChoicesMarkup() {
  return `<fieldset class="character-options"><legend class="character-legend">キャラクターを選ぶ</legend><div class="character-choice-grid">${PLAYABLE_CHARACTER_MODELS.map(
    (model) => {
      const [name, variant] = model.name.split(' ');
      return `<label class="character-choice"><input type="radio" name="character" value="${cardValue(model)}" required><img class="character-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><span class="character-name"><strong>${name}</strong>${variant ? `<small>${variant}</small>` : ''}</span></label>`;
    },
  ).join('')}</div><p class="character-scroll-hint">左右にスワイプして選ぶ</p></fieldset>`;
}

export function bindCharacterSelection(form: HTMLFormElement, profile: CharacterProfile) {
  const input = form.querySelector(
    `input[name="character"][value="${characterValue(profile)}"]`,
  ) as HTMLInputElement | null;
  if (input) input.checked = true;
  const grid = form.querySelector<HTMLElement>('.character-choice-grid');
  if (!grid) return;
  // One DOM focus drives the highlight and confirmation for every input device.
  // Hover only moves the cursor; it never changes the radio value or opens a step.
  // Rebinding the setup form replaces this handler instead of accumulating listeners.
  let lastPointer: { x: number; y: number } | null = null;
  grid.onpointermove = (event) => {
    if (event.pointerType === 'touch' || event.buttons !== 0) return;
    if (lastPointer?.x === event.clientX && lastPointer?.y === event.clientY) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    const card = (event.target as Element).closest('.character-choice');
    const target = card?.querySelector<HTMLInputElement>('input[name="character"]');
    if (target && target !== document.activeElement) target.focus({ preventScroll: true });
  };
}
