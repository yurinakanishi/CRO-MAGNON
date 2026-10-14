import { CAVE_BEND } from '../shared/camp-cave-layout.mjs';

// Pixel bounds preserve each complete motif in the unmodified generated atlas.
export const CAVE_MOTIFS = {
  // One unmodified painting: the small 524 amongst mammoth, horses and aurochs.
  creature524: [0, 0, 2171, 724],
  // One unmodified transparent painting: Rimo, two horses, aurochs and deer.
  rimoFrieze: [0, 0, 2172, 724],
  roundBots: [0, 0, 2172, 724],
  shapeBots: [0, 0, 2172, 724],
  maruimoFrieze: [0, 0, 2172, 724],
  maeKohaku: [0, 0, 2172, 724],
  // Contributors' companions among horses, an ibex, a stag, an aurochs and a bison.
  friendsMeadow: [0, 0, 2172, 724],
  friendsRiver: [0, 0, 2172, 724],
  // The deepened gallery's ninth procession is served as painted, at 1024 px.
  daredaroFrieze: [0, 0, 1024, 341],
  bison: [805, 40, 1254, 418],
  redHorse: [3, 443, 431, 779],
  ochreHorse: [435, 442, 827, 779],
  mammoth: [823, 437, 1254, 786],
  deer: [15, 782, 430, 1230],
  hands: [444, 798, 813, 1205],
  signs: [832, 821, 1236, 1215],
} as const;

// Each frieze's original image. The game loads the camp-cave manifest's record
// of it (caveMuralImages), which may be a resized copy.
export const CAVE_EXTRA_PIGMENTS = {
  roundBots: {
    url: '/models/camp-cave/bot-round-lascaux-r31.png',
    subjects: ['white', 'blue', 'green', 'purple', 'orange'],
  },
  shapeBots: {
    url: '/models/camp-cave/bot-shapes-lascaux-r31.png',
    subjects: ['beret', 'frog', 'triangle', 'heart'],
  },
  maruimoFrieze: { url: '/models/camp-cave/maruimo-lascaux-r33.png', subjects: ['maruimo-mascot'] },
  maeKohaku: { url: '/models/camp-cave/mae-kohaku-lascaux-r31.png', subjects: ['mae', 'kohaku'] },
  friendsMeadow: {
    url: '/models/camp-cave/friends-meadow-lascaux-r34.png',
    subjects: ['saber-mascot', 'fairy-mascot', 'nukonuko-mascot', 'sagasa-mascot'],
  },
  friendsRiver: {
    url: '/models/camp-cave/friends-river-lascaux-r35.png',
    subjects: ['otani-mascot', 'urata-mascot', 'howkey-scientist', 'rei-mascot'],
  },
  daredaroFrieze: { url: '/models/camp-cave/daredaro-lascaux-r37.png', subjects: ['daredaro'] },
} as const;
export type CaveExtraPigment = keyof typeof CAVE_EXTRA_PIGMENTS;

export type CaveMural = {
  motif: keyof typeof CAVE_MOTIFS;
  wall: 'east' | 'west';
  centre: number;
  bottom: number;
  width: number;
  strength: number;
};

