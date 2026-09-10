import { characterModel } from '../shared/characters.mjs';
import { characterSwitchUnavailable } from '../shared/character-switch.mjs';
import {
  characterChoicesMarkup,
  bindCharacterSelection,
  parseCharacterValue,
} from './character-selection.js';

export function updateCharacterSwitch(player, now, connected) {
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  if (!form) return;
  const selected = form.querySelector<HTMLInputElement>('input[name="character"]:checked');
  const model = selected ? characterModel(parseCharacterValue(selected.value)) : null;
  const reason = !connected
    ? '接続を待っています。'
    : characterSwitchUnavailable(player, model, now);
  const button = form.querySelector<HTMLButtonElement>('#character-switch-submit');
  button.disabled = !!reason;
  form.querySelector('#character-switch-status').textContent = reason;
}

export function openCharacterSwitch({ openModal, player, now, connected, action }) {
  openModal(
    `<form id="character-switch-form" class="character-switch"><h2>キャラクターを変える</h2><p class="modal-intro">今いる場所で切り替わります。もちもの・元気・進行はそのまま。</p>${characterChoicesMarkup()}<div class="character-switch-footer"><p id="character-switch-status" role="status"></p><button id="character-switch-submit" class="button button-accent wide" type="submit" disabled>このキャラクターにする</button></div></form>`,
  );
  const form = document.querySelector<HTMLFormElement>('#character-switch-form');
  bindCharacterSelection(form, player());
  const update = () => updateCharacterSwitch(player(), now(), connected());
  form.onchange = update;
  form.onkeydown = (event) => {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' && target.matches('input[type="radio"]')) {
      event.preventDefault();
      target.click();
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    update();
    const button = form.querySelector<HTMLButtonElement>('#character-switch-submit');
    if (button.disabled) return;
    const model = characterModel(parseCharacterValue(new FormData(form).get('character')));
    button.disabled = true;
    action('changeCharacter', model.key);
  };
  update();
  form.querySelector<HTMLInputElement>('input:checked')?.focus();
}
