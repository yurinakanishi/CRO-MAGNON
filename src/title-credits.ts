import {
  TITLE_CREDITS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
} from './title-credit-profiles.js';
import { CAVE_MURAL_SPOTS, CAVE_MURAL_STRIP } from './cave-mural-strip.js';
export {
  TITLE_CREDITS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
} from './title-credit-profiles.js';

/** Exhibition title: icon, name and a scannable QR code; nothing navigates away. */
export function titleCreditsMarkup(): string {
  const card = (
    credit: (typeof TITLE_CREDITS)[number] | typeof TITLE_GUEST | typeof TITLE_SUPPORT,
    size = 74,
    avatarSize = 56,
  ) =>
    `<figure class="credit-person"><img class="credit-avatar" src="/title/avatar-${credit.qr}.jpg" width="${avatarSize}" height="${avatarSize}" alt="${credit.name}のXアイコン" decoding="async"><img class="credit-qr" src="/title/qr-${credit.qr}.png" width="${size}" height="${size}" alt="${credit.name}のXプロフィールのQRコード" decoding="async"><figcaption class="credit-name">${credit.name}</figcaption></figure>`;
  return `<section class="title-credits" data-credits="${TITLE_CREDITS.length > 1 ? 'full' : 'public'}" aria-label="クレジット">
    <div class="credit-production"><h2>${TITLE_CREDITS.length > 1 ? '制作' : '開発者'}</h2>${card(TITLE_CREDITS[0], 148, 112)}</div>
    ${
      TITLE_CREDITS.length > 1
        ? `<div class="credit-planning"><h2>監修</h2><div class="credit-people">${TITLE_CREDITS.slice(
            1,
          )
            .map((credit) => card(credit))
            .join('')}</div></div>`
        : ''
    }
    <div class="credit-side">
      <div class="credit-guest"><h2>友情出演</h2>${card(TITLE_GUEST)}</div>
      <div class="credit-support"><h2>友情出演</h2>${card(TITLE_SUPPORT)}</div>
    </div>
  </section>`;
}

export interface Contributor {
  key: string;
  name: string;
  role: '制作' | '開発者' | '監修' | '友情出演';
  /** Verified X profile, or empty while it is still unknown. */
  profile: string;
  avatar: string;
  /** The character painted for this person in the cave mural, if any. */
  mural?: string;
}

const PROFILE = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})$/;
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const xGlyph = `<svg class="x-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/></svg>`;

/** Only well-formed x.com profiles become links; anything else stays plain text. */
export function contributorHandle(profile: string): string | null {
  return PROFILE.exec(profile)?.[1] ?? null;
}

/** Everyone credited in this build, in credit order, with their mural character. */
export function titleContributors(): Contributor[] {
  const painted = new Map(CAVE_MURAL_SPOTS.map((spot) => [spot.subject, spot.label]));
  const person = (
    credit: { name: string; profile: string; qr: string },
    role: Contributor['role'],
  ): Contributor => ({
    key: credit.qr,
    name: credit.name,
    role,
    profile: contributorHandle(credit.profile) ? credit.profile : '',
    avatar: `/title/avatar-${credit.qr}.jpg`,
    ...(painted.has(credit.qr) ? { mural: painted.get(credit.qr) } : {}),
  });
  return [
    person(TITLE_CREDITS[0], TITLE_CREDITS.length > 1 ? '制作' : '開発者'),
    ...TITLE_CREDITS.slice(1).map((credit) => person(credit, '監修')),
    ...[TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS].map((credit) => person(credit, '友情出演')),
  ];
}

function muralSpots(people: Contributor[], copy: boolean) {
  const byKey = new Map(people.map((p) => [p.key, p]));
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return CAVE_MURAL_SPOTS.flatMap((spot) => {
    const person = byKey.get(spot.subject);
    if (!person) return [];
    const style = `left:${pct(spot.x)};top:${pct(spot.y)};width:${pct(spot.w)};height:${pct(spot.h)}`;
    const tag = `<span class="mural-tag"><img src="${person.avatar}" width="20" height="20" alt="" decoding="async"><b>${escape(person.name)}</b>${person.profile ? xGlyph : ''}</span>`;
    // The duplicate copy only exists for the seamless loop: it stays clickable
    // but out of the accessibility tree; neither copy joins arrow/Tab focus.
    const label = copy
      ? ''
      : ` aria-label="${escape(`${person.name}（壁画の${spot.label}）のXプロフィールを開く`)}"`;
    return person.profile
      ? `<a class="mural-spot" data-contributor="${person.key}" href="${person.profile}" target="_blank" rel="noopener noreferrer" tabindex="-1" data-nav-skip style="${style}"${label}>${tag}</a>`
      : `<span class="mural-spot" data-contributor="${person.key}" style="${style}">${tag}</span>`;
  }).join('');
}

/**
 * MMO title and loading screen visual: the long cave frieze slowly panning,
 * where each contributor's character links to their X profile.
 */
export function titleMuralMarkup(people = titleContributors()): string {
  const { url, preview, width, height } = CAVE_MURAL_STRIP;
  const panel = (copy: boolean) =>
    `<div class="mural-panel" style="background-image:url('${preview}')"${copy ? ' aria-hidden="true"' : ''}><img class="mural-image" src="${url}" width="${width}" height="${height}" alt="" decoding="async" fetchpriority="high" draggable="false">${muralSpots(people, copy)}</div>`;
  return `<section class="cave-mural" aria-label="洞窟の壁画。この世界に関わってくれた人たちが描かれています">
    <div class="mural-viewport"><div class="mural-track">${panel(false)}${panel(true)}</div></div>
    <p class="mural-caption">関わってくれた人たちが、洞窟の壁画に残っています</p>
  </section>`;
}

/** Dialog listing every contributor with their X icon; names link to X. */
export function contributorsDialogMarkup(people = titleContributors()): string {
  const roles: Contributor['role'][] = ['制作', '開発者', '監修', '友情出演'];
  const card = (person: Contributor) => {
    const handle = contributorHandle(person.profile);
    const body = `<img class="contributor-avatar" src="${person.avatar}" width="56" height="56" alt="" decoding="async"><span class="contributor-text"><strong>${escape(person.name)}</strong>${handle ? `<small>@${handle}</small>` : ''}${person.mural ? `<em>壁画：${escape(person.mural)}</em>` : ''}</span>`;
    return handle
      ? `<li><a class="contributor" href="${person.profile}" target="_blank" rel="noopener noreferrer" aria-label="${escape(`${person.name}のXプロフィールを開く`)}">${body}${xGlyph}</a></li>`
      : `<li><div class="contributor">${body}</div></li>`;
  };
  const groups = roles
    .map((role) => [role, people.filter((p) => p.role === role)] as const)
    .filter(([, list]) => list.length)
    .map(
      ([role, list]) =>
        `<section class="contributor-group"><h3>${role}</h3><ul class="contributor-list">${list.map(card).join('')}</ul></section>`,
    )
    .join('');
  return `<div class="contributors-dialog"><span class="contributors-mark" aria-hidden="true"></span><h2>関わってくれた人たち</h2><p class="modal-intro">この世界は、たくさんの人の手で描かれました。友情出演の仲間たちは、アプデの洞窟の壁画にも残っています。</p>${groups}</div>`;
}
