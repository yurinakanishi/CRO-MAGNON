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

/** Only well-formed x.com profiles become links; anything else stays plain text. */
export function contributorHandle(profile: string): string | null {
  return PROFILE.exec(profile)?.[1] ?? null;
}

/** The common cast for title cards and cave murals, independent of mascot release. */
export function titleContributors(): Contributor[] {
  const person = (
    credit: { name: string; profile: string; qr: string },
    role: Contributor['role'],
  ): Contributor => ({
    key: credit.qr,
    name: credit.name,
    role,
    profile: contributorHandle(credit.profile) ? credit.profile : '',
    ...(CONTRIBUTOR_CHARACTERS[credit.qr]
      ? {
          mural: CONTRIBUTOR_CHARACTERS[credit.qr].name,
          ...(mascotCreditReleased(credit.qr)
            ? { appears: CONTRIBUTOR_CHARACTERS[credit.qr].appears }
            : {}),
        }
      : {}),
  });
  const people = [
    person(TITLE_CREDITS[0], '制作'),
    ...TITLE_CREDITS.slice(1).map((credit) => person(credit, '監修')),
    ...[TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS].map((credit) => person(credit, '友情出演')),
    person(TITLE_DOTS, '友情出演'),
  ];
  // A person can occur in several source groups; keep their first credit once.
  // X handles are case insensitive, and people without a profile use their credit id.
  const seen = new Set<string>();
  return people.filter((person) => {
    const handle = contributorHandle(person.profile)?.toLowerCase();
    const identities = [`credit:${person.key}`, ...(handle ? [`x:${handle}`] : [])];
    if (identities.some((identity) => seen.has(identity))) return false;
    for (const identity of identities) seen.add(identity);
    return true;
  });
}

const creator = (person: Contributor) => person.role === '制作' || person.role === '開発者';

const xIcon =
  '<svg class="contributor-x" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.44h2.039L6.487 3.24H4.3l13.31 17.353Z"/></svg>';

/** A name and X mark on linked cards (user request 2026-10-16).
 * Cards without an available link keep just the name. */
function personCard(person: Pick<Contributor, 'name' | 'profile'>, links: boolean) {
  const handle = contributorHandle(person.profile);
  const body = `<strong translate="no">${escape(person.name)}</strong>`;
  return links && handle
    ? `<li><a class="contributor" href="${person.profile}" target="_blank" rel="noopener noreferrer" aria-label="${escape(`${person.name}のXプロフィールを開く`)}">${body}${xIcon}</a></li>`
    : `<li><div class="contributor">${body}</div></li>`;
}

/** All credits live in this QR-free dialog; exhibition cards never navigate away. */
export function contributorsDialogMarkup(
  people = titleContributors(),
  { links = true }: { links?: boolean } = {},
): string {
  // Keep the source roles for release auditing; the dialog has just two groups.
  const groups = [
    ['制作', people.filter(creator)],
    ['関わってくれた人たち', people.filter((person) => !creator(person))],
  ] as const;
  const markup = groups
    .filter(([, list]) => list.length)
    .map(
      ([role, list]) =>
        `<section class="contributor-group"><h3>${role}</h3><ul class="contributor-list">${list.map((person) => personCard(person, links)).join('')}</ul></section>`,
    )
    .join('');
  return `<div class="contributors-dialog">${markup}</div>`;
}

/**
 * Paintings belonging to each person in the common cast. The nine Dots share one card.
 * The creator remains in the title credits only (user request 2026-10-16).
 */
export const CONTRIBUTOR_MURAL_SUBJECTS: Readonly<Record<string, readonly string[]>> = {
  ryuichi: ['ryuichi'],
  maruimo: ['maruimo-mascot'],
  saber: ['saber-mascot'],
  fairy: ['fairy-mascot'],
  nukonuko: ['nukonuko-mascot'],
  sagasa: ['sagasa-mascot'],
  rimo: ['rimo-neko'],
  r524: ['524'],
  mae: ['mae'],
  risa: ['kohaku'],
  otani: ['otani-mascot'],
  urata: ['urata-mascot'],
  hawkie: ['howkey-scientist'],
  asahina: ['rei-mascot'],
  daredaro: ['daredaro'],
  dots: ['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog', 'triangle', 'heart'],
};

export interface MuralPerson {
  key: string;
  name: string;
  /** Verified X profile, or empty. */
  profile: string;
}

/**
 * The same names, links and order as the title's common cast, with yuri excluded.
 * A person is omitted only when every one of their paintings was replaced with animals.
 */
export function muralPeople(hidden: readonly string[] = []): MuralPerson[] {
  return titleContributors()
    .filter(
      (person) =>
        !creator(person) &&
        CONTRIBUTOR_MURAL_SUBJECTS[person.key]?.some((subject) => !hidden.includes(subject)),
    )
    .map(({ key, name, profile }) => ({ key, name, profile }));
}

/** The cave's own dialog: who is painted on its walls, with their X profiles. */
export function muralPeopleDialogMarkup(
  people = muralPeople(),
  { links = true }: { links?: boolean } = {},
): string {
  return `<div class="contributors-dialog mural-people-dialog"><h2>壁画の人々</h2><ul class="contributor-list">${people.map((person) => personCard(person, links)).join('')}</ul></div>`;
}
