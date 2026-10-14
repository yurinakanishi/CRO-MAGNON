import { characterModel } from '../shared/characters.mjs';
import { characterSwitchUnavailable } from '../shared/character-switch.mjs';
import { normalizeDye } from '../shared/clothing-dye.mjs';
import {
  characterChoicesMarkup,
  bindCharacterSelection,
  characterValue,
  parseCharacterValue,
} from './character-selection.js';
import { dyeLabelMarkup, pickedDye, showDye } from './dye-picker.js';

/**
 * A choice is a character and, where the clothing colours are offered, a colour. The swatches
 * only pick the colour; picking a card then asks "…にしますか？" right away, with はい focused,
 * for that character in that colour. The same character in another colour is a change of its
 * own, and the character and colour already worn ask nothing. いいえ (or ×/Escape) returns to
 * browsing with the previous card restored.
 */
export interface CharacterChoice {
  /** A card's value (species-gender). */
  character: string;
  /** A dye key, '' for the character's own colours, or null where no colours are offered. */
  dye: string | null;
}

/** What wearing `picked` changes, or null when it is the character and colour already worn. */
export function characterChoiceChange(
  worn: { character: string; dye: string },
  picked: CharacterChoice,
) {
  const character = picked.character !== worn.character;
  const dye = picked.dye !== null && picked.dye !== worn.dye;
  return character || dye ? { character, dye } : null;
}

export function characterConfirmOpen() {
  return !!document.querySelector('#character-confirm');
}

export function closeCharacterConfirm(): boolean {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  const confirm = form?.querySelector<HTMLElement>('#character-confirm');
  if (!form || !confirm) return false;
  const declined = confirm.dataset.value;
  const previous = confirm.dataset.previous;
  confirm.remove();
  const restore = previous
    ? form.querySelector<HTMLInputElement>(`input[name="character"][value="${previous}"]`)
    : null;
  const card = form.querySelector<HTMLInputElement>(`input[name="character"][value="${declined}"]`);
  if (restore) restore.checked = true;
  else if (card) card.checked = false;
  card?.focus({ preventScroll: true });
  return true;
}

export function updateCharacterSwitch(player, now, connected) {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  if (!form) return;
  const confirm = form.querySelector<HTMLElement>('#character-confirm');
  if (!confirm) return;
  const model = characterModel(parseCharacterValue(confirm.dataset.value));
  // Another colour on the same character is worn at any moment; another character waits.
  const reason = !connected
    ? '接続を待っています。'
    : player && characterModel(player).key === model.key
      ? ''
      : characterSwitchUnavailable(player, model, now);
  const yes = confirm.querySelector<HTMLButtonElement>('#character-confirm-yes');
  const note = confirm.querySelector<HTMLElement>('#character-confirm-note');
  yes.disabled = !!reason;
  note.textContent = reason;
  note.hidden = !reason;
  if (yes.disabled && document.activeElement === yes)
    confirm
      .querySelector<HTMLButtonElement>('#character-confirm-no')
      ?.focus({ preventScroll: true });
}

/** `extra` comes between the introduction and the characters (the clothing colours). */
export function characterSwitchMarkup(extra = '') {
  return `<form id="character-switch-form" class="character-switch"><h2>キャラクターを変える</h2><p class="modal-intro">今いる場所で切り替わり、もちもの・元気・進行はそのまま。</p>${extra}${characterChoicesMarkup()}</form>`;
}

/**
 * `chooseDye` wears a colour; `done` leaves the menu after a new colour alone, since only a new
 * character closes it when it arrives.
 */
export function bindCharacterSwitch(
  { player, now, connected, action, settle, chooseDye, done },
  focus = true,
) {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  const current = () => form.querySelector<HTMLInputElement>('input[name="character"]:checked');
  bindCharacterSelection(form, player());
  const initial = current()?.value ?? '';
  // Only a picker beside the cards that picks without wearing adds a colour to the choice.
  const picker = form.querySelector<HTMLElement>('.dye-picker[data-dye-choice]');
  const worn = () => {
    const me = player();
    return { character: me ? characterValue(me) : initial, dye: normalizeDye(me?.dye) ?? '' };
  };
  const update = () => updateCharacterSwitch(player(), now(), connected());
  const close = () => {
    if (closeCharacterConfirm()) settle?.();
  };
  if (picker)
    picker.onclick = (event) => {
      const swatch = (event.target as Element).closest<HTMLButtonElement>('[data-dye]');
      if (swatch) showDye(picker, swatch.dataset.dye);
    };
  const openConfirm = (input: HTMLInputElement, dye: string | null) => {
    const previous =
      form.querySelector<HTMLElement>('#character-confirm')?.dataset.previous ?? initial;
    form.querySelector('#character-confirm')?.remove();
    const model = characterModel(parseCharacterValue(input.value));
    const [name, variant] = model.name.split(' ');
    form.insertAdjacentHTML(
      'beforeend',
      `<div id="character-confirm" class="character-confirm" role="dialog" aria-modal="true" aria-labelledby="character-confirm-title" data-focus-scope data-value="${input.value}" data-previous="${previous}"${dye === null ? '' : ` data-dye="${dye}"`}><div class="character-confirm-card"><img class="character-confirm-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><div class="character-confirm-body"><h3 id="character-confirm-title"><strong>${name}${variant ? ` <small>${variant}</small>` : ''}</strong>にしますか？</h3>${dye === null ? '' : `<p class="character-confirm-dye">${dyeLabelMarkup(dye)}</p>`}<p id="character-confirm-note" class="character-confirm-note" role="status" hidden></p><div class="character-confirm-actions"><button id="character-confirm-yes" class="button button-accent" type="submit">はい</button><button id="character-confirm-no" class="button button-outline" type="button">いいえ</button></div></div></div></div>`,
    );
    const confirm = form.querySelector<HTMLElement>('#character-confirm')!;
    confirm.onclick = (event) => {
      if (event.target === confirm) close();
    };
    confirm.querySelector<HTMLButtonElement>('#character-confirm-no')!.onclick = close;
    update();
    const yes = confirm.querySelector<HTMLButtonElement>('#character-confirm-yes')!;
    (yes.disabled ? confirm.querySelector<HTMLButtonElement>('#character-confirm-no') : yes)?.focus(
      {
        preventScroll: true,
      },
    );
    settle?.();
  };
  form.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('input[name="character"]') || form.querySelector('#character-confirm'))
      return;
    const input = target as HTMLInputElement;
    const dye = picker ? pickedDye(picker) : null;
    if (characterChoiceChange(worn(), { character: input.value, dye })) openConfirm(input, dye);
  };
  form.onkeydown = (event) => {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Escape' && form.querySelector('#character-confirm')) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && target.matches('input[type="radio"]')) {
      event.preventDefault();
      target.click();
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    update();
    const confirm = form.querySelector<HTMLElement>('#character-confirm');
    const yes = confirm?.querySelector<HTMLButtonElement>('#character-confirm-yes');
    if (!confirm || !yes || yes.disabled) return;
    const value = confirm.dataset.value ?? '';
    const dye = confirm.dataset.dye ?? null;
    const change = characterChoiceChange(worn(), { character: value, dye });
    if (!change) return close();
    yes.disabled = true;
    // The colour first, so a new character arrives already dressed in it.
    if (change.dye) chooseDye?.(dye);
    if (change.character) action('changeCharacter', characterModel(parseCharacterValue(value)).key);
    else done?.();
  };
  if (focus) current()?.focus({ preventScroll: true });
}
