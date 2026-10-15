import { characterModel } from '../shared/characters.mjs';
import { characterSwitchUnavailable } from '../shared/character-switch.mjs';
import { normalizeDye } from '../shared/clothing-dye.mjs';
import { characterValue, parseCharacterValue } from './character-selection.js';
import {
  bindCharacterPicker,
  characterPickerMarkup,
  pickedCharacterChoice,
  type CharacterChoice,
} from './character-choice-ui.js';
import { setLocalizedText } from './language-ui.js';

/** What wearing `picked` changes, or null when it is the character and colour already worn. */
export function characterChoiceChange(
  worn: { character: string; dye: string },
  picked: CharacterChoice,
) {
  const character = picked.character !== worn.character;
  const dye = picked.dye !== null && picked.dye !== worn.dye;
  return character || dye ? { character, dye } : null;
}

export function updateCharacterSwitch(player, now, connected) {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  if (!form) return;
  const choice = pickedCharacterChoice(form);
  const model = characterModel(parseCharacterValue(choice.character));
  // Another colour on the same character is worn at any moment; another character waits.
  const reason = !connected
    ? '接続を待っています。'
    : player && characterModel(player).key === model.key
      ? ''
      : characterSwitchUnavailable(player, model, now);
  const apply = form.querySelector<HTMLButtonElement>('#character-switch-apply');
  const note = form.querySelector<HTMLElement>('.character-choice-note');
  apply.disabled = !!reason;
  setLocalizedText(note, reason);
  note.hidden = !reason;
}

export function characterSwitchMarkup(dye: string | null = null) {
  return `<form id="character-switch-form" class="character-switch"><h2>キャラクターを変える</h2><p class="modal-intro">今いる場所で切り替わり、もちもの・元気・進行はそのまま。</p>${characterPickerMarkup(dye, 'character-switch-apply')}</form>`;
}

/** Browsing changes only the draft; one apply submits its character and colour together. */
export function bindCharacterSwitch(
  { player, now, connected, action, chooseDye, done },
  focus = true,
) {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  bindCharacterPicker(form, player());
  const update = () => updateCharacterSwitch(player(), now(), connected());
  const updateChoice = form.onchange;
  form.onchange = (event) => {
    updateChoice?.call(form, event);
    update();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    update();
    const apply = form.querySelector<HTMLButtonElement>('#character-switch-apply');
    if (event.submitter !== apply || apply.disabled) return;
    const choice = pickedCharacterChoice(form);
    const me = player();
    const change = characterChoiceChange(
      { character: characterValue(me), dye: normalizeDye(me?.dye) ?? '' },
      choice,
    );
    if (!change) return done?.();
    apply.disabled = true;
    // The colour first, so a new character arrives already dressed in it.
    if (change.dye) chooseDye?.(choice.dye);
    if (change.character)
      action('changeCharacter', characterModel(parseCharacterValue(choice.character)).key);
    else done?.();
  };
  update();
  if (focus)
    form
      .querySelector<HTMLInputElement>('input[name="character"]:checked')
      ?.focus({ preventScroll: true });
}
