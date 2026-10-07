import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  contributorHandle,
  contributorsDialogMarkup,
  titleContributors,
  titleCreditsMarkup,
  TITLE_CREDITS,
  TITLE_FRIENDS,
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
  assert.equal(people.length, TITLE_CREDITS.length + 2 + TITLE_FRIENDS.length);
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
    maruimo: 'まるぃも',
    mae: 'mae',
    risa: 'こはくちゃん',
    saber: 'Saber',
    fairy: 'フェアリー',
    sagasa: 'さが',
    hawkie: 'Howkey',
    asahina: '怜ちゃん',
  });
  // Everyone listed has a delivered X icon.
  for (const person of people)
    assert.ok(existsSync(new URL(`public${person.avatar}`, root)), person.avatar);
});

test('the dialog lists every contributor with an X icon and the exhibition keeps QR codes', () => {
  const dialog = contributorsDialogMarkup();
  const people = titleContributors();
  assert.equal((dialog.match(/class="contributor-avatar"/g) ?? []).length, people.length);
  assert.equal(
    (dialog.match(/<a class="contributor"/g) ?? []).length,
    people.filter((p) => p.profile).length,
  );
  assert.doesNotMatch(dialog, /qr-/);
  const exhibition = titleCreditsMarkup();
  assert.match(exhibition, /class="credit-qr"/);
  assert.doesNotMatch(exhibition, /<a\b/);
});

test('the online title offers contributors immediately without a mural or loading gate', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const nav = await readFile(new URL('src/menu-navigation.ts', root), 'utf8');
  assert.match(
    main,
    /const onlineTitle = !fixedIdentity && BUILD_PROFILE\.environment !== 'exhibition';/,
  );
  assert.match(main, /\$\{onlineTitle \? '' : titleCreditsMarkup\(\)\}/);
  assert.match(main, /id="title-contributors" class="menu-item">関わってくれた人たち/);
  assert.doesNotMatch(main, /titleMuralMarkup|titleLoading|data-loading/);
  assert.match(nav, /\[data-nav-skip\]/);
});
