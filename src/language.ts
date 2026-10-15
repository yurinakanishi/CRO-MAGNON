import { readSaved, save } from './session-storage.js';

export type Language = 'ja' | 'en';
export const LANGUAGE_KEY = 'cro-language';

/** Language is a preference of this browser, never part of the shared room/save. */
export function normalizeLanguage(value: unknown): Language {
  return value === 'en' ? 'en' : 'ja';
}

let language = normalizeLanguage(readSaved(LANGUAGE_KEY, 'ja'));
const listeners = new Set<() => void>();
const messages = new Map<string, string>();
const patterns: { expression: RegExp; names: string[]; english: string }[] = [];
const cache = new Map<string, string>();
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;

export const getLanguage = (): Language => language;

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(next: Language): void {
  next = normalizeLanguage(next);
  save(LANGUAGE_KEY, next);
  if (language === next) return;
  language = next;
  for (const listener of listeners) listener();
}

export function toggleLanguage(): void {
  setLanguage(language === 'ja' ? 'en' : 'ja');
}

/** Exact messages and anchored templates only; never replace words inside user text.
 * Named values are kept verbatim, except explicitly marked game labels (item/place/action).
 * The larger game catalog is registered by main, keeping the first title lightweight. */
export function registerTranslations(catalog: Readonly<Record<string, string>>): void {
  for (const [source, english] of Object.entries(catalog)) {
    if (messages.has(source)) continue;
    messages.set(source, english);
    const names: string[] = [];
    const expression = source
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          const name = part.slice(1, -1);
          names.push(name);
          return /^(count|total|percent|seconds|day|owned|needed|distance|number)\d*$/.test(name)
            ? '([0-9.,]+)'
            : /^(item|place|action|state)\d*$/.test(name)
              ? '([^・\\n]+?)'
              : '(.+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    if (names.length)
      patterns.push({ expression: new RegExp(`^${expression}$`, 's'), names, english });
  }
  cache.clear();
}

function englishText(source: string, depth = 0): string {
  const exact = messages.get(source);
  if (exact !== undefined) return exact;
  if (depth > 3) return source;
  for (const { expression, names, english } of patterns) {
    const match = expression.exec(source);
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    return english.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = values[name] ?? '';
      return /^(item|place|action|state|note)\d*$/.test(name)
        ? englishText(value, depth + 1)
        : value;
    });
  }
  // HUD rows concatenate independent labels with these separators.
  if (/ · |\n|・/.test(source)) {
    const parts = source.split(/( · |\n|・)/);
    const translated = parts.map((part) => englishText(part, depth + 1));
    if (translated.some((part, index) => part !== parts[index]))
      return translated.map((part) => (part === '・' ? ' · ' : part)).join('');
  }
  return source;
}

export function translateText(source: string, selected = language): string {
  if (selected === 'ja' || !japanese.test(source)) return source;
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const trimmed = source.trim();
  const translated = englishText(trimmed);
  const result = translated === trimmed ? source : source.replace(trimmed, () => translated);
  // Live counters must not grow the cache indefinitely.
  if (cache.size >= 2048) cache.clear();
  cache.set(source, result);
  return result;
}

registerTranslations({
  はじめる: 'Start',
  ソロプレイで始める: 'Start solo play',
  オンラインで始める: 'Start online play',
  関わってくれた人たち: 'Contributors',
  戻る: 'Back',
  全画面表示: 'Fullscreen',
  全画面表示を終了: 'Exit fullscreen',
  タイトルメニュー: 'Title menu',
  'CRO-MAGNON MMO ゲーム画面': 'CRO-MAGNON MMO game',
  'CRO-MAGNON MMO — 氷河時代の旅人たちとマンモス':
    'CRO-MAGNON MMO — Ice Age travelers and a mammoth',
  '準備しています…': 'Getting ready…',
  再読み込み: 'Reload',
  'この画面では全画面表示を利用できません。': 'Fullscreen is unavailable here.',
  'ゲームを読み込めませんでした。通信を確認して再読み込みしてください。':
    'Could not load the game. Check your connection and reload.',
  ゲームを開始できませんでした: 'Could not start the game',
  '接続設定を読み込めません。': 'Could not load connection settings.',
  '接続設定を読み込めません。起動ウィンドウを確認してください。':
    'Could not load connection settings. Check the server window.',
  制作: 'Created by',
  開発者: 'Developer',
  監修: 'Advisers',
  友情出演: 'Special appearances',
  '{name}のXプロフィールを開く': 'Open {name} on X',
});
