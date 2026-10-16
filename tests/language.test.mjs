import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLanguage,
  setLanguage,
  toggleLanguage,
  normalizeLanguage,
  initialLanguage,
  translateText,
  registerTranslations,
  onLanguageChange,
  LANGUAGE_KEY,
} from '../dist/src/language.js';
import { ENGLISH_GAME } from '../dist/src/language-en.js';
import { titleScreenMarkup } from '../dist/src/title-shell.js';
import { INVENTORY_RECIPES } from '../dist/shared/inventory-crafting.mjs';
import { SPAWN_SITES } from '../dist/shared/spawn-sites.mjs';
import { PLAYABLE_CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { LOADING_TIPS } from '../dist/src/loading-tips.js';

registerTranslations(ENGLISH_GAME);
const en = (text) => translateText(text, 'en');
test('new loading screens, tips and renamed warp places also support English', () => {
  for (const text of [
    '読み込み中',
    '読み込みの進み具合',
    '招待',
    '参加者',
    'チャット',
    ...LOADING_TIPS.flatMap((tip) => [tip.title, tip.text]),
    ...WARP_POINTS.map((place) => place.name),
  ]) {
    assert.doesNotMatch(en(text), /[\u3040-\u30ff\u3400-\u9fff]/, text);
    assert.equal(translateText(text, 'ja'), text);
  }
});

test.afterEach(() => {
  setLanguage('ja');
  delete globalThis.localStorage;
});

test('Japanese is the default; one toggle changes and persists only the language preference', () => {
  const writes = [];
  globalThis.localStorage = { setItem: (...args) => writes.push(args) };
  assert.equal(getLanguage(), 'ja');
  const changes = [];
  const stop = onLanguageChange(() => changes.push(getLanguage()));
  toggleLanguage();
  assert.equal(getLanguage(), 'en');
  assert.equal(translateText('はじめる'), 'Start');
  toggleLanguage();
  assert.equal(translateText('はじめる'), 'はじめる');
  setLanguage('ja');
  assert.deepEqual(changes, ['en', 'ja']);
  assert.deepEqual(writes, [
    [LANGUAGE_KEY, 'en'],
    [LANGUAGE_KEY, 'ja'],
    [LANGUAGE_KEY, 'ja'],
  ]);
  stop();
});

test('invalid settings and blocked browser storage are safe', () => {
  for (const value of [null, undefined, '', 'EN', 'fr', 'ja'])
    assert.equal(normalizeLanguage(value), 'ja');
  assert.equal(normalizeLanguage('en'), 'en');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage disabled');
    },
  });
  assert.doesNotThrow(toggleLanguage);
  assert.equal(getLanguage(), 'en');
});

test('English share links override a saved Japanese preference; other pages retain it', () => {
  for (const pathname of ['/en', '/en/', '/en/index.html']) {
    assert.equal(initialLanguage('ja', pathname), 'en');
    assert.equal(initialLanguage(undefined, pathname), 'en');
  }
  for (const pathname of ['/', '/index.html', '/en/other', '/model-review.html', undefined]) {
    assert.equal(initialLanguage('ja', pathname), 'ja');
    assert.equal(initialLanguage('en', pathname), 'en');
    assert.equal(initialLanguage('fr', pathname), 'ja');
  }
});

test('title exposes one focusable bilingual toggle alongside Start and Contributors', () => {
  const html = titleScreenMarkup();
  assert.equal(html.match(/id="title-language"/g).length, 1);
  assert.match(html, /<button id="title-language"[^>]*type="button"[^>]*translate="no"/);
  assert.match(html, /<span lang="ja">日本語<\/span>/);
  assert.match(html, /<span lang="en">English<\/span>/);
});

test('templates preserve numbers, arbitrary player names, whitespace and unknown messages', () => {
  assert.equal(en('  戻る\n'), '  Back\n');
  assert.equal(en('12日目'), 'Day 12');
  assert.equal(en('読み込み中 43%'), 'Loading 43%');
  assert.equal(en('参加者 5人'), 'Players: 5');
  assert.equal(en('今の装備：木槍'), 'Current equipment: Wooden spear');
  assert.equal(en('木材 あと2・石 あと1'), 'Wood: need 2 more · Stone: need 1 more');
  assert.equal(en('肉を焼いています · 2.9秒'), 'Cooking meat · 2.9s');
  assert.equal(en('はい：ここへ行こう'), 'はい: Let’s go here');
  assert.equal(en('$&のXプロフィールを開く'), 'Open $& on X');
  assert.equal(en('日本語の未登録メッセージ'), '日本語の未登録メッセージ');
  assert.equal(en('未登録・メッセージ'), '未登録・メッセージ');
  assert.equal(
    en('採集用・装備中は木材と石の採集量が2倍。今の装備は持ち物に残ります。'),
    'Gathering tool: gather twice as much wood and stone when equipped. Your current equipment stays in your inventory.',
  );
  assert.equal(en('https://x.com/test?language=ja'), 'https://x.com/test?language=ja');
});

test('all character names, travel cards, crafting names and notes have English copy', () => {
  const copy = [
    ...PLAYABLE_CHARACTER_MODELS.flatMap((model) => [model.name, ...model.name.split(' ')]),
    ...SPAWN_SITES.flatMap((site) => [site.name, site.blurb]),
    ...INVENTORY_RECIPES.flatMap((recipe) => [recipe.name, recipe.note]),
  ];
  for (const text of copy) assert.doesNotMatch(en(text), /[\u3040-\u30ff\u3400-\u9fff]/, text);
});

test('translations never contain leftover template parameters', () => {
  for (const [source, english] of Object.entries(ENGLISH_GAME)) {
    const sourceParams = [...source.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const englishParams = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(englishParams, sourceParams, source);
    if (!sourceParams.length) assert.equal(translateText(source, 'ja'), source);
  }
});
