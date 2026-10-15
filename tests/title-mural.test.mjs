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
} from '../dist/src/title-credits.js';
import { mascotCreditReleased } from '../dist/shared/mascot-roster.mjs';
import { CAVE_MURAL_SPOTS, CAVE_MURAL_STRIP } from '../dist/src/cave-mural-strip.js';

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
  assert.equal(people.length, TITLE_CREDITS.length + 4);
  assert.deepEqual(
    people.filter((p) => p.role === '監修').map((p) => p.key),
    ['ryuichi', 'nukonuko', 'otani', 'urata'],
  );
  assert.deepEqual(
    people.filter((p) => p.role === '友情出演').map((p) => p.key),
    ['r524', 'rimo', 'asahina', 'dots'],
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
  const painted = Object.fromEntries(people.filter((p) => p.mural).map((p) => [p.key, p.mural]));
  assert.deepEqual(painted, {
    otani: 'オータニ',
    urata: 'うらた',
    nukonuko: 'ぬこぬこ',
    r524: '524',
    rimo: 'りもねこ',
    asahina: '怜ちゃん',
  });
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
  // A card is the name only, with no image, platform mark or @handle.
  assert.doesNotMatch(dialog, /<small>|<img\b|<svg\b|avatar-/);
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
  assert.match(
    dialog,
    /<div class="contributor"><strong translate="no">OpenAI Dots<\/strong><\/div>/,
  );
});

test('the loading cave lists the people painted on its walls with their X, apart from the credits', () => {
  const people = muralPeople();
  const dialog = muralPeopleDialogMarkup(people);
  assert.match(dialog, /<h2>壁画の人々<\/h2>/);
  assert.doesNotMatch(dialog, /関わってくれた人たち|contributor-group|contributors-cave|<button/);
  // Each painted person once, in the cave's order; the round and shape bots are the Dots.
  assert.deepEqual(
    people.map((person) => person.key),
    [
      'maruimo',
      'saber',
      'fairy',
      'nukonuko',
      'sagasa',
      'rimo',
      'r524',
      'mae',
      'risa',
      'otani',
      'urata',
      'hawkie',
      'asahina',
      'daredaro',
      'dots',
    ],
  );
  const linked = people.filter((person) => contributorHandle(person.profile));
  assert.equal(linked.length, people.length - 1, 'everyone but the Dots has an X profile');
  assert.equal((dialog.match(/<a class="contributor"/g) ?? []).length, linked.length);
  for (const person of linked) assert.match(dialog, new RegExp(`href="${person.profile}"`));
  // Names and links only: no images, platform marks, character names or @handles.
  assert.doesNotMatch(dialog, /<small>|<img\b|<svg\b|avatar-|りもねこ|丸いBot/);
  for (const person of linked)
    assert.ok(!dialog.includes(`@${contributorHandle(person.profile)}`), person.key);
  assert.match(
    dialog,
    /<a class="contributor" href="https:\/\/x\.com\/vibe_walking"[^>]*><strong translate="no">[^<]+<\/strong><\/a>/,
  );
  assert.doesNotMatch(muralPeopleDialogMarkup(people, { links: false }), /<a\b/);
});

test('the mural list leaves out subjects the composition painted over with animals', () => {
  const keys = (hidden) => muralPeople(hidden).map((person) => person.key);
  assert.ok(!keys(['howkey-scientist']).includes('hawkie'));
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

test('the public build carries painted profiles and credits Asahina independently of mascot release', async () => {
  const build = await readFile(new URL('scripts/cloudflare-public-build.mjs', root), 'utf8');
  assert.match(
    build,
    /const painted = new Set\(muralPeople\(\)\.map\(\(person\) => person\.key\)\);/,
  );
  assert.match(
    build,
    /TITLE_FRIENDS\.filter\(\s*\(person\) => mascotCreditReleased\(person\.qr\) \|\| painted\.has\(person\.qr\),?\s*\)/,
  );
  const release = JSON.parse(
    await readFile(new URL('cloudflare/public-release.json', root), 'utf8'),
  );
  const credits = release.credits === 'full' ? TITLE_CREDITS : TITLE_CREDITS.slice(0, 1);
  const painted = muralPeople().map((person) => person.key);
  const friends = TITLE_FRIENDS.filter(
    (friend) => mascotCreditReleased(friend.qr) || painted.includes(friend.qr),
  );
  const shipped = new Set(
    [...credits, TITLE_GUEST, TITLE_SUPPORT, TITLE_DOTS, ...friends].map((credit) => credit.qr),
  );
  // Everyone painted is listed in public too; only a setting that hides supervisors drops them.
  const supervisors = TITLE_CREDITS.slice(1).map((credit) => credit.qr);
  for (const key of painted)
    assert.equal(shipped.has(key), release.credits === 'full' || !supervisors.includes(key), key);
  // Shipping a profile does not itself credit it; Asahina is an explicit credit.
  const credited = titleContributors().map((person) => person.key);
  for (const friend of TITLE_FRIENDS)
    assert.equal(
      credited.includes(friend.qr),
      friend.qr === 'asahina' || mascotCreditReleased(friend.qr),
      friend.qr,
    );
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
