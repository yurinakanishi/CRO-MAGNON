import { getLanguage, onLanguageChange, toggleLanguage, translateText } from './language.js';

type Translation = { source: string; rendered: string };
const texts = new WeakMap<Node, Translation>();
const attributes = new WeakMap<Element, Map<string, Translation>>();
const roots = new WeakMap<HTMLElement, () => void>();
const translatedAttributes = ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt'];
const excluded = '[translate="no"], script, style, textarea, [contenteditable]';

function sourceFor(current: string, previous?: Translation): string {
  return previous && current === previous.rendered ? previous.source : current;
}

/** Used by hot HUD writers too: compare against the translated value, so a stable
 * English label does not cause a Japanese→English DOM rewrite on every frame. */
export function setLocalizedText(node: Node, value: unknown): boolean {
  const source = value == null ? '' : String(value);
  const verbatim = node.nodeType === 1 && (node as Element).closest?.(excluded);
  const rendered = verbatim ? source : translateText(source);
  const first = node.firstChild;
  const same = rendered
    ? first?.nodeType === 3 && !first.nextSibling && (first as Text).data === rendered
    : !first;
  if (!same) node.textContent = rendered;
  if (node.firstChild) texts.set(node.firstChild, { source, rendered });
  return !same;
}

export function setLocalizedAttribute(element: Element, name: string, value: string): boolean {
  const rendered = translateText(value);
  let saved = attributes.get(element);
  if (!saved) attributes.set(element, (saved = new Map()));
  saved.set(name, { source: value, rendered });
  if (element.getAttribute(name) === rendered) return false;
  element.setAttribute(name, rendered);
  return true;
}

function translateNode(node: Node): void {
  if (node.nodeType === 3) {
    if (node.parentElement?.closest(excluded)) return;
    const current = (node as Text).data;
    const source = sourceFor(current, texts.get(node));
    const rendered = translateText(source);
    if (source !== rendered || texts.has(node)) texts.set(node, { source, rendered });
    if (rendered !== current) (node as Text).data = rendered;
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (element.closest(excluded)) return;
  for (const name of translatedAttributes) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const source = sourceFor(current, attributes.get(element)?.get(name));
    setLocalizedAttribute(element, name, source);
  }
  for (const child of element.childNodes) translateNode(child);
}

/** Localize the presentation only. Inputs, protocol values, player names and chat
 * are never modified. Observe only new text/accessible labels, not 3D transforms,
 * style, counters in datasets, or the render loop. Japanese needs no observer.
 * Keeping the original text in WeakMaps makes the switch reversible without
 * replacing elements, losing focus, or restarting the game. */
export function installLanguageUI(root: HTMLElement): void {
  const installed = roots.get(root);
  if (installed) return installed();
  const observer = new MutationObserver((records) => {
    observer.disconnect();
    const changed = new Set<Node>();
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) changed.add(node);
      else changed.add(record.target);
    }
    for (const node of changed) if (root.contains(node)) translateNode(node);
    observe();
  });
  const observe = () => {
    if (getLanguage() === 'en')
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: translatedAttributes,
      });
  };
  const refresh = () => {
    observer.disconnect();
    root.ownerDocument.documentElement.lang = getLanguage();
    translateNode(root);
    updateLanguageButton(root);
    observe();
  };
  roots.set(root, refresh);
  onLanguageChange(refresh);
  refresh();
}

function updateLanguageButton(root: ParentNode): void {
  const button = root.querySelector<HTMLButtonElement>('#title-language');
  if (!button) return;
  const english = getLanguage() === 'en';
  button.dataset.language = getLanguage();
  button.setAttribute('aria-pressed', String(english));
  button.setAttribute('aria-label', english ? '日本語に切り替える' : 'Switch to English');
}

export function bindLanguageToggle(root: ParentNode, signal?: AbortSignal): void {
  updateLanguageButton(root);
  root.querySelector('#title-language')?.addEventListener('click', toggleLanguage, { signal });
}
