import { icon } from './icons.js';
import { getLanguage, onLanguageChange, type Language } from './language.js';
import { setLocalizedText } from './language-ui.js';

/**
 * Share buttons for the published game: X, Instagram, Facebook and a copied link
 * (user request 2026-10-24). The title and the loading cave show four small marks;
 * during play they wait in the menu's シェア tab and never sit on the HUD. They always
 * share the public page in the visitor's language, never a local, LAN or room address,
 * and builds that never link out (exhibition, LAN) show none.
 */

export type ShareTarget = 'x' | 'instagram' | 'facebook' | 'copy';
export const SHARE_TARGETS: readonly ShareTarget[] = ['x', 'instagram', 'facebook', 'copy'];

/** The game's public address (README): its own domain, not the retained workers.dev URL. */
export const PUBLIC_PAGE = 'https://cromagnonmmo.com/';
const INSTAGRAM = 'https://www.instagram.com/';
const TEXT: Readonly<Record<Language, string>> = {
  ja: 'CRO-MAGNON MMO — 原始の世界を自由に冒険。',
  en: 'CRO-MAGNON MMO — Explore a prehistoric world.',
};
const LABELS: Readonly<Record<ShareTarget, string>> = {
  x: 'Xでポスト',
  instagram: 'Instagramでシェア',
  facebook: 'Facebookでシェア',
  copy: 'リンクをコピー',
};
export const SHARE_COPIED = 'リンクをコピーしました';
export const SHARE_INSTAGRAM_COPIED = 'リンクをコピーしました。Instagramに貼り付けてください。';
const copyFailed = (page: string) => `リンクをコピーできませんでした：${page}`;

const mark = (paths: string, line = false) =>
  `<svg class="share-mark" viewBox="0 0 24 24" ${line ? 'fill="none" stroke="currentColor" stroke-width="2"' : 'fill="currentColor"'} aria-hidden="true" focusable="false">${paths}</svg>`;
const MARKS: Readonly<Record<ShareTarget, string>> = {
  x: mark(
    '<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.44h2.039L6.487 3.24H4.3l13.31 17.353Z"/>',
  ),
  instagram: mark(
    '<rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>',
    true,
  ),
  facebook: mark(
    '<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z"/>',
  ),
  copy: icon('link', 'share-mark'),
};

/** The public page in `language`, whatever address this page itself was opened from. */
export function sharePage(language: Language): string {
  return language === 'en' ? `${PUBLIC_PAGE}en/` : PUBLIC_PAGE;
}

export function shareText(language: Language): string {
  return TEXT[language];
}

/** X's composer or Facebook's sharer for `page`; Facebook reads the page's own OG text. */
export function shareHref(target: 'x' | 'facebook', page: string, text: string): string {
  return target === 'x'
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`
    : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(page)}`;
}

/** Four round marks (`compact`: the title and the loading cave), or labelled buttons. */
export function shareLinksMarkup(compact: boolean, language: Language = getLanguage()): string {
  const page = sharePage(language);
  const text = shareText(language);
  const controls = SHARE_TARGETS.map((target) => {
    const body = compact ? MARKS[target] : `${MARKS[target]}<span>${LABELS[target]}</span>`;
    const name = compact ? ` aria-label="${LABELS[target]}" title="${LABELS[target]}"` : '';
    return target === 'x' || target === 'facebook'
      ? `<a class="share-link" data-share="${target}" href="${shareHref(target, page, text).replaceAll('&', '&amp;')}" target="_blank" rel="noopener noreferrer"${name}>${body}</a>`
      : `<button type="button" class="share-link" data-share="${target}"${name}>${body}</button>`;
  }).join('');
  return `<div class="share-links ${compact ? 'share-compact' : 'share-panel'}" role="group" aria-label="シェア">${controls}<p class="share-status" role="status"></p></div>`;
}

/** The menu's シェア tab: the labelled buttons and the address they share. */
export function sharePanelMarkup(language: Language = getLanguage()): string {
  return `${shareLinksMarkup(false, language)}<p class="share-address" translate="no">${sharePage(language)}</p>`;
}

const statusTimers = new WeakMap<Element, number>();

function showStatus(group: Element | null, message: string) {
  const line = group?.querySelector<HTMLElement>('.share-status');
  if (!line) return;
  setLocalizedText(line, message);
  clearTimeout(statusTimers.get(line));
  statusTimers.set(
    line,
    window.setTimeout(() => setLocalizedText(line, ''), 3200),
  );
}

/** Writes `text` to the clipboard; without the clipboard API a selected field is copied. */
async function copyText(text: string, group: Element): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Inside the group, so a modal menu's field can still take focus.
    const before = document.activeElement as HTMLElement | null;
    const field = document.createElement('textarea');
    field.className = 'share-copy-field';
    field.value = text;
    field.readOnly = true;
    group.append(field);
    field.focus({ preventScroll: true });
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
      before?.focus({ preventScroll: true });
    }
  }
}

async function copyPage(group: Element, page: string) {
  showStatus(group, (await copyText(page, group)) ? SHARE_COPIED : copyFailed(page));
}

/** Instagram has no address that posts a link: a phone offers it in its share sheet;
 * elsewhere the link is copied for pasting and Instagram opens in a new tab. */
async function shareToInstagram(group: Element, page: string, text: string) {
  if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'CRO-MAGNON MMO', text, url: page });
      return;
    } catch (error) {
      // Closed without sharing; any other refusal copies the link instead.
      if ((error as DOMException | null)?.name === 'AbortError') return;
    }
  }
  const copied = await copyText(page, group);
  window.open(INSTAGRAM, '_blank', 'noopener,noreferrer');
  showStatus(group, copied ? SHARE_INSTAGRAM_COPIED : copyFailed(page));
}

/** Handles every share control inside `root`, including ones added later, until `signal`
 * aborts. Links follow a language switch, so a copied link address matches it too. */
export function bindShareLinks(root: Element, signal?: AbortSignal): void {
  const links = () => {
    const page = sharePage(getLanguage());
    const text = shareText(getLanguage());
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-share]'))
      link.href = shareHref(link.dataset.share as 'x' | 'facebook', page, text);
  };
  const stop = onLanguageChange(links);
  signal?.addEventListener('abort', stop, { once: true });
  root.addEventListener(
    'click',
    (event) => {
      const control = (event.target as Element | null)?.closest<HTMLElement>('[data-share]');
      if (!control || !root.contains(control)) return;
      const group = control.closest('.share-links')!;
      const target = control.dataset.share as ShareTarget;
      const page = sharePage(getLanguage());
      // X and Facebook are ordinary links that open in a new tab.
      if (target === 'x' || target === 'facebook') links();
      else if (target === 'copy') void copyPage(group, page);
      else void shareToInstagram(group, page, shareText(getLanguage()));
    },
    { signal },
  );
}
