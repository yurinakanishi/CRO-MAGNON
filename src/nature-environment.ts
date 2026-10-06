import { biomeAt } from '../shared/biomes.mjs';
import { caveInteriorWeight } from '../shared/cave-light.mjs';
import { riverX, riverHalfWidth, WATER_LEVEL } from '../shared/terrain.mjs';
import { MOUNTAIN_RIVER, mountainWaterHeight } from '../shared/mountain-river.mjs';
import { coastDistance, isLand } from '../shared/paleo-geography.mjs';
import { maritimeWeight } from '../shared/maritime-weather.mjs';

export type SoundPoint = { x: number; y: number; z: number };
export type FootSurface = 'grass' | 'stone' | 'sand' | 'snow' | 'water';
export const unit = (n: number) => Math.max(0, Math.min(1, n));

/** Slow, shared gusts. The same field drives grass, smoke and the wind mix. */
export function natureWind(time: number, x = 0, z = 0) {
  const angle = 0.65 + Math.sin(time * 0.021) * 0.28;
  const strength =
    0.35 +
    0.22 * Math.sin(time * 0.19 + x * 0.012 + z * 0.009) +
    0.12 * Math.sin(time * 0.47 + z * 0.018);
  return { x: Math.cos(angle) * strength, z: Math.sin(angle) * strength, strength };
}

/** Closest point along the actual valley / tributary centre lines, including height. */
export function nearestRiver(p: SoundPoint) {
  let point: SoundPoint = { x: riverX(-40), y: WATER_LEVEL, z: -40 };
  let distance = Infinity;
  const segment = (a: SoundPoint, b: SoundPoint) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const t = unit(
      ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) /
        Math.max(0.001, dx * dx + dy * dy + dz * dz),
    );
    const next = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
    const d = Math.hypot(p.x - next.x, p.y - next.y, p.z - next.z);
    if (d < distance) {
      distance = d;
      point = next;
    }
  };
  if (p.x > 20 && p.x < 145 && p.z > -85 && p.z < 205) {
    const centreZ = Math.max(-40, Math.min(160, p.z));
    for (let z = Math.max(-40, centreZ - 12); z < Math.min(160, centreZ + 12); z += 3)
      segment({ x: riverX(z), y: WATER_LEVEL, z }, { x: riverX(z + 3), y: WATER_LEVEL, z: z + 3 });
  }
  if (p.x > -100 && p.x < 140 && p.z > 130 && p.z < 360)
    for (let i = 1; i < MOUNTAIN_RIVER.length; i++)
      segment(MOUNTAIN_RIVER[i - 1], MOUNTAIN_RIVER[i]);
  return { point, distance };
}

export function waterAt(p: SoundPoint) {
  const mountain = mountainWaterHeight(p.x, p.z);
  if (Number.isFinite(mountain) && p.y < mountain + 0.12) return mountain;
  const river = riverHalfWidth(p.z) > 0.5 && Math.abs(p.x - riverX(p.z)) < riverHalfWidth(p.z);
  if ((!isLand(p.x, p.z) || river) && p.y < WATER_LEVEL + 0.12) return WATER_LEVEL;
  return null;
}

export function natureEnvironment(p: SoundPoint, time: number, weather?: { kind?: string }) {
  const cave = caveInteriorWeight(p);
  const biome = biomeAt(p.x, p.z).id;
  const water = cave < 0.5 ? waterAt(p) : null;
  const shore = cave < 0.5 ? 1 - unit(Math.abs(coastDistance(p.x, p.z)) / 22) : 0;
  const rain = weather?.kind === 'rain' ? maritimeWeight(p.x, p.z) * (1 - cave) : 0;
  const surface: FootSurface =
    water !== null
      ? 'water'
      : cave > 0.35 || biome === 'volcano' || biome === 'ice'
        ? 'stone'
        : biome === 'snow'
          ? 'snow'
          : biome === 'desert' || shore > 0.85
            ? 'sand'
            : 'grass';
  return {
    cave,
    biome,
    water,
    shore,
    rain,
    surface,
    wind: natureWind(time, p.x, p.z),
    river: nearestRiver(p),
  };
}

export type StepSample = SoundPoint & {
  id: string;
  warp: number;
  moving: boolean;
  grounded: boolean;
  phase: number | null;
  clip: string;
};

/** Observe rendered gait phases; never infer a footfall from a teleport or a timer. */
export class FootstepClock {
  private previous: StepSample | null = null;
  private travel = 0;
  private lastStep = -Infinity;
  reset() {
    this.previous = null;
    this.travel = 0;
  }
  update(p: StepSample, time: number) {
    const old = this.previous;
    this.previous = { ...p };
    if (
      !old ||
      old.id !== p.id ||
      old.warp !== p.warp ||
      Math.hypot(p.x - old.x, p.z - old.z) > 1.5
    ) {
      this.travel = 0;
      return false;
    }
    if (!p.grounded || !p.moving || p.phase === null || old.phase === null || p.clip !== old.clip) {
      this.travel = 0;
      return false;
    }
    this.travel += Math.hypot(p.x - old.x, p.z - old.z);
    const crossed = Math.floor(p.phase * 2) !== Math.floor(old.phase * 2) || p.phase < old.phase;
    if (!crossed || this.travel < 0.055 || time - this.lastStep < 0.15) return false;
    this.travel = 0;
    this.lastStep = time;
    return true;
  }
}