// One scale and pigment density for all main processions. The upper animal
// register fills the limestone between the processions and the roof. Wall
// coordinates follow local Z; Rimo and 524 still face each other. The cave's
// r28 deepening added one 7.9 m bay: its east wall holds the ninth procession.
export const CAVE_MURALS: readonly CaveMural[] = [
  { motif: 'roundBots', wall: 'east', centre: -5.4, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'maruimoFrieze', wall: 'east', centre: -13.3, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'rimoFrieze', wall: 'east', centre: -21.2, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'maeKohaku', wall: 'east', centre: -29.1, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'shapeBots', wall: 'west', centre: -5.4, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'friendsMeadow', wall: 'west', centre: -13.3, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'creature524', wall: 'west', centre: -21.2, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'friendsRiver', wall: 'west', centre: -29.1, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'daredaroFrieze', wall: 'east', centre: -37.0, bottom: 1.4, width: 7.5, strength: 0.84 },
  { motif: 'redHorse', wall: 'east', centre: -2.9, bottom: 3.75, width: 1.59, strength: 0.8 },
  { motif: 'bison', wall: 'east', centre: -6.4, bottom: 3.75, width: 1.48, strength: 0.8 },
  { motif: 'ochreHorse', wall: 'east', centre: -9.9, bottom: 3.75, width: 1.45, strength: 0.8 },
  { motif: 'deer', wall: 'east', centre: -13.4, bottom: 3.75, width: 1.16, strength: 0.8 },
  { motif: 'mammoth', wall: 'east', centre: -16.9, bottom: 3.75, width: 1.54, strength: 0.8 },
  { motif: 'redHorse', wall: 'east', centre: -20.4, bottom: 3.75, width: 1.59, strength: 0.8 },
  { motif: 'ochreHorse', wall: 'east', centre: -23.9, bottom: 3.75, width: 1.45, strength: 0.8 },
  { motif: 'bison', wall: 'east', centre: -27.4, bottom: 3.75, width: 1.48, strength: 0.8 },
  { motif: 'deer', wall: 'east', centre: -30.9, bottom: 3.75, width: 1.16, strength: 0.8 },
  { motif: 'mammoth', wall: 'east', centre: -34.4, bottom: 3.75, width: 1.54, strength: 0.8 },
  { motif: 'redHorse', wall: 'east', centre: -37.9, bottom: 3.75, width: 1.59, strength: 0.8 },
  { motif: 'mammoth', wall: 'west', centre: -2.9, bottom: 3.75, width: 1.54, strength: 0.8 },
  { motif: 'ochreHorse', wall: 'west', centre: -6.4, bottom: 3.75, width: 1.45, strength: 0.8 },
  { motif: 'deer', wall: 'west', centre: -9.9, bottom: 3.75, width: 1.16, strength: 0.8 },
  { motif: 'redHorse', wall: 'west', centre: -13.4, bottom: 3.75, width: 1.59, strength: 0.8 },
  { motif: 'bison', wall: 'west', centre: -16.9, bottom: 3.75, width: 1.48, strength: 0.8 },
  { motif: 'deer', wall: 'west', centre: -20.4, bottom: 3.75, width: 1.16, strength: 0.8 },
  { motif: 'mammoth', wall: 'west', centre: -23.9, bottom: 3.75, width: 1.54, strength: 0.8 },
  { motif: 'ochreHorse', wall: 'west', centre: -27.4, bottom: 3.75, width: 1.45, strength: 0.8 },
  { motif: 'redHorse', wall: 'west', centre: -30.9, bottom: 3.75, width: 1.59, strength: 0.8 },
  { motif: 'bison', wall: 'west', centre: -34.4, bottom: 3.75, width: 1.48, strength: 0.8 },
  { motif: 'deer', wall: 'west', centre: -37.9, bottom: 3.75, width: 1.16, strength: 0.8 },
  { motif: 'hands', wall: 'east', centre: -11.65, bottom: 4.3, width: 0.75, strength: 0.64 },
  { motif: 'signs', wall: 'east', centre: -25.65, bottom: 4.35, width: 0.8, strength: 0.64 },
  { motif: 'signs', wall: 'west', centre: -11.65, bottom: 4.35, width: 0.8, strength: 0.64 },
  { motif: 'hands', wall: 'west', centre: -25.65, bottom: 4.3, width: 0.75, strength: 0.64 },
];

export function caveMuralHeight(mural: CaveMural) {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[mural.motif];
  return (mural.width * (y1 - y0)) / (x1 - x0);
}

export function caveMuralPigment(mural: CaveMural) {
  if (mural.motif in CAVE_EXTRA_PIGMENTS) return mural.motif;
  return mural.motif === 'creature524'
    ? 'character524'
    : mural.motif === 'rimoFrieze'
      ? 'rimoFrieze'
      : 'atlas';
}

