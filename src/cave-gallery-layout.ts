import { CAVE_BEND } from '../shared/camp-cave-layout.mjs';
import { CAVE_SUBJECT_ART, CAVE_ANIMAL_ART } from '../shared/cave-mural-art.mjs';

// Pixel bounds preserve each complete motif in the unmodified generated atlas.
export const CAVE_MOTIFS = {
  // Storage atlases, not panel-sized paintings. Their historical keys keep the
  // verified loader / adoption interface stable. Cutouts have independent UVs.
  creature524: [0, 0, 1024, 341],
  rimoFrieze: [0, 0, 1024, 341],
  roundBots: [0, 0, 1024, 341],
  shapeBots: [0, 0, 1024, 341],
  maruimoFrieze: [0, 0, 1024, 341],
  maeKohaku: [0, 0, 1024, 341],
  friendsMeadow: [0, 0, 1024, 341],
  friendsRiver: [0, 0, 1024, 341],
  daredaroFrieze: [0, 0, 1024, 341],
  ryuichiFrieze: [0, 0, 1024, 341],
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
    url: '/models/camp-cave/round-bots-sprites-r39-4e5d49d65bd48974.png',
    subjects: ['white', 'blue', 'green', 'purple', 'orange'],
  },
  maruimoFrieze: {
    url: '/models/camp-cave/maruimo-frieze-sprites-r39-8e8a66ed9d4b940e.png',
    subjects: ['maruimo-mascot'],
  },
  shapeBots: {
    url: '/models/camp-cave/shape-bots-sprites-r39-15effe4966ef81fd.png',
    subjects: ['beret', 'frog', 'triangle', 'heart'],
  },
  maeKohaku: {
    url: '/models/camp-cave/mae-kohaku-sprites-r42-f95eaf3ec1b5ca8b.png',
    subjects: ['mae', 'kohaku', 'jank0vic'],
  },
  friendsMeadow: {
    url: '/models/camp-cave/friends-meadow-sprites-r41-f42da105eead65b7.png',
    subjects: ['saber-mascot', 'fairy-mascot', 'nukonuko-mascot', 'sagasa-mascot'],
  },
  friendsRiver: {
    url: '/models/camp-cave/friends-river-sprites-r41-8ff4736a7f5ccd89.png',
    subjects: ['otani-mascot', 'urata-mascot', 'howkey-scientist', 'rei-mascot'],
  },
  daredaroFrieze: {
    url: '/models/camp-cave/daredaro-frieze-sprites-r41-8334b0a72303bc9e.png',
    subjects: ['daredaro'],
  },
  ryuichiFrieze: {
    url: '/models/camp-cave/ryuichi-frieze-sprites-r39-38a533fa1a5459cf.png',
    subjects: ['ryuichi'],
  },
} as const;
export type CaveExtraPigment = keyof typeof CAVE_EXTRA_PIGMENTS;

export type CaveMural = {
  /** A placement, distinct from a species painted more than once. */
  id?: string;
  motif: keyof typeof CAVE_MOTIFS;
  wall: 'east' | 'west';
  centre: number;
  bottom: number;
  width: number;
  strength: number;
  /** A single generated cutout within its storage atlas. */
  rect?: readonly [number, number, number, number];
  height?: number;
  distance?: number;
  subject?: string;
  kind?: 'character' | 'animal' | 'sign';
  layer?: 'underpainting' | 'foreground' | 'accent';
  /** Height of the measured foot, independent of body size and atlas margins. */
  footHeight?: number;
};

// Head crown to planted foot, in painted metres. Hats/ears keep their extra
// height; walking poses, transparent margins and storage atlases never set scale.
export const CAVE_MURAL_SCALE = {
  person: 1.4,
  small: 0.72,
  cat: 1.05,
  duck: 1.0,
  mammoth: 3.0,
  woollyRhino: 1.8,
  aurochs: 1.85,
  bison: 1.75,
  redHorse: 1.65,
  ochreHorse: 1.65,
  deer: 2.0,
  ibex: 1.55,
  hands: 0.65,
  signs: 0.65,
} as const;
export type CaveMuralArt = {
  readonly id: string;
  readonly motif: keyof typeof CAVE_MOTIFS;
  readonly size: keyof typeof CAVE_MURAL_SCALE;
  readonly rect: readonly [number, number, number, number];
  readonly aspect: number;
  readonly bodySpan: number;
  readonly foot: number;
  readonly lift?: number;
};

