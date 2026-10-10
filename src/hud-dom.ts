/**
 * HUD writes that leave the document alone when it already shows the value. Chrome treats an
 * equal write as a change all the same (a replaced text node, a re-set attribute), and the
 * HUD's `:has()` rules then restyle the whole viewport. Each helper ends in exactly the state
 * the plain assignment it stands for would leave, and reports whether it had to write.
 */

const TEXT_NODE = 3;

/** `node.textContent = value`: null and undefined clear it, anything else becomes a string. */
export function setText(node: Node, value: unknown): boolean {
  const text = value == null ? '' : String(value),
    first = node.firstChild;
  const same = text
    ? first?.nodeType === TEXT_NODE && !first.nextSibling && (first as Text).data === text
    : !first;
  if (same) return false;
  node.textContent = text;
  return true;
}

/** `element.hidden = value` or `element.disabled = value`: an empty attribute when true, none
 * when false. */
export function setFlag(
  element: HTMLElement & { disabled?: boolean },
  name: 'hidden' | 'disabled',
  value: boolean,
): boolean {
  if (element.getAttribute(name) === (value ? '' : null)) return false;
  element[name] = value;
  return true;
}

/** `element.setAttribute(name, value)`, which `className` (`class`) and `title` also set. */
export function setAttr(element: Element, name: string, value: unknown): boolean {
  const text = String(value);
  if (element.getAttribute(name) === text) return false;
  element.setAttribute(name, text);
  return true;
}

/** `Object.assign(element.dataset, values)`, writing only the entries that differ. */
export function setData(element: HTMLElement, values: Record<string, unknown>): number {
  let written = 0;
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    if (element.dataset[key] === text) continue;
    element.dataset[key] = text;
    written++;
  }
  return written;
}
