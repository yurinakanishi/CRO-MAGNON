import { characterModel } from '../shared/characters.mjs';
import { spawnSite } from '../shared/spawn-sites.mjs';
import { spawnCardsMarkup } from './spawn-picker.js';
import { parseCharacterValue } from './character-selection.js';

/**
 * Character cards and colours only edit the first draft screen. Companions come next.
 * The retained exhibition flow asks for a starting sight after the companion button.
 */

interface SetupFlowOptions {
  form: HTMLFormElement;
  characterForm: HTMLFormElement;
  /** True when the room lets the visitor choose a starting sight instead. */
  spawnChoice?: () => boolean;
  /** Starting sight to preselect (the visitor's last choice). */
  spawn?: () => string;
  /** Called after focus moves, so the controller does not reuse the press that got here. */
  settle?: () => void;
}

let current: SetupFlowOptions | null = null;

const hiddenSpawn = (form: HTMLFormElement) =>
  form.querySelector<HTMLInputElement>('input[name="spawn"]');

const overlay = (form: HTMLFormElement) => form.querySelector<HTMLElement>('#setup-flow');

const pickedCard = (form: HTMLFormElement) =>
  form.querySelector<HTMLInputElement>('input[name="character"]:checked');

export function setupFlowOpen(): boolean {
  return !!current && !!overlay(current.form);
}

/** Steps back one screen; returns false when no flow screen is open. */
export function setupFlowBack(): boolean {
  if (!current) return false;
  const { form } = current;
  const flow = overlay(form);
  if (!flow) return false;
  flow.remove();
  form.querySelector<HTMLElement>('#mascot-start')?.focus({ preventScroll: true });
  current.settle?.();
  return true;
}

export function closeSetupFlow() {
  if (!current) return;
  overlay(current.form)?.remove();
}

function openSpawn() {
  if (!current) return;
  const card = pickedCard(current.characterForm);
  if (!card) return;
  const model = characterModel(parseCharacterValue(card.value));
  const [name, variant] = model.name.split(' ');
  renderSpawn(`${name}${variant ? ` ${variant}` : ''}`);
}

function renderSpawn(who: string) {
  if (!current) return;
  const { form } = current;
  const picked = spawnSite(hiddenSpawn(form)?.value || current.spawn?.()).id;
  overlay(form)?.remove();
  form.insertAdjacentHTML(
    'beforeend',
    `<div id="setup-flow" class="setup-flow" role="dialog" aria-modal="true" aria-labelledby="setup-flow-title" data-focus-scope data-step="spawn"><div class="spawn-picker"><p class="setup-flow-eyebrow">${who}</p><h3 id="setup-flow-title">どこから はじめますか？</h3><div class="spawn-grid" role="group" aria-label="はじめる場所">${spawnCardsMarkup(picked)}</div></div></div>`,
  );
  const flow = overlay(form)!;
  flow.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target === flow) {
      setupFlowBack();
      return;
    }
    // The card is the submit button: record the sight before the form submits.
    const choice = target.closest<HTMLButtonElement>('[data-choose-spawn]');
    const input = hiddenSpawn(form);
    if (choice && input) input.value = spawnSite(choice.dataset.chooseSpawn).id;
  };
  flow
    .querySelector<HTMLElement>(`[data-choose-spawn="${picked}"]`)
    ?.focus({ preventScroll: true });
  current.settle?.();
}

/** Wires the card grid of `form`; safe to call once per page. */
export function bindSetupFlow(options: SetupFlowOptions) {
  current = options;
  const { form } = options;
  if (!hiddenSpawn(form))
    form.insertAdjacentHTML('afterbegin', '<input type="hidden" name="spawn">');
  form.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#mascot-start') && options.spawnChoice?.()) {
      event.preventDefault();
      if (form.reportValidity()) openSpawn();
    }
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay(form)) {
      event.preventDefault();
      event.stopPropagation();
      setupFlowBack();
    }
  });
  options.characterForm.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target.matches('input[name="name"],input[name="room"]')) {
      // Enter in a text field moves on to the cards instead of submitting nothing.
      event.preventDefault();
      target.blur();
      (
        pickedCard(options.characterForm) ??
        options.characterForm.querySelector<HTMLElement>('input[name="character"]')
      )?.focus({
        preventScroll: true,
      });
    }
  });
}