// Both walls were made by translating the same TRELLIS shell along X=f(Z).
// Integrate that bend, rather than stretching one metre of Z farther near the
// back. A shared 1 m lookup also makes CPU packing and the GPU projection agree.
const arc = [0];
const speed = (depth: number) => {
  const t = Math.max(0, Math.min(1, depth / CAVE_BEND.depth));
  return Math.hypot(1, (CAVE_BEND.offset * 6 * t * (1 - t)) / CAVE_BEND.depth);
};
for (let d = 0; d < Math.ceil(CAVE_BEND.depth); d++)
  arc.push(arc[d] + (speed(d) + 4 * speed(d + 0.5) + speed(d + 1)) / 6);

export function caveMuralDistance(localZ: number) {
  const depth = Math.max(0, Math.min(arc.length - 1.000001, -localZ)),
    i = Math.floor(depth);
  return arc[i] + (arc[i + 1] - arc[i]) * (depth - i);
}
export function caveMuralLocalZ(distance: number) {
  for (let i = 1; i < arc.length; i++)
    if (arc[i] >= distance) return -(i - 1 + (distance - arc[i - 1]) / (arc[i] - arc[i - 1]));
  throw new Error('Cave mural distance is outside the reconstructed gallery');
}

export const CAVE_MURAL_GALLERY = {
  startZ: -1.7,
  endZ: -40.3,
  baseline: 1.4,
  minGap: 0.16,
} as const;
export const CAVE_MURAL_LAYOUT_REVISION = '40';
const animalOrder = [
  'redHorse',
  'bison',
  'deer',
  'mammoth',
  'ibex',
  'ochreHorse',
  'aurochs',
  'woollyRhino',
];
const animalArt = new Map<string, CaveMuralArt>(CAVE_ANIMAL_ART.map((art) => [art.id, art]));

function measuredMural(
  art: CaveMuralArt,
  wall: CaveMural['wall'],
  kind: CaveMural['kind'],
): CaveMural {
  if (
    !(art.size in CAVE_MURAL_SCALE) ||
    !(art.bodySpan > 0 && art.bodySpan <= 1) ||
    !(art.aspect > 0 && Number.isFinite(art.aspect)) ||
    !art.rect ||
    art.rect.some((n) => !Number.isFinite(n)) ||
    art.rect[0] < 0 ||
    art.rect[1] < 0 ||
    art.rect[2] <= 0 ||
    art.rect[3] <= 0 ||
    art.rect[0] + art.rect[2] > 1.000001 ||
    art.rect[1] + art.rect[3] > 1.000001 ||
    !(art.foot >= art.bodySpan && art.foot <= 1)
  )
    throw new Error(`${art.id}: missing mural scale/paint measurements`);
  const height = CAVE_MURAL_SCALE[art.size] / art.bodySpan;
  return {
    id: `${wall}:${art.id}`,
    motif: art.motif,
    subject: art.id,
    kind,
    layer: kind === 'sign' ? 'accent' : 'foreground',
    wall,
    rect: art.rect,
    centre: 0,
    distance: 0,
    width: height * art.aspect,
    height,
    footHeight: CAVE_MURAL_GALLERY.baseline + (art.lift ?? 0),
    bottom: CAVE_MURAL_GALLERY.baseline + (art.lift ?? 0) - height * (1 - art.foot),
    strength: 0.84,
  };
}

/** Reflow the foreground without changing its accepted sizes. Older animal
 * paintings rise behind it at irregular heights, using exactly the same scale.
 * Storage atlases never reserve group-sized bays in either painted layer. */
