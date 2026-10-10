import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  contributorHandle,
  contributorsDialogMarkup,
  titleContributors,
  TITLE_CREDITS,
} from '../dist/src/title-credits.js';
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
  assert.equal(people.length, TITLE_CREDITS.length + 2);
  assert.deepEqual(
    people.filter((p) => p.role === '監修').map((p) => p.key),
    ['ryuichi', 'nukonuko', 'otani', 'urata'],
  );
  assert.deepEqual(
    people.filter((p) => p.role === '友情出演').map((p) => p.key),
    ['r524', 'rimo'],
  );
  for (const person of people) {
    assert.ok(person.profile === '' || contributorHandle(person.profile), person.name);
    assert.match(person.avatar, /^\/title\/avatar-[a-z0-9]+\.jpg$/);
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
  });
  // Everyone listed has a delivered X icon.
  for (const person of people)
    assert.ok(existsSync(new URL(`public${person.avatar}`, root)), person.avatar);
});

test('the dialog lists every contributor without QR codes and exhibition cards have no links', () => {
  const dialog = contributorsDialogMarkup();
  const people = titleContributors();
  assert.equal((dialog.match(/class="contributor-avatar"/g) ?? []).length, people.length);
  assert.equal(
    (dialog.match(/<a class="contributor"/g) ?? []).length,
    people.filter((p) => p.profile).length,
  );
  assert.doesNotMatch(dialog, /qr-/);
  assert.doesNotMatch(dialog, /contributors-mark|この世界は|たくさんの人|<em>|壁画：/);
  assert.match(dialog, /アプレノ洞窟に残る壁画に会いに来てください。/);
  assert.match(dialog, /id="contributors-cave"[^>]*>アプレノ洞窟に行く<\/button>/);
  const exhibition = contributorsDialogMarkup(undefined, { links: false });
  assert.equal((exhibition.match(/class="contributor-avatar"/g) ?? []).length, people.length);
  assert.doesNotMatch(exhibition, /qr-/);
  assert.doesNotMatch(exhibition, /<a\b/);
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
