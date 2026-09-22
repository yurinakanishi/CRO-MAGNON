import { characterModel } from '../shared/characters.mjs';
import {
  DIFFICULTIES,
  DIFFICULTY_LEVELS,
  normalizeDifficulty,
  type Difficulty,
} from '../shared/difficulty.mjs';
import { SPAWN_SITES, spawnSite } from '../shared/spawn-sites.mjs';
import { parseCharacterValue } from './character-selection.js';

/**
 * Start flow without a fixed launch button: picking a character card immediately asks
 * for the difficulty (簡単・普通・難しい only), then shows one final "これでいいですか？"
 * whose はい submits the setup form. Escape, いいえ, the backdrop and the controller's
 * cancel button each step back one screen; backing out of the difficulty step returns
 * to the card grid with the pick still highlighted.
 *
 * The exhibition build has no difficulty: the card instead asks where to begin, as a
 * grid of pictured sights, and picking one starts the game at once.
 */
type Step = 'difficulty' | 'confirm' | 'spawn';

interface SetupFlowOptions {
  form: HTMLFormElement;
  /** Difficulty to preselect when the question opens (the player's last choice). */
  difficulty: () => Difficulty;
  /** True when the room lets the visitor choose a starting sight instead. */
  spawnChoice?: () => boolean;
  /** Starting sight to preselect (the visitor's last choice). */
  spawn?: () => string;
  /** Called after focus moves, so the controller does not reuse the press that got here. */
  settle?: () => void;
}

let current: SetupFlowOptions | null = null;

const hiddenDifficulty = (form: HTMLFormElement) =>
  form.querySelector<HTMLInputElement>('input[name="difficulty"]');

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
  if (flow.dataset.step === 'confirm') {
    render('difficulty');
    return true;
  }
  flow.remove();
  pickedCard(form)?.focus({ preventScroll: true });
  current.settle?.();
  return true;
}

export function closeSetupFlow() {
  if (!current) return;
  overlay(current.form)?.remove();
}

function render(step: Step) {
  if (!current) return;
  const { form } = current;
  const card = pickedCard(form);
  if (!card) return;
  const model = characterModel(parseCharacterValue(card.value));
  const [name, variant] = model.name.split(' ');
  const difficulty = normalizeDifficulty(hiddenDifficulty(form)?.value || current.difficulty());
  if (step === 'spawn') return renderSpawn(`${name}${variant ? ` ${variant}` : ''}`);
  const who = `<p class="setup-flow-eyebrow">${step === 'difficulty' ? 'Character' : 'Ready'}</p><h3 id="setup-flow-title"><strong>${name}</strong>${variant ? `<small>${variant}</small>` : ''}</h3>`;
  const body =
    step === 'difficulty'
      ? `${who}<p class="setup-flow-question">難易度はどれにしますか？</p><div class="setup-flow-choices" role="group" aria-label="難易度">${DIFFICULTY_LEVELS.map(
          (id) =>
            `<button type="button" class="button ${id === difficulty ? 'button-accent' : 'button-outline'}" data-choose-difficulty="${id}" aria-pressed="${id === difficulty}">${DIFFICULTIES[id].label}</button>`,
        ).join('')}</div>`
      : `${who}<p class="setup-flow-summary"><span>難易度</span><strong>${DIFFICULTIES[difficulty].label}</strong></p><p class="setup-flow-question">これでいいですか？</p><div class="character-confirm-actions"><button id="setup-flow-yes" class="button button-accent" type="submit">はい</button><button id="setup-flow-no" class="button button-outline" type="button">いいえ</button></div>`;
  overlay(form)?.remove();
  form.insertAdjacentHTML(
    'beforeend',
    `<div id="setup-flow" class="character-confirm setup-flow" role="dialog" aria-modal="true" aria-labelledby="setup-flow-title" data-focus-scope data-step="${step}"><div class="character-confirm-card"><img class="character-confirm-art" src="/models/${model.key}/portrait.png" width="420" height="480" alt="" draggable="false"><div class="character-confirm-body">${body}</div></div></div>`,
  );
  const flow = overlay(form)!;
  flow.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target === flow) {
      setupFlowBack();
      return;
    }
    const choice = target.closest<HTMLButtonElement>('[data-choose-difficulty]');
    if (choice) {
      const input = hiddenDifficulty(form);
      if (input) input.value = normalizeDifficulty(choice.dataset.chooseDifficulty);
      render('confirm');
    } else if (target.closest('#setup-flow-no')) setupFlowBack();
  };
  const first =
    step === 'difficulty'
      ? flow.querySelector<HTMLElement>(`[data-choose-difficulty="${difficulty}"]`)
      : flow.querySelector<HTMLElement>('#setup-flow-yes');
  first?.focus({ preventScroll: true });
  current.settle?.();
}

function renderSpawn(who: string) {
  if (!current) return;
  const { form } = current;
  const picked = spawnSite(hiddenSpawn(form)?.value || current.spawn?.()).id;
  overlay(form)?.remove();
  form.insertAdjacentHTML(
    'beforeend',
    `<div id="setup-flow" class="character-confirm setup-flow" role="dialog" aria-modal="true" aria-labelledby="setup-flow-title" data-focus-scope data-step="spawn"><div class="spawn-picker"><p class="setup-flow-eyebrow">${who}</p><h3 id="setup-flow-title">どこから はじめますか？</h3><div class="spawn-grid" role="group" aria-label="はじめる場所">${SPAWN_SITES.map(
      (site) =>
        `<button type="submit" class="spawn-card" data-choose-spawn="${site.id}" aria-pressed="${site.id === picked}"><img src="/spawn/${site.id}.jpg" width="640" height="360" alt="" draggable="false"><strong>${site.name}</strong><small>${site.blurb}</small></button>`,
    ).join('')}</div></div></div>`,
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
  if (!hiddenDifficulty(form))
    form.insertAdjacentHTML('afterbegin', '<input type="hidden" name="difficulty">');
  if (!hiddenSpawn(form))
    form.insertAdjacentHTML('afterbegin', '<input type="hidden" name="spawn">');
  const open = () => {
    const input = hiddenDifficulty(form);
    if (input) input.value = normalizeDifficulty(options.difficulty());
    // The name and room fields are validated before the questions start.
    if (!form.reportValidity()) return;
    render(options.spawnChoice?.() ? 'spawn' : 'difficulty');
  };
  form.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('input[name="character"]') && !overlay(form)) open();
  });
  form.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && overlay(form)) {
      event.preventDefault();
      event.stopPropagation();
      setupFlowBack();
    } else if (event.key === 'Enter' && target.matches('input[type="radio"]')) {
      event.preventDefault();
      target.click();
    } else if (event.key === 'Enter' && target.matches('input[name="name"],input[name="room"]')) {
      // Enter in a text field moves on to the cards instead of submitting nothing.
      event.preventDefault();
      (pickedCard(form) ?? form.querySelector<HTMLElement>('input[name="character"]'))?.focus({
        preventScroll: true,
      });
    }
  });
}
