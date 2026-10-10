import { icon } from './icons.js';
import { contributorsDialogMarkup } from './title-credits.js';
import { BUILD_PROFILE } from './build-profile.js';
import type { MultiplayerConfig } from './multiplayer-config.js';
import { ScreenManager } from './screens.js';

/**
 * The title before the game module: the same title screen and dialog the game
 * renders, working from modules that load no 3D or world data. The game module
 * (main.ts) takes the shell once: it adopts the same title and dialog nodes, and
 * performs the visitor's last pending title action once (TitleHandoff). Without a
 * shell (a direct main.js import, ?autostart=1) main.ts renders its own title.
 */

export const GAME_TITLE = 'CRO-MAGNON MMO';
export const titleArtPath = '/title/cro-magnon-mmo-transparent.webp';

export function titleScreenMarkup(): string {
  return `<section id="screen-title" class="screen title-screen" data-variant="classic" hidden>
        <div class="title-content">
          <div class="title-hero">
          <div class="title-logo" style="--title-art: url('${titleArtPath}')"><h1>${GAME_TITLE}</h1><img class="title-art" src="${titleArtPath}" width="1536" height="1024" alt="${GAME_TITLE} — 氷河時代の旅人たちとマンモス" fetchpriority="high"></div>
          <div class="title-welcome">
          <nav class="title-menu" aria-label="タイトルメニュー">
            <button id="title-start" class="menu-item">はじめる</button>
            <button id="title-contributors" class="menu-item">関わってくれた人たち</button>
          </nav>
          </div>
          </div>
        </div>
        <button id="title-fullscreen" class="title-fullscreen" type="button" aria-label="全画面表示" aria-pressed="false">${icon('expand')}</button>
        <div class="title-footer"><span>v0.1</span></div>
      </section>`;
}

export function modalMarkup(): string {
  return `<dialog id="modal"><div class="modal-top"><span class="eyebrow">${GAME_TITLE}</span><button id="modal-close" class="button button-outline modal-back" type="button">戻る</button></div><div id="modal-body"></div></dialog>`;
}

/** The game's rule (main.ts onlineTitle): exhibition and LAN titles never link out. */
export function titleLinks(config: Pick<MultiplayerConfig, 'mode'>): boolean {
  return config.mode !== 'lan' && BUILD_PROFILE.environment !== 'exhibition';
}

/** A title action that needs the game module: performed once by main.ts. */
export type TitleIntent = 'start' | 'contributors-cave';

export type TitleStatus =
  | { kind: 'busy' }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string }
  | null;

export interface TitleNodes {
  /** The shell's viewport section, replaced by the game's. */
  viewport: HTMLElement;
  /** #screen-title, already detached: the game inserts it into its #screens. */
  title: HTMLElement;
  /** #modal, left in place (an open modal dialog keeps its state). */
  dialog: HTMLDialogElement;
}

export interface TitleHandoff extends TitleNodes {
  /** The visitor's last pending action; null when the contributors dialog is open. */
  intent: TitleIntent | null;
  /** The contributors dialog is open: the game binds its cave-visit button. */
  contributorsOpen: boolean;
}

/** What the session needs from the page (a fake in tests). */
export interface TitleShellView {
  status(status: TitleStatus): void;
  openContributors(links: boolean): void;
  closeContributors(): void;
  contributorsOpen(): boolean;
  /** Remove every shell listener and the shell's screen handling; detach the title. */
  release(): TitleNodes;
}

export const TITLE_BUSY = '準備しています…';

/** The title's state until the game module takes it: the pending action, a failure
 * that stops the game from loading, and the single handoff. */
export class TitleShellSession {
  private pending: TitleIntent | null = null;
  private failure: string | null = null;
  private actions = 0;
  private handedOff = false;

  constructor(
    private readonly view: TitleShellView,
    /** The one configuration request; main.ts awaits this promise too. */
    readonly config: Promise<MultiplayerConfig>,
  ) {
    // Observed here; the boot and main.ts report a rejection.
    config.catch(() => {});
  }

  get taken(): boolean {
    return this.handedOff;
  }

  get intent(): TitleIntent | null {
    return this.pending;
  }

  get failed(): boolean {
    return this.failure !== null;
  }

  start(): void {
    this.act('start');
  }

  /** The dialog's cave visit: the dialog closes and the game performs the visit. */
  visitCave(): void {
    if (this.handedOff) return;
    this.view.closeContributors();
    this.act('contributors-cave');
  }

  /** The credits need only the configuration (whether profiles may link out). */
  async contributors(): Promise<void> {
    if (this.handedOff) return;
    const action = ++this.actions;
    const links = await this.config.then(titleLinks, () => false);
    // A later title action or the handoff supersedes this one.
    if (this.handedOff || action !== this.actions) return;
    this.pending = null;
    this.view.status(this.failure ? { kind: 'error', message: this.failure } : null);
    this.view.openContributors(links);
  }