export type CaveMotif = keyof typeof CAVE_MOTIFS;
export type CaveImageSize = { readonly width: number; readonly height: number };
export type CaveExtraKey = keyof typeof CAVE_EXTRA_PIGMENTS;

/** The pixel size a motif's rectangle is measured in: the original size of the
 * image it is painted in. Full-image friezes span their own rectangle. */
export function caveMotifSource(motif: CaveMotif): CaveImageSize {
  const [, , x1, y1] = CAVE_MOTIFS[motif];
  const extra = motif in CAVE_EXTRA_PIGMENTS;
  const [imageWidth, imageHeight] =
    extra || motif === 'creature524'
      ? [x1, y1]
      : motif === 'rimoFrieze'
        ? [2172, 724]
        : [1254, 1254];
  return { width: imageWidth, height: imageHeight };
}

/** A motif's UV offset and scale in its image (V up, as sampled). Rectangles are
 * normalised by the image's original size, so a whole-image resize keeps them. */
export function caveMotifUV(motif: CaveMotif, source = caveMotifSource(motif)) {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[motif];
  return {
    offset: [x0 / source.width, 1 - y1 / source.height],
    scale: [(x1 - x0) / source.width, (y1 - y0) / source.height],
  } as const;
}

/** A served cave image as the camp-cave manifest records it. */
export type CaveImageRecord = {
  readonly url: string;
  /** The served file, verified before it is decoded (verified-texture.ts). */
  readonly sha256: string;
  readonly bytes: number;
  readonly image: CaveImageSize;
  /** The original size, recorded when the served image was resized. */
  readonly uvSource?: CaveImageSize;
};
export type CaveMuralImages = {
  readonly pigment: CaveImageRecord;
  readonly characterPigment: CaveImageRecord;
  readonly rimoPigment: CaveImageRecord;
  readonly extras: Readonly<Record<CaveExtraKey, CaveImageRecord>>;
};

const isSize = (size: unknown): size is CaveImageSize =>
  Number.isSafeInteger((size as CaveImageSize)?.width) &&
  Number.isSafeInteger((size as CaveImageSize)?.height) &&
  (size as CaveImageSize).width > 0 &&
  (size as CaveImageSize).height > 0;

/** The pixel space of a served image's motif rectangles: `uvSource` when the
 * image was resized, else its own size. Never the resized width and height. A
 * resize must keep the whole image and its aspect, within a pixel of rounding. */
export function caveUvSource(record: CaveImageRecord, where = record?.url): CaveImageSize {
  const image = record?.image,
    uvSource = record?.uvSource;
  if (!isSize(image)) throw new Error(`${where}: no image width and height`);
  if (uvSource === undefined) return { width: image.width, height: image.height };
  if (!isSize(uvSource)) throw new Error(`${where}: uvSource needs a width and a height`);
  const slack = Math.max(uvSource.width, uvSource.height);
  if (
    image.width > uvSource.width ||
    image.height > uvSource.height ||
    Math.abs(image.width * uvSource.height - image.height * uvSource.width) > slack
  )
    throw new Error(
      `${where}: a ${image.width}x${image.height} image is not a whole-image resize of its ${uvSource.width}x${uvSource.height} uvSource`,
    );
  return { width: uvSource.width, height: uvSource.height };
}

/** The camp-cave manifest's mural images: the records the loaders load, each
 * checked against the rectangles that sample it. Fails, rather than mapping any
 * artwork through the wrong pixel space, when a record is missing or its UV
 * source is not the size CAVE_MOTIFS was measured in. */
