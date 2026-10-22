import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  contributorHandle,
  contributorsDialogMarkup,
  muralPeople,
  muralPeopleDialogMarkup,
  titleContributors,
  TITLE_CREDITS,
  TITLE_DOTS,
  TITLE_FRIENDS,
  TITLE_GUEST,
  TITLE_SUPPORT,
  CONTRIBUTOR_CHARACTERS,
  CONTRIBUTOR_MURAL_SUBJECTS,
} from '../dist/src/title-credits.js';
import { mascotCreditReleased } from '../dist/shared/mascot-roster.mjs';
import { CAVE_MURAL_SPOTS, CAVE_MURAL_STRIP } from '../dist/src/cave-mural-strip.js';
import { CAVE_EXTRA_PIGMENTS, CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';

const root = new URL('../', import.meta.url);
const record = JSON.parse(
  await readFile(new URL('assets/title-credits/cave-mural-strip.json', root), 'utf8'),
);

test('the title mural is the baked strip of the unmodified cave friezes', async () => {
  const strip = await readFile(new URL(`public${CAVE_MURAL_STRIP.url}`, root));
  assert.equal(createHash('sha256').update(strip).digest('hex'), record.output.sha256);
  assert.equal(CAVE_MURAL_STRIP.width, record.output.width);
  assert.equal(CAVE_MURAL_STRIP.height, record.output.height);
  // A whole number of square rock tiles, so two copies loop without a seam.
  assert.equal(CAVE_MURAL_STRIP.width % CAVE_MURAL_STRIP.height, 0);
  assert.equal(CAVE_MURAL_STRIP.width / CAVE_MURAL_STRIP.height, 19);
  for (const frieze of record.friezes) {
    const bytes = await readFile(new URL(frieze.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), frieze.sha256, frieze.file);
  }
  assert.deepEqual(CAVE_MURAL_SPOTS, record.spots);
  for (const spot of CAVE_MURAL_SPOTS) {
    assert.ok(spot.x >= 0 && spot.x + spot.w <= 1 && spot.y >= 0 && spot.y + spot.h <= 1);
  }
});

test('contributors link only to verified x.com profiles', () => {
  const people = titleContributors();
  assert.equal(people[0].name, 'yuri');
  assert.equal(people.length, 18);
  assert.deepEqual(
    people.filter((p) => p.role === '監修').map((p) => p.key),
    ['ryuichi', 'nukonuko', 'otani', 'urata'],
  );
  assert.deepEqual(
    people.filter((p) => p.role === '友情出演').map((p) => p.key),
    [TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS, TITLE_DOTS].map((credit) => credit.qr),
  );
  // OpenAI's dots, which the camp's dots follow, have no X profile: a card without a link.
  const dots = people.find((p) => p.key === 'dots');
  assert.equal(dots.name, 'OpenAI Dots');
  assert.equal(dots.profile, '');
  assert.equal(dots.mural, undefined);
  for (const person of people) {
    assert.ok(person.profile === '' || contributorHandle(person.profile), person.name);
  }
  assert.equal(contributorHandle('https://x.com/R5ni4'), 'R5ni4');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.com/a', 'http://x.com/a', ''])
    assert.equal(contributorHandle(bad), null, bad);
  for (const person of people) {
    assert.equal(person.mural, CONTRIBUTOR_CHARACTERS[person.key]?.name);
    assert.equal(!!person.appears, mascotCreditReleased(person.key));
  }
});

test('the common cast deduplicates both credit ids and case-insensitive X accounts', () => {
  const before = titleContributors();
  const count = TITLE_FRIENDS.length;
  try {
    TITLE_FRIENDS.push(
      { ...TITLE_GUEST, name: 'Duplicate 524', profile: 'https://x.com/another524' },
      { qr: 'same-ryuichi', name: 'Duplicate Ryuichi', profile: 'https://x.com/wabisuketyper' },
    );
    assert.deepEqual(titleContributors(), before);
    assert.equal(muralPeople().length, 17);
  } finally {
    TITLE_FRIENDS.splice(count);
  }
});

test('the dialog lists every contributor without QR codes and exhibition cards have no links', () => {
  const dialog = contributorsDialogMarkup();
  const people = titleContributors();
  assert.deepEqual(
    [...dialog.matchAll(/<h3>(.*?)<\/h3>/g)].map((match) => match[1]),
    ['制作', '関わってくれた人たち'],
  );
  assert.doesNotMatch(dialog, /監修|友情出演|開発者/);
  assert.doesNotMatch(dialog, /<h2>/);
  assert.equal((dialog.match(/関わってくれた人たち/g) ?? []).length, 1);
  assert.equal((dialog.match(/<strong translate="no">/g) ?? []).length, people.length);
  assert.equal(
    (dialog.match(/<a class="contributor"/g) ?? []).length,
    people.filter((p) => p.profile).length,
  );
  assert.doesNotMatch(dialog, /qr-/);
  assert.doesNotMatch(dialog, /contributors-mark|この世界は|たくさんの人|<em>|壁画：/);
  assert.doesNotMatch(dialog, /class="modal-intro"/);
  // Linked cards show the X mark without profile images or @handles.
  assert.doesNotMatch(dialog, /<small>|<img\b|avatar-/);
  assert.equal(
    (dialog.match(/<svg class="contributor-x"/g) ?? []).length,
    people.filter((person) => person.profile).length,
  );
  for (const person of people) {
    const handle = contributorHandle(person.profile);
    if (handle) assert.ok(!dialog.includes(`@${handle}`), handle);
  }
  // The credits no longer offer a trip to the cave.
  assert.doesNotMatch(dialog, /contributors-cave|アプデの洞窟|<button/);
  const exhibition = contributorsDialogMarkup(undefined, { links: false });
  assert.equal((exhibition.match(/<strong translate="no">/g) ?? []).length, people.length);
  assert.doesNotMatch(exhibition, /qr-/);
  assert.doesNotMatch(exhibition, /<a\b/);
  assert.doesNotMatch(exhibition, /contributor-x|<svg\b/);
  assert.match(
    dialog,
    /<div class="contributor"><strong translate="no">OpenAI Dots<\/strong><\/div>/,
  );
});

test('title and cave share the same cards, names, links and order, except creator yuri', () => {
  const people = muralPeople();
  const dialog = muralPeopleDialogMarkup(people);
  assert.match(dialog, /<h2>壁画の人々<\/h2>/);
  assert.doesNotMatch(dialog, /関わってくれた人たち|contributor-group|contributors-cave|<button/);
  // The title keeps the creator; every other person is shared in the same order.
  assert.deepEqual(
    people,
    titleContributors()
      .filter((person) => person.key !== 'yuri')
      .map(({ key, name, profile }) => ({ key, name, profile })),
  );
  assert.equal(people.length, 17);
  assert.equal(new Set(people.map((person) => person.key)).size, 17);
  assert.ok(people.some((person) => person.key === 'ryuichi'));
  assert.ok(!people.some((person) => person.key === 'yuri'));
  const titleGroups = contributorsDialogMarkup().split('<section class="contributor-group">');
  assert.deepEqual(
    [...dialog.matchAll(/<li>.*?<\/li>/g)].map((match) => match[0]),
    [...titleGroups.at(-1).matchAll(/<li>.*?<\/li>/g)].map((match) => match[0]),
  );
  const linked = people.filter((person) => contributorHandle(person.profile));
  assert.equal(linked.length, people.length - 1, 'everyone but the Dots has an X profile');
  assert.equal((dialog.match(/<a class="contributor"/g) ?? []).length, linked.length);
  for (const person of linked) assert.match(dialog, new RegExp(`href="${person.profile}"`));
  assert.equal((dialog.match(/<svg class="contributor-x"/g) ?? []).length, linked.length);
  // No profile images, character names or @handles.
  assert.doesNotMatch(dialog, /<small>|<img\b|avatar-|りもねこ|丸いBot/);
  for (const person of linked)
    assert.ok(!dialog.includes(`@${contributorHandle(person.profile)}`), person.key);
  assert.match(
    dialog,
    /<a class="contributor" href="https:\/\/x\.com\/vibe_walking"[^>]*><strong translate="no">[^<]+<\/strong><svg class="contributor-x"[^>]*aria-hidden="true"[^>]*>.*?<\/svg><\/a>/,
  );
  assert.doesNotMatch(muralPeopleDialogMarkup(people, { links: false }), /<a\b/);
  assert.doesNotMatch(muralPeopleDialogMarkup(people, { links: false }), /contributor-x|<svg\b/);
});

test('X marks only label usable profile links, including on the shared mural cards', () => {
  const people = [
    { key: 'valid', name: 'Valid', profile: 'https://x.com/R5ni4' },
    { key: 'missing', name: 'Missing', profile: '' },
    { key: 'invalid', name: 'Invalid', profile: 'https://example.com/R5ni4' },
  ];
  const dialog = muralPeopleDialogMarkup(people);
  assert.equal((dialog.match(/<svg class="contributor-x"/g) ?? []).length, 1);
  assert.match(dialog, /aria-label="ValidのXプロフィールを開く"/);
  for (const name of ['Missing', 'Invalid'])
    assert.ok(
      dialog.includes(`<div class="contributor"><strong translate="no">${name}</strong></div>`),
    );
});

test('every non-creator in the common cast has a real projected cave painting', () => {
  const actual = [
    'rimo-neko',
    '524',
    ...Object.values(CAVE_EXTRA_PIGMENTS).flatMap((pigment) => pigment.subjects),
  ];
  const assigned = Object.values(CONTRIBUTOR_MURAL_SUBJECTS).flat();
  assert.deepEqual([...assigned].sort(), [...actual].sort());
  assert.equal(new Set(assigned).size, assigned.length, 'each subject belongs to one person');
  assert.ok(!('yuri' in CONTRIBUTOR_MURAL_SUBJECTS));
  assert.deepEqual(
    Object.keys(CONTRIBUTOR_MURAL_SUBJECTS).sort(),
    muralPeople()
      .map((person) => person.key)
      .sort(),
  );
  const ryuichi = CAVE_MURALS.find((mural) => mural.subject === 'ryuichi');
  assert.equal(ryuichi.wall, 'west');
  assert(ryuichi.centre < -30 && ryuichi.centre > -40.3);
});

test('the mural list leaves out subjects the composition painted over with animals', () => {
  const keys = (hidden) => muralPeople(hidden).map((person) => person.key);
  assert.ok(!keys(['howkey-scientist']).includes('hawkie'));
  assert.ok(!keys(['ryuichi']).includes('ryuichi'));
  assert.ok(keys(['howkey-scientist']).includes('otani'), 'only that subject');
  // The Dots stay while any of their bots is still painted.
  assert.ok(keys(['white', 'frog']).includes('dots'));
  const bots = ['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog', 'triangle', 'heart'];
  assert.ok(!keys(bots).includes('dots'));
});

test('the public build rewrites every credit table the dialog imports, including the dots', async () => {
  const build = await readFile(new URL('scripts/cloudflare-public-build.mjs', root), 'utf8');
  const credits = await readFile(new URL('src/title-credits.ts', root), 'utf8');
  const imported = /import \{([^}]+)\} from '\.\/title-credit-profiles\.js'/
    .exec(credits)[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  assert.ok(imported.includes('TITLE_DOTS'));
  const start = build.indexOf("'/src/title-credit-profiles.js'");
  assert.ok(start > 0);
  const written = build.slice(start, build.indexOf('\n);', start));
  // A table missing here would stop the public title's module from loading.
  for (const name of imported) assert.match(written, new RegExp(`export const ${name} =`), name);
});

test('the public build keeps the complete common cast independently of mascot release', async () => {
  const build = await readFile(new URL('scripts/cloudflare-public-build.mjs', root), 'utf8');
  assert.match(build, /const credits = TITLE_CREDITS;/);
  assert.match(build, /const friends = TITLE_FRIENDS;/);
  const release = JSON.parse(
    await readFile(new URL('cloudflare/public-release.json', root), 'utf8'),
  );
  assert.equal(release.credits, 'full');
  const credits = TITLE_CREDITS;
  const painted = muralPeople().map((person) => person.key);
  const friends = TITLE_FRIENDS;
  const shipped = new Set(
    [...credits, TITLE_GUEST, TITLE_SUPPORT, TITLE_DOTS, ...friends].map((credit) => credit.qr),
  );
  for (const key of painted) assert.ok(shipped.has(key), key);
  const credited = titleContributors().map((person) => person.key);
  for (const friend of TITLE_FRIENDS) assert.ok(credited.includes(friend.qr), friend.qr);
});

test('every title offers contributors immediately without home credit cards or a loading gate', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const shell = await readFile(new URL('src/title-shell.ts', root), 'utf8');
  const nav = await readFile(new URL('src/menu-navigation.ts', root), 'utf8');
  assert.match(
    main,
    /const onlineTitle = !fixedIdentity && BUILD_PROFILE\.environment !== 'exhibition';/,
  );
  // The shell opens the same credits before the game loads, with the same link rule.
  assert.match(
    shell,
    /return config\.mode !== 'lan' && BUILD_PROFILE\.environment !== 'exhibition';/,
  );
  assert.match(shell, /class="screen title-screen" data-variant="classic" hidden/);
  for (const source of [main, shell]) {
    assert.doesNotMatch(
      source,
      /titleCreditsMarkup|onlineTitle \? '<button id="title-contributors"/,
    );
    assert.doesNotMatch(source, /titleMuralMarkup|titleLoading|data-loading/);
  }
  assert.match(shell, /id="title-contributors" class="menu-item">関わってくれた人たち/);
  assert.match(nav, /\[data-nav-skip\]/);
});
