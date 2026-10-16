import type { LoadingTip } from './loading-tips.js';

/** What the screen is loading toward: a warp's destination, or the world itself. */
export interface LoadingPlace {
  /** The action above a destination name (ワープ); empty for startup. */
  eyebrow: string;
  name: string;
}

export const LOADING_TEXT = '読み込み中';
/** Original mammoth, bison and horse painting, without the later guest characters. */
export const LOADING_MURAL = '/title/loading-mammoth-mural.webp';

/** Tips in shuffled rounds: none repeats before every other one was shown, and a
 * new round never starts with the tip that ended the last one. */
export class TipDeck {
  private order: number[] = [];
  private last = -1;

  constructor(
    private readonly tips: readonly LoadingTip[],
    private readonly random: () => number = Math.random,
  ) {
    if (!tips.length) throw new Error('A tip deck needs at least one tip');
  }

  next(): LoadingTip {
    if (!this.order.length) {
      // Drawn from the end of a Fisher–Yates shuffle.
      this.order = this.tips.map((_, index) => index);
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
      const end = this.order.length - 1;
      if (end > 0 && this.order[end] === this.last)
        [this.order[0], this.order[end]] = [this.order[end], this.order[0]];
    }
    this.last = this.order.pop()!;
    return this.tips[this.last];
  }
}

export type LoadingState = 'shown' | 'leaving' | 'hidden';

/** The page side of the cover (a fake in tests). */
export interface LoadingView {
  content(place: LoadingPlace, tip: LoadingTip): void;
  status(text: string, progress: number | null): void;
  state(state: LoadingState): void;
}

export interface LoadingClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserClock: LoadingClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export const LOADING_TIMING = Object.freeze({
  /** Long enough to read a tip; a quicker load still shows it this long. */
  minimumMs: 1500,
  /** A long load turns to the next tip. */
  tipMs: 9000,
  /** The fade-out, matched by the stylesheet. */
  fadeMs: 320,
});

/**
 * A cover over the world while it loads, like a console game's loading screen. It
 * appears at once, stays at least `minimumMs` so its tip can be read, and fades out
 * when the request that showed it is released. A newer request takes the cover over
 * (an entry followed at once by a warp keeps one screen and its tip); a long load
 * turns to the next tip every `tipMs`.
 */
export class LoadingCover {
  private request = 0;
  private visible = false;
  private leaving = false;
  private shownAt = 0;
  private place: LoadingPlace | null = null;
  private tip: LoadingTip | null = null;
  private leaveTimer: unknown = null;
  private hideTimer: unknown = null;
  private tipTimer: unknown = null;

  constructor(
    private readonly view: LoadingView,
    private readonly deck: TipDeck,
    private readonly clock: LoadingClock = browserClock,
    private readonly timing: typeof LOADING_TIMING = LOADING_TIMING,
  ) {}

  /** On screen and holding the world's input (not fading out). */
  get active(): boolean {
    return this.visible && !this.leaving;
  }

  /** Whether `request` is still the one the cover waits for. */
  current(request: number): boolean {
    return request === this.request && this.visible;
  }

  /** Cover the world for a new request, or retarget the cover already shown. */
  show(place: LoadingPlace): number {
    const request = ++this.request;
    this.stop('leave');
    if (this.leaving) {
      // A new load during the fade-out: the same tip comes back.
      this.stop('hide');
      this.leaving = false;
      this.view.state('shown');
      this.turnTips();
    }
    if (!this.visible) {
      // A fresh appearance: a new tip, and its reading time starts now.
      this.visible = true;
      this.shownAt = this.clock.now();
      this.tip = this.deck.next();
      this.view.state('shown');
      this.turnTips();
    }
    this.place = place;
    this.view.content(place, this.tip!);
    this.view.status(LOADING_TEXT, null);
    return request;
  }

  status(text: string, progress: number | null = null) {
    if (this.active) this.view.status(text, progress);
  }

  /** `request` has loaded: the cover fades once it has been up `minimumMs`. A request
   * another one replaced, or one already cancelled, changes nothing. */
  release(request: number) {
    if (!this.current(request) || this.leaving) return;
    this.stop('leave');
    const wait = Math.max(0, this.shownAt + this.timing.minimumMs - this.clock.now());
    this.leaveTimer = this.clock.setTimeout(() => this.leave(), wait);
  }

