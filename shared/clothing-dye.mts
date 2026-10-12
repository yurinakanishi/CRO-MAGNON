/**
 * The clothing colours a traveler can choose, so friends gathered around one fire can tell
 * each other apart even in the same character. Null keeps the character's own colours.
 * Eight clear, distinct dyes: two never look alike on any playable character.
 */
export const CLOTHING_DYES = Object.freeze([
  { key: 'red', name: '赤', color: '#c0392b' },
  { key: 'yellow', name: '黄', color: '#f0c419' },
  { key: 'green', name: '緑', color: '#2f9e44' },
  { key: 'teal', name: '水色', color: '#1fa3b5' },
  { key: 'blue', name: '青', color: '#2f6fd8' },
  { key: 'purple', name: '紫', color: '#8e44ad' },
  { key: 'pink', name: '桃', color: '#e8609e' },
  { key: 'white', name: '白', color: '#e8e4da' },
] as const);
export type ClothingDye = (typeof CLOTHING_DYES)[number]['key'];

/** Each change is sent to the whole room, so one traveler changes at most four times a second. */
export const DYE_COOLDOWN_MS = 250;

/** A known dye key, or null (the character's own colours) for anything else. */
export function normalizeDye(value: unknown): ClothingDye | null {
  return CLOTHING_DYES.find((dye) => dye.key === value)?.key ?? null;
}

export function dyeColor(value: unknown): string | null {
  return CLOTHING_DYES.find((dye) => dye.key === value)?.color ?? null;
}
