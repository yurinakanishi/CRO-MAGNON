import type { Direction } from './gamepad-input.js';

type MenuRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

/** Follow the rendered layout; never turn an edge press into a wrap to another row. */
export function spatialMenuIndex(rects: readonly MenuRect[], index: number, direction: Direction) {
  const source = rects[index];
  if (!source) return rects.length ? 0 : -1;
  const vertical = direction === 'up' || direction === 'down';
  const forward = direction === 'down' || direction === 'right';
  const start = vertical ? 'top' : 'left';
  const end = vertical ? 'bottom' : 'right';
  const crossStart = vertical ? 'left' : 'top';
  const crossEnd = vertical ? 'right' : 'bottom';
  let best = index;
  let bestAligned = false;
  let bestDistance = Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === index) continue;
    const target = rects[i];
    const gap = forward ? target[start] - source[end] : source[start] - target[end];
    // Edge separation also excludes neighbours on the same row with unequal heights.
    if (gap < -1) continue;
    const aligned =
      Math.min(source[crossEnd], target[crossEnd]) -
        Math.max(source[crossStart], target[crossStart]) >
      1;
    const offset =
      (target[crossStart] + target[crossEnd] - source[crossStart] - source[crossEnd]) / 2;
    const distance = Math.hypot(Math.max(0, gap), offset);
    if ((aligned && !bestAligned) || (aligned === bestAligned && distance < bestDistance)) {
      best = i;
      bestAligned = aligned;
      bestDistance = distance;
    }
  }
  return best;
}

export function menuItems(root: HTMLElement): HTMLElement[] {
  // The foremost item dialog owns navigation, including Tab and arrow keys.
  root = root.querySelector<HTMLElement>('[data-focus-scope]') ?? root;
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button,a[href],input,select,textarea,summary,[role="button"],[tabindex="0"]',
    ),
  ].filter(
    (el) =>
      !el.matches(':disabled,[type="hidden"]') &&
      !el.closest('[hidden],[inert]') &&
      !!el.getClientRects().length &&
      getComputedStyle(el).visibility !== 'hidden',
  );
}

export function menuKeyDirection(event: KeyboardEvent): Direction | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
    return null;
  if (
    event.target instanceof Element &&
    event.target.closest(
      'input:not([type="radio"]):not([type="checkbox"]),select,textarea,[contenteditable]',
    )
  )
    return null;
  switch (event.key.toLowerCase()) {
    case 'arrowup':
    case 'w':
      return 'up';
    case 'arrowdown':
    case 's':
      return 'down';
    case 'arrowleft':
    case 'a':
      return 'left';
    case 'arrowright':
    case 'd':
      return 'right';
    default:
      return null;
  }
}

export function adjacentMenuItem(
  items: HTMLElement[],
  current: HTMLElement | null,
  direction: Direction,
) {
  return items[
    spatialMenuIndex(
      items.map((el) => {
        const target = el.matches('input[type="radio"],input[type="checkbox"]')
          ? (el.closest('label') ?? el)
          : el;
        return target.getBoundingClientRect();
      }),
      current ? items.indexOf(current) : -1,
      direction,
    )
  ];
}