export function buildCaveMurals(
  subjects: readonly CaveMuralArt[] = CAVE_SUBJECT_ART,
  hidden: readonly string[] = [],
): readonly CaveMural[] {
  if (new Set(subjects.map((s) => s.id)).size !== subjects.length)
    throw new Error('Duplicate cave mural character');
  for (const id of hidden)
    if (!subjects.some((s) => s.id === id)) throw new Error(`Unknown mural character: ${id}`);
  const result: CaveMural[] = [];
  for (const wall of ['east', 'west'] as const) {
    const people = subjects.filter(
      (s, i) =>
        !hidden.includes(s.id) &&
        (s.id === '524' ? 'west' : s.id === 'rimo-neko' ? 'east' : i % 2 ? 'west' : 'east') ===
          wall,
    );
    const animals = animalOrder.map((_, i) =>
      animalArt.get(animalOrder[(i + (wall === 'west' ? 3 : 0)) % animalOrder.length])!,
    );
    const stream = [
      ...people.map((s, i) => ({
        order: (i + 0.35) / people.length,
        mural: measuredMural(s, wall, 'character'),
      })),
      ...animals.map((s, i) => ({
        order: (i + 0.75) / animals.length,
        mural: measuredMural(s, wall, 'animal'),
      })),
    ]
      .sort((a, b) => a.order - b.order)
      .map((s) => s.mural);
    const start = caveMuralDistance(CAVE_MURAL_GALLERY.startZ),
      end = caveMuralDistance(CAVE_MURAL_GALLERY.endZ);
    // A dense procession of earlier paintings, rather than a separate row of
    // miniatures. Mammoths stay lower so their full 3 m bodies fit the real roof.
    // The two walls use different species orders and rises. Foreground people
    // are painted afterwards, keeping their faces clear where silhouettes cross.
    const underpainting = Array.from({ length: 16 }, (_, i) => {
      const animal = animals[(i * 3 + Math.floor(i / 8)) % animals.length];
      const mural = measuredMural(animal, wall, 'animal');
      const rises = [1.48, 1.12, 1.68, 1.28, 1.55, 0.96, 1.38, 1.76];
      const rise =
        animal.size === 'mammoth'
          ? 0.48
          : rises[(i + (wall === 'west' ? 3 : 0)) % rises.length] - (i % 3 === 1 ? 0.36 : 0);
      mural.id = `${wall}:${animal.id}:underpainting-${i}`;
      mural.layer = 'underpainting';
      mural.bottom += rise;
      mural.footHeight! += rise;
      mural.strength = 0.68 + (i % 3) * 0.04;
      return mural;
    });
    const occupied = underpainting.reduce((n, m) => n + m.width, 0),
      gap = (end - start - occupied) / (underpainting.length - 1);
    let cursor = start;
    for (const [i, mural] of underpainting.entries()) {
      // Small offsets break up horizontal rows without changing the endpoints.
      const stagger = i === 0 || i === underpainting.length - 1 ? 0 : [0.16, -0.2, 0.08][i % 3];
      mural.distance = cursor + mural.width / 2 + stagger;
      mural.centre = caveMuralLocalZ(mural.distance);
      result.push(mural);
      cursor += mural.width + gap;
    }
    const pack = (
      items: CaveMural[],
      from: number,
      to: number,
      edge: 'start' | 'end' | null = null,
    ) => {
      if (!items.length) return;
      const occupied = items.reduce((n, m) => n + m.width, 0);
      const gapCount = Math.max(1, items.length - 1 + Number(edge !== null));
      const gap = (to - from - occupied) / gapCount;
      if (gap < CAVE_MURAL_GALLERY.minGap)
        throw new Error(
          `${wall} cave mural is full: needs ${(occupied + CAVE_MURAL_GALLERY.minGap * gapCount).toFixed(2)} m; ${(to - from).toFixed(2)} m available. Review placement; character scales were not reduced.`,
        );
      let cursor = from + (edge === 'start' ? gap : 0);
      for (const mural of items) {
        mural.distance = cursor + mural.width / 2;
        mural.centre = caveMuralLocalZ(mural.distance);
        result.push(mural);
        cursor += mural.width + gap;
      }
    };
    const anchorIndex = stream.findIndex(
      (m) => m.subject === (wall === 'east' ? 'rimo-neko' : '524'),
    );
    if (anchorIndex >= 0) {
      const anchor = stream[anchorIndex],
        distance = caveMuralDistance(-21.2);
      const others = stream.filter((m) => m !== anchor);
      let split = -1,
        best = Infinity;
      for (let i = 1; i < others.length; i++) {
        const before = others.slice(0, i).reduce((n, m) => n + m.width, 0);
        const after = others.slice(i).reduce((n, m) => n + m.width, 0);
        const gapBefore = (distance - anchor.width / 2 - start - before) / i;
        const gapAfter = (end - distance - anchor.width / 2 - after) / (others.length - i);
        const score = Math.abs(gapBefore - gapAfter);
        if (Math.min(gapBefore, gapAfter) >= CAVE_MURAL_GALLERY.minGap && score < best) {
          split = i;
          best = score;
        }
      }
      if (split < 0)
        throw new Error(`${wall} cave mural is full; character scales were not reduced.`);
      pack(others.slice(0, split), start, distance - anchor.width / 2, 'end');
      anchor.distance = distance;
      anchor.centre = -21.2;
      result.push(anchor);
      pack(others.slice(split), distance + anchor.width / 2, end, 'start');
    } else pack(stream, start, end);
    // Small marks are accents in the same composition, clear of the tallest animals.
    for (const [i, id] of ['hands', 'signs'].entries()) {
      const mural = measuredMural(animalArt.get(id)!, wall, 'sign');
      mural.distance = start + (end - start) * (i ? 0.7 : 0.27);
      mural.centre = caveMuralLocalZ(mural.distance);
      mural.bottom = 4.65;
      mural.footHeight = mural.bottom + mural.height! * (1 - animalArt.get(id)!.foot);
      result.push(mural);
    }
  }
  return result;
}
export const CAVE_MURALS = buildCaveMurals();