  /** A message that does not replace a pending or failed start (fullscreen refused). */
  notice(message: string): void {
    if (this.handedOff || this.pending || this.failure) return;
    this.view.status({ kind: 'notice', message });
  }

  /** The game cannot load: the title stays usable and offers a reload. */
  fail(message: string): void {
    if (this.handedOff) return;
    this.failure = message;
    this.view.status({ kind: 'error', message });
  }

  /** The game module takes the title, once; later calls return null. */
  take(): TitleHandoff | null {
    if (this.handedOff) return null;
    this.handedOff = true;
    this.actions++;
    const contributorsOpen = this.view.contributorsOpen();
    const intent = contributorsOpen ? null : this.pending;
    this.pending = null;
    this.view.status(null);
    return { ...this.view.release(), intent, contributorsOpen };
  }

  private act(intent: TitleIntent) {
    if (this.handedOff) return;
    this.actions++;
    this.pending = intent;
    this.view.status(this.failure ? { kind: 'error', message: this.failure } : { kind: 'busy' });
  }
}

let session: TitleShellSession | null = null;

/** The shell's configuration request while the shell waits for the game, else null. */
export function titleShellConfig(): Promise<MultiplayerConfig> | null {
  return session && !session.taken ? session.config : null;
}

/** A shell title is on screen and not yet taken by the game. */
export function titleShellShown(): boolean {
  return !!session && !session.taken;
}

/** For main.ts: take the shell's nodes and pending action, once. */
export function takeTitleShell(): TitleHandoff | null {
  return session?.take() ?? null;
}

async function toggleFullscreen(current: TitleShellSession) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    current.notice('この画面では全画面表示を利用できません。');
  }
}

/** Render the title into #app and handle it until the game module takes it. */
export function renderTitleShell(
  app: HTMLElement,
  config: Promise<MultiplayerConfig>,
): TitleShellSession {
  if (session) throw new Error('The title shell is already shown');
  // The game's rule for its touch layout, applied before the first paint.
  document.body.classList.toggle(
    'touch-mode',
    navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches,
  );
  app.innerHTML = `
  <section class="game-viewport" aria-label="${GAME_TITLE} ゲーム画面">
    <div id="screens" class="screens">
      ${titleScreenMarkup()}
    </div>
  </section>
  ${modalMarkup()}`;
  const viewport = app.querySelector<HTMLElement>('.game-viewport')!;
  const title = viewport.querySelector<HTMLElement>('#screen-title')!;
  const dialog = app.querySelector<HTMLDialogElement>('#modal')!;
  const events = new AbortController();
  const signal = events.signal;
  const screens = new ScreenManager(viewport.querySelector<HTMLElement>('#screens')!, () => {});
  let current: TitleShellSession;

  const view: TitleShellView = {
    status(status) {
      title.querySelector('[data-title-status]')?.remove();
      title.querySelector('[data-title-reload]')?.remove();
      if (!status) return;
      const line = document.createElement('p');
      line.dataset.titleStatus = status.kind;
      line.className = status.kind === 'error' ? 'form-error' : 'form-note';
      line.setAttribute('role', status.kind === 'error' ? 'alert' : 'status');
      line.textContent = status.kind === 'busy' ? TITLE_BUSY : status.message;
      title.querySelector('.title-welcome')!.append(line);
      if (status.kind !== 'error') return;
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.className = 'menu-item';
      reload.dataset.titleReload = '';
      reload.textContent = '再読み込み';
      reload.addEventListener('click', () => location.reload(), { signal });
      title.querySelector('.title-menu')!.append(reload);
    },
    openContributors(links) {
      dialog.querySelector('#modal-body')!.innerHTML = contributorsDialogMarkup(undefined, {
        links,
      });
      if (!dialog.open) dialog.showModal();
      const visit = dialog.querySelector<HTMLButtonElement>('#contributors-cave')!;
      visit.addEventListener(
        'click',
        () => {
          if (visit.disabled) return;
          visit.disabled = true;
          current.visitCave();
        },
        { signal },
      );
    },
    closeContributors() {
      dialog.close();
    },
    contributorsOpen() {
      return dialog.open;
    },
    release() {
      events.abort();
      screens.destroy();
      title.remove();
      return { viewport, title, dialog };
    },
  };
  current = session = new TitleShellSession(view, config);

  const on = (selector: string, listener: () => void) =>
    title.querySelector(selector)!.addEventListener('click', listener, { signal });
  on('#title-start', () => current.start());
  on('#title-contributors', () => void current.contributors());
  on('#title-fullscreen', () => void toggleFullscreen(current));
  document.addEventListener(
    'fullscreenchange',
    () => {
      const active = !!document.fullscreenElement;
      const button = title.querySelector('#title-fullscreen')!;
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? '全画面表示を終了' : '全画面表示');
    },
    { signal },
  );
  dialog.querySelector('#modal-close')!.addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener(
    'click',
    (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    },
    { signal },
  );
  screens.show('title');
  return current;
}
