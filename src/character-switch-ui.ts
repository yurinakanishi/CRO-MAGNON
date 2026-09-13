import { characterModel } from '../shared/characters.mjs';
import { characterSwitchUnavailable } from '../shared/character-switch.mjs';
import {
  characterChoicesMarkup,
  bindCharacterSelection,
  parseCharacterValue,
} from './character-selection.js';

/**
 * Picking a card asks "このキャラクターにしますか？" right away, with はい focused, instead of
 * a permanent submit button under the grid. いいえ (or ×/Escape) returns to browsing
 * with the previous choice restored.
 */
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
  const reason = !connected
    ? '接続を待っています。'
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

export function openCharacterSwitch({ openModal, player, now, connected, action, settle }) {
  openModal(
    `<form id="character-switch-form" class="character-switch"><h2>キャラクターを変える</h2><p class="modal-intro">キャラクターを選ぶと確認が出ます。今いる場所で切り替わり、もちもの・元気・進行はそのまま。</p>${characterChoicesMarkup()}</form>`,
  );
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  const current = () => form.querySelector<HTMLInputElement>('input[name="character"]:checked');
  bindCharacterSelection(form, player());
  const initial = current()?.value ?? '';
  const update = () => updateCharacterSwitch(player(), now(), connected());
  const close = () => {
    if (closeCharacterConfirm()) settle?.();
  };
  const openConfirm = (input: HTMLInputElement) => {
    const previous =
      form.querySelector<HTMLElement>('#character-confirm')?.dataset.previous ?? initial;
    form.querySelector('#character-confirm')?.remove();
    const model = characterModel(parseCharacterValue(input.value));
    const [name, variant] = model.name.split(' ');
    form.insertAdjacentHTML(
      'beforeend',
      `<div id="character-confirm" class="character-confirm" role="dialog" aria-modal="true" aria-labelledby="character-confirm-title" data-focus-scope data-value="${input.value}" data-previous="${previous}"><div class="character-confirm-card"><img class="character-confirm-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><div class="character-confirm-body"><h3 id="character-confirm-title"><strong>${name}${variant ? ` <small>${variant}</small>` : ''}</strong>にしますか？</h3><p id="character-confirm-note" class="character-confirm-note" role="status" hidden></p><div class="character-confirm-actions"><button id="character-confirm-yes" class="button button-accent" type="submit">はい</button><button id="character-confirm-no" class="button button-outline" type="button">いいえ</button></div></div></div></div>`,
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
    if (target.matches('input[name="character"]') && !form.querySelector('#character-confirm'))
      openConfirm(target as HTMLInputElement);
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
    const yes = form.querySelector<HTMLButtonElement>('#character-confirm-yes');
    if (!yes || yes.disabled) return;
    const model = characterModel(parseCharacterValue(current()?.value));
    yes.disabled = true;
    action('changeCharacter', model.key);
  };
  current()?.focus({ preventScroll: true });
}
