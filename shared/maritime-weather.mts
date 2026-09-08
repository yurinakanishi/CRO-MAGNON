import { GULF, GULF_SPINE, inGulf } from './gulf-region.mjs';
import { coastDistance } from './paleo-geography.mjs';
import type { Point } from './types.mjs';
import type { MaritimeWeather, SeaWeatherKind } from './maritime-types.mjs';

// Authored weather and assisted paddling, not a reconstructed ancient climate or tide model.
export const MARITIME = Object.freeze({ version: 1, periodMs: 180_000 });
export const SEA_WEATHER = {
  calm: {
    name: '凪',
    drag: 0,
    fog: 0,
    rain: 0,
    dim: 0,
    advice: '遠い浜へ渡りやすい空模様。帰りの見通しも確かめよう。',
  },
  breeze: {
    name: '海風',
    drag: 0.12,
    fog: 0.1,
    rain: 0,
    dim: 0.12,
    advice: '沖では流れに沿うと速く、逆らうと遅くなる。岸沿いは影響が小さい。',
  },
  rain: {
    name: '雨風',
    drag: 0.28,
    fog: 0.55,
    rain: 1,
    dim: 0.5,
    advice: '外湾は波で進みが鈍る。岸をたどり、湾奥の浜を経由しよう。',
  },
  mist: {
    name: '海霧',
    drag: 0.04,
    fog: 1,
    rain: 0,
    dim: 0.24,
    advice: '遠い岸が見えにくい。地図と上陸地を頼りに、岸沿いを進もう。',
  },
} as const;
const cycle: readonly { kind: SeaWeatherKind; x: number; z: number }[] = [
  { kind: 'calm', x: 0, z: 0 },
  { kind: 'breeze', x: 0.73, z: 0.15 },
  { kind: 'rain', x: 0.83, z: -0.35 },
  { kind: 'breeze', x: -0.73, z: 0.15 },
  { kind: 'mist', x: -0.28, z: -0.1 },
  { kind: 'calm', x: 0, z: 0 },
];
export function maritimeWeather(now: number, createdAt = now): MaritimeWeather {
  const phase = Math.floor(Math.max(0, now - createdAt) / MARITIME.periodMs);
  const current = cycle[phase % cycle.length];
  return {
    version: MARITIME.version,
    phase,
    kind: current.kind,
    next: cycle[(phase + 1) % cycle.length].kind,
    changesAt: createdAt + (phase + 1) * MARITIME.periodMs,
    currentX: current.x,
    currentZ: current.z,
  };
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function maritimeWeight(x: number, z: number) {
  if (!inGulf(x, z)) return 0;
  const a = GULF_SPINE[4],
    b = GULF_SPINE[5];
  const tangent =
    ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / Math.hypot(b.x - a.x, b.z - a.z) + 208;
  return clamp(Math.min(x - GULF.minX, GULF.maxX - x, z - GULF.minZ, GULF.maxZ - z, tangent) / 48);
}
export function seaConditions(weather: MaritimeWeather | undefined, x: number, z: number) {
  const weight = weather ? maritimeWeight(x, z) : 0;
  // The common coastline grid stores a 32 m distance band. Shelter fades within it.
  const shore = clamp((-coastDistance(x, z) - 4) / 26);
  const outer = clamp((z - 550) / 500);
  const exposure = weight * shore * (0.25 + 0.75 * outer);
  return {
    exposure,
    drag: weather ? SEA_WEATHER[weather.kind].drag * exposure : 0,
    currentX: (weather?.currentX ?? 0) * exposure,
    currentZ: (weather?.currentZ ?? 0) * exposure,
  };
}
export function seaBoatSpeed(
  boat: Point & { dx: number; dz: number; target?: Point | null },
  baseSpeed: number,
  weather?: MaritimeWeather,
) {
  const conditions = seaConditions(weather, boat.x, boat.z);
  const dx = boat.target ? boat.target.x - boat.x : boat.dx;
  const dz = boat.target ? boat.target.z - boat.z : boat.dz;
  const length = Math.hypot(dx, dz);
  const along = length > 0 ? (conditions.currentX * dx + conditions.currentZ * dz) / length : 0;
  // Preserve movement's analog input, collision sweep, stale-input stop and exact path arrival.
  // No lateral drift: releasing the paddle also holds position for fishing and menus.
  return Math.max(
    baseSpeed * 0.55,
    Math.min(baseSpeed * 1.25, baseSpeed * (1 - conditions.drag) + along),
  );
}
export function currentDirection(weather?: MaritimeWeather) {
  if (!weather || Math.hypot(weather.currentX, weather.currentZ) < 0.01) return '流れは穏やか';
  return weather.currentX > 0 ? '東へ流れる' : '西へ流れる';
}
