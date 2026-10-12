import { CLOTHING_DYES, normalizeDye } from '../shared/clothing-dye.mjs';
import { setLocalizedText } from './language-ui.js';

const OWN_COLOURS = '元の色';

const dyeName = (dye: unknown) =>
  CLOTHING_DYES.find((entry) => entry.key === normalizeDye(dye))?.name ?? OWN_COLOURS;

/**
 * The clothing colours as one row of round swatches, the character's own colours first. A tap
 * dyes at once, for everyone nearby to see; there is nothing to confirm or save. The swatches
 * are large enough to tap on a phone and wrap onto a second row on a narrow screen.
 */
export function dyePickerMarkup(current: unknown) {
  const chosen = normalizeDye(current) ?? '';
  const swatch = (key: string, name: string, color?: string) =>
    `<button type="button" class="dye-swatch${color ? '' : ' dye-own'}" data-dye="${key}" aria-pressed="${chosen === key}" aria-label="${name}" title="${name}"${color ? ` style="--dye: ${color}"` : ''}></button>`;
  return `<fieldset class="dye-picker"><legend>服の色<span class="dye-name">${dyeName(current)}</span></legend><div class="dye-swatches">${swatch('', OWN_COLOURS)}${CLOTHING_DYES.map((dye) => swatch(dye.key, dye.name, dye.color)).join('')}</div></fieldset>`;
}

/** `choose` sends a dye key ('' for the own colours); the swatches follow the shared state. */
export function bindDyePickers(root: ParentNode, choose: (dye: string) => void) {
  for (const picker of root.querySelectorAll<HTMLElement>('.dye-picker'))
    picker.onclick = (event) => {
      const swatch = (event.target as Element).closest<HTMLButtonElement>('[data-dye]');
      if (!swatch || swatch.getAttribute('aria-pressed') === 'true') return;
      choose(swatch.dataset.dye ?? '');
    };
}

/** Shows the dye the room knows the player wears. */
export function updateDyePickers(current: unknown) {
  const chosen = normalizeDye(current) ?? '';
  for (const picker of document.querySelectorAll<HTMLElement>('.dye-picker')) {
    for (const swatch of picker.querySelectorAll<HTMLButtonElement>('[data-dye]')) {
      const pressed = String(swatch.dataset.dye === chosen);
      if (swatch.getAttribute('aria-pressed') !== pressed)
        swatch.setAttribute('aria-pressed', pressed);
    }
    const name = picker.querySelector('.dye-name');
    if (name) setLocalizedText(name, dyeName(current));
  }
}
