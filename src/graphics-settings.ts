import {
  GRAPHICS_KEY,
  GRAPHICS_LABELS,
  graphicsMode,
  readGraphicsMode,
  type GraphicsMode,
} from './graphics-quality.js';

export function graphicsSettingsMarkup() {
  const selected = readGraphicsMode();
  return `<div class="settings-item graphics-setting"><div><strong>画質</strong></div><div class="settings-buttons" role="group" aria-label="画質">${Object.entries(
    GRAPHICS_LABELS,
  )
    .map(
      ([id, label]) =>
        `<button type="button" class="button button-outline" data-graphics="${id}" aria-pressed="${selected === id}">${label}</button>`,
    )
    .join('')}</div></div>`;
}

export function bindGraphicsSettings(root: HTMLElement, change: (mode: GraphicsMode) => void) {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-graphics]'))
    button.onclick = () => {
      const mode = graphicsMode(button.dataset.graphics);
      try {
        localStorage.setItem(GRAPHICS_KEY, mode);
      } catch {
        /* Session controls still work. */
      }
      change(mode);
      for (const option of root.querySelectorAll<HTMLElement>('[data-graphics]'))
        option.setAttribute('aria-pressed', String(option.dataset.graphics === mode));
    };
}
