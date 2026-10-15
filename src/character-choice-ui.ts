import { characterModel } from '../shared/characters.mjs';
import type { CharacterProfile } from '../shared/types.mjs';
import {
  bindCharacterSelection,
  characterChoiceName,
  characterChoicesMarkup,
  parseCharacterValue,
} from './character-selection.js';
import { dyeLabelMarkup, dyePickerMarkup, pickedDye, showDye } from './dye-picker.js';
import { setLocalizedText } from './language-ui.js';
import { characterPortraitUrl } from './character-portraits.js';

/** A draft stays in this form until its apply button is pressed. */
export interface CharacterChoice {
  character: string;
  /** null means this form does not offer clothing colours. */
  dye: string | null;
}

export function characterPickerMarkup(dye: string | null, applyId: string, label = 'これにする') {
  return `${characterChoicesMarkup(dye)}<div class="character-choice-controls">${dye === null ? '' : dyePickerMarkup(dye, { choice: true })}<div class="character-choice-actions"><p class="character-choice-summary" aria-live="polite"><strong data-choice-name></strong><span data-choice-dye></span></p><button id="${applyId}" class="button button-accent" type="submit">${label}</button></div><p class="character-choice-note" role="status" hidden></p></div>`;
}

export function pickedCharacterChoice(form: HTMLFormElement): CharacterChoice {
  const picker = form.querySelector('.dye-picker[data-dye-choice]');
  return {
    character: form.querySelector<HTMLInputElement>('input[name="character"]:checked')?.value ?? '',
    dye: picker ? pickedDye(picker) : null,
  };
}

/** Shared by first entry, title re-entry and the in-game character tab. */
export function bindCharacterPicker(
  form: HTMLFormElement,
  profile: CharacterProfile & { dye?: unknown },
) {
  bindCharacterSelection(form, profile);
  const update = () => {
    const choice = pickedCharacterChoice(form);
    const name = characterChoiceName(characterModel(parseCharacterValue(choice.character)));
    setLocalizedText(form.querySelector('[data-choice-name]'), name);
    const dye = form.querySelector<HTMLElement>('[data-choice-dye]');
    if (dye) dye.innerHTML = choice.dye === null ? '' : dyeLabelMarkup(choice.dye);
    for (const image of form.querySelectorAll<HTMLImageElement>('[data-character-image]')) {
      const url = characterPortraitUrl(image.dataset.characterImage!, choice.dye);
      if (image.getAttribute('src') !== url) image.src = url;
    }
  };
  const picker = form.querySelector<HTMLElement>('.dye-picker[data-dye-choice]');
  if (picker) {
    showDye(picker, profile.dye);
    picker.onclick = (event) => {
      const swatch = (event.target as Element).closest<HTMLButtonElement>('[data-dye]');
      if (!swatch) return;
      showDye(picker, swatch.dataset.dye);
      update();
    };
  }
  form.onchange = update;
  form.onkeydown = (event) => {
    const target = event.target as HTMLElement;
    // Enter selects a card just like Space; it never submits the form implicitly.
    if (event.key === 'Enter' && target.matches('input[type="radio"]')) {
      event.preventDefault();
      target.click();
    }
  };
  update();
}
