import {
  TITLE_CREDITS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
} from './title-credit-profiles.js';
import { FRIEND_MASCOTS } from '../shared/friend-mascots.mjs';
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
  /** How that character also appears in the game: a camp companion or a playable character. */
  appears?: '仲間' | 'キャラクター';
}

/**
 * Each contributor's character, keyed by credit id: painted in the Update Cave
 * and met in the game. The contributors' companions come from FRIEND_MASCOTS.
 */
export const CONTRIBUTOR_CHARACTERS: Readonly<
  Record<string, { name: string; appears: '仲間' | 'キャラクター' }>
> = {
  rimo: { name: 'りもねこ', appears: '仲間' },
  r524: { name: '524', appears: '仲間' },
  maruimo: { name: 'まるぃも', appears: '仲間' },
  mae: { name: 'mae', appears: '仲間' },
  risa: { name: 'こはくちゃん', appears: '仲間' },
  hawkie: { name: 'Howkey', appears: 'キャラクター' },
  ...Object.fromEntries(
    FRIEND_MASCOTS.map((f) => [f.credit, { name: f.name, appears: '仲間' as const }]),
  ),
};

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
  const person = (
    credit: { name: string; profile: string; qr: string },
    role: Contributor['role'],
  ): Contributor => ({
    key: credit.qr,
    name: credit.name,
    role,
    profile: contributorHandle(credit.profile) ? credit.profile : '',
    avatar: `/title/avatar-${credit.qr}.jpg`,
    ...(CONTRIBUTOR_CHARACTERS[credit.qr]
      ? {
          mural: CONTRIBUTOR_CHARACTERS[credit.qr].name,
          appears: CONTRIBUTOR_CHARACTERS[credit.qr].appears,
        }
      : {}),
  });
  return [
    person(TITLE_CREDITS[0], TITLE_CREDITS.length > 1 ? '制作' : '開発者'),
    ...TITLE_CREDITS.slice(1).map((credit) => person(credit, '監修')),
    ...[TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS].map((credit) => person(credit, '友情出演')),
  ];
}

/** Dialog listing every contributor with their X icon; names link to X. */
export function contributorsDialogMarkup(people = titleContributors()): string {
  const roles: Contributor['role'][] = ['制作', '開発者', '監修', '友情出演'];
  const card = (person: Contributor) => {
    const handle = contributorHandle(person.profile);
    const body = `<img class="contributor-avatar" src="${person.avatar}" width="56" height="56" alt="" decoding="async"><span class="contributor-text"><strong>${escape(person.name)}</strong>${handle ? `<small>@${handle}</small>` : ''}${person.mural ? `<em>${person.appears ? `${person.appears}・` : ''}壁画：${escape(person.mural)}</em>` : ''}</span>`;
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
  return `<div class="contributors-dialog"><span class="contributors-mark" aria-hidden="true"></span><h2>関わってくれた人たち</h2><p class="modal-intro">この世界は、たくさんの人の手で描かれました。みんなの分身がキャンプの仲間やキャラクターとして暮らし、アプデの洞窟の壁画にも残っています。</p>${groups}</div>`;
}
