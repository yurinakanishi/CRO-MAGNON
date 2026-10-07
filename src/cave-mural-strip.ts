/**
 * The 2D cave wall shown on the MMO title and loading screen. One baked strip
 * (scripts/build-cave-mural-strip.py) holds the six unmodified friezes over the
 * cave limestone; its width is a whole number of rock tiles, so two copies side
 * by side loop without a seam. Record: assets/title-credits/cave-mural-strip.json.
 */
export const CAVE_MURAL_STRIP = {
  url: '/title/cave-mural-strip.webp',
  preview: '/title/cave-mural-strip-preview.webp',
  width: 7600,
  height: 400,
} as const;

export interface MuralSpot {
  /** Matches a contributor key (the credit's `qr` id). */
  subject: string;
  /** The character's name as painted. */
  label: string;
  /** Fractions of the strip's width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Character bounds measured on the original frieze PNGs, as fractions of the strip. */
export const CAVE_MURAL_SPOTS: readonly MuralSpot[] = [
  { subject: 'rimo', label: 'りもねこ', x: 0.0647, y: 0.24862, w: 0.03308, h: 0.67956 },
  { subject: 'r524', label: '524', x: 0.41407, y: 0.48343, w: 0.02072, h: 0.37983 },
  { subject: 'maruimo', label: 'まるぃも', x: 0.59269, y: 0.38674, w: 0.02871, h: 0.53177 },
  { subject: 'mae', label: 'mae', x: 0.88027, y: 0.62155, w: 0.02108, h: 0.30663 },
  { subject: 'kohaku', label: 'こはくちゃん', x: 0.92934, y: 0.39365, w: 0.02944, h: 0.55249 },
];
