import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PUBLIC_PAGE,
  SHARE_COPIED,
  SHARE_INSTAGRAM_COPIED,
  SHARE_TARGETS,
  shareHref,
  shareLinksMarkup,
  sharePage,
  sharePanelMarkup,
  shareText,
} from '../dist/src/share-links.js';
import { translateText } from '../dist/src/language.js';
import { titleScreenMarkup } from '../dist/src/title-shell.js';
import { BUILD_PROFILE } from '../dist/src/build-profile.js';

const root = new URL('../', import.meta.url);
const LABELS = ['Xでポスト', 'Instagramでシェア', 'Facebookでシェア', 'リンクをコピー'];

test('the shared address is the published domain each page names; the text is its preview', async () => {
  // README names where the game is played; the retained workers.dev URL is not shared.
  const readme = await readFile(new URL('README.md', root), 'utf8');
  assert.equal(PUBLIC_PAGE, 'https://cromagnonmmo.com/');
  assert.ok(readme.includes(`(${PUBLIC_PAGE})`));
  for (const [file, language, page] of [
    ['public/index.html', 'ja', PUBLIC_PAGE],
    ['public/en/index.html', 'en', `${PUBLIC_PAGE}en/`],
  ]) {
    const html = await readFile(new URL(file, root), 'utf8');
    const description = html.match(/property="og:description" content="([^"]+)"/)[1];
    assert.equal(sharePage(language), page);
    // A shared card resolves to the same page: its canonical link and og:url.
    assert.equal(html.match(/<link rel="canonical" href="([^"]+)"/)[1], page);
    assert.equal(html.match(/property="og:url" content="([^"]+)"/)[1], page);
    assert.equal(shareText(language), `CRO-MAGNON MMO — ${description}`);
  }
});

test('X opens its composer with the text and page, Facebook its sharer with the page', () => {
  for (const language of ['ja', 'en']) {
    const page = sharePage(language);
    const text = shareText(language);
    const x = new URL(shareHref('x', page, text));
    assert.equal(`${x.origin}${x.pathname}`, 'https://x.com/intent/tweet');
    assert.deepEqual(
      [...x.searchParams],
      [
        ['text', text],
        ['url', page],
      ],
    );
    const facebook = new URL(shareHref('facebook', page, text));
    assert.equal(
      `${facebook.origin}${facebook.pathname}`,
      'https://www.facebook.com/sharer/sharer.php',
    );
    assert.deepEqual([...facebook.searchParams], [['u', page]]);
  }
});

test('X and Facebook are new-tab links; Instagram and copy are buttons, in that order', () => {
  assert.deepEqual(SHARE_TARGETS, ['x', 'instagram', 'facebook', 'copy']);
  for (const compact of [true, false]) {
    const markup = shareLinksMarkup(compact, 'ja');
    assert.deepEqual(
      [...markup.matchAll(/data-share="(\w+)"/g)].map((match) => match[1]),
      SHARE_TARGETS,
    );
    for (const target of ['x', 'facebook']) {
      const href = markup.match(
        new RegExp(
          `<a class="share-link" data-share="${target}" href="([^"]+)" target="_blank" rel="noopener noreferrer"`,
        ),
      )?.[1];
      assert.ok(href, target);
      assert.doesNotMatch(href, /&(?!amp;)/, 'the attribute escapes its ampersands');
      assert.equal(href.replaceAll('&amp;', '&'), shareHref(target, PUBLIC_PAGE, shareText('ja')));
    }
    for (const target of ['instagram', 'copy'])
      assert.match(
        markup,
        new RegExp(`<button type="button" class="share-link" data-share="${target}"`),
      );
    assert.match(markup, /role="group" aria-label="シェア"/);
    assert.match(markup, /<p class="share-status" role="status"><\/p><\/div>$/);
  }
  const compact = shareLinksMarkup(true, 'ja');
  assert.match(compact, /class="share-links share-compact"/);
  for (const label of LABELS)
    assert.match(compact, new RegExp(`aria-label="${label}" title="${label}"`));
  assert.doesNotMatch(compact, /<span>/, 'the round marks carry no words');
  const labelled = shareLinksMarkup(false, 'ja');
  assert.match(labelled, /class="share-links share-panel"/);
  for (const label of LABELS) assert.match(labelled, new RegExp(`<span>${label}</span>`));
  // The English page shares the English address.
  assert.match(shareLinksMarkup(true, 'en'), /url=https%3A%2F%2Fcromagnonmmo\.com%2Fen%2F/);
});

test("the menu's シェア tab shows the address it shares, verbatim", () => {
  assert.match(
    sharePanelMarkup('ja'),
    /<p class="share-address" translate="no">https:\/\/cromagnonmmo\.com\/<\/p>$/,
  );
  assert.match(sharePanelMarkup('en'), /cromagnonmmo\.com\/en\/<\/p>$/);
});

test('every share label and message has English', () => {
  for (const text of ['シェア', ...LABELS, SHARE_COPIED, SHARE_INSTAGRAM_COPIED])
    assert.notEqual(translateText(text, 'en'), text, text);
  assert.equal(
    translateText(`リンクをコピーできませんでした：${PUBLIC_PAGE}`, 'en'),
    `Could not copy the link: ${PUBLIC_PAGE}`,
  );
});

test('the marks follow the title menu; exhibitions, LAN and the HUD have none', async () => {
  const title = titleScreenMarkup();
  if (BUILD_PROFILE.environment === 'exhibition') assert.doesNotMatch(title, /share-links/);
  else assert.match(title, /<\/nav>\s*<div class="share-links share-compact"/);
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const hud = main.slice(
    main.indexOf('const viewportMarkup = `'),
    main.indexOf('if (titleHandoff) {'),
  );
  assert.ok(hud.length > 1000);
  assert.doesNotMatch(hud, /share/, 'play never shows share buttons over the world');
  // The menu tab and the cave follow the rule of the credits' profile links.
  assert.match(main, /\.\.\.\(onlineTitle \? \[\['share', 'share', 'シェア'\]/);
  assert.match(main, /share: onlineTitle,/);
  assert.match(
    main,
    /if \(onlineTitle\) \{\s*bindShareLinks\(\$\('#screen-title'\)\);\s*bindShareLinks\(\$\('#modal'\)\);\s*\} else \$\('#screen-title \.share-links'\)\?\.remove\(\);/,
  );
  const shell = await readFile(new URL('src/title-shell.ts', root), 'utf8');
  assert.match(
    shell,
    /if \(!titleLinks\(value\)\) title\.querySelector\('\.share-links'\)\?\.remove\(\)/,
  );
});
