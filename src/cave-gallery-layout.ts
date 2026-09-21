import { CAVE_BEND } from '../shared/camp-cave-layout.mjs';

// Pixel bounds preserve each complete motif in the unmodified generated atlas.
export const CAVE_MOTIFS = {
  cat: [4, 67, 456, 411],
  // The faithful 524 uses its own unmodified transparent image.
  creature524: [0, 0, 1254, 1254],
  bison: [805, 40, 1254, 418],
  redHorse: [3, 443, 431, 779],
  ochreHorse: [435, 442, 827, 779],
  mammoth: [823, 437, 1254, 786],
  deer: [15, 782, 430, 1230],
  hands: [444, 798, 813, 1205],
  signs: [832, 821, 1236, 1215],
} as const;

export type CaveMural = {
  motif: keyof typeof CAVE_MOTIFS;
  wall: 'east' | 'west';
  centre: number;
  bottom: number;
  width: number;
  strength: number;
};

// Wall coordinates follow local Z into the cave. Every painting starts beyond
// the midpoint of the walkable chamber; the user motifs occur once each on
// opposite walls and at different depths.
export const CAVE_MURALS: readonly CaveMural[] = [
  { motif: 'hands', wall: 'east', centre: -13.8, bottom: 4.35, width: 0.95, strength: 0.64 },
  { motif: 'redHorse', wall: 'east', centre: -15.2, bottom: 1.65, width: 2.8, strength: 0.78 },
  { motif: 'mammoth', wall: 'east', centre: -19.2, bottom: 1.6, width: 3, strength: 0.81 },
  { motif: 'bison', wall: 'east', centre: -22.8, bottom: 1.7, width: 2.8, strength: 0.79 },
  { motif: 'signs', wall: 'east', centre: -24.2, bottom: 4.45, width: 1.05, strength: 0.57 },
  { motif: 'cat', wall: 'east', centre: -26.1, bottom: 1.8, width: 3.3, strength: 0.84 },
  { motif: 'deer', wall: 'east', centre: -29.2, bottom: 1.6, width: 1.7, strength: 0.72 },
  { motif: 'ochreHorse', wall: 'east', centre: -31.2, bottom: 1.55, width: 1.85, strength: 0.72 },
  { motif: 'deer', wall: 'west', centre: -14, bottom: 1.6, width: 1.8, strength: 0.72 },
  { motif: 'mammoth', wall: 'west', centre: -17.4, bottom: 1.6, width: 3, strength: 0.81 },
  { motif: 'creature524', wall: 'west', centre: -21.2, bottom: 1.5, width: 3.5, strength: 0.94 },
  { motif: 'redHorse', wall: 'west', centre: -24.8, bottom: 1.65, width: 2.8, strength: 0.78 },
  { motif: 'hands', wall: 'west', centre: -24.7, bottom: 4.5, width: 1.0, strength: 0.64 },
  { motif: 'bison', wall: 'west', centre: -28.6, bottom: 1.5, width: 2.7, strength: 0.79 },
  { motif: 'signs', wall: 'west', centre: -28.4, bottom: 4.5, width: 0.95, strength: 0.57 },
  { motif: 'ochreHorse', wall: 'west', centre: -31.2, bottom: 1.5, width: 1.7, strength: 0.72 },
];

export function caveMuralHeight(mural: CaveMural) {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[mural.motif];
  return (mural.width * (y1 - y0)) / (x1 - x0);
}

const f = (n: number) => n.toFixed(6);
export const caveMuralShader = CAVE_MURALS.map((m) => {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[m.motif];
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
      vec2 atlasUV=vec2(${f(x0 / 1254)},${f(1 - y1 / 1254)})+clamp(muralUV,.001,.999)*vec2(${f((x1 - x0) / 1254)},${f((y1 - y0) / 1254)});
      vec4 paint=texture2D(${m.motif === 'creature524' ? 'caveCharacter524' : 'cavePigment'},atlasUV);
      vec3 mineralPaint=paint.rgb*(.84+.24*rockLuma);
      diffuseColor.rgb=mix(diffuseColor.rgb,mineralPaint,paint.a*muralSide*${f(m.strength)});
    }
  }`;
}).join('\n');