export function caveMuralImages(asset): CaveMuralImages {
  const record = (where: string, value) => {
    if (typeof value?.url !== 'string' || !value.url)
      throw new Error(`camp-cave ${where}: the manifest records no image`);
    caveUvSource(value, `camp-cave ${where}`);
    return value as CaveImageRecord;
  };
  const extras = {} as Record<CaveExtraKey, CaveImageRecord>;
  for (const key of Object.keys(CAVE_EXTRA_PIGMENTS) as CaveExtraKey[])
    extras[key] = record(`mascotPigments.${key}`, asset?.mascotPigments?.[key]);
  const images: CaveMuralImages = {
    pigment: record('pigment', asset?.pigment),
    characterPigment: record('characterPigment', asset?.characterPigment),
    rimoPigment: record('rimoPigment', asset?.rimoPigment),
    extras,
  };
  for (const motif of Object.keys(CAVE_MOTIFS) as CaveMotif[]) {
    const [where, image]: [string, CaveImageRecord] =
      motif in CAVE_EXTRA_PIGMENTS
        ? [`mascotPigments.${motif}`, extras[motif as CaveExtraKey]]
        : motif === 'creature524'
          ? ['characterPigment', images.characterPigment]
          : motif === 'rimoFrieze'
            ? ['rimoPigment', images.rimoPigment]
            : ['pigment', images.pigment];
    const measured = caveMotifSource(motif),
      mapped = caveUvSource(image, `camp-cave ${where}`);
    if (mapped.width !== measured.width || mapped.height !== measured.height)
      throw new Error(
        `camp-cave ${where}: ${image.url} maps CAVE_MOTIFS.${motif} by ${mapped.width}x${mapped.height}; its rectangle is measured in ${measured.width}x${measured.height} pixels`,
      );
  }
  return images;
}

/** Painted subjects the mural composition replaced with animals (cave-mural-visibility.json),
 * as each composed image's provenance records them. */
export function hiddenMuralSubjects(asset): string[] {
  const { extras, ...main } = caveMuralImages(asset);
  return [...Object.values(main), ...Object.values(extras)].flatMap(
    (image) =>
      (image as { provenance?: { muralComposition?: { hidden?: string[] } } }).provenance
        ?.muralComposition?.hidden ?? [],
  );
}

const f = (n: number) => n.toFixed(6);
export const caveMuralShader = CAVE_MURALS.map((m) => {
  const extra = m.motif in CAVE_EXTRA_PIGMENTS;
  const { offset, scale } = caveMotifUV(m.motif);
  const sampler = extra
    ? `cave_${m.motif}`
    : m.motif === 'creature524'
      ? 'caveCharacter524'
      : m.motif === 'rimoFrieze'
        ? 'caveRimoPigment'
        : 'cavePigment';
  const u =
    m.wall === 'east'
      ? `(${f(m.centre + m.width / 2)}-cavePosition.z)/${f(m.width)}`
      : `(cavePosition.z-(${f(m.centre - m.width / 2)}))/${f(m.width)}`;
  const wall =
    m.wall === 'east' ? 'step(caveAcross,-1.1)*insideRock' : 'step(1.1,caveAcross)*insideRock';
  // Let pigment follow the inward-facing folds and the wall-to-roof curve.
  // A steep-normal cutoff used to erase heads and legs on these real triangles.
  return `{
    float caveCurveT=clamp(-cavePosition.z/${f(CAVE_BEND.depth)},0.0,1.0);
    caveCurveT=caveCurveT*caveCurveT*(3.0-2.0*caveCurveT);
    float caveAcross=cavePosition.x-${f(CAVE_BEND.offset)}*caveCurveT;
    vec2 muralUV=vec2(${u},(cavePosition.y-${f(m.bottom)})/${f(caveMuralHeight(m))});
    float muralSide=${wall};
    if(muralSide>0.0 && all(greaterThanEqual(muralUV,vec2(0.0))) && all(lessThanEqual(muralUV,vec2(1.0)))) {
      vec2 atlasUV=vec2(${f(offset[0])},${f(offset[1])})+clamp(muralUV,.001,.999)*vec2(${f(scale[0])},${f(scale[1])});
      vec4 paint=texture2D(${sampler},atlasUV);
      vec3 mineralPaint=paint.rgb*(.84+.24*rockLuma);
      diffuseColor.rgb=mix(diffuseColor.rgb,mineralPaint,paint.a*muralSide*${f(m.strength)});
    }
  }`;
}).join('\n');
