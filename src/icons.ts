// Line icons shared by the title shell and the game screens.
const icons = {
  boat: '<path d="M3 12h18l-3 6H6l-3-6Zm9-9v9M5 21c2-2 4 2 7 0s5 2 7 0"/>',
  unarmed:
    '<path d="M5 12V8a2 2 0 0 1 4 0V6a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v7l-4 5H9l-6-7a2 2 0 0 1 2-2Z"/>',
  shell:
    '<path d="M12 3C5 3 2 8 3 13l5 7h8l5-7c1-5-2-10-9-10Z"/><path d="m8 20-3-9m7 9V7m4 13 3-9M9 20h6"/>',
  blade: '<path d="m12 2 6 9-2 10H8L6 11l6-9Zm0 0v19m0-10 6 0m-6 4-5-4"/>',
  katana: '<path d="m4 21 4-4m-2-3 4 4M8 15C15 10 20 5 21 2c-4 1-9 6-13 11Z"/>',
  magic:
    '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/><path d="m20 3 1 1M3 20l1 1"/>',
  science:
    '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><ellipse cx="12" cy="12" rx="4" ry="10"/>',
  spear: '<path d="m4 21 12-14m-2 0 6-5-1 8-5-3Z"/>',
  meat: '<path d="M5 6c3-3 9-3 12 0s4 9 0 12-10 3-13-1S2 9 5 6Z"/><path d="M7 8c2-2 6-2 8 0s2 6 0 8-6 2-8 0-2-6 0-8Z"/>',
  flame:
    '<path d="M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7-1 4 2 5 3-5Z"/><path d="M10 17c0-2 2-3 2-5 3 3 4 6 0 7-1 0-2-1-2-2Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  // A backpack with side pockets: the menu opens on it, and small it must not read as a padlock.
  bag: '<path d="M6.5 11a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5v8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-8Z"/><path d="M10.2 6V4.6a1.8 1.8 0 0 1 3.6 0V6M9 21v-3.2a1.3 1.3 0 0 1 1.3-1.3h3.4a1.3 1.3 0 0 1 1.3 1.3V21M9 12h6"/><path d="M6.5 13.5H5a1 1 0 0 0-1 1V18a1.5 1.5 0 0 0 1.5 1.5h1m11-6H19a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5h-1"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5"/>',
  paw: '<ellipse cx="5" cy="10" rx="1.7" ry="2.3" transform="rotate(-25 5 10)"/><ellipse cx="9" cy="5.7" rx="1.7" ry="2.3" transform="rotate(-12 9 5.7)"/><ellipse cx="15" cy="5.7" rx="1.7" ry="2.3" transform="rotate(12 15 5.7)"/><ellipse cx="19" cy="10" rx="1.7" ry="2.3" transform="rotate(25 19 10)"/><path d="M12 11.4c-2 0-2.8 1.9-4.3 3.4-1.3 1.3-2.2 2.4-1.6 4.1.5 1.6 2.1 2 3.6 1.4 1.5-.7 3.1-.7 4.6 0 1.5.6 3.1.2 3.6-1.4.6-1.7-.3-2.8-1.6-4.1-1.5-1.5-2.3-3.4-4.3-3.4Z"/>',
  // One figure for the player's own character; companions use the paw.
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-1.5a7 7 0 0 1 14 0V21"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3V4Zm9 2v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  wood: '<path d="m4 16 12-12 5 5L9 21 4 16Z"/><ellipse cx="6.5" cy="18.5" rx="3" ry="2.5" transform="rotate(45 6.5 18.5)"/><path d="m11 13 5-5m-3 7 5-5"/>',
  stone:
    '<path d="m3 16 4-10 10-2 5 10-6 7H7l-4-5Z"/><path d="m7 6 5 7 5-9m-5 9 4 8m-4-8-9 3m9-3 10 1"/>',
  berry:
    '<circle cx="8" cy="14" r="4"/><circle cx="16" cy="14" r="4"/><circle cx="12" cy="18" r="4"/><path d="M12 11V5m0 3C5 9 6 2 6 2s7 0 6 6Zm0 0c0-6 7-6 7-6s0 6-7 6"/>',
  axe: '<path d="m5 22 12-17m-5 4 5 4 5-7-7-5-3 8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  sound: '<path d="M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 4 5 9H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  gear: '<path d="M10.08 4.85 10.66 2.5a9.6 9.6 0 0 1 2.68 0l.58 2.35a7.4 7.4 0 0 1 1.78.74l2.08-1.26a9.6 9.6 0 0 1 1.89 1.89L18.41 8.3a7.4 7.4 0 0 1 .74 1.78l2.36.58a9.6 9.6 0 0 1 0 2.68l-2.36.58a7.4 7.4 0 0 1-.74 1.78l1.26 2.08a9.6 9.6 0 0 1-1.89 1.89l-2.08-1.26a7.4 7.4 0 0 1-1.78.74l-.58 2.36a9.6 9.6 0 0 1-2.68 0l-.58-2.36a7.4 7.4 0 0 1-1.78-.74l-2.08 1.26a9.6 9.6 0 0 1-1.89-1.89l1.26-2.08a7.4 7.4 0 0 1-.74-1.78l-2.36-.58a9.6 9.6 0 0 1 0-2.68l2.36-.58a7.4 7.4 0 0 1 .74-1.78L4.33 6.22a9.6 9.6 0 0 1 1.89-1.89L8.3 5.59a7.4 7.4 0 0 1 1.78-.74Z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  chat: '<path d="M21 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9Z"/><path d="M7 8h10M7 12h7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  jump: '<path d="m6 12.5 6-6 6 6"/><path d="m6 18.5 6-6 6 6"/>',
  leaf: '<path d="M20 3C4 1 1 13 8 17c7 5 14-4 12-14Z"/><path d="M4 22 16 8"/>',
  link: '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
  exchange: '<path d="M3 7h17l-4-4m4 14H3l4 4M20 7l-4 4M3 17l4-4"/>',
  wave: '<path d="M5 12V8a2 2 0 0 1 3 0V4a2 2 0 0 1 3 0v7-8a2 2 0 0 1 3 0v8-6a2 2 0 0 1 3 0v8l2-3c2-2 4 0 3 2l-4 8c-4 4-13 1-13-4v-4Z"/>',
  // Phone action glyphs: what the finger does here, read without a label.
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>',
  hand: '<path d="M7.5 12.5V6a1.5 1.5 0 0 1 3 0v5m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v5.5m0-3a1.5 1.5 0 0 1 3 0V15c0 3.9-3.1 7-7 7h-.6c-2.4 0-4.2-1.1-5.5-3.1l-2.8-4.4a1.5 1.5 0 0 1 2.5-1.7l1.4 1.9"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  mammoth:
    '<path d="M3.5 19v-5.5C3.5 9 6.5 6 10.5 6h2c2.6 0 4.7 1.6 5.6 3.9l.6 1.6c.4 1.1.6 2.3.6 3.5 0 1.9.6 3.2 1.7 4"/><path d="M7.5 19v-3m5 3v-3.5"/><path d="M19.2 12.5c-2.3-.4-4 .7-4.7 2.9"/><path d="M13 9.5h.01"/>',
  call: '<circle cx="12" cy="9" r="2.6"/><path d="M7.5 18.5a4.5 4.5 0 0 1 9 0"/><path d="M5 5.5a8.5 8.5 0 0 0 0 9M19 5.5a8.5 8.5 0 0 1 0 9M7.6 7.6a4.6 4.6 0 0 0 0 4.8M16.4 7.6a4.6 4.6 0 0 1 0 4.8"/>',
  recenter:
    '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><circle cx="12" cy="12" r="2.2"/>',
  throw:
    '<circle cx="18" cy="6" r="2.6"/><path d="M4 20c1.6-6.4 5.4-10.6 10.6-12.4"/><path d="m11.8 6.4 3 1.2-1.4 2.9"/>',
  torch:
    '<path d="M10 21.5h4l1.2-9H8.8l1.2 9Z"/><path d="M12 2.5c2.4 2.3 3.6 4.2 3.6 6.1a3.6 3.6 0 0 1-7.2 0c0-1.4.6-2.6 1.7-3.6.1 1.3.8 2 1.9 2.1-.7-1.6-.7-3.1 0-4.6Z"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  tentacle:
    '<path d="M8 21c-2.5-3-2-7 1.5-9 3-1.7 5.5-1.4 6.5-4 .8-2-.8-3.8-2.7-3.4-1.6.3-2.2 2.2-1 3"/><path d="M12.5 21c-.5-2.4.6-4.3 3.2-5 2-.6 3.3.4 3.3 1.8"/>',
};
export const icon = (name: string, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(icons as Record<string, string>)[name] || icons.leaf}</svg>`;
