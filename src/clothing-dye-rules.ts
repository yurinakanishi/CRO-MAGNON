// Local play keeps every rule; the public build writes a copy without the excluded characters'
// (publicClothingDyeRulesModule in scripts/public-character-audit.mjs).

/** A colour range of a texture's sRGB colour: hue from and to in degrees (from above to wraps
 * through red), saturation from and to, value from and to. */
export type ColourRange = readonly [number, number, number, number, number, number];

export type ClothingDyeRule = {
  /** The materials that are clothing; the others (heads, the hunter's tribe accent) keep theirs. */
  materials: readonly string[];
  /** Skin keeps its colour. */
  skin: ColourRange;
  /** Another range that keeps its colour. */
  keep?: ColourRange;
  /** Only texels whose luminance lies in this range take the dye. */
  luminance?: readonly [number, number];
  /** Only this part of the mesh's bind-pose height takes the dye (0 its lowest vertex, 1 its top). */
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
 * whatever dye is chosen, and the menu offers no dye for it.
 */
export const CLOTHING_DYE_RULES: Readonly<Record<string, Readonly<ClothingDyeRule>>> =
  Object.freeze({
    // The chibi woman (2026-10-13): her hands have the colour of the cream fur, so her bare skin is a
    // material of its own (SkinSurface); the pink of the legs and neck left in the body is kept too,
    // and nothing above the collar (0.885 of the body's 0.917 m: hair tips at the neck cut) is dyed.
    'cro-magnon-woman': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 0.965],
    },
    // The chibi cast keeps the woman's rule (its bare skin is SkinSurface too); above 0.93 of the
    // body's 0.95 m are the braid ends beside the face, with the colour of the cape.
    'cro-magnon-girl-feather': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 0.93],
    },
    // The bear girl's dress only: her brown pelt cape continues the hood (head, never dyed) and
    // keeps its colour, as the boots and the belt.
    'cro-magnon-girl-bear': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      keep: [340, 34, 0.3, 1, 0, 0.68],
      height: [0, 0.88],
    },
    // The wolf girl's dress and boots: her grey pelt cape continues the hood (head, never dyed) and keeps its colour, as the white fur.
    'cro-magnon-girl-wolf': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      keep: [0, 360, 0, 0.28, 0.3, 0.95],
      height: [0, 0.88],
    },
    // The twin-tail girl: the woman's rule; above 0.93 of the body are hair tips at the neck cut.
    'cro-magnon-girl-twintails': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 0.93],
    },
    // The parka girl: the whole parka with its fur ruff and the boots; nothing of her hair is in the body.
    'cro-magnon-girl-reindeer': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 1],
    },
    // The headband boy: the vest, tunic, trousers, cuffs and boots; above 0.955 of the body are the hair tips at the neck cut.
    'cro-magnon-boy-headband': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 0.955],
    },
    // The lion boy: the cream tunic and the fur trims; the tawny pelt cape continues the hood (head, never dyed) and keeps its colour, as the brown shorts, boots and belt.
    'cro-magnon-boy-lion': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      keep: [340, 36, 0.3, 1, 0, 1],
      height: [0, 0.93],
    },
    // The braided boy: the cape, tunic, trousers and boots; above 0.91 of the body is the end of his braid beside the face, with the colour of the cape.
    'cro-magnon-boy-braid': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      height: [0, 0.91],
    },
    // The topknot boy: the tunic, the fur trims, the shorts and the boots; his red-ochre hand stencil keeps its colour, and nothing of his hair is in the body.
    'cro-magnon-boy-topknot': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      keep: [6, 16, 0.48, 0.65, 0.62, 0.82],
      height: [0, 1],
    },
    // The mammoth boy: the tunic and the cream fur trims; the reddish-brown pelt capelet continues the hood (head, never dyed) and keeps its colour, as the brown shorts, the belt and the red hem zigzag; the boots and leg warmers below 0.31 of the body keep theirs.
    'cro-magnon-boy-mammoth': {
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],
      keep: [340, 24, 0.3, 1, 0, 1],
      height: [0.31, 1],
    },
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
