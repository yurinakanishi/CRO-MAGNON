import { controllerLabels } from './controller-labels.js';
/**
 * Full-screen game screens (title, setup) shown over the 3D world,
 * plus the small pieces that make the HUD feel like a game: the area banner
 * shown when the player enters a new place and the button-prompt bar.
 */
import { adjacentMenuItem, menuItems, menuKeyDirection } from './menu-navigation.js';

export type ScreenId = 'title' | 'setup';

export interface KeyPrompt {
  key: string;
  label: string;
}

/**
 * The bottom-right bar only keeps the exhibition map shortcut.
 * Menu controls remain available without a persistent HUD prompt.
 */
export function keyPrompts(_gamepad: boolean, exhibition = false): KeyPrompt[] {
  return exhibition ? [{ key: controllerLabels().map, label: '地図' }] : [];
}

/** Shows and hides the full-screen game screens; one screen is visible at a time. */
export class ScreenManager {
  private current: ScreenId | null = null;

  constructor(
    private root: HTMLElement,
    private onChange: (id: ScreenId | null) => void,
  ) {
    document.addEventListener('keydown', this.keydown);
    window.visualViewport?.addEventListener('resize', this.viewportChanged);
    window.visualViewport?.addEventListener('scroll', this.viewportChanged);
  }

  get active(): ScreenId | null {
    return this.current;
  }

  element(id: ScreenId): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`#screen-${id}`);
  }

  activeElement(): HTMLElement | null {
    return this.current ? this.element(this.current) : null;
  }

  show(id: ScreenId): void {
    for (const screen of this.root.querySelectorAll<HTMLElement>('.screen'))
      screen.hidden = screen.id !== `screen-${id}`;
    this.current = id;
    this.root.classList.add('active');
    document.body.dataset.screen = id;
    this.onChange(id);
    this.viewportChanged();
    // Let a phone user choose a card before opening the software keyboard.
    if (document.body.classList.contains('touch-mode')) {
      const screen = this.element(id);
      if (screen) {
        screen.tabIndex = -1;
        screen.focus({ preventScroll: true });
      }
      return;
    }
    const items = this.items(id);
    (items.find((el) => el.hasAttribute('autofocus')) ?? items[0])?.focus({ preventScroll: true });
  }

  hide(): void {
    for (const screen of this.root.querySelectorAll<HTMLElement>('.screen')) screen.hidden = true;
    this.current = null;
    this.root.classList.remove('active');
    delete document.body.dataset.screen;
    this.root.style.removeProperty('--screen-height');
    this.root.style.removeProperty('--screen-top');
    delete this.root.dataset.compact;
    this.onChange(null);
  }

  private viewportChanged = () => {
    if (!this.current) return;
    const viewport = window.visualViewport;
    const height = viewport?.height ?? window.innerHeight;
    this.root.style.setProperty('--screen-height', `${height}px`);
    this.root.style.setProperty('--screen-top', `${viewport?.offsetTop ?? 0}px`);
    this.root.dataset.compact = String(height < 440);
  };

  /** Focusable controls of a screen, skipping hidden ones such as an unavailable "continue". */
  private items(id: ScreenId): HTMLElement[] {
    const screen = this.element(id);
    return screen ? menuItems(screen) : [];
  }

  private keydown = (event: KeyboardEvent) => {
    if (!this.current || document.querySelector('dialog[open]')) return;
    const direction = menuKeyDirection(event);
    if (!direction) return;
    event.preventDefault();
    const next = adjacentMenuItem(
      this.items(this.current),
      document.activeElement as HTMLElement,
      direction,
    );
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  destroy(): void {
    document.removeEventListener('keydown', this.keydown);
    window.visualViewport?.removeEventListener('resize', this.viewportChanged);
    window.visualViewport?.removeEventListener('scroll', this.viewportChanged);
  }
}

/** Cinematic place name that fades in when the player reaches a new area. */
export class AreaBanner {
  private timer = 0;
  private last = '';

  constructor(private element: HTMLElement) {}

  /** Shows the banner once per distinct area; `reset` makes the next update show again. */
  update(eyebrow: string, name: string): void {
    if (name === this.last) return;
    this.last = name;
    this.element.querySelector('small')!.textContent = eyebrow;
    this.element.querySelector('strong')!.textContent = name;
    this.element.hidden = false;
    this.element.classList.remove('visible');
    void this.element.offsetWidth;
    this.element.classList.add('visible');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.element.classList.remove('visible');
      this.element.hidden = true;
    }, 3800);
  }

  reset(): void {
    this.last = '';
    clearTimeout(this.timer);
    this.element.hidden = true;
    this.element.classList.remove('visible');
  }
}
