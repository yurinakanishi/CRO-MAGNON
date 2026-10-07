import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  contributorHandle,
  contributorsDialogMarkup,
  titleContributors,
  titleCreditsMarkup,
  titleMuralMarkup,
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
  assert.deepEqual(painted, { r524: '524', rimo: 'りもねこ', maruimo: 'まるぃも', mae: 'mae' });
});

test('mural hotspots move with the painting and stay out of arrow navigation', () => {
  const html = titleMuralMarkup();
  const panels = html.match(/<div class="mural-panel"[^>]*>/g);
  assert.equal(panels.length, 2);
  assert.doesNotMatch(panels[0], /aria-hidden/);
  assert.match(panels[1], /aria-hidden="true"/);
  const links = html.match(/<a class="mural-spot"[^>]*>/g) ?? [];
  const verified = titleContributors().filter((p) => p.mural && p.profile).length;
  assert.equal(links.length, verified * 2);
  for (const link of links) {
    assert.match(link, /href="https:\/\/x\.com\/[A-Za-z0-9_]+"/);
    assert.match(link, /target="_blank" rel="noopener noreferrer" tabindex="-1" data-nav-skip/);
  }
  // Characters not tied to a credited person (こはくちゃん, the bots) are not hotspots.
  assert.doesNotMatch(html, /data-contributor="kohaku"/);
  assert.doesNotMatch(html, /credit-qr|qr-/);
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

test('only the online title waits on the world and offers the contributors dialog', async () => {
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const nav = await readFile(new URL('src/menu-navigation.ts', root), 'utf8');
  assert.match(
    main,
    /const muralTitle = !fixedIdentity && BUILD_PROFILE\.environment !== 'exhibition';/,
  );
  assert.match(main, /\$\{muralTitle \? titleMuralMarkup\(\) : titleCreditsMarkup\(\)\}/);
  assert.match(main, /id="title-contributors" class="menu-item">関わってくれた人たち/);
  assert.match(main, /progress\.phase === 'ready' \|\| progress\.phase === 'error'/);
  assert.match(nav, /\[data-nav-skip\]/);
});