export function caveMuralHeight(mural: CaveMural) {
  if (mural.height !== undefined) return mural.height;
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
        ? [1024, 341]
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

/** The cutout's own UVs inside the whole-image motif. Storage neighbours never
 * become a single painted group or contribute to its physical dimensions. */
export function caveMuralUV(mural: CaveMural) {
  const uv = caveMotifUV(mural.motif);
  if (!mural.rect) return uv;
  const [x, y, width, height] = mural.rect;
  return {
    offset: [uv.offset[0] + x * uv.scale[0], uv.offset[1] + (1 - y - height) * uv.scale[1]],
    scale: [width * uv.scale[0], height * uv.scale[1]],
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
  if (asset?.muralComposition?.version === 2) {
    const hidden = asset.muralComposition.hidden;
    if (!Array.isArray(hidden) || hidden.some((id) => typeof id !== 'string'))
      throw new Error('Invalid cave mural visibility');
    buildCaveMurals(CAVE_SUBJECT_ART, hidden);
    return [...hidden];
  }
  const { extras, ...main } = caveMuralImages(asset);
  return [...Object.values(main), ...Object.values(extras)].flatMap(
    (image) =>
      (image as { provenance?: { muralComposition?: { hidden?: string[] } } }).provenance
        ?.muralComposition?.hidden ?? [],
  );
}

const f = (n: number) => n.toFixed(6);
export function caveMuralShaderFor(hidden: readonly string[] = []) {
  // Piecewise-linear arc length, identical to caveMuralDistance on the CPU.
  const distanceShader =
    `float caveDepth=clamp(-cavePosition.z,0.0,${f(arc.length - 1.000001)});\nfloat caveDistance=caveDepth*${f(arc[1])};\n` +
    arc
      .slice(1, -1)
      .map(
        (_, i) =>
          `caveDistance+=${f(arc[i + 2] - 2 * arc[i + 1] + arc[i])}*max(0.0,caveDepth-${f(i + 1)});`,
      )
      .join('\n');
  return (
    distanceShader +
    `
    float caveCurveT=clamp(-cavePosition.z/${f(CAVE_BEND.depth)},0.0,1.0);
    caveCurveT=caveCurveT*caveCurveT*(3.0-2.0*caveCurveT);
    float caveAcross=cavePosition.x-${f(CAVE_BEND.offset)}*caveCurveT;
  ` +
    buildCaveMurals(CAVE_SUBJECT_ART, hidden)
      .map((m) => {
        const extra = m.motif in CAVE_EXTRA_PIGMENTS;
        const { offset, scale } = caveMuralUV(m);
        const sampler = extra
          ? `cave_${m.motif}`
          : m.motif === 'creature524'
            ? 'caveCharacter524'
            : m.motif === 'rimoFrieze'
              ? 'caveRimoPigment'
              : 'cavePigment';
        const u =
          m.wall === 'east'
            ? `(caveDistance-${f(m.distance! - m.width / 2)})/${f(m.width)}`
            : `(${f(m.distance! + m.width / 2)}-caveDistance)/${f(m.width)}`;
        const wall =
          m.wall === 'east'
            ? 'step(caveAcross,-1.1)*insideRock'
            : 'step(1.1,caveAcross)*insideRock';
        // Let pigment follow the inward-facing folds and the wall-to-roof curve.
        // A steep-normal cutoff used to erase heads and legs on these real triangles.
        return `{
    vec2 muralUV=vec2(${u},(cavePosition.y-${f(m.bottom)})/${f(caveMuralHeight(m))});
    float muralSide=${wall};
    if(muralSide>0.0 && all(greaterThanEqual(muralUV,vec2(0.0))) && all(lessThanEqual(muralUV,vec2(1.0)))) {
      vec2 atlasUV=vec2(${f(offset[0])},${f(offset[1])})+clamp(muralUV,.001,.999)*vec2(${f(scale[0])},${f(scale[1])});
      vec4 paint=texture2D(${sampler},atlasUV);
      vec3 mineralPaint=paint.rgb*(.84+.24*rockLuma);
      diffuseColor.rgb=mix(diffuseColor.rgb,mineralPaint,paint.a*muralSide*${f(m.strength)});
    }
  }`;
      })
      .join('\n')
  );
}
export const caveMuralShader = caveMuralShaderFor();
