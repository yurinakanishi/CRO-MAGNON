import {
  TITLE_CREDITS,
  TITLE_DOTS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
} from './title-credit-profiles.js';
// The roster, not friend-mascots.mjs: the title's credits load no world data.
import { FRIEND_MASCOTS } from '../shared/friend-mascot-roster.mjs';
import { mascotCreditReleased } from '../shared/mascot-roster.mjs';
export {
  TITLE_CREDITS,
  TITLE_DOTS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
} from './title-credit-profiles.js';

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
 * Retained characters keyed by credit id. Their paintings remain in the cave;
 * only released companions are described as living in the camp.
 */
export const CONTRIBUTOR_CHARACTERS: Readonly<
  Record<string, { name: string; appears: '仲間' | 'キャラクター' }>
> = {
  rimo: { name: 'りもねこ', appears: '仲間' },
  r524: { name: '524', appears: '仲間' },
  maruimo: { name: 'まるぃも', appears: '仲間' },
  mae: { name: 'mae', appears: '仲間' },
  risa: { name: 'こはくちゃん', appears: '仲間' },
  hawkie: { name: 'Howkey', appears: '仲間' },
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
          ...(mascotCreditReleased(credit.qr)
            ? { appears: CONTRIBUTOR_CHARACTERS[credit.qr].appears }
            : {}),
        }
      : {}),
  });
  return [
    person(TITLE_CREDITS[0], TITLE_CREDITS.length > 1 ? '制作' : '開発者'),
    ...TITLE_CREDITS.slice(1).map((credit) => person(credit, '監修')),
    ...[TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS]
      .filter((credit) => mascotCreditReleased(credit.qr))
      .map((credit) => person(credit, '友情出演')),
    // The dots are always in the world, so their credit is never held back.
    person(TITLE_DOTS, '友情出演'),
  ];
}

/** One person's card: their icon and name only, no handle or character name (user request
 * 2026-10-14), linking to their X profile when allowed and well formed. */
function personCard(person: Pick<Contributor, 'name' | 'profile' | 'avatar'>, links: boolean) {
  const handle = contributorHandle(person.profile);
  const body = `<img class="contributor-avatar" src="${person.avatar}" width="56" height="56" alt="" decoding="async"><span class="contributor-text"><strong translate="no">${escape(person.name)}</strong></span>`;
  return links && handle
    ? `<li><a class="contributor" href="${person.profile}" target="_blank" rel="noopener noreferrer" aria-label="${escape(`${person.name}のXプロフィールを開く`)}">${body}${xGlyph}</a></li>`
    : `<li><div class="contributor">${body}</div></li>`;
}

/** All credits live in this QR-free dialog; exhibition cards never navigate away. */
export function contributorsDialogMarkup(
  people = titleContributors(),
  { links = true }: { links?: boolean } = {},
): string {
  const roles: Contributor['role'][] = ['制作', '開発者', '監修', '友情出演'];
  const groups = roles
    .map((role) => [role, people.filter((p) => p.role === role)] as const)
    .filter(([, list]) => list.length)
    .map(
      ([role, list]) =>
        `<section class="contributor-group"><h3>${role}</h3><ul class="contributor-list">${list.map((person) => personCard(person, links)).join('')}</ul></section>`,
    )
    .join('');
  return `<div class="contributors-dialog"><h2>関わってくれた人たち</h2>${groups}</div>`;
}

/**
 * Who each painted subject of the cave's processions is (assets/camp-cave/modular-r36), in
 * the cave's order from the entrance; the round and shape bots are the Dots.
 */
const MURAL_SUBJECTS: readonly (readonly [subject: string, credit: string])[] = [
  ['maruimo-mascot', 'maruimo'],
  ['saber-mascot', 'saber'],
  ['fairy-mascot', 'fairy'],
  ['nukonuko-mascot', 'nukonuko'],
  ['sagasa-mascot', 'sagasa'],
  ['rimo-neko', 'rimo'],
  ['524', 'r524'],
  ['mae', 'mae'],
  ['kohaku', 'risa'],
  ['otani-mascot', 'otani'],
  ['urata-mascot', 'urata'],
  ['howkey-scientist', 'hawkie'],
  ['rei-mascot', 'asahina'],
  // The deepened gallery's east wall (2026-10-14).
  ['daredaro', 'daredaro'],
  ...['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog', 'triangle', 'heart'].map(
    (bot) => [bot, 'dots'] as const,
  ),
];

export interface MuralPerson {
  key: string;
  name: string;
  /** Verified X profile, or empty. */
  profile: string;
  avatar: string;
}

/**
 * The people painted in the cave, once each: subjects the mural composition replaced with
 * animals are left out, and so is anyone whose profile this build does not carry (the public
 * build ships filtered credit tables).
 */
export function muralPeople(hidden: readonly string[] = []): MuralPerson[] {
  const profiles = new Map<string, { name: string; profile: string; qr: string }>(
    [...TITLE_CREDITS, TITLE_GUEST, TITLE_SUPPORT, TITLE_DOTS, ...TITLE_FRIENDS].map((credit) => [
      credit.qr,
      credit,
    ]),
  );
  const people: MuralPerson[] = [];
  for (const [subject, credit] of MURAL_SUBJECTS) {
    const profile = profiles.get(credit);
    if (hidden.includes(subject) || !profile || people.some((p) => p.key === credit)) continue;
    people.push({
      key: credit,
      name: profile.name,
      profile: contributorHandle(profile.profile) ? profile.profile : '',
      avatar: `/title/avatar-${credit}.jpg`,
    });
  }
  return people;
}

/** The cave's own dialog: who is painted on its walls, with their X profiles. */
export function muralPeopleDialogMarkup(
  people = muralPeople(),
  { links = true }: { links?: boolean } = {},
): string {
  return `<div class="contributors-dialog mural-people-dialog"><h2>壁画の人々</h2><ul class="contributor-list">${people.map((person) => personCard(person, links)).join('')}</ul></div>`;
}
