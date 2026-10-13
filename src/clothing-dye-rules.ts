/** A texture's sRGB hue, saturation and value ranges. */
export type ColourRange = readonly [number, number, number, number, number, number];

export type ClothingDyeRule = {
  /** Clothing materials; the other materials keep their colours. */
  materials: readonly string[];
  /** Skin keeps its colour. */
  skin: ColourRange;
  /** Another range that keeps its colour. */
  keep?: ColourRange;
  /** Only texels whose luminance lies in this range take the dye. */
  luminance?: readonly [number, number];
  /** Bind-pose height fraction that takes the dye, from the lowest to the highest vertex. */
  height?: readonly [number, number];
  /** The dyed colour's floor, so dark cloth shows it too. */
  lift?: number;
};

const SKIN: ColourRange = [8, 42, 0.28, 0.78, 0.42, 1];

/**
 * Which texels of each verified character are cloth. The GLBs and their textures stay as
 * delivered: the shader classifies the texture's colour (and, where colours overlap, the
 * bind-pose height) and recolours the cloth with its own shading. Tuned on renders of the
 * delivered GLBs (docs/clothing-dye-2026-10-12.md). A model without a rule keeps its own colours
 * whatever dye is chosen, and the menu offers no dye for it. The public build filters this
 * data module to its released character models before bundling.
 */
export const CLOTHING_DYE_RULES: Readonly<Record<string, Readonly<ClothingDyeRule>>> =
  Object.freeze({
    'cro-magnon-woman': { materials: ['BodySurface'], skin: [8, 40, 0.3, 0.75, 0.62, 1] },
    'cro-magnon-hunter': { materials: ['BodySurface'], skin: SKIN },
    // Black cloth: a higher floor lets it show the colour.
    'cat-kunoichi': { materials: ['BodySurface'], skin: SKIN, lift: 0.45 },
    // The dress only: the pale and the dark fur, the eyes, the head and the feet keep theirs.
    'desert-fennec-mage': {
      materials: ['DesertFennecMageSurface'],
      skin: SKIN,
      keep: [70, 220, 0.1, 1, 0.05, 1],
      luminance: [0.13, 0.62],
      height: [0.25, 0.62],
    },
    // It wears only a loincloth: the fur takes the colour, the chest and face keep theirs.
    'giant-ape': { materials: ['GiantApeSurface'], skin: [4, 46, 0.1, 0.78, 0.5, 1] },
    // The sweater only: the red tentacles and their suckers keep their colours.
    'maruimo-octopus': {
      materials: ['MaruimoOctopusSurface'],
      skin: [5, 27, 0.1, 0.55, 0.8, 1],
      keep: [335, 20, 0.5, 1, 0, 1],
      height: [0.3, 0.6],
      lift: 0.3,
    },
  });