  /** Remove the cover now, whatever it waits for (leaving to the title, a failure). */
  cancel() {
    this.request++;
    this.stop('leave');
    this.stop('hide');
    this.stop('tip');
    if (!this.visible) return;
    this.visible = this.leaving = false;
    this.view.state('hidden');
  }

  private leave() {
    this.leaveTimer = null;
    this.leaving = true;
    this.stop('tip');
    this.view.state('leaving');
    this.hideTimer = this.clock.setTimeout(() => {
      this.hideTimer = null;
      this.visible = this.leaving = false;
      this.view.state('hidden');
    }, this.timing.fadeMs);
  }

  private turnTips() {
    this.stop('tip');
    this.tipTimer = this.clock.setTimeout(() => {
      this.tipTimer = null;
      if (!this.active) return;
      this.tip = this.deck.next();
      this.view.content(this.place!, this.tip);
      this.turnTips();
    }, this.timing.tipMs);
  }

  private stop(timer: 'leave' | 'hide' | 'tip') {
    const key = `${timer}Timer` as const;
    if (this[key] !== null) this.clock.clearTimeout(this[key]);
    this[key] = null;
  }
}

/** The loading tip's heading and text, fading in at each new tip. */
export function tipCard(className: string) {
  const element = document.createElement('figure');
  element.className = `loading-tip ${className}`;
  element.innerHTML = '<strong></strong><p></p>';
  return {
    element,
    show(tip: LoadingTip) {
      if (element.dataset.tip === tip.title) return;
      element.dataset.tip = tip.title;
      element.querySelector('strong')!.textContent = tip.title;
      element.querySelector('p')!.textContent = tip.text;
      element.classList.remove('turned');
      void element.offsetWidth;
      element.classList.add('turned');
    },
  };
}

/** The loading screen's elements, appended to the game viewport. */
export function loadingScreenView(parent: HTMLElement): LoadingView {
  const root = document.createElement('section');
  root.id = 'loading-screen';
  root.className = 'loading-screen';
  root.hidden = true;
  root.setAttribute('aria-label', LOADING_TEXT);
  // Four small animal groups fill a sequence; its identical copy makes the drift seamless.
  // Every image shares one URL and decoded asset, including on narrow phone screens.
  const muralSequence = `<div class="loading-mural-sequence">${'<img alt="" width="1536" height="1024" decoding="async" draggable="false">'.repeat(4)}</div>`;
  root.innerHTML = `<div class="loading-screen-art" aria-hidden="true"><div class="loading-mural-track">${muralSequence.repeat(2)}</div></div>
    <header class="loading-screen-place"><small></small><strong></strong></header>
    <div class="loading-screen-bottom">
      <div class="loading-screen-status"><span class="loading-screen-spinner" aria-hidden="true"></span><span role="status" data-loading-status>${LOADING_TEXT}</span><progress max="1" value="0" aria-label="読み込みの進み具合" hidden></progress></div>
    </div>`;
  const tip = tipCard('loading-screen-tip');
  root.querySelector('.loading-screen-bottom')!.prepend(tip.element);
  parent.append(root);
  const art = root.querySelector<HTMLElement>('.loading-screen-art')!;
  const images = art.querySelectorAll('img');
  const place = root.querySelector('.loading-screen-place')!;
  const statusText = root.querySelector<HTMLElement>('[data-loading-status]')!;
  const progress = root.querySelector('progress')!;
  images[0].addEventListener('load', () => art.classList.add('loaded'));
  return {
    content(next, nextTip) {
      place.querySelector('small')!.textContent = next.eyebrow;
      place.querySelector('small')!.hidden = !next.eyebrow;
      place.querySelector('strong')!.textContent = next.name;
      // Fetch once, when first needed; every destination shares the same looping wall.
      if (!images[0].getAttribute('src')) images.forEach((image) => (image.src = LOADING_MURAL));
      tip.show(nextTip);
    },
    status(text, value) {
      if (statusText.textContent !== text) statusText.textContent = text;
      progress.hidden = value === null;
      if (value !== null) progress.value = value;
    },
    state(state) {
      root.hidden = state === 'hidden';
      if (state === 'hidden') delete root.dataset.state;
      else root.dataset.state = state;
    },
  };
}
