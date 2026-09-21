import { CHARACTER_MODELS, normalizeCharacter } from '../shared/characters.mjs';
import type { CharacterProfile } from '../shared/types.mjs';

// One card per playable look. Humans are listed as separate female/male cards so
// the player never has to pick a species first and a gender second.
export const characterValue = (profile: CharacterProfile) => {
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
      return `<label class="character-choice"><input type="radio" name="character" value="${model.species}-${model.gender}" required><img class="character-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><span class="character-name"><strong>${name}</strong>${variant ? `<small>${variant}</small>` : ''}</span></label>`;
    },
  ).join('')}</div></fieldset>`;
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
