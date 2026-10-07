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
  comingSoon: [0, 0, 2048, 512],
  bison: [805, 40, 1254, 418],
  redHorse: [3, 443, 431, 779],
  ochreHorse: [435, 442, 827, 779],
  mammoth: [823, 437, 1254, 786],
  deer: [15, 782, 430, 1230],
  hands: [444, 798, 813, 1205],
  signs: [832, 821, 1236, 1215],
} as const;

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
} as const;
export type CaveExtraPigment = keyof typeof CAVE_EXTRA_PIGMENTS | 'comingSoon';
// Only confirmed forthcoming characters belong to the preview, never released
// mascots or invented silhouettes. Empty until the next cast is specified.
export const CAVE_UPCOMING_CHARACTERS: readonly string[] = [];

export type CaveMural = {
  motif: keyof typeof CAVE_MOTIFS;
  wall: 'east' | 'west';
  centre: number;
  bottom: number;
  width: number;
  strength: number;
};

// Wall coordinates follow local Z into the cave. Released mascots are mixed
// among animal processions. Rimo is painted among animals on the
// east wall, at the same depth as the 524 painting on the opposite west wall.
export const CAVE_MURALS: readonly CaveMural[] = [
  { motif: 'roundBots', wall: 'east', centre: -7, bottom: 1.45, width: 9, strength: 0.86 },
  { motif: 'shapeBots', wall: 'west', centre: -7, bottom: 1.45, width: 9, strength: 0.86 },
  { motif: 'hands', wall: 'east', centre: -13.8, bottom: 4.35, width: 0.95, strength: 0.64 },
  { motif: 'maruimoFrieze', wall: 'east', centre: -14.8, bottom: 1.45, width: 5, strength: 0.82 },
  { motif: 'rimoFrieze', wall: 'east', centre: -21.2, bottom: 1.6, width: 7.5, strength: 0.82 },
  { motif: 'signs', wall: 'east', centre: -24.2, bottom: 4.45, width: 1.05, strength: 0.57 },
  { motif: 'maeKohaku', wall: 'east', centre: -28.5, bottom: 1.5, width: 6.4, strength: 0.86 },
  // The contributors' procession replaces the lone deer; its stag stays in the frieze.
  { motif: 'friendsMeadow', wall: 'west', centre: -14.3, bottom: 1.5, width: 5.6, strength: 0.84 },
  // Replaces the separated mammoth, 524 and horse with one continuous group.
  // The small floating mascot is roughly half the mammoth's painted height.
  { motif: 'creature524', wall: 'west', centre: -21.2, bottom: 1.6, width: 7.5, strength: 0.82 },
  { motif: 'hands', wall: 'west', centre: -24.7, bottom: 4.5, width: 1.0, strength: 0.64 },
  // The second procession (duck, Urata, Howkey, Rei) replaces the lone bison with an aurochs, a bison and a horse.
  { motif: 'friendsRiver', wall: 'west', centre: -27.6, bottom: 1.5, width: 5.0, strength: 0.84 },
  { motif: 'signs', wall: 'west', centre: -28.4, bottom: 4.5, width: 0.95, strength: 0.57 },
  { motif: 'comingSoon', wall: 'west', centre: -31.4, bottom: 2.1, width: 2.5, strength: 0.9 },
];

export function caveMuralHeight(mural: CaveMural) {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[mural.motif];
  return (mural.width * (y1 - y0)) / (x1 - x0);
}

export function caveMuralPigment(mural: CaveMural) {
  if (mural.motif in CAVE_EXTRA_PIGMENTS || mural.motif === 'comingSoon') return mural.motif;
  return mural.motif === 'creature524'
    ? 'character524'
    : mural.motif === 'rimoFrieze'
      ? 'rimoFrieze'
      : 'atlas';
}

const f = (n: number) => n.toFixed(6);
export const caveMuralShader = CAVE_MURALS.map((m) => {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[m.motif];
  const extra = m.motif in CAVE_EXTRA_PIGMENTS || m.motif === 'comingSoon';
  const [imageWidth, imageHeight] =
    extra || m.motif === 'creature524'
      ? [x1, y1]
      : m.motif === 'rimoFrieze'
        ? [2172, 724]
        : [1254, 1254];
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
    m.wall === 'east'
      ? 'step(caveAcross,-1.1)*smoothstep(.38,.78,caveNormal.x)'
      : 'step(1.1,caveAcross)*smoothstep(.38,.78,-caveNormal.x)';
  return `{
    float caveCurveT=clamp(-cavePosition.z/${f(CAVE_BEND.depth)},0.0,1.0);
    caveCurveT=caveCurveT*caveCurveT*(3.0-2.0*caveCurveT);
    float caveAcross=cavePosition.x-${f(CAVE_BEND.offset)}*caveCurveT;
    vec2 muralUV=vec2(${u},(cavePosition.y-${f(m.bottom)})/${f(caveMuralHeight(m))});
    float muralSide=${wall};
    if(muralSide>0.0 && all(greaterThanEqual(muralUV,vec2(0.0))) && all(lessThanEqual(muralUV,vec2(1.0)))) {
      vec2 atlasUV=vec2(${f(x0 / imageWidth)},${f(1 - y1 / imageHeight)})+clamp(muralUV,.001,.999)*vec2(${f((x1 - x0) / imageWidth)},${f((y1 - y0) / imageHeight)});
      vec4 paint=texture2D(${sampler},atlasUV);
      vec3 mineralPaint=paint.rgb*(.84+.24*rockLuma);
      diffuseColor.rgb=mix(diffuseColor.rgb,mineralPaint,paint.a*muralSide*${f(m.strength)});
    }
  }`;
}).join('\n');
