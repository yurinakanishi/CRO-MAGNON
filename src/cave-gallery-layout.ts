// Pixel bounds preserve each complete motif in the unmodified generated atlas.
export const CAVE_MOTIFS = {
  cat: [4, 67, 456, 411],
  creature524: [458, 70, 805, 396],
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
  wall: 'east' | 'west' | 'back';
  centre: number;
  bottom: number;
  width: number;
  strength: number;
};

// Wall coordinates are local Z on the sides, local X at the blind end.
// The two user motifs occur once each on opposite walls at the same depth.
export const CAVE_MURALS: readonly CaveMural[] = [
  { motif: 'hands', wall: 'east', centre: 7.8, bottom: 3.3, width: 0.9, strength: 0.66 },
  { motif: 'redHorse', wall: 'east', centre: 10, bottom: 1.6, width: 3.2, strength: 0.74 },
  { motif: 'mammoth', wall: 'east', centre: 5.65, bottom: 1.8, width: 3, strength: 0.77 },
  { motif: 'signs', wall: 'east', centre: 2.8, bottom: 3.2, width: 1.15, strength: 0.57 },
  { motif: 'cat', wall: 'east', centre: 0.1, bottom: 1.65, width: 3.6, strength: 0.8 },
  { motif: 'deer', wall: 'east', centre: -4, bottom: 1.5, width: 2, strength: 0.66 },
  { motif: 'ochreHorse', wall: 'west', centre: 8.1, bottom: 1.55, width: 2.5, strength: 0.67 },
  { motif: 'bison', wall: 'west', centre: 4.6, bottom: 1.6, width: 2.7, strength: 0.78 },
  { motif: 'hands', wall: 'west', centre: 2.2, bottom: 3.2, width: 0.9, strength: 0.58 },
  { motif: 'creature524', wall: 'west', centre: 0, bottom: 1.8, width: 2.5, strength: 0.79 },
  { motif: 'redHorse', wall: 'west', centre: -3.65, bottom: 1.5, width: 2.6, strength: 0.64 },
  { motif: 'signs', wall: 'west', centre: -6.2, bottom: 1.5, width: 0.9, strength: 0.62 },
  { motif: 'hands', wall: 'back', centre: 1.1, bottom: 1.55, width: 1.3, strength: 0.64 },
  { motif: 'signs', wall: 'back', centre: -0.4, bottom: 2.4, width: 0.8, strength: 0.48 },
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
      : m.wall === 'west'
        ? `(cavePosition.z-(${f(m.centre - m.width / 2)}))/${f(m.width)}`
        : `(cavePosition.x-(${f(m.centre - m.width / 2)}))/${f(m.width)}`;
  const wall =
    m.wall === 'east'
      ? 'step(cavePosition.x,-2.4)*smoothstep(.45,.82,caveNormal.x)'
      : m.wall === 'west'
        ? 'step(2.2,cavePosition.x)*smoothstep(.45,.82,-caveNormal.x)'
        : 'step(cavePosition.z,-8.1)*smoothstep(.55,.85,caveNormal.z)';
  return `{
    vec2 muralUV=vec2(${u},(cavePosition.y-${f(m.bottom)})/${f(caveMuralHeight(m))});
    float muralSide=${wall};
    if(muralSide>0.0 && all(greaterThanEqual(muralUV,vec2(0.0))) && all(lessThanEqual(muralUV,vec2(1.0)))) {
      vec2 atlasUV=vec2(${f(x0 / 1254)},${f(1 - y1 / 1254)})+clamp(muralUV,.001,.999)*vec2(${f((x1 - x0) / 1254)},${f((y1 - y0) / 1254)});
      vec4 paint=texture2D(cavePigment,atlasUV);
      vec3 mineralPaint=paint.rgb*(.55+.65*rockLuma);
      diffuseColor.rgb=mix(diffuseColor.rgb,mineralPaint,paint.a*muralSide*${f(m.strength)});
    }
  }`;
}).join('\n');
