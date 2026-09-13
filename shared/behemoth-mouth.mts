// Generated from /models/violet-behemoth/model-quadruped-r04.glb, SHA-256 6dd28210973bdccc543c0e2805ced82c838b95df2535218a652fda8ca869aa55.
// Midpoint of Head/Jaw front lip, measured from the exported animation.
export const BEHEMOTH_MOUTH_AT_RELEASE = {
  forward: 2.292788796171056,
  height: 1.6189243587876243,
} as const;
const WINDUP = [
  {
    forward: 2.36,
    height: 2.04,
  },
  {
    forward: 2.359028,
    height: 2.045636,
  },
  {
    forward: 2.356057,
    height: 2.061161,
  },
  {
    forward: 2.350766,
    height: 2.084587,
  },
  {
    forward: 2.342786,
    height: 2.113893,
  },
  {
    forward: 2.331972,
    height: 2.146966,
  },
  {
    forward: 2.318599,
    height: 2.181566,
  },
  {
    forward: 2.303464,
    height: 2.215396,
  },
  {
    forward: 2.287909,
    height: 2.246144,
  },
  {
    forward: 2.273755,
    height: 2.27151,
  },
  {
    forward: 2.263104,
    height: 2.28929,
  },
  {
    forward: 2.258094,
    height: 2.297319,
  },
  {
    forward: 2.257932,
    height: 2.297575,
  },
  {
    forward: 2.257932,
    height: 2.297575,
  },
  {
    forward: 2.257932,
    height: 2.297575,
  },
  {
    forward: 2.257932,
    height: 2.297575,
  },
  {
    forward: 2.257932,
    height: 2.297575,
  },
] as const;

export function behemothWindupMouth(progress: number) {
  const sample = Math.max(0, Math.min(1, progress)) * (WINDUP.length - 1);
  const i = Math.min(WINDUP.length - 2, Math.floor(sample)),
    t = sample - i;
  return {
    forward: WINDUP[i].forward + (WINDUP[i + 1].forward - WINDUP[i].forward) * t,
    height: WINDUP[i].height + (WINDUP[i + 1].height - WINDUP[i].height) * t,
  };
}
